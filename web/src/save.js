import { CONTENT_MANIFEST, GARAGE_CATEGORY, MEDAL, allManifestCourseIds, allRivalIds } from './content-manifest.js';
import { validateStoredGhostPayload } from './ghost.js';
import { normalizeKeyBindings } from './input.js';
import {
  DEFAULT_PRESENTATION_SETTINGS,
  normalizePresentationSettings,
} from './presentation-settings.js';

export const SAVE_KEY = 'skyroads-neon.save.v1';
export const QUARANTINE_KEY = 'skyroads-neon.save.v1.quarantine';
export const SAVE_VERSION = 1;

export const SAVE_LIMITS = Object.freeze({
  wholeSaveBytes: 262144,
  ghostBytes: 32768,
  allGhostsBytes: 196608,
  nonGhostCoreBytes: 65536,
  shipNameLength: 32,
});

const textEncoder = new TextEncoder();

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function byteLength(value) {
  return textEncoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
}

function clampInt(value, min, max, fallback = min) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Number(value)));
}

function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function safeString(value, fallback, maxLength = 96) {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  return value.slice(0, maxLength);
}

function safeHex(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function knownCourseSet(manifest = CONTENT_MANIFEST) {
  return new Set(allManifestCourseIds({ manifest }));
}

function uniqueKnownArray(value, ids) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const id of value) {
    if (typeof id !== 'string' || !ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function uniqueStringArray(value, maxItems = 128) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 96 || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= maxItems) break;
  }
  return result;
}

function garageDefaults(manifest) {
  return manifest.garage.defaults;
}

function completedCourseIds(save) {
  const ids = new Set(save.campaign?.completedCourseIds ?? []);
  for (const [courseId, record] of Object.entries(save.levels ?? {})) {
    if (record?.completed === true) ids.add(courseId);
  }
  return ids;
}

function garageUnlockSatisfied(save, unlock) {
  if (!unlock || unlock.type === 'default') return true;
  if (unlock.type === 'course-complete') return completedCourseIds(save).has(unlock.courseId);
  if (unlock.type === 'rival-reward') return save.rewards?.claimed?.includes(unlock.rewardId) === true;
  return false;
}

function garageItems(manifest, category) {
  return manifest.garage?.catalogs?.[category] ?? [];
}

function garageItem(manifest, category, id) {
  return garageItems(manifest, category).find((item) => item.id === id) ?? null;
}

function sanitizeGarageUnlocks(inputUnlocks, category, save, manifest) {
  const ids = new Set(garageItems(manifest, category).map((item) => item.id));
  const result = [];
  for (const id of uniqueStringArray(inputUnlocks)) {
    if (!ids.has(id)) continue;
    const item = garageItem(manifest, category, id);
    if (!item || item.price === 0 || !garageUnlockSatisfied(save, item.unlock)) continue;
    result.push(id);
  }
  return result;
}

function ownsGarageItem(save, category, id, manifest) {
  const item = garageItem(manifest, category, id);
  if (!item || !garageUnlockSatisfied(save, item.unlock)) return false;
  if (item.price === 0) return true;
  return save.unlocks?.[category]?.includes(id) === true;
}

function sanitizeCosmetics(inputCosmetics, save, manifest) {
  const defaults = garageDefaults(manifest);
  const paint = safeString(inputCosmetics?.paint, defaults.paint, 64);
  const underglow = safeString(inputCosmetics?.underglow, defaults.underglow, 64);
  const pattern = safeString(inputCosmetics?.livery?.pattern, defaults.livery.pattern, 64);
  const safePaint = ownsGarageItem(save, GARAGE_CATEGORY.PAINTS, paint, manifest) ? paint : defaults.paint;
  const safeUnderglow = ownsGarageItem(save, GARAGE_CATEGORY.UNDERGLOWS, underglow, manifest) ? underglow : defaults.underglow;
  const safePattern = ownsGarageItem(save, GARAGE_CATEGORY.LIVERIES, pattern, manifest) ? pattern : defaults.livery.pattern;
  const liveryItem = garageItem(manifest, GARAGE_CATEGORY.LIVERIES, safePattern);
  return {
    paint: safePaint,
    underglow: safeUnderglow,
    livery: {
      pattern: safePattern,
      accent: safeHex(liveryItem?.params?.accent, defaults.livery.accent),
    },
  };
}

export function createDefaultSave(manifest = CONTENT_MANIFEST) {
  const firstStarter = manifest.starterCup.courses[0]?.id ?? null;
  const defaults = garageDefaults(manifest);
  return {
    v: SAVE_VERSION,
    credits: 0,
    tiers: { topSpeed: 0, accel: 0, handling: 0, lift: 0 },
    cosmetics: {
      paint: defaults.paint,
      underglow: defaults.underglow,
      livery: { pattern: defaults.livery.pattern, accent: defaults.livery.accent },
    },
    shipName: 'NEONDRIFT',
    worlds: { unlockedMax: 0 },
    levels: {},
    campaign: {
      unlockedCourseIds: firstStarter ? [firstStarter] : [],
      completedCourseIds: [],
    },
    blacklist: { defeated: [], mostWanted: false },
    rivals: { defeated: [] },
    unlocks: { paints: [], underglows: [], liveries: [], courses: firstStarter ? [firstStarter] : [] },
    rewards: { claimed: [] },
    ghosts: {},
    audio: { muted: false, volume: 0.8, music: true, retroMuzax: false },
    settings: {
      ...DEFAULT_PRESENTATION_SETTINGS,
      keyBindings: normalizeKeyBindings(),
      jomAssist: false,
    },
  };
}

function sanitizeLevelRecords(inputLevels, ids) {
  const levels = {};
  if (!inputLevels || typeof inputLevels !== 'object' || Array.isArray(inputLevels)) return levels;
  for (const [courseId, value] of Object.entries(inputLevels)) {
    if (!ids.has(courseId) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const bestTicks = Number.isSafeInteger(value.bestTicks) && value.bestTicks > 0 ? value.bestTicks : null;
    levels[courseId] = {
      bestTicks,
      medal: clampInt(value.medal, MEDAL.NONE, MEDAL.GOLD, MEDAL.NONE),
      completed: boolOr(value.completed, false),
      clean: boolOr(value.clean, false),
    };
  }
  return levels;
}

function normalizeGhostValue(value, levelRecord, options = {}) {
  if (!levelRecord || !Number.isSafeInteger(levelRecord.bestTicks) || levelRecord.bestTicks <= 0) return null;
  const ghost = validateStoredGhostPayload(value, {
    courseId: options.courseId,
    levelRecord,
  });
  if (!ghost) return null;
  if (byteLength(ghost) > SAVE_LIMITS.ghostBytes) return null;
  return ghost;
}

function evictGhostsWithinBudget(ghosts) {
  const next = { ...ghosts };
  const ordered = Object.entries(next).sort(([leftId, left], [rightId, right]) => {
    const bySlowest = right.bestTicks - left.bestTicks;
    if (bySlowest !== 0) return bySlowest;
    return rightId.localeCompare(leftId);
  });
  while (byteLength(next) > SAVE_LIMITS.allGhostsBytes && ordered.length > 0) {
    const [courseId] = ordered.shift();
    delete next[courseId];
  }
  return next;
}

function sanitizeGhosts(inputGhosts, ids, levels) {
  const ghosts = {};
  if (!inputGhosts || typeof inputGhosts !== 'object' || Array.isArray(inputGhosts)) return ghosts;
  for (const [courseId, value] of Object.entries(inputGhosts)) {
    if (!ids.has(courseId)) continue;
    const ghost = normalizeGhostValue(value, levels[courseId], { courseId });
    if (ghost) ghosts[courseId] = ghost;
  }
  return evictGhostsWithinBudget(ghosts);
}

function coreWithoutGhosts(save) {
  const core = cloneData(save);
  delete core.ghosts;
  return core;
}

function rawCoreTooLarge(input) {
  if (!input || typeof input !== 'object') return false;
  const core = { ...input };
  delete core.ghosts;
  return byteLength(core) > SAVE_LIMITS.nonGhostCoreBytes;
}

export function validateSaveObject(input, options = {}) {
  const manifest = options.manifest ?? CONTENT_MANIFEST;
  const ids = knownCourseSet(manifest);
  const defaults = createDefaultSave(manifest);
  const warnings = [];

  if (input == null) return { save: defaults, warnings, quarantined: false, reason: null };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { save: defaults, warnings: ['save root is not an object'], quarantined: true, reason: 'invalid-root' };
  }
  if (input.v !== undefined && input.v !== SAVE_VERSION) {
    return { save: defaults, warnings: [`unknown save version ${input.v}`], quarantined: true, reason: 'unknown-version' };
  }
  if (rawCoreTooLarge(input)) {
    return { save: defaults, warnings: ['non-ghost save core exceeds byte limit'], quarantined: true, reason: 'core-oversize' };
  }

  const save = createDefaultSave(manifest);
  const rivalIds = new Set(allRivalIds(manifest));
  save.credits = Number.isSafeInteger(input.credits) && input.credits >= 0 ? input.credits : 0;
  save.tiers = {
    topSpeed: clampInt(input.tiers?.topSpeed, 0, 4, 0),
    accel: clampInt(input.tiers?.accel, 0, 4, 0),
    handling: clampInt(input.tiers?.handling, 0, 4, 0),
    lift: clampInt(input.tiers?.lift, 0, 4, 0),
  };
  save.shipName = safeString(input.shipName, defaults.shipName, SAVE_LIMITS.shipNameLength);
  save.worlds = { unlockedMax: clampInt(input.worlds?.unlockedMax, 0, 9, 0) };
  save.levels = sanitizeLevelRecords(input.levels, ids);
  save.campaign = {
    unlockedCourseIds: uniqueKnownArray(input.campaign?.unlockedCourseIds, ids),
    completedCourseIds: uniqueKnownArray(input.campaign?.completedCourseIds, ids),
  };
  if (save.campaign.unlockedCourseIds.length === 0) {
    save.campaign.unlockedCourseIds = [...defaults.campaign.unlockedCourseIds];
  }
  save.blacklist = {
    defeated: uniqueKnownArray(input.blacklist?.defeated, ids),
    mostWanted: boolOr(input.blacklist?.mostWanted, false),
  };
  save.rivals = {
    defeated: uniqueKnownArray(input.rivals?.defeated, rivalIds),
  };
  save.rewards = {
    claimed: uniqueStringArray(input.rewards?.claimed, 512),
  };
  save.unlocks = {
    paints: [],
    underglows: [],
    liveries: [],
    courses: uniqueKnownArray(input.unlocks?.courses, ids),
  };
  if (save.unlocks.courses.length === 0) save.unlocks.courses = [...save.campaign.unlockedCourseIds];
  save.unlocks.paints = sanitizeGarageUnlocks(input.unlocks?.paints, GARAGE_CATEGORY.PAINTS, save, manifest);
  save.unlocks.underglows = sanitizeGarageUnlocks(input.unlocks?.underglows, GARAGE_CATEGORY.UNDERGLOWS, save, manifest);
  save.unlocks.liveries = sanitizeGarageUnlocks(input.unlocks?.liveries, GARAGE_CATEGORY.LIVERIES, save, manifest);
  save.cosmetics = sanitizeCosmetics(input.cosmetics, save, manifest);
  save.audio = {
    muted: boolOr(input.audio?.muted, defaults.audio.muted),
    volume: clampNumber(input.audio?.volume, 0, 1, defaults.audio.volume),
    music: boolOr(input.audio?.music, defaults.audio.music),
    retroMuzax: false,
  };
  const presentationSettings = normalizePresentationSettings(input.settings ?? defaults.settings);
  save.settings = {
    ...presentationSettings,
    keyBindings: normalizeKeyBindings(input.settings?.keyBindings ?? defaults.settings.keyBindings),
    jomAssist: boolOr(input.settings?.jomAssist, defaults.settings.jomAssist),
  };
  save.ghosts = sanitizeGhosts(input.ghosts, ids, save.levels);
  if (byteLength(save) > SAVE_LIMITS.wholeSaveBytes) {
    save.ghosts = {};
    warnings.push('all ghosts dropped because whole save exceeded byte limit');
  }
  if (byteLength(coreWithoutGhosts(save)) > SAVE_LIMITS.nonGhostCoreBytes) {
    return { save: defaults, warnings: ['normalized non-ghost core exceeds byte limit'], quarantined: true, reason: 'core-oversize' };
  }
  if (byteLength(save) > SAVE_LIMITS.wholeSaveBytes) {
    return { save: defaults, warnings: ['normalized save exceeds byte limit'], quarantined: true, reason: 'whole-oversize' };
  }
  return { save, warnings, quarantined: false, reason: null };
}

export function decodeSave(raw, options = {}) {
  if (raw == null) return validateSaveObject(null, options);
  try {
    return validateSaveObject(JSON.parse(raw), options);
  } catch (error) {
    return {
      save: createDefaultSave(options.manifest ?? CONTENT_MANIFEST),
      warnings: [`corrupt save JSON: ${error.message}`],
      quarantined: true,
      reason: 'corrupt-json',
    };
  }
}

export function encodeSave(save, options = {}) {
  const normalized = validateSaveObject(save, options);
  return {
    ...normalized,
    raw: JSON.stringify(normalized.save),
    bytes: byteLength(normalized.save),
  };
}

export function upsertGhost(save, courseId, ghost, options = {}) {
  const ids = knownCourseSet(options.manifest ?? CONTENT_MANIFEST);
  if (!ids.has(courseId)) return { save: cloneData(save), accepted: false, reason: 'unknown-course' };
  const candidate = cloneData(save);
  candidate.ghosts = candidate.ghosts ?? {};
  const normalizedGhost = normalizeGhostValue(ghost, candidate.levels?.[courseId], { courseId });
  if (!normalizedGhost) return { save: candidate, accepted: false, reason: 'invalid-or-oversize-ghost' };
  const previous = candidate.ghosts[courseId];
  if (previous && normalizedGhost.bestTicks >= previous.bestTicks) {
    return { save: candidate, accepted: false, reason: 'not-new-best' };
  }
  candidate.ghosts[courseId] = normalizedGhost;
  const normalized = validateSaveObject(candidate, options).save;
  return {
    save: normalized,
    accepted: Object.hasOwn(normalized.ghosts, courseId),
    reason: Object.hasOwn(normalized.ghosts, courseId) ? null : 'evicted-by-budget',
  };
}

export class MemoryStorage {
  constructor(initial = {}) {
    this.data = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  }

  setItem(key, value) {
    this.data.set(key, String(value));
  }

  removeItem(key) {
    this.data.delete(key);
  }
}

export function createSaveManager(options = {}) {
  const manifest = options.manifest ?? CONTENT_MANIFEST;
  const fallbackStorage = options.fallbackStorage ?? new MemoryStorage();
  const warnings = [];
  let storage = options.storage;
  if (!storage) {
    try {
      storage = globalThis.localStorage ?? fallbackStorage;
    } catch (error) {
      storage = fallbackStorage;
      warnings.push(`storage unavailable: ${error.name || error.message}`);
    }
  }
  let usingFallback = storage === fallbackStorage;
  let state = null;

  function markFallback(reason) {
    if (!usingFallback) warnings.push(reason);
    usingFallback = true;
    storage = fallbackStorage;
  }

  function safeGet(key) {
    try {
      return storage.getItem(key);
    } catch (error) {
      markFallback(`storage unavailable: ${error.name || error.message}`);
      return fallbackStorage.getItem(key);
    }
  }

  function safeSet(key, value) {
    try {
      storage.setItem(key, value);
      return true;
    } catch (error) {
      markFallback(`storage write failed: ${error.name || error.message}`);
      fallbackStorage.setItem(key, value);
      return false;
    }
  }

  function safeRemove(key) {
    try {
      storage.removeItem(key);
    } catch (error) {
      markFallback(`storage remove failed: ${error.name || error.message}`);
      fallbackStorage.removeItem(key);
    }
  }

  function load() {
    const raw = safeGet(SAVE_KEY);
    const decoded = decodeSave(raw, { manifest });
    if (decoded.quarantined && raw != null) safeSet(QUARANTINE_KEY, raw);
    state = decoded.save;
    const encoded = JSON.stringify(state);
    if (raw !== encoded) safeSet(SAVE_KEY, encoded);
    return {
      save: cloneData(state),
      quarantined: decoded.quarantined,
      reason: decoded.reason,
      warnings: [...warnings, ...decoded.warnings],
      storage: usingFallback ? 'memory' : 'localStorage',
    };
  }

  function write(nextSave) {
    const encoded = encodeSave(nextSave, { manifest });
    state = encoded.save;
    safeSet(SAVE_KEY, encoded.raw);
    return {
      save: cloneData(state),
      bytes: encoded.bytes,
      warnings: [...warnings, ...encoded.warnings],
      storage: usingFallback ? 'memory' : 'localStorage',
    };
  }

  function update(mutator) {
    if (!state) load();
    const draft = cloneData(state);
    const next = mutator(draft) ?? draft;
    return write(next);
  }

  function reset(options = {}) {
    if (options.confirm !== 'RESET') throw new Error('reset requires explicit confirmation');
    state = createDefaultSave(manifest);
    safeRemove(QUARANTINE_KEY);
    return write(state);
  }

  function status() {
    return {
      storage: usingFallback ? 'memory' : 'localStorage',
      warnings: [...warnings],
    };
  }

  return { load, write, update, reset, status, fallbackStorage };
}
