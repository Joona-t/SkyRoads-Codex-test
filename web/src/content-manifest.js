export const MANIFEST_VERSION = 1;

export const MEDAL = Object.freeze({
  NONE: 0,
  BRONZE: 1,
  SILVER: 2,
  GOLD: 3,
});

export const MEDAL_NAMES = Object.freeze({
  [MEDAL.NONE]: 'None',
  [MEDAL.BRONZE]: 'Bronze',
  [MEDAL.SILVER]: 'Silver',
  [MEDAL.GOLD]: 'Gold',
});

export const STARTER_CUP_ID = 'starter-cup';

export const STARTER_COURSE_IDS = Object.freeze({
  TRAINING: 'tutorial',
  HANDLING: 'starter-handling',
  JUMP_EFFECT: 'starter-ion-gauntlet',
});

export const STARTER_COURSE_ALIASES = Object.freeze({
  'starter-jump-effect': STARTER_COURSE_IDS.JUMP_EFFECT,
});

export const SOURCE_DEMO_COURSE_ID = 'source-demo-00';
export const SOURCE_WORLD_COUNT = 10;
export const SOURCE_COURSES_PER_WORLD = 3;
export const SOURCE_CAMPAIGN_COURSE_COUNT = SOURCE_WORLD_COUNT * SOURCE_COURSES_PER_WORLD;

export const COURSE_KIND = Object.freeze({
  STARTER: 'starter',
  SOURCE_CAMPAIGN: 'source-campaign',
  SOURCE_DEMO: 'source-demo',
});

export const GARAGE_CATEGORY = Object.freeze({
  PAINTS: 'paints',
  UNDERGLOWS: 'underglows',
  LIVERIES: 'liveries',
});

export const SPARKY_LIVERY_ID = 'sparky-signal';
export const SPARKY_LIVERY_REWARD_ID = 'rival-reward:rank-1:sparky-signal';

export const TUNING_STAT_IDS = Object.freeze({
  TOP_SPEED: 'topSpeed',
  ACCEL: 'accel',
  HANDLING: 'handling',
  LIFT: 'lift',
});

const DEFAULT_REWARDS = Object.freeze({
  baseCredits: 350,
  medalBonuses: Object.freeze({
    [MEDAL.BRONZE]: 100,
    [MEDAL.SILVER]: 225,
    [MEDAL.GOLD]: 400,
  }),
  cleanRunBonus: 150,
});

const STARTER_REWARDS = Object.freeze({
  baseCredits: 500,
  medalBonuses: Object.freeze({
    [MEDAL.BRONZE]: 125,
    [MEDAL.SILVER]: 275,
    [MEDAL.GOLD]: 475,
  }),
  cleanRunBonus: 200,
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const DEFAULT_GARAGE_SELECTION = deepFreeze({
  paint: 'neon-cyan',
  underglow: 'volt-green',
  livery: { pattern: 'none', accent: '#16f0e6' },
});

function defaultUnlock() {
  return Object.freeze({ type: 'default' });
}

function completionUnlock(courseId) {
  return Object.freeze({ type: 'course-complete', courseId });
}

function rivalRewardUnlock(rewardId) {
  return Object.freeze({ type: 'rival-reward', rewardId });
}

export const GARAGE_CATALOGS = deepFreeze({
  [GARAGE_CATEGORY.PAINTS]: [
    {
      id: DEFAULT_GARAGE_SELECTION.paint,
      name: 'Ion Cyan',
      price: 0,
      unlock: defaultUnlock(),
      material: { color: '#28f6ff', emissive: '#07304c', wing: '#ff3bd4', canopy: '#ffe66d' },
    },
    {
      id: 'sunset-magenta',
      name: 'Sunset Magenta',
      price: 400,
      unlock: defaultUnlock(),
      material: { color: '#ff3bd4', emissive: '#3d0932', wing: '#16f0e6', canopy: '#ffe66d' },
    },
    {
      id: 'hazard-rose',
      name: 'Hazard Rose',
      price: 750,
      unlock: completionUnlock(STARTER_COURSE_IDS.TRAINING),
      material: { color: '#ff2b4e', emissive: '#4c0718', wing: '#ffe66d', canopy: '#78f6ff' },
    },
    {
      id: 'aurora-lime',
      name: 'Aurora Lime',
      price: 1050,
      unlock: completionUnlock(STARTER_COURSE_IDS.HANDLING),
      material: { color: '#45ff8a', emissive: '#08381d', wing: '#9d4bff', canopy: '#fff5a8' },
    },
    {
      id: 'nova-gold',
      name: 'Nova Gold',
      price: 1600,
      unlock: completionUnlock(STARTER_COURSE_IDS.JUMP_EFFECT),
      material: { color: '#ffe66d', emissive: '#4c3908', wing: '#ff3bd4', canopy: '#16f0e6' },
    },
  ],
  [GARAGE_CATEGORY.UNDERGLOWS]: [
    {
      id: DEFAULT_GARAGE_SELECTION.underglow,
      name: 'Volt Green',
      price: 0,
      unlock: defaultUnlock(),
      material: { color: '#45ff8a', intensity: 1.2 },
    },
    {
      id: 'ion-cyan',
      name: 'Ion Cyan',
      price: 350,
      unlock: defaultUnlock(),
      material: { color: '#16f0e6', intensity: 1.12 },
    },
    {
      id: 'pulse-violet',
      name: 'Pulse Violet',
      price: 700,
      unlock: completionUnlock(STARTER_COURSE_IDS.TRAINING),
      material: { color: '#9d4bff', intensity: 1.3 },
    },
    {
      id: 'amber-arc',
      name: 'Amber Arc',
      price: 900,
      unlock: completionUnlock(STARTER_COURSE_IDS.HANDLING),
      material: { color: '#ff9f2d', intensity: 1.18 },
    },
  ],
  [GARAGE_CATEGORY.LIVERIES]: [
    {
      id: DEFAULT_GARAGE_SELECTION.livery.pattern,
      name: 'Clean Hull',
      price: 0,
      unlock: defaultUnlock(),
      params: { pattern: 'none', accent: DEFAULT_GARAGE_SELECTION.livery.accent, secondary: '#ffffff', opacity: 0 },
    },
    {
      id: 'splitter-stripes',
      name: 'Splitter Stripes',
      price: 500,
      unlock: defaultUnlock(),
      params: { pattern: 'splitter-stripes', accent: '#ff3bd4', secondary: '#ffe66d', opacity: 0.92 },
    },
    {
      id: 'circuit-lines',
      name: 'Circuit Lines',
      price: 850,
      unlock: completionUnlock(STARTER_COURSE_IDS.TRAINING),
      params: { pattern: 'circuit-lines', accent: '#16f0e6', secondary: '#45ff8a', opacity: 0.95 },
    },
    {
      id: 'void-check',
      name: 'Void Check',
      price: 1250,
      unlock: completionUnlock(STARTER_COURSE_IDS.JUMP_EFFECT),
      params: { pattern: 'void-check', accent: '#ffe66d', secondary: '#ff2b4e', opacity: 0.9 },
    },
    {
      id: SPARKY_LIVERY_ID,
      name: 'Sparky Signal',
      price: 0,
      unlock: rivalRewardUnlock(SPARKY_LIVERY_REWARD_ID),
      params: { pattern: SPARKY_LIVERY_ID, accent: '#ffe66d', secondary: '#16f0e6', opacity: 0.96 },
    },
  ],
});

export const GARAGE_TUNING = deepFreeze({
  [TUNING_STAT_IDS.TOP_SPEED]: {
    id: TUNING_STAT_IDS.TOP_SPEED,
    label: 'Top Speed',
    copy: 'Raises the z-velocity ceiling; hazards arrive sooner.',
    injectionPoints: ['MAX_Z_VELOCITY'],
    configKeys: ['topSpeedMultiplier'],
    multipliers: [1, 1.08, 1.17, 1.26, 1.35],
    prices: [0, 600, 1200, 2100, 3300],
    unlock: defaultUnlock(),
  },
  [TUNING_STAT_IDS.ACCEL]: {
    id: TUNING_STAT_IDS.ACCEL,
    label: 'Acceleration',
    copy: 'Scales throttle force; it does not alter boost pads.',
    injectionPoints: ['throttle force 75/65536'],
    configKeys: ['accelerationMultiplier'],
    multipliers: [1, 1.12, 1.25, 1.38, 1.5],
    prices: [0, 500, 1000, 1800, 2900],
    unlock: defaultUnlock(),
  },
  [TUNING_STAT_IDS.HANDLING]: {
    id: TUNING_STAT_IDS.HANDLING,
    label: 'Handling',
    copy: 'Raises lateral strafe authority.',
    injectionPoints: ['lateral base 29/128'],
    configKeys: ['handlingMultiplier'],
    multipliers: [1, 1.15, 1.3, 1.45, 1.6],
    prices: [0, 550, 1100, 1900, 3100],
    unlock: defaultUnlock(),
  },
  [TUNING_STAT_IDS.LIFT]: {
    id: TUNING_STAT_IDS.LIFT,
    label: 'Lift',
    copy: 'Raises jump impulse and fuel efficiency; gravity 20+ still disables jumps.',
    injectionPoints: ['jump velocity 9.0', 'level fuel denominator'],
    configKeys: ['jumpVelocityMultiplier', 'fuelEfficiencyMultiplier'],
    multipliers: [1, 1.15, 1.3, 1.45, 1.6],
    prices: [0, 650, 1300, 2200, 3400],
    unlock: defaultUnlock(),
  },
});

const GARAGE_CATALOG_BY_ID = new Map(
  Object.entries(GARAGE_CATALOGS).flatMap(([category, items]) =>
    items.map((item) => [`${category}:${item.id}`, item])
  )
);

function sourceCourseId(roadIndex) {
  return `byo-road-${String(roadIndex).padStart(2, '0')}`;
}

function sourceWorldId(worldIndex) {
  return `byo-world-${String(worldIndex + 1).padStart(2, '0')}`;
}

function rewardIds(courseId) {
  return Object.freeze({
    completion: `complete:${courseId}`,
    bronze: `medal:${courseId}:bronze`,
    silver: `medal:${courseId}:silver`,
    gold: `medal:${courseId}:gold`,
    clean: `clean:${courseId}`,
  });
}

function thresholds(gold, silver, bronze) {
  return Object.freeze({ gold, silver, bronze });
}

export const RIVAL_TUNING_CONFIG_IDS = Object.freeze({
  STOCK: 'rival-stock',
  TURBO_1: 'rival-turbo-1',
});

export const RIVAL_TUNING_CONFIGS = deepFreeze([
  {
    id: RIVAL_TUNING_CONFIG_IDS.STOCK,
    label: 'Factory Spec',
    physics: {
      topSpeedMultiplier: 1,
      accelerationMultiplier: 1,
      handlingMultiplier: 1,
      jumpVelocityMultiplier: 1,
      fuelEfficiencyMultiplier: 1,
    },
  },
  {
    id: RIVAL_TUNING_CONFIG_IDS.TURBO_1,
    label: 'Pulse Turbo I',
    physics: {
      topSpeedMultiplier: 1.08,
      accelerationMultiplier: 1.12,
      handlingMultiplier: 1,
      jumpVelocityMultiplier: 1,
      fuelEfficiencyMultiplier: 1,
    },
  },
]);

function rivalReward(rivalId, credits, options = {}) {
  return Object.freeze({
    id: options.id ?? `rival-reward:${rivalId}`,
    credits,
    liveryId: options.liveryId ?? null,
  });
}

function rivalVisual(body, wing, underglow, accent) {
  return Object.freeze({
    body,
    emissive: '#06111f',
    wing,
    canopy: '#fff5a8',
    underglow,
    underglowIntensity: 1.18,
    livery: {
      pattern: 'circuit-lines',
      accent,
      secondary: '#ffffff',
      opacity: 0.82,
    },
    opacity: 0.38,
  });
}

const STARTER_COURSES = deepFreeze([
  {
    id: STARTER_COURSE_IDS.TRAINING,
    levelId: STARTER_COURSE_IDS.TRAINING,
    kind: COURSE_KIND.STARTER,
    sourceKind: 'starter',
    campaignSlot: true,
    chainId: STARTER_CUP_ID,
    worldId: STARTER_CUP_ID,
    worldOrder: 0,
    courseOrder: 0,
    order: 0,
    role: 'training',
    focus: 'launch, jump timing, finish',
    name: 'NEONDRIFT Training Run',
    presentationName: 'NEONDRIFT Training Run',
    visualWorld: 0,
    world: 0,
    gravityLabel: 'Medium',
    resourcesLabel: 'Long training tanks',
    hazardLegend: 'Red kill pads, cyan refill pads, violet slide pads',
    parTicks: 620,
    medalThresholds: thresholds(620, 720, 840),
    rewards: STARTER_REWARDS,
    unlockAfter: null,
    rewardIds: rewardIds(STARTER_COURSE_IDS.TRAINING),
    source: 'tracked-original-neondrift-starter-cup',
  },
  {
    id: STARTER_COURSE_IDS.HANDLING,
    levelId: STARTER_COURSE_IDS.HANDLING,
    kind: COURSE_KIND.STARTER,
    sourceKind: 'starter',
    campaignSlot: true,
    chainId: STARTER_CUP_ID,
    worldId: STARTER_CUP_ID,
    worldOrder: 0,
    courseOrder: 1,
    order: 1,
    role: 'handling',
    focus: 'slalom lane gates and recovery',
    name: 'Switchback Handling',
    presentationName: 'Switchback Handling',
    visualWorld: 1,
    world: 1,
    gravityLabel: 'Medium',
    resourcesLabel: 'Extended handling tanks',
    hazardLegend: 'Red closed lanes, violet slide pads, cyan refill pads',
    parTicks: 760,
    medalThresholds: thresholds(760, 880, 1010),
    rewards: STARTER_REWARDS,
    unlockAfter: STARTER_COURSE_IDS.TRAINING,
    rewardIds: rewardIds(STARTER_COURSE_IDS.HANDLING),
    source: 'tracked-original-neondrift-starter-cup',
  },
  {
    id: STARTER_COURSE_IDS.JUMP_EFFECT,
    levelId: STARTER_COURSE_IDS.JUMP_EFFECT,
    kind: COURSE_KIND.STARTER,
    sourceKind: 'starter',
    campaignSlot: true,
    chainId: STARTER_CUP_ID,
    worldId: STARTER_CUP_ID,
    worldOrder: 0,
    courseOrder: 2,
    order: 2,
    role: 'jump-effect',
    focus: 'jump timing over effect pads',
    name: 'Pulse Jumpway',
    presentationName: 'Pulse Jumpway',
    contentHash: '774ea1b7285684a34cb27a64d7fdfbcd6cdc0fed90eba7226ffdb34530904f8d',
    visualWorld: 2,
    world: 2,
    gravityLabel: 'Medium',
    resourcesLabel: 'Long jump-effect tanks',
    hazardLegend: 'Full-width red hazard, amber decel pads, cyan refill pads',
    parTicks: 820,
    medalThresholds: thresholds(820, 960, 1100),
    rewards: STARTER_REWARDS,
    unlockAfter: STARTER_COURSE_IDS.HANDLING,
    rewardIds: rewardIds(STARTER_COURSE_IDS.JUMP_EFFECT),
    source: 'tracked-original-neondrift-starter-cup',
  },
]);

const SOURCE_WORLDS = deepFreeze(Array.from({ length: SOURCE_WORLD_COUNT }, (_, worldIndex) => {
  const courseIds = Array.from({ length: SOURCE_COURSES_PER_WORLD }, (_, courseIndex) =>
    sourceCourseId(worldIndex * SOURCE_COURSES_PER_WORLD + courseIndex + 1)
  );
  return {
    id: sourceWorldId(worldIndex),
    kind: 'source-world',
    chainId: 'byo-source-campaign',
    worldIndex,
    order: worldIndex,
    name: `BYO World ${worldIndex + 1}`,
    presentationName: `BYO World ${worldIndex + 1}`,
    courseIds,
    unlockAfterWorldId: worldIndex === 0 ? null : sourceWorldId(worldIndex - 1),
  };
}));

const SOURCE_COURSES = deepFreeze(Array.from({ length: SOURCE_CAMPAIGN_COURSE_COUNT }, (_, index) => {
  const roadIndex = index + 1;
  const worldIndex = Math.floor(index / SOURCE_COURSES_PER_WORLD);
  const courseOrder = index % SOURCE_COURSES_PER_WORLD;
  const id = sourceCourseId(roadIndex);
  const parTicks = 700 + worldIndex * 105 + courseOrder * 55;
  const rewards = {
    baseCredits: DEFAULT_REWARDS.baseCredits + worldIndex * 35 + courseOrder * 15,
    medalBonuses: DEFAULT_REWARDS.medalBonuses,
    cleanRunBonus: DEFAULT_REWARDS.cleanRunBonus + worldIndex * 5,
  };
  return {
    id,
    levelId: id,
    kind: COURSE_KIND.SOURCE_CAMPAIGN,
    sourceKind: 'source',
    campaignSlot: true,
    chainId: 'byo-source-campaign',
    worldId: sourceWorldId(worldIndex),
    worldOrder: worldIndex,
    courseOrder,
    order: roadIndex,
    roadIndex,
    role: `source-${courseOrder + 1}`,
    focus: 'local BYO SkyRoads discovery',
    name: `BYO ${worldIndex + 1}-${courseOrder + 1}`,
    presentationName: `BYO World ${worldIndex + 1} Course ${courseOrder + 1}`,
    visualWorld: worldIndex,
    world: worldIndex,
    gravityLabel: 'From local data',
    resourcesLabel: 'From local data',
    hazardLegend: 'Decoded road hazards and effects from local data',
    parTicks,
    medalThresholds: thresholds(parTicks, parTicks + 140, parTicks + 300),
    rewards,
    rewardIds: rewardIds(id),
    source: 'local-byo-data',
  };
}));

const SOURCE_DEMO_ENTRY = deepFreeze({
  id: SOURCE_DEMO_COURSE_ID,
  levelId: SOURCE_DEMO_COURSE_ID,
  kind: COURSE_KIND.SOURCE_DEMO,
  sourceKind: 'source',
  campaignSlot: false,
  chainId: 'legacy-demo',
  worldId: 'legacy-demo',
  worldOrder: -1,
  courseOrder: 0,
  order: 0,
  roadIndex: 0,
  role: 'legacy-demo',
  focus: 'explicit exported Demo Level entry',
  name: 'Legacy Demo Level',
  presentationName: 'Legacy Demo Level',
  visualWorld: 0,
  world: 0,
  gravityLabel: 'From local data',
  resourcesLabel: 'From local data',
  hazardLegend: 'Decoded legacy demo hazards and effects',
  parTicks: null,
  medalThresholds: null,
  rewards: Object.freeze({ baseCredits: 0, medalBonuses: Object.freeze({}), cleanRunBonus: 0 }),
  rewardIds: Object.freeze({}),
  source: 'local-byo-data',
});

export const RIVAL_LADDER = deepFreeze([
  {
    id: 'rival-06-mara-vex',
    rank: 6,
    name: 'Mara Vex',
    courseId: STARTER_COURSE_IDS.TRAINING,
    tuningConfigId: RIVAL_TUNING_CONFIG_IDS.STOCK,
    encodedRunId: 'run-rival-mara-training-724',
    targetTicks: 724,
    reward: rivalReward('rival-06-mara-vex', 275),
    visual: rivalVisual('#78f6ff', '#ff3bd4', '#45ff8a', '#ffe66d'),
  },
  {
    id: 'rival-05-ion-kade',
    rank: 5,
    name: 'Ion Kade',
    courseId: STARTER_COURSE_IDS.TRAINING,
    tuningConfigId: RIVAL_TUNING_CONFIG_IDS.STOCK,
    encodedRunId: 'run-rival-ion-training-644',
    targetTicks: 644,
    reward: rivalReward('rival-05-ion-kade', 375),
    visual: rivalVisual('#16f0e6', '#ffe66d', '#9d4bff', '#ff3bd4'),
  },
  {
    id: 'rival-04-vela-orr',
    rank: 4,
    name: 'Vela Orr',
    courseId: STARTER_COURSE_IDS.HANDLING,
    tuningConfigId: RIVAL_TUNING_CONFIG_IDS.STOCK,
    encodedRunId: 'run-rival-vela-handling-845',
    targetTicks: 845,
    reward: rivalReward('rival-04-vela-orr', 500),
    visual: rivalVisual('#45ff8a', '#78f6ff', '#ffe66d', '#16f0e6'),
  },
  {
    id: 'rival-03-noor-cass',
    rank: 3,
    name: 'Noor Cass',
    courseId: STARTER_COURSE_IDS.HANDLING,
    tuningConfigId: RIVAL_TUNING_CONFIG_IDS.STOCK,
    encodedRunId: 'run-rival-noor-handling-775',
    targetTicks: 775,
    reward: rivalReward('rival-03-noor-cass', 650),
    visual: rivalVisual('#ffe66d', '#ff2b4e', '#16f0e6', '#45ff8a'),
  },
  {
    id: 'rival-02-sable-rin',
    rank: 2,
    name: 'Sable Rin',
    courseId: STARTER_COURSE_IDS.JUMP_EFFECT,
    tuningConfigId: RIVAL_TUNING_CONFIG_IDS.STOCK,
    encodedRunId: 'run-rival-sable-jump-818',
    targetTicks: 818,
    reward: rivalReward('rival-02-sable-rin', 850),
    visual: rivalVisual('#ff3bd4', '#78f6ff', '#45ff8a', '#ffe66d'),
  },
  {
    id: 'rival-01-cipher-sol',
    rank: 1,
    name: 'Cipher Sol',
    courseId: STARTER_COURSE_IDS.JUMP_EFFECT,
    tuningConfigId: RIVAL_TUNING_CONFIG_IDS.TURBO_1,
    encodedRunId: 'run-rival-cipher-jump-704',
    targetTicks: 704,
    reward: rivalReward('rival-01-cipher-sol', 1200, {
      id: SPARKY_LIVERY_REWARD_ID,
      liveryId: SPARKY_LIVERY_ID,
    }),
    visual: rivalVisual('#fff5a8', '#16f0e6', '#ff3bd4', '#ffe66d'),
  },
]);

const COURSE_ENTRIES = deepFreeze([...STARTER_COURSES, ...SOURCE_COURSES, SOURCE_DEMO_ENTRY]);
const COURSE_BY_ID = new Map(COURSE_ENTRIES.map((entry) => [entry.id, entry]));
const SOURCE_BY_ROAD = new Map([[0, SOURCE_DEMO_ENTRY], ...SOURCE_COURSES.map((entry) => [entry.roadIndex, entry])]);
const RIVAL_BY_ID = new Map(RIVAL_LADDER.map((entry) => [entry.id, entry]));
const RIVAL_BY_RANK = new Map(RIVAL_LADDER.map((entry) => [entry.rank, entry]));
const RIVAL_TUNING_BY_ID = new Map(RIVAL_TUNING_CONFIGS.map((entry) => [entry.id, entry]));

export const STARTER_CUP_MANIFEST = deepFreeze({
  version: MANIFEST_VERSION,
  id: STARTER_CUP_ID,
  name: 'NEONDRIFT Starter Cup',
  chainId: STARTER_CUP_ID,
  courses: STARTER_COURSES,
});

export const CONTENT_MANIFEST = deepFreeze({
  version: MANIFEST_VERSION,
  schema: 'neondrift.content.v1',
  starterCup: STARTER_CUP_MANIFEST,
  sourceCampaign: {
    id: 'byo-source-campaign',
    worldCount: SOURCE_WORLD_COUNT,
    coursesPerWorld: SOURCE_COURSES_PER_WORLD,
    worlds: SOURCE_WORLDS,
    courses: SOURCE_COURSES,
    legacyDemo: SOURCE_DEMO_ENTRY,
  },
  garage: {
    defaults: DEFAULT_GARAGE_SELECTION,
    catalogs: GARAGE_CATALOGS,
    tuning: GARAGE_TUNING,
  },
  rivals: {
    schema: 'neondrift.rivals.v1',
    tuningConfigs: RIVAL_TUNING_CONFIGS,
    ladder: RIVAL_LADDER,
    sparkyLiveryId: SPARKY_LIVERY_ID,
  },
  courses: COURSE_ENTRIES,
});

export function cloneManifestEntry(entry) {
  return JSON.parse(JSON.stringify(entry));
}

export function getCourseEntry(courseId) {
  const entry = COURSE_BY_ID.get(canonicalStarterCourseId(courseId));
  if (!entry) throw new Error(`unknown content manifest course ${courseId}`);
  return entry;
}

export function maybeGetCourseEntry(courseId) {
  return COURSE_BY_ID.get(canonicalStarterCourseId(courseId)) ?? null;
}

export function canonicalStarterCourseId(courseId) {
  return STARTER_COURSE_ALIASES[courseId] ?? courseId;
}

export function getStarterCourseEntry(courseId = STARTER_COURSE_IDS.TRAINING) {
  const entry = getCourseEntry(courseId);
  if (entry.kind !== COURSE_KIND.STARTER) throw new Error(`${courseId} is not a Starter Cup course`);
  return entry;
}

export function isStarterCourseId(courseId) {
  return maybeGetCourseEntry(courseId)?.kind === COURSE_KIND.STARTER;
}

export function isSourceCampaignCourseId(courseId) {
  return maybeGetCourseEntry(courseId)?.kind === COURSE_KIND.SOURCE_CAMPAIGN;
}

export function isCampaignCourseId(courseId) {
  return maybeGetCourseEntry(courseId)?.campaignSlot === true;
}

export function allManifestCourseIds(options = {}) {
  const manifest = options.manifest ?? CONTENT_MANIFEST;
  const includeLegacy = options.includeLegacy ?? true;
  return manifest.courses
    .filter((entry) => includeLegacy || entry.campaignSlot)
    .map((entry) => entry.id);
}

export function allRivals(manifest = CONTENT_MANIFEST) {
  return manifest.rivals?.ladder ?? [];
}

export function allRivalIds(manifest = CONTENT_MANIFEST) {
  return allRivals(manifest).map((entry) => entry.id);
}

export function getRivalEntry(rivalId, manifest = CONTENT_MANIFEST) {
  if (manifest === CONTENT_MANIFEST) {
    const rival = RIVAL_BY_ID.get(rivalId);
    if (!rival) throw new Error(`unknown rival ${rivalId}`);
    return rival;
  }
  const rival = allRivals(manifest).find((entry) => entry.id === rivalId);
  if (!rival) throw new Error(`unknown rival ${rivalId}`);
  return rival;
}

export function maybeGetRivalEntry(rivalId, manifest = CONTENT_MANIFEST) {
  try {
    return getRivalEntry(rivalId, manifest);
  } catch {
    return null;
  }
}

export function getRivalForRank(rank, manifest = CONTENT_MANIFEST) {
  if (manifest === CONTENT_MANIFEST) {
    const rival = RIVAL_BY_RANK.get(rank);
    if (!rival) throw new Error(`unknown rival rank ${rank}`);
    return rival;
  }
  const rival = allRivals(manifest).find((entry) => entry.rank === rank);
  if (!rival) throw new Error(`unknown rival rank ${rank}`);
  return rival;
}

export function getRivalTuningConfig(tuningConfigId, manifest = CONTENT_MANIFEST) {
  if (manifest === CONTENT_MANIFEST) {
    const config = RIVAL_TUNING_BY_ID.get(tuningConfigId);
    if (!config) throw new Error(`unknown rival tuning config ${tuningConfigId}`);
    return config;
  }
  const config = manifest.rivals?.tuningConfigs?.find((entry) => entry.id === tuningConfigId);
  if (!config) throw new Error(`unknown rival tuning config ${tuningConfigId}`);
  return config;
}

export function garageCatalogCategories() {
  return Object.values(GARAGE_CATEGORY);
}

export function garageCatalogItems(category, manifest = CONTENT_MANIFEST) {
  const items = manifest.garage?.catalogs?.[category];
  if (!Array.isArray(items)) throw new Error(`unknown garage category ${category}`);
  return items;
}

export function getGarageCatalogItem(category, id, manifest = CONTENT_MANIFEST) {
  if (manifest === CONTENT_MANIFEST) {
    const item = GARAGE_CATALOG_BY_ID.get(`${category}:${id}`);
    if (!item) throw new Error(`unknown garage item ${category}:${id}`);
    return item;
  }
  const item = garageCatalogItems(category, manifest).find((candidate) => candidate.id === id);
  if (!item) throw new Error(`unknown garage item ${category}:${id}`);
  return item;
}

export function maybeGetGarageCatalogItem(category, id, manifest = CONTENT_MANIFEST) {
  try {
    return getGarageCatalogItem(category, id, manifest);
  } catch {
    return null;
  }
}

export function allGarageCatalogIds(category, manifest = CONTENT_MANIFEST) {
  return garageCatalogItems(category, manifest).map((item) => item.id);
}

export function getTuningStat(statId, manifest = CONTENT_MANIFEST) {
  const stat = manifest.garage?.tuning?.[statId];
  if (!stat) throw new Error(`unknown tuning stat ${statId}`);
  return stat;
}

export function allTuningStatIds(manifest = CONTENT_MANIFEST) {
  return Object.keys(manifest.garage?.tuning ?? {});
}

function assertGarageManifest(garage) {
  const defaults = garage?.defaults;
  if (!defaults?.paint || !defaults?.underglow || !defaults?.livery?.pattern) {
    throw new Error('garage defaults are incomplete');
  }
  for (const category of garageCatalogCategories()) {
    const ids = new Set();
    const items = garage?.catalogs?.[category];
    if (!Array.isArray(items) || items.length === 0) throw new Error(`${category} catalog is empty`);
    for (const item of items) {
      if (ids.has(item.id)) throw new Error(`duplicate garage id ${category}:${item.id}`);
      ids.add(item.id);
      if (!Number.isSafeInteger(item.price) || item.price < 0) {
        throw new Error(`${category}:${item.id} has invalid price`);
      }
      if (!['default', 'course-complete', 'rival-reward'].includes(item.unlock?.type)) {
        throw new Error(`${category}:${item.id} has invalid unlock`);
      }
      if (item.unlock.type === 'course-complete' && !maybeGetCourseEntry(item.unlock.courseId)) {
        throw new Error(`${category}:${item.id} references unknown unlock course`);
      }
      if (item.unlock.type === 'rival-reward' && typeof item.unlock.rewardId !== 'string') {
        throw new Error(`${category}:${item.id} references invalid rival reward`);
      }
    }
  }
  if (!allGarageCatalogIds(GARAGE_CATEGORY.PAINTS).includes(defaults.paint)) {
    throw new Error('default paint is not cataloged');
  }
  if (!allGarageCatalogIds(GARAGE_CATEGORY.UNDERGLOWS).includes(defaults.underglow)) {
    throw new Error('default underglow is not cataloged');
  }
  if (!allGarageCatalogIds(GARAGE_CATEGORY.LIVERIES).includes(defaults.livery.pattern)) {
    throw new Error('default livery is not cataloged');
  }
  for (const [statId, stat] of Object.entries(garage?.tuning ?? {})) {
    if (stat.id !== statId) throw new Error(`tuning stat ${statId} id mismatch`);
    if (!Array.isArray(stat.multipliers) || stat.multipliers.length !== 5) {
      throw new Error(`${statId} must define five multipliers`);
    }
    if (!Array.isArray(stat.prices) || stat.prices.length !== 5 || stat.prices[0] !== 0) {
      throw new Error(`${statId} must define five prices with tier zero free`);
    }
    for (let tier = 0; tier < 5; tier++) {
      if (!Number.isFinite(stat.multipliers[tier]) || stat.multipliers[tier] < 1) {
        throw new Error(`${statId} tier ${tier} has invalid multiplier`);
      }
      if (!Number.isSafeInteger(stat.prices[tier]) || stat.prices[tier] < 0) {
        throw new Error(`${statId} tier ${tier} has invalid price`);
      }
    }
  }
}

function validHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function assertRivalVisual(rival) {
  const visual = rival.visual;
  for (const key of ['body', 'emissive', 'wing', 'canopy', 'underglow']) {
    if (!validHexColor(visual?.[key])) throw new Error(`${rival.id} visual ${key} is invalid`);
  }
  if (!validHexColor(visual?.livery?.accent) || !validHexColor(visual?.livery?.secondary)) {
    throw new Error(`${rival.id} livery colors are invalid`);
  }
  if (!Number.isFinite(visual.opacity) || visual.opacity <= 0 || visual.opacity >= 1) {
    throw new Error(`${rival.id} must render as translucent`);
  }
}

function assertRivalManifest(manifest) {
  const rivals = manifest.rivals?.ladder;
  if (!Array.isArray(rivals) || rivals.length !== 6) throw new Error('rival ladder must contain exactly six rivals');
  const expectedRanks = [6, 5, 4, 3, 2, 1];
  const ids = new Set();
  const ranks = new Set();
  const runIds = new Set();
  const rewardIds = new Set();
  for (const [index, rival] of rivals.entries()) {
    if (rival.rank !== expectedRanks[index]) throw new Error(`rival rank order mismatch at ${index}`);
    if (ids.has(rival.id)) throw new Error(`duplicate rival id ${rival.id}`);
    ids.add(rival.id);
    if (ranks.has(rival.rank)) throw new Error(`duplicate rival rank ${rival.rank}`);
    ranks.add(rival.rank);
    if (!maybeGetCourseEntry(rival.courseId)?.campaignSlot) throw new Error(`${rival.id} has invalid course`);
    getRivalTuningConfig(rival.tuningConfigId, manifest);
    if (runIds.has(rival.encodedRunId)) throw new Error(`duplicate rival run id ${rival.encodedRunId}`);
    runIds.add(rival.encodedRunId);
    if (!Number.isSafeInteger(rival.targetTicks) || rival.targetTicks <= 0) {
      throw new Error(`${rival.id} has invalid target ticks`);
    }
    if (rewardIds.has(rival.reward?.id)) throw new Error(`duplicate rival reward ${rival.reward?.id}`);
    rewardIds.add(rival.reward?.id);
    if (!Number.isSafeInteger(rival.reward?.credits) || rival.reward.credits < 0) {
      throw new Error(`${rival.id} has invalid reward credits`);
    }
    assertRivalVisual(rival);
  }
  const rankOne = getRivalForRank(1, manifest);
  if (rankOne.reward.liveryId !== SPARKY_LIVERY_ID || rankOne.reward.id !== SPARKY_LIVERY_REWARD_ID) {
    throw new Error('rank 1 rival must grant the Sparky livery reward');
  }
}

export function sourceCourseIdForRoadIndex(roadIndex) {
  const entry = SOURCE_BY_ROAD.get(roadIndex);
  return entry?.id ?? null;
}

export function sourceManifestEntryForRoadIndex(roadIndex) {
  return SOURCE_BY_ROAD.get(roadIndex) ?? null;
}

export function sourceRoadIndexForCourseId(courseId) {
  const entry = maybeGetCourseEntry(courseId);
  return entry?.sourceKind === 'source' ? entry.roadIndex : null;
}

export function assertContentManifest(manifest = CONTENT_MANIFEST) {
  if (manifest.version !== MANIFEST_VERSION) throw new Error(`manifest version ${manifest.version} is not supported`);
  assertGarageManifest(manifest.garage);
  assertRivalManifest(manifest);
  const ids = new Set();
  for (const entry of manifest.courses) {
    if (ids.has(entry.id)) throw new Error(`duplicate course id ${entry.id}`);
    ids.add(entry.id);
    if (entry.campaignSlot) {
      if (!entry.rewardIds?.completion) throw new Error(`${entry.id} missing one-time completion reward id`);
      if (!Number.isSafeInteger(entry.parTicks) || entry.parTicks <= 0) {
        throw new Error(`${entry.id} has invalid par ticks`);
      }
      const t = entry.medalThresholds;
      if (!t || !(t.gold < t.silver && t.silver < t.bronze)) {
        throw new Error(`${entry.id} medal thresholds must be gold < silver < bronze`);
      }
      if (!Number.isSafeInteger(entry.rewards.baseCredits) || entry.rewards.baseCredits < 0) {
        throw new Error(`${entry.id} has invalid base credits`);
      }
    }
  }
  for (let roadIndex = 1; roadIndex <= SOURCE_CAMPAIGN_COURSE_COUNT; roadIndex++) {
    const entry = sourceManifestEntryForRoadIndex(roadIndex);
    if (!entry) throw new Error(`missing BYO road ${roadIndex}`);
    const expectedWorld = Math.floor((roadIndex - 1) / SOURCE_COURSES_PER_WORLD);
    const expectedCourse = (roadIndex - 1) % SOURCE_COURSES_PER_WORLD;
    if (entry.worldOrder !== expectedWorld || entry.courseOrder !== expectedCourse) {
      throw new Error(`BYO road ${roadIndex} maps to ${entry.worldOrder}:${entry.courseOrder}`);
    }
  }
  if (sourceManifestEntryForRoadIndex(0)?.id !== SOURCE_DEMO_COURSE_ID) {
    throw new Error('source road 0 must remain the explicit legacy demo entry');
  }
  return true;
}

function indexLevelMap(index) {
  const map = new Map();
  const duplicates = new Set();
  for (const entry of index?.levels ?? []) {
    if (!Number.isInteger(entry?.roadIndex)) continue;
    if (map.has(entry.roadIndex)) duplicates.add(entry.roadIndex);
    else map.set(entry.roadIndex, entry);
  }
  return { map, duplicates };
}

function discoveredEntry(manifestEntry, exported, duplicates, catalogAvailable, corruptRoads = new Set()) {
  let disabledReason = null;
  if (!catalogAvailable) disabledReason = 'Local exported source catalog is unavailable';
  else if (duplicates.has(manifestEntry.roadIndex)) disabledReason = `Duplicate road ${manifestEntry.roadIndex} in local index`;
  else if (corruptRoads.has(manifestEntry.roadIndex)) disabledReason = `Corrupt local road ${manifestEntry.roadIndex}`;
  else if (!exported) disabledReason = `Missing local road ${manifestEntry.roadIndex}`;
  return {
    ...cloneManifestEntry(manifestEntry),
    file: exported?.file ?? `level_${String(manifestEntry.roadIndex).padStart(2, '0')}.json`,
    exportedName: exported?.name ?? null,
    available: disabledReason == null,
    disabled: disabledReason != null,
    disabledReason,
  };
}

export function createSourceDiscovery(index = null, options = {}) {
  const catalogAvailable = Array.isArray(index?.levels);
  const { map, duplicates } = indexLevelMap(index);
  const corruptRoads = new Set(options.corruptRoads ?? []);
  const legacyDemo = discoveredEntry(SOURCE_DEMO_ENTRY, map.get(0), duplicates, catalogAvailable, corruptRoads);
  const worlds = SOURCE_WORLDS.map((world) => {
    const courses = world.courseIds.map((courseId) => {
      const entry = getCourseEntry(courseId);
      return discoveredEntry(entry, map.get(entry.roadIndex), duplicates, catalogAvailable, corruptRoads);
    });
    return {
      ...cloneManifestEntry(world),
      courses,
      availableCount: courses.filter((course) => course.available).length,
      disabledCount: courses.filter((course) => course.disabled).length,
    };
  });
  const courses = worlds.flatMap((world) => world.courses);
  return {
    ok: catalogAvailable,
    expectedCampaignCourses: SOURCE_CAMPAIGN_COURSE_COUNT,
    legacyDemo,
    worlds,
    courses,
    availableCampaignCourses: courses.filter((course) => course.available).length,
    disabledCampaignCourses: courses.filter((course) => course.disabled).length,
  };
}

assertContentManifest();
