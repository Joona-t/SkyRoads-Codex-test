import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  CONTENT_MANIFEST,
  GARAGE_CATEGORY,
  STARTER_COURSE_IDS,
  TUNING_STAT_IDS,
  assertContentManifest,
  getGarageCatalogItem,
  getTuningStat,
} from '../src/content-manifest.js';
import {
  buyGarageItem,
  buyTuningTier,
  createCraftRenderParameters,
  createGarageView,
  createRaceTuningConfig,
  equipGarageItem,
  resetGarageConfiguration,
} from '../src/garage.js';
import {
  FULL_RESOURCE,
  JUMP_VELOCITY,
  LATERAL_BASE,
  MAX_Z_VELOCITY,
  THROTTLE_FORCE,
  SHIP_STATE,
  SkyRoadsSim,
  effectivePhysicsParameters,
} from '../src/sim.js';
import {
  MemoryStorage,
  createDefaultSave,
  createSaveManager,
  validateSaveObject,
} from '../src/save.js';
import { GROUND_Y, LEVEL_CENTER_X, LEVEL_MAX_X, LEVEL_MIN_X, LEVEL_TILE_STRIDE_X, TOUCH_EFFECT } from '../src/level-physics.js';

const repoRoot = resolve(new URL('../..', import.meta.url).pathname);
const CENTER_COLUMN = 3;

function near(actual, expected, tolerance = 1e-9, message = undefined) {
  assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `${actual} != ${expected}`);
}

function makeCell(options = {}) {
  return {
    raw: options.raw ?? 0,
    kind: options.kind ?? 0,
    tile: options.tile ?? false,
    tunnel: options.tunnel ?? false,
    cube: options.cube ?? null,
    tileColor: options.tileColor ?? (options.tile ? 1 : 0),
    cubeColor: options.cubeColor ?? (options.cube == null ? 0 : 1),
    tileEffect: options.tileEffect ?? TOUCH_EFFECT.NONE,
    cubeEffect: options.cubeEffect ?? TOUCH_EFFECT.NONE,
  };
}

function makeLevel(options = {}) {
  const length = options.length ?? 80;
  const cells = Array.from({ length }, () =>
    Array.from({ length: 7 }, () => makeCell({ tile: true }))
  );
  return {
    version: 1,
    roadIndex: options.roadIndex ?? 999,
    name: options.name ?? 'garage-fixture',
    world: 0,
    gravity: options.gravity ?? 8,
    fuel: options.fuel ?? 100000,
    oxygen: options.oxygen ?? 100000,
    columns: 7,
    length,
    start: { x: LEVEL_CENTER_X, y: GROUND_Y, z: 3 },
    constants: {
      tileStrideX: LEVEL_TILE_STRIDE_X,
      groundY: GROUND_Y,
      roadColumns: 7,
      levelMinX: LEVEL_MIN_X,
      levelMaxX: LEVEL_MAX_X,
      levelCenterX: LEVEL_CENTER_X,
      cubeShortTop: 100,
      cubeTallTop: 120,
      zPerRow: 1,
    },
    palette: [[0, 0, 0], [255, 255, 255]],
    cells,
  };
}

function completeTraining(save) {
  const next = JSON.parse(JSON.stringify(save));
  next.levels[STARTER_COURSE_IDS.TRAINING] = {
    bestTicks: 620,
    medal: 3,
    completed: true,
    clean: true,
  };
  next.campaign.completedCourseIds = [STARTER_COURSE_IDS.TRAINING];
  return next;
}

function changedFields(base, candidate) {
  return Object.keys(base).filter((key) => candidate[key] !== base[key]);
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('VAL-GARAGE-001 manifest owns catalogs, prices, unlocks, and exact tuning arrays', () => {
  assert.equal(assertContentManifest(), true);
  assert.deepEqual(Object.keys(CONTENT_MANIFEST.garage.catalogs), [
    GARAGE_CATEGORY.PAINTS,
    GARAGE_CATEGORY.UNDERGLOWS,
    GARAGE_CATEGORY.LIVERIES,
  ]);
  for (const [category, items] of Object.entries(CONTENT_MANIFEST.garage.catalogs)) {
    assert.ok(items.length >= 4, category);
    for (const item of items) {
      assert.equal(Number.isSafeInteger(item.price), true, item.id);
      assert.equal(item.price >= 0, true, item.id);
      assert.equal(['default', 'course-complete', 'rival-reward'].includes(item.unlock.type), true, item.id);
      assert.equal(JSON.stringify(item).includes('http'), false, item.id);
      assert.equal(JSON.stringify(item).includes('data:image'), false, item.id);
    }
  }
  assert.deepEqual(getTuningStat(TUNING_STAT_IDS.TOP_SPEED).configKeys, ['topSpeedMultiplier']);
  assert.deepEqual(getTuningStat(TUNING_STAT_IDS.ACCEL).configKeys, ['accelerationMultiplier']);
  assert.deepEqual(getTuningStat(TUNING_STAT_IDS.HANDLING).configKeys, ['handlingMultiplier']);
  assert.deepEqual(getTuningStat(TUNING_STAT_IDS.LIFT).configKeys, ['jumpVelocityMultiplier', 'fuelEfficiencyMultiplier']);
  assert.deepEqual(getTuningStat(TUNING_STAT_IDS.TOP_SPEED).multipliers, [1, 1.08, 1.17, 1.26, 1.35]);
  assert.deepEqual(getTuningStat(TUNING_STAT_IDS.ACCEL).multipliers, [1, 1.12, 1.25, 1.38, 1.5]);
  assert.deepEqual(getTuningStat(TUNING_STAT_IDS.HANDLING).multipliers, [1, 1.15, 1.3, 1.45, 1.6]);
  assert.deepEqual(getTuningStat(TUNING_STAT_IDS.LIFT).multipliers, [1, 1.15, 1.3, 1.45, 1.6]);
});

test('VAL-GARAGE-001 purchases and equips are atomic and persist through reload', () => {
  let save = createDefaultSave();
  save.credits = 399;
  const before = JSON.stringify(save);
  let result = buyGarageItem(save, GARAGE_CATEGORY.PAINTS, 'sunset-magenta');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-credits');
  assert.equal(JSON.stringify(save), before);
  assert.equal(result.save.credits, 399);

  save.credits = 400;
  result = buyGarageItem(save, GARAGE_CATEGORY.PAINTS, 'sunset-magenta');
  assert.equal(result.ok, true);
  assert.equal(result.save.credits, 0);
  assert.deepEqual(result.save.unlocks.paints, ['sunset-magenta']);

  result = equipGarageItem(result.save, GARAGE_CATEGORY.PAINTS, 'sunset-magenta');
  assert.equal(result.ok, true);
  assert.equal(result.save.cosmetics.paint, 'sunset-magenta');

  const storage = new MemoryStorage();
  createSaveManager({ storage }).write(result.save);
  const reloaded = createSaveManager({ storage }).load().save;
  assert.equal(reloaded.cosmetics.paint, 'sunset-magenta');
  assert.deepEqual(reloaded.unlocks.paints, ['sunset-magenta']);

  let locked = createDefaultSave();
  locked.credits = 750;
  result = buyGarageItem(locked, GARAGE_CATEGORY.PAINTS, 'hazard-rose');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'locked');
  assert.equal(result.save.unlocks.paints.includes('hazard-rose'), false);

  locked = completeTraining(locked);
  result = buyGarageItem(locked, GARAGE_CATEGORY.PAINTS, 'hazard-rose');
  assert.equal(result.ok, true);
  assert.equal(result.save.credits, 0);
  assert.deepEqual(result.save.unlocks.paints, ['hazard-rose']);
});

test('VAL-GARAGE-001 save validation cannot grant locked cosmetics from hostile storage', () => {
  let normalized = validateSaveObject({
    v: 1,
    credits: 9999,
    unlocks: {
      paints: ['hazard-rose'],
      underglows: ['pulse-violet'],
      liveries: ['void-check'],
    },
    cosmetics: {
      paint: 'hazard-rose',
      underglow: 'pulse-violet',
      livery: { pattern: 'void-check', accent: '#ff0000' },
    },
  }).save;
  assert.deepEqual(normalized.unlocks.paints, []);
  assert.deepEqual(normalized.unlocks.underglows, []);
  assert.deepEqual(normalized.unlocks.liveries, []);
  assert.equal(normalized.cosmetics.paint, CONTENT_MANIFEST.garage.defaults.paint);
  assert.equal(normalized.cosmetics.underglow, CONTENT_MANIFEST.garage.defaults.underglow);
  assert.equal(normalized.cosmetics.livery.pattern, CONTENT_MANIFEST.garage.defaults.livery.pattern);

  normalized = validateSaveObject(completeTraining({
    ...createDefaultSave(),
    credits: 9999,
    unlocks: { paints: ['hazard-rose'], underglows: ['pulse-violet'], liveries: ['circuit-lines'], courses: [] },
    cosmetics: { paint: 'hazard-rose', underglow: 'pulse-violet', livery: { pattern: 'circuit-lines', accent: '#ff0000' } },
  })).save;
  assert.equal(normalized.cosmetics.paint, 'hazard-rose');
  assert.equal(normalized.cosmetics.underglow, 'pulse-violet');
  assert.equal(normalized.cosmetics.livery.pattern, 'circuit-lines');
  assert.equal(normalized.cosmetics.livery.accent, getGarageCatalogItem(GARAGE_CATEGORY.LIVERIES, 'circuit-lines').params.accent);
});

test('VAL-GARAGE-001 tuning upgrades spend exactly once and reset only equipped build state', () => {
  let save = createDefaultSave();
  save.credits = 2300;
  let result = buyTuningTier(save, TUNING_STAT_IDS.TOP_SPEED, 2);
  assert.equal(result.ok, true);
  assert.equal(result.spent, 1800);
  assert.equal(result.save.credits, 500);
  assert.equal(result.save.tiers.topSpeed, 2);

  result = buyTuningTier(result.save, TUNING_STAT_IDS.LIFT, 1);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-credits');
  assert.equal(result.save.credits, 500);
  assert.equal(result.save.tiers.lift, 0);

  result = resetGarageConfiguration({
    ...result.save,
    unlocks: { ...result.save.unlocks, paints: ['sunset-magenta'] },
    cosmetics: { ...result.save.cosmetics, paint: 'sunset-magenta' },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.save.tiers, { topSpeed: 0, accel: 0, handling: 0, lift: 0 });
  assert.equal(result.save.cosmetics.paint, CONTENT_MANIFEST.garage.defaults.paint);
  assert.deepEqual(result.save.unlocks.paints, ['sunset-magenta']);
});

test('VAL-GARAGE-001 render parameters resolve catalog paint, underglow, and procedural livery params', () => {
  let save = completeTraining(createDefaultSave());
  save.credits = 3000;
  save = buyGarageItem(save, GARAGE_CATEGORY.PAINTS, 'hazard-rose').save;
  save = equipGarageItem(save, GARAGE_CATEGORY.PAINTS, 'hazard-rose').save;
  save = buyGarageItem(save, GARAGE_CATEGORY.UNDERGLOWS, 'pulse-violet').save;
  save = equipGarageItem(save, GARAGE_CATEGORY.UNDERGLOWS, 'pulse-violet').save;
  save = buyGarageItem(save, GARAGE_CATEGORY.LIVERIES, 'circuit-lines').save;
  save = equipGarageItem(save, GARAGE_CATEGORY.LIVERIES, 'circuit-lines').save;

  const params = createCraftRenderParameters(save);
  assert.equal(params.body, '#ff2b4e');
  assert.equal(params.wing, '#ffe66d');
  assert.equal(params.underglow, '#9d4bff');
  assert.equal(params.underglowIntensity, 1.3);
  assert.deepEqual(params.livery, {
    pattern: 'circuit-lines',
    accent: '#16f0e6',
    secondary: '#45ff8a',
    opacity: 0.95,
  });
});

test('VAL-GARAGE-001 garage view explains Reaction Margin and high-gravity lift limits', () => {
  const save = createDefaultSave();
  const view = createGarageView(save);
  assert.equal(view.reactionMargin.copy.includes('Reaction Margin'), true);
  assert.equal(view.reactionMargin.limitation.includes('gravity 20+'), true);
  assert.equal(view.catalogs.paints.find((item) => item.id === 'neon-cyan').owned, true);
  assert.equal(view.catalogs.paints.find((item) => item.id === 'hazard-rose').unlocked, false);
});

test('VAL-GARAGE-001 tier-zero JS output is byte-equal to the pre-parameterization corpus', async () => {
  const raw = await readFile(resolve(repoRoot, 'web/tests/fixtures/pre-parameterization-tier0-300.json'), 'utf8');
  const corpus = JSON.parse(raw);
  const level = JSON.parse(await readFile(resolve(repoRoot, 'web/assets/levels/level_00.json'), 'utf8'));
  const sim = new SkyRoadsSim(level, { physicsConfig: createRaceTuningConfig(createDefaultSave()) });
  const frames = corpus.frames.map((frame) => sim.tick(frame.controls));
  const generated = {
    schema: corpus.schema,
    source: corpus.source,
    level: corpus.level,
    controls: corpus.controls,
    frames,
  };
  assert.equal(`${JSON.stringify(generated)}\n`, raw);
});

test('VAL-GARAGE-001 per-stat sensitivity matrix changes only named injection authority', () => {
  const level = makeLevel({ fuel: 100000 });
  const baseSave = createDefaultSave();
  const base = effectivePhysicsParameters(createRaceTuningConfig(baseSave), level);
  const matrix = {};
  for (const statId of Object.values(TUNING_STAT_IDS)) {
    const save = { ...baseSave, tiers: { ...baseSave.tiers, [statId]: 4 } };
    matrix[statId] = effectivePhysicsParameters(createRaceTuningConfig(save), level);
  }

  assert.deepEqual(changedFields(base, matrix.topSpeed), ['maxZVelocity']);
  assert.deepEqual(changedFields(base, matrix.accel), ['throttleForce']);
  assert.deepEqual(changedFields(base, matrix.handling), ['lateralBase']);
  assert.deepEqual(changedFields(base, matrix.lift), ['jumpVelocity', 'fuelEfficiencyMultiplier', 'fuelDenominator']);

  near(matrix.topSpeed.maxZVelocity, MAX_Z_VELOCITY * 1.35);
  near(matrix.accel.throttleForce, THROTTLE_FORCE * 1.5);
  near(matrix.handling.lateralBase, LATERAL_BASE * 1.6);
  near(matrix.lift.jumpVelocity, JUMP_VELOCITY * 1.6);
  near(matrix.lift.fuelDenominator, level.fuel * 1.6);

  let sim = new SkyRoadsSim(level, { physicsConfig: createRaceTuningConfig({ tiers: { topSpeed: 4 } }) });
  sim.ship.zVelocity = MAX_Z_VELOCITY * 2;
  near(sim.tick().zVel, MAX_Z_VELOCITY * 1.35);

  sim = new SkyRoadsSim(level, { physicsConfig: createRaceTuningConfig({ tiers: { accel: 4 } }) });
  near(sim.tick({ accel: 1 }).zVel, THROTTLE_FORCE * 1.5);

  sim = new SkyRoadsSim(level, { physicsConfig: createRaceTuningConfig({ tiers: { handling: 4 } }) });
  sim.ship.zVelocity = 0.05;
  sim.tick({ turn: 1 });
  near(sim.ship.xMovementBase, LATERAL_BASE * 1.6);

  sim = new SkyRoadsSim(level, { physicsConfig: createRaceTuningConfig({ tiers: { lift: 4 } }) });
  sim.tick({ jump: true });
  near(sim.ship.yVelocity, 13.5);

  const heavy = new SkyRoadsSim(makeLevel({ gravity: 20 }), { physicsConfig: createRaceTuningConfig({ tiers: { lift: 4 } }) });
  heavy.tick({ jump: true });
  assert.equal(heavy.ship.isGoingUp, false);

  const baseFuel = new SkyRoadsSim(level);
  const liftFuel = new SkyRoadsSim(level, { physicsConfig: createRaceTuningConfig({ tiers: { lift: 4 } }) });
  baseFuel.ship.zVelocity = 0.1;
  liftFuel.ship.zVelocity = 0.1;
  baseFuel.tick();
  liftFuel.tick();
  assert.equal(baseFuel.ship.state, SHIP_STATE.ALIVE);
  assert.equal(liftFuel.ship.state, SHIP_STATE.ALIVE);
  const baseSpent = FULL_RESOURCE - baseFuel.ship.fuelRemaining;
  const liftSpent = FULL_RESOURCE - liftFuel.ship.fuelRemaining;
  near(baseSpent / liftSpent, 1.6);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

console.log(JSON.stringify({ tests: passed, target: 'VAL-GARAGE-001' }, null, 2));
