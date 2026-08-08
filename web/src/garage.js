import {
  CONTENT_MANIFEST,
  GARAGE_CATEGORY,
  TUNING_STAT_IDS,
  allTuningStatIds,
  garageCatalogCategories,
  garageCatalogItems,
  getGarageCatalogItem,
  getTuningStat,
  maybeGetGarageCatalogItem,
} from './content-manifest.js';
import { createRacePhysicsConfig } from './sim.js';

const GARAGE_UNLOCK_KEYS = Object.freeze({
  [GARAGE_CATEGORY.PAINTS]: 'paints',
  [GARAGE_CATEGORY.UNDERGLOWS]: 'underglows',
  [GARAGE_CATEGORY.LIVERIES]: 'liveries',
});

const FALLBACK_RENDER_PARAMETERS = Object.freeze({
  body: '#28f6ff',
  emissive: '#07304c',
  wing: '#ff3bd4',
  canopy: '#ffe66d',
  underglow: '#45ff8a',
  underglowIntensity: 1.2,
  livery: Object.freeze({
    pattern: 'none',
    accent: '#16f0e6',
    secondary: '#ffffff',
    opacity: 0,
  }),
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function tierValue(save, statId) {
  const value = save?.tiers?.[statId];
  return Number.isSafeInteger(value) ? Math.max(0, Math.min(4, value)) : 0;
}

function completedCourseIds(save) {
  const ids = new Set(save?.campaign?.completedCourseIds ?? []);
  for (const [courseId, record] of Object.entries(save?.levels ?? {})) {
    if (record?.completed === true) ids.add(courseId);
  }
  return ids;
}

export function isGarageUnlockSatisfied(save, unlock) {
  if (!unlock || unlock.type === 'default') return true;
  if (unlock.type === 'course-complete') return completedCourseIds(save).has(unlock.courseId);
  if (unlock.type === 'rival-reward') return save?.rewards?.claimed?.includes(unlock.rewardId) === true;
  return false;
}

function unlockKeyForCategory(category) {
  const key = GARAGE_UNLOCK_KEYS[category];
  if (!key) throw new Error(`unknown garage category ${category}`);
  return key;
}

export function isGarageItemOwned(save, category, id, manifest = CONTENT_MANIFEST) {
  const item = maybeGetGarageCatalogItem(category, id, manifest);
  if (!item || !isGarageUnlockSatisfied(save, item.unlock)) return false;
  if (item.price === 0) return true;
  const key = unlockKeyForCategory(category);
  return save?.unlocks?.[key]?.includes(id) === true;
}

function defaultSelection(manifest = CONTENT_MANIFEST) {
  return cloneData(manifest.garage.defaults);
}

function normalizeSelection(selection, save, manifest = CONTENT_MANIFEST) {
  const defaults = defaultSelection(manifest);
  const desired = selection ?? save?.cosmetics ?? defaults;
  const paint = isGarageItemOwned(save, GARAGE_CATEGORY.PAINTS, desired.paint, manifest)
    ? desired.paint
    : defaults.paint;
  const underglow = isGarageItemOwned(save, GARAGE_CATEGORY.UNDERGLOWS, desired.underglow, manifest)
    ? desired.underglow
    : defaults.underglow;
  const pattern = isGarageItemOwned(save, GARAGE_CATEGORY.LIVERIES, desired.livery?.pattern, manifest)
    ? desired.livery.pattern
    : defaults.livery.pattern;
  const liveryItem = getGarageCatalogItem(GARAGE_CATEGORY.LIVERIES, pattern, manifest);
  return {
    paint,
    underglow,
    livery: {
      pattern,
      accent: liveryItem.params?.accent ?? defaults.livery.accent,
    },
  };
}

function ensureGarageShape(save) {
  const next = cloneData(save);
  next.credits = Number.isSafeInteger(next.credits) && next.credits >= 0 ? next.credits : 0;
  next.unlocks = next.unlocks ?? {};
  for (const key of Object.values(GARAGE_UNLOCK_KEYS)) {
    next.unlocks[key] = Array.isArray(next.unlocks[key]) ? [...next.unlocks[key]] : [];
  }
  next.tiers = {
    topSpeed: tierValue(next, TUNING_STAT_IDS.TOP_SPEED),
    accel: tierValue(next, TUNING_STAT_IDS.ACCEL),
    handling: tierValue(next, TUNING_STAT_IDS.HANDLING),
    lift: tierValue(next, TUNING_STAT_IDS.LIFT),
  };
  next.cosmetics = normalizeSelection(next.cosmetics, next);
  return next;
}

function reject(save, reason, message) {
  return Object.freeze({
    ok: false,
    reason,
    message,
    save: cloneData(save),
  });
}

function accept(save, detail = {}) {
  return Object.freeze({
    ok: true,
    reason: null,
    message: detail.message ?? null,
    save: cloneData(save),
    ...detail,
  });
}

export function previewGarageSelection(save, patch = {}, manifest = CONTENT_MANIFEST) {
  const base = normalizeSelection(save?.cosmetics, save, manifest);
  return normalizeSelection({
    paint: patch.paint ?? base.paint,
    underglow: patch.underglow ?? base.underglow,
    livery: {
      pattern: patch.livery?.pattern ?? patch.pattern ?? base.livery.pattern,
      accent: patch.livery?.accent ?? base.livery.accent,
    },
  }, save, manifest);
}

export function buyGarageItem(save, category, id, manifest = CONTENT_MANIFEST) {
  const item = getGarageCatalogItem(category, id, manifest);
  const next = ensureGarageShape(save);
  if (!isGarageUnlockSatisfied(next, item.unlock)) {
    return reject(next, 'locked', `${item.name} is still locked`);
  }
  if (isGarageItemOwned(next, category, id, manifest)) {
    return accept(next, { item, spent: 0, alreadyOwned: true, message: `${item.name} is already owned` });
  }
  if (next.credits < item.price) {
    return reject(next, 'insufficient-credits', `${item.name} costs ${item.price} credits`);
  }
  const key = unlockKeyForCategory(category);
  next.credits -= item.price;
  next.unlocks[key].push(id);
  return accept(next, { item, spent: item.price, alreadyOwned: false, message: `${item.name} purchased` });
}

export function equipGarageItem(save, category, id, manifest = CONTENT_MANIFEST) {
  const item = getGarageCatalogItem(category, id, manifest);
  const next = ensureGarageShape(save);
  if (!isGarageItemOwned(next, category, id, manifest)) {
    return reject(next, 'not-owned', `${item.name} is not owned`);
  }
  if (category === GARAGE_CATEGORY.PAINTS) next.cosmetics.paint = id;
  else if (category === GARAGE_CATEGORY.UNDERGLOWS) next.cosmetics.underglow = id;
  else if (category === GARAGE_CATEGORY.LIVERIES) {
    next.cosmetics.livery = {
      pattern: id,
      accent: item.params?.accent ?? next.cosmetics.livery.accent,
    };
  }
  return accept(next, { item, equipped: true, message: `${item.name} equipped` });
}

export function resetGarageConfiguration(save, manifest = CONTENT_MANIFEST) {
  const next = ensureGarageShape(save);
  next.cosmetics = defaultSelection(manifest);
  next.tiers = { topSpeed: 0, accel: 0, handling: 0, lift: 0 };
  return accept(next, { message: 'Garage configuration reset' });
}

function upgradeCost(stat, currentTier, targetTier) {
  let cost = 0;
  for (let tier = currentTier + 1; tier <= targetTier; tier++) cost += stat.prices[tier];
  return cost;
}

export function buyTuningTier(save, statId, targetTier, manifest = CONTENT_MANIFEST) {
  const stat = getTuningStat(statId, manifest);
  const next = ensureGarageShape(save);
  const tier = Number(targetTier);
  if (!Number.isSafeInteger(tier) || tier < 0 || tier > 4) {
    return reject(next, 'invalid-tier', `${stat.label} tier must be 0..4`);
  }
  const currentTier = tierValue(next, statId);
  if (tier <= currentTier) {
    return accept(next, { stat, spent: 0, currentTier, targetTier: currentTier, message: `${stat.label} is already tier ${currentTier}` });
  }
  if (!isGarageUnlockSatisfied(next, stat.unlock)) {
    return reject(next, 'locked', `${stat.label} tuning is locked`);
  }
  const cost = upgradeCost(stat, currentTier, tier);
  if (next.credits < cost) {
    return reject(next, 'insufficient-credits', `${stat.label} tier ${tier} costs ${cost} credits`);
  }
  next.credits -= cost;
  next.tiers[statId] = tier;
  return accept(next, { stat, spent: cost, previousTier: currentTier, targetTier: tier, message: `${stat.label} upgraded to tier ${tier}` });
}

export function createRaceTuningConfig(save, manifest = CONTENT_MANIFEST) {
  const tiers = save?.tiers ?? {};
  const topSpeed = getTuningStat(TUNING_STAT_IDS.TOP_SPEED, manifest).multipliers[tierValue({ tiers }, TUNING_STAT_IDS.TOP_SPEED)];
  const acceleration = getTuningStat(TUNING_STAT_IDS.ACCEL, manifest).multipliers[tierValue({ tiers }, TUNING_STAT_IDS.ACCEL)];
  const handling = getTuningStat(TUNING_STAT_IDS.HANDLING, manifest).multipliers[tierValue({ tiers }, TUNING_STAT_IDS.HANDLING)];
  const lift = getTuningStat(TUNING_STAT_IDS.LIFT, manifest).multipliers[tierValue({ tiers }, TUNING_STAT_IDS.LIFT)];
  return createRacePhysicsConfig({
    topSpeedMultiplier: topSpeed,
    accelerationMultiplier: acceleration,
    handlingMultiplier: handling,
    jumpVelocityMultiplier: lift,
    fuelEfficiencyMultiplier: lift,
  });
}

export function createRaceTuningConfigId(save) {
  const tiers = save?.tiers ?? {};
  return [
    `top${tierValue({ tiers }, TUNING_STAT_IDS.TOP_SPEED)}`,
    `accel${tierValue({ tiers }, TUNING_STAT_IDS.ACCEL)}`,
    `handling${tierValue({ tiers }, TUNING_STAT_IDS.HANDLING)}`,
    `lift${tierValue({ tiers }, TUNING_STAT_IDS.LIFT)}`,
  ].join(':');
}

export function createCraftRenderParameters(saveOrSelection, manifest = CONTENT_MANIFEST) {
  const fakeSave = saveOrSelection?.cosmetics
    ? saveOrSelection
    : { cosmetics: saveOrSelection, unlocks: { paints: [], underglows: [], liveries: [] } };
  const selection = fakeSave?.cosmetics
    ? fakeSave.cosmetics
    : defaultSelection(manifest);
  const paint = maybeGetGarageCatalogItem(GARAGE_CATEGORY.PAINTS, selection.paint, manifest)
    ?? getGarageCatalogItem(GARAGE_CATEGORY.PAINTS, manifest.garage.defaults.paint, manifest);
  const underglow = maybeGetGarageCatalogItem(GARAGE_CATEGORY.UNDERGLOWS, selection.underglow, manifest)
    ?? getGarageCatalogItem(GARAGE_CATEGORY.UNDERGLOWS, manifest.garage.defaults.underglow, manifest);
  const livery = maybeGetGarageCatalogItem(GARAGE_CATEGORY.LIVERIES, selection.livery?.pattern, manifest)
    ?? getGarageCatalogItem(GARAGE_CATEGORY.LIVERIES, manifest.garage.defaults.livery.pattern, manifest);
  return deepFreeze({
    body: paint.material?.color ?? FALLBACK_RENDER_PARAMETERS.body,
    emissive: paint.material?.emissive ?? FALLBACK_RENDER_PARAMETERS.emissive,
    wing: paint.material?.wing ?? FALLBACK_RENDER_PARAMETERS.wing,
    canopy: paint.material?.canopy ?? FALLBACK_RENDER_PARAMETERS.canopy,
    underglow: underglow.material?.color ?? FALLBACK_RENDER_PARAMETERS.underglow,
    underglowIntensity: underglow.material?.intensity ?? FALLBACK_RENDER_PARAMETERS.underglowIntensity,
    livery: {
      pattern: livery.params?.pattern ?? FALLBACK_RENDER_PARAMETERS.livery.pattern,
      accent: livery.params?.accent ?? FALLBACK_RENDER_PARAMETERS.livery.accent,
      secondary: livery.params?.secondary ?? FALLBACK_RENDER_PARAMETERS.livery.secondary,
      opacity: livery.params?.opacity ?? FALLBACK_RENDER_PARAMETERS.livery.opacity,
    },
  });
}

export function reactionMarginForTiers(tiers = {}, manifest = CONTENT_MANIFEST) {
  const topSpeed = getTuningStat(TUNING_STAT_IDS.TOP_SPEED, manifest).multipliers[tierValue({ tiers }, TUNING_STAT_IDS.TOP_SPEED)];
  const accel = getTuningStat(TUNING_STAT_IDS.ACCEL, manifest).multipliers[tierValue({ tiers }, TUNING_STAT_IDS.ACCEL)];
  const handling = getTuningStat(TUNING_STAT_IDS.HANDLING, manifest).multipliers[tierValue({ tiers }, TUNING_STAT_IDS.HANDLING)];
  const lift = getTuningStat(TUNING_STAT_IDS.LIFT, manifest).multipliers[tierValue({ tiers }, TUNING_STAT_IDS.LIFT)];
  const authority = (handling + lift) / 2;
  const arrivalRate = (topSpeed + accel) / 2;
  const score = Math.round(authority / arrivalRate * 100);
  const label = score >= 105 ? 'Wide' : score >= 92 ? 'Narrow' : 'Critical';
  return deepFreeze({
    label,
    score,
    authority,
    arrivalRate,
    copy: 'Reaction Margin compares handling plus lift authority against top-speed and acceleration arrival rate.',
    limitation: 'Lift also improves fuel efficiency, but gravity 20+ courses still disable jumps.',
  });
}

export function createGarageView(save, options = {}) {
  const manifest = options.manifest ?? CONTENT_MANIFEST;
  const equipped = normalizeSelection(save?.cosmetics, save, manifest);
  const preview = options.preview ? previewGarageSelection(save, options.preview, manifest) : equipped;
  const categoryViews = {};
  for (const category of garageCatalogCategories()) {
    categoryViews[category] = garageCatalogItems(category, manifest).map((item) => {
      const unlocked = isGarageUnlockSatisfied(save, item.unlock);
      const owned = isGarageItemOwned(save, category, item.id, manifest);
      const equippedId = category === GARAGE_CATEGORY.LIVERIES ? equipped.livery.pattern : equipped[category.slice(0, -1)];
      const previewId = category === GARAGE_CATEGORY.LIVERIES ? preview.livery.pattern : preview[category.slice(0, -1)];
      return {
        id: item.id,
        name: item.name,
        price: item.price,
        unlock: cloneData(item.unlock),
        unlocked,
        owned,
        equipped: equippedId === item.id,
        previewed: previewId === item.id,
        disabledReason: unlocked ? null : item.unlock.type === 'course-complete'
          ? `Complete ${item.unlock.courseId} to unlock`
          : 'Locked',
        material: cloneData(item.material ?? item.params ?? {}),
      };
    });
  }
  const tuning = {};
  for (const statId of allTuningStatIds(manifest)) {
    const stat = getTuningStat(statId, manifest);
    const currentTier = tierValue(save, statId);
    const nextTier = Math.min(4, currentTier + 1);
    tuning[statId] = {
      id: stat.id,
      label: stat.label,
      copy: stat.copy,
      injectionPoints: [...stat.injectionPoints],
      configKeys: [...stat.configKeys],
      currentTier,
      multiplier: stat.multipliers[currentTier],
      nextTier,
      nextMultiplier: stat.multipliers[nextTier],
      nextPrice: currentTier < 4 ? stat.prices[nextTier] : 0,
      maxed: currentTier >= 4,
    };
  }
  return deepFreeze({
    credits: save?.credits ?? 0,
    equipped,
    preview,
    renderParameters: createCraftRenderParameters({ cosmetics: preview }, manifest),
    catalogs: categoryViews,
    tuning,
    raceConfig: createRaceTuningConfig(save, manifest),
    reactionMargin: reactionMarginForTiers(save?.tiers, manifest),
  });
}
