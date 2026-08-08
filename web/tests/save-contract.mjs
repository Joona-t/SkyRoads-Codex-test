import assert from 'node:assert/strict';

import {
  CONTENT_MANIFEST,
  MEDAL,
  STARTER_COURSE_IDS,
  sourceManifestEntryForRoadIndex,
} from '../src/content-manifest.js';
import { createRaceTuningConfig, createRaceTuningConfigId } from '../src/garage.js';
import { createOwnBestGhostPayload } from '../src/ghost.js';
import {
  QUARANTINE_KEY,
  SAVE_KEY,
  SAVE_LIMITS,
  SAVE_VERSION,
  MemoryStorage,
  createDefaultSave,
  createSaveManager,
  decodeSave,
  encodeSave,
  upsertGhost,
  validateSaveObject,
} from '../src/save.js';

class ThrowingStorage extends MemoryStorage {
  constructor(mode) {
    super();
    this.mode = mode;
  }

  getItem(key) {
    if (this.mode === 'get') {
      const error = new Error('blocked');
      error.name = 'SecurityError';
      throw error;
    }
    return super.getItem(key);
  }

  setItem(key, value) {
    if (this.mode === 'set') {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    }
    return super.setItem(key, value);
  }
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function ghostFixtureLevel(courseId) {
  return {
    version: 1,
    roadIndex: courseId,
    name: `ghost-${courseId}`,
    world: 0,
    gravity: 12,
    fuel: 100000,
    oxygen: 100000,
    length: 16,
    columns: 7,
    start: { x: 256, y: 80, z: 3 },
    constants: {
      tileStrideX: 46,
      groundY: 80,
      roadColumns: 7,
      levelMinX: 95,
      levelMaxX: 417,
      levelCenterX: 256,
      cubeShortTop: 100,
      cubeTallTop: 120,
      zPerRow: 1,
    },
    palette: [[0, 0, 0], [255, 255, 255]],
    cells: [[]],
  };
}

function alternatingControls(ticks) {
  return Array.from({ length: ticks }, (_, index) => ({
    turn: index % 2 === 0 ? -1 : 1,
    accel: 1,
    jump: false,
  }));
}

function ghostPayload(courseId, bestTicks) {
  const save = createDefaultSave();
  const payload = createOwnBestGhostPayload({
    level: ghostFixtureLevel(courseId),
    courseId,
    tuningConfig: createRaceTuningConfig(save),
    tuningConfigId: createRaceTuningConfigId(save),
    runRecord: { outcome: 'won', raceTicks: bestTicks },
    controls: alternatingControls(bestTicks),
  });
  assert.equal(payload.ok, true, payload.reason);
  return payload.ghost;
}

test('VAL-SAVE-001 default save exports v1 schema and bounded encoded payload', () => {
  const save = createDefaultSave();
  assert.equal(save.v, SAVE_VERSION);
  assert.equal(save.credits, 0);
  assert.deepEqual(save.tiers, { topSpeed: 0, accel: 0, handling: 0, lift: 0 });
  assert.equal(save.campaign.unlockedCourseIds.includes(STARTER_COURSE_IDS.TRAINING), true);
  const encoded = encodeSave(save);
  assert.equal(encoded.quarantined, false);
  assert.equal(encoded.bytes <= SAVE_LIMITS.wholeSaveBytes, true);
});

test('VAL-SAVE-001 partial v1 deep-defaults and hostile fields clamp without losing valid progress', () => {
  const hostile = {
    v: 1,
    credits: -10,
    tiers: { topSpeed: 9, accel: 2.8, handling: -4, lift: Number.NaN },
    cosmetics: { paint: 'hot', underglow: '', livery: { pattern: 'stripe', accent: 'pink' } },
    shipName: 'A'.repeat(80),
    worlds: { unlockedMax: 99 },
    levels: {
      [STARTER_COURSE_IDS.TRAINING]: { bestTicks: 500, medal: 99, completed: true, clean: 'yes' },
      unknown: { bestTicks: 1, medal: 3, completed: true, clean: true },
    },
    campaign: {
      unlockedCourseIds: [STARTER_COURSE_IDS.TRAINING, STARTER_COURSE_IDS.TRAINING, 'unknown'],
      completedCourseIds: [STARTER_COURSE_IDS.TRAINING, 'unknown'],
    },
    blacklist: { defeated: [STARTER_COURSE_IDS.TRAINING, STARTER_COURSE_IDS.TRAINING, 'unknown'], mostWanted: 'yes' },
    unlocks: {
      paints: ['pink', 'pink'],
      underglows: ['cyan'],
      liveries: ['stripe'],
      courses: [STARTER_COURSE_IDS.TRAINING, 'unknown'],
    },
    rewards: { claimed: ['complete:tutorial', 'complete:tutorial'] },
    audio: { muted: 'no', volume: 4, music: false, retroMuzax: 1 },
    settings: { reducedMotionForce: 'no', highContrast: true, renderScale: 8, jomAssist: null },
  };
  const { save, quarantined } = validateSaveObject(hostile);
  assert.equal(quarantined, false);
  assert.equal(save.credits, 0);
  assert.deepEqual(save.tiers, { topSpeed: 4, accel: 2, handling: 0, lift: 0 });
  assert.equal(save.cosmetics.livery.accent, '#16f0e6');
  assert.equal(save.shipName.length, SAVE_LIMITS.shipNameLength);
  assert.equal(save.worlds.unlockedMax, 9);
  assert.deepEqual(Object.keys(save.levels), [STARTER_COURSE_IDS.TRAINING]);
  assert.deepEqual(save.levels[STARTER_COURSE_IDS.TRAINING], {
    bestTicks: 500,
    medal: MEDAL.GOLD,
    completed: true,
    clean: false,
  });
  assert.deepEqual(save.campaign.unlockedCourseIds, [STARTER_COURSE_IDS.TRAINING]);
  assert.deepEqual(save.blacklist.defeated, [STARTER_COURSE_IDS.TRAINING]);
  assert.deepEqual(save.unlocks.courses, [STARTER_COURSE_IDS.TRAINING]);
  assert.deepEqual(save.rewards.claimed, ['complete:tutorial']);
  assert.equal(save.audio.volume, 1);
  assert.equal(save.audio.muted, false);
  assert.equal(save.audio.retroMuzax, false);
  assert.equal(save.settings.renderScale, 1);
  assert.equal(save.settings.highContrast, true);
  assert.equal(save.settings.qualityTier, 'desktop');
  assert.ok(save.settings.keyBindings.restart.includes('Enter'));
});

test('VAL-SAVE-001 corrupt JSON, unknown versions, and oversized core quarantine to defaults', () => {
  let decoded = decodeSave('{bad json');
  assert.equal(decoded.quarantined, true);
  assert.equal(decoded.reason, 'corrupt-json');
  assert.equal(decoded.save.v, SAVE_VERSION);

  decoded = decodeSave(JSON.stringify({ v: 99, credits: 100 }));
  assert.equal(decoded.quarantined, true);
  assert.equal(decoded.reason, 'unknown-version');
  assert.equal(decoded.save.credits, 0);

  decoded = decodeSave(JSON.stringify({ v: 1, shipName: 'OK', note: 'x'.repeat(SAVE_LIMITS.nonGhostCoreBytes + 1) }));
  assert.equal(decoded.quarantined, true);
  assert.equal(decoded.reason, 'core-oversize');
});

test('VAL-SAVE-001 storage manager quarantines corrupt saves and reset requires explicit confirmation', () => {
  const storage = new MemoryStorage({ [SAVE_KEY]: '{bad json' });
  const manager = createSaveManager({ storage });
  const loaded = manager.load();
  assert.equal(loaded.quarantined, true);
  assert.equal(loaded.reason, 'corrupt-json');
  assert.equal(storage.getItem(QUARANTINE_KEY), '{bad json');
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).v, SAVE_VERSION);

  assert.throws(() => manager.reset(), /explicit confirmation/);
  const reset = manager.reset({ confirm: 'RESET' });
  assert.equal(reset.save.credits, 0);
});

test('VAL-SAVE-001 unavailable and quota-failed storage falls back to in-memory session with warning', () => {
  let manager = createSaveManager({ storage: new ThrowingStorage('get') });
  let loaded = manager.load();
  assert.equal(loaded.storage, 'memory');
  assert.equal(loaded.warnings.some((warning) => warning.includes('SecurityError')), true);

  manager = createSaveManager({ storage: new ThrowingStorage('set') });
  loaded = manager.load();
  assert.equal(loaded.storage, 'memory');
  assert.equal(loaded.warnings.some((warning) => warning.includes('QuotaExceededError')), true);
  const written = manager.write({ ...loaded.save, credits: 123 });
  assert.equal(written.storage, 'memory');
  assert.equal(JSON.parse(manager.fallbackStorage.getItem(SAVE_KEY)).credits, 123);
});

test('VAL-SAVE-001 ghost payloads are bounded, preserve prior valid best, and evict slowest first', () => {
  const courseIds = Array.from({ length: 8 }, (_, index) => sourceManifestEntryForRoadIndex(index + 1).id);
  let save = createDefaultSave();
  for (const [index, courseId] of courseIds.entries()) {
    save.levels[courseId] = { bestTicks: 3000 + index, medal: MEDAL.BRONZE, completed: true, clean: false };
  }
  const invalid = { ...ghostPayload(courseIds[0], 3000), data: 'x'.repeat(SAVE_LIMITS.ghostBytes + 1) };
  let result = upsertGhost(save, courseIds[0], invalid);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'invalid-or-oversize-ghost');
  assert.deepEqual(Object.keys(result.save.ghosts ?? {}), []);

  save = result.save;
  for (let index = 0; index < 6; index++) {
    result = upsertGhost(save, courseIds[index], ghostPayload(courseIds[index], 3000 + index));
    assert.equal(result.accepted, true, courseIds[index]);
    save = result.save;
  }
  const beforeIds = Object.keys(save.ghosts);
  assert.equal(beforeIds.length, 6);
  result = upsertGhost(save, courseIds[7], ghostPayload(courseIds[7], 3007));
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'evicted-by-budget');
  assert.deepEqual(Object.keys(result.save.ghosts).sort(), beforeIds.sort());
  assert.equal(encodeSave(result.save).bytes <= SAVE_LIMITS.wholeSaveBytes, true);
});

test('VAL-SAVE-001 round trip persists normalized progress through reload', () => {
  const storage = new MemoryStorage();
  const manager = createSaveManager({ storage });
  const loaded = manager.load();
  const save = {
    ...loaded.save,
    credits: 42,
    levels: {
      [STARTER_COURSE_IDS.TRAINING]: { bestTicks: 700, medal: MEDAL.SILVER, completed: true, clean: true },
    },
  };
  manager.write(save);
  const reloaded = createSaveManager({ storage }).load();
  assert.equal(reloaded.save.credits, 42);
  assert.equal(reloaded.save.levels[STARTER_COURSE_IDS.TRAINING].bestTicks, 700);
  assert.equal(reloaded.save.levels[STARTER_COURSE_IDS.TRAINING].medal, MEDAL.SILVER);
});

test('VAL-SAVE-001 schema covers manifest ids only and no legacy shipped migration is invented', () => {
  const ids = new Set(CONTENT_MANIFEST.courses.map((entry) => entry.id));
  const save = validateSaveObject({
    v: 1,
    levels: Object.fromEntries([...ids, 'legacy-made-up'].map((id) => [id, { bestTicks: 1, medal: 1 }])),
  }).save;
  assert.equal(Object.hasOwn(save.levels, 'legacy-made-up'), false);
  assert.equal(Object.keys(save.levels).every((id) => ids.has(id)), true);
});

let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

console.log(JSON.stringify({ tests: passed, target: 'VAL-SAVE-001' }, null, 2));
