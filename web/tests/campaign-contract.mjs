import assert from 'node:assert/strict';

import {
  CONTENT_MANIFEST,
  MEDAL,
  SOURCE_CAMPAIGN_COURSE_COUNT,
  SOURCE_COURSES_PER_WORLD,
  SOURCE_DEMO_COURSE_ID,
  STARTER_COURSE_IDS,
  assertContentManifest,
  createSourceDiscovery,
  getCourseEntry,
  sourceManifestEntryForRoadIndex,
} from '../src/content-manifest.js';
import {
  applyRunRecordToProgress,
  createCampaignView,
  medalForTicks,
  nextCourseAfter,
  recomputeCampaignUnlocks,
} from '../src/progression.js';
import { resultActionsForRace } from '../src/shell-ui.js';
import { RaceSessionModel, createRunRecord, formatTicks, ticksToMilliseconds } from '../src/race-session.js';
import { createDefaultSave, MemoryStorage, createSaveManager } from '../src/save.js';
import { createStarterCourse, createStarterCupCourses } from '../src/starter-cup.js';
import { TOUCH_EFFECT } from '../src/level-physics.js';
import { GAMEPLAY_EVENT, SESSION_STATE, SHIP_STATE } from '../src/sim.js';
import { RaceSessionLifecycle } from '../src/session-lifecycle.js';

const CENTER_COLUMN = 3;

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
  const fill = options.fill ?? makeCell({ tile: true });
  const cells = Array.from({ length }, () => Array.from({ length: 7 }, () => ({ ...fill })));
  return {
    version: 1,
    roadIndex: options.roadIndex ?? 'fixture',
    name: options.name ?? 'fixture',
    world: 0,
    gravity: options.gravity ?? 8,
    fuel: options.fuel ?? 100000,
    oxygen: options.oxygen ?? 100000,
    columns: 7,
    length,
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
    palette: [[0, 0, 0], [255, 255, 255], [255, 0, 0]],
    cells,
  };
}

function setCell(level, row, column, cell) {
  level.cells[row][column] = makeCell(cell);
}

function controlsAt(trace, tick) {
  const segment = trace.segments.find((candidate) => tick < candidate.until) ?? trace.segments.at(-1);
  return {
    turn: segment.turn,
    accel: segment.accel,
    jump: segment.jump,
  };
}

function runTrace(level, trace) {
  const session = new RaceSessionModel(level, { courseId: level.cup.courseId, sourceKind: 'starter' });
  let frame = session.snapshot();
  for (let tick = 0; tick < trace.maxTicks; tick++) {
    frame = session.tick(controlsAt(trace, tick));
    if (frame.sessionState !== SESSION_STATE.PLAYING) break;
  }
  return { frame, session, record: session.terminalRunRecord() };
}

function runUntilTerminal(level, options = {}) {
  const session = new RaceSessionModel(level, {
    courseId: options.courseId ?? STARTER_COURSE_IDS.TRAINING,
    sourceKind: 'starter',
  });
  let frame = session.snapshot();
  for (let tick = 0; tick < (options.maxTicks ?? 400); tick++) {
    frame = session.tick(options.controls?.(tick) ?? { turn: 0, accel: 1, jump: false });
    if (frame.sessionState !== SESSION_STATE.PLAYING) return { frame, session, record: session.terminalRunRecord() };
  }
  throw new Error(`${options.name ?? 'fixture'} did not terminate`);
}

function fakeIndex(exclude = new Set()) {
  return {
    version: 1,
    levels: Array.from({ length: 31 }, (_, roadIndex) => ({
      roadIndex,
      world: roadIndex === 0 ? 0 : Math.floor((roadIndex - 1) / 3),
      name: `Export ${roadIndex}`,
      file: `level_${String(roadIndex).padStart(2, '0')}.json`,
    })).filter((entry) => !exclude.has(entry.roadIndex)),
  };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('VAL-CAMPAIGN-001 manifest is authoritative, complete, and unique', () => {
  assert.equal(assertContentManifest(), true);
  assert.equal(CONTENT_MANIFEST.starterCup.courses.length, 3);
  assert.equal(CONTENT_MANIFEST.sourceCampaign.worlds.length, 10);
  assert.equal(CONTENT_MANIFEST.sourceCampaign.courses.length, SOURCE_CAMPAIGN_COURSE_COUNT);
  assert.equal(CONTENT_MANIFEST.sourceCampaign.legacyDemo.id, SOURCE_DEMO_COURSE_ID);
  assert.equal(CONTENT_MANIFEST.sourceCampaign.legacyDemo.campaignSlot, false);
  assert.equal(new Set(CONTENT_MANIFEST.courses.map((entry) => entry.id)).size, CONTENT_MANIFEST.courses.length);

  for (let roadIndex = 1; roadIndex <= SOURCE_CAMPAIGN_COURSE_COUNT; roadIndex++) {
    const entry = sourceManifestEntryForRoadIndex(roadIndex);
    assert.equal(entry.roadIndex, roadIndex);
    assert.equal(entry.worldOrder, Math.floor((roadIndex - 1) / SOURCE_COURSES_PER_WORLD));
    assert.equal(entry.courseOrder, (roadIndex - 1) % SOURCE_COURSES_PER_WORLD);
    assert.equal(entry.medalThresholds.gold < entry.medalThresholds.silver, true);
    assert.equal(entry.medalThresholds.silver < entry.medalThresholds.bronze, true);
  }
  assert.equal(sourceManifestEntryForRoadIndex(0).id, SOURCE_DEMO_COURSE_ID);
});

test('VAL-CAMPAIGN-001 BYO discovery maps 1..30 and disables missing, duplicate, or corrupt optional entries', () => {
  let discovery = createSourceDiscovery(fakeIndex());
  assert.equal(discovery.availableCampaignCourses, 30);
  assert.equal(discovery.legacyDemo.available, true);
  assert.equal(discovery.worlds.length, 10);
  assert.deepEqual(discovery.worlds[0].courses.map((entry) => entry.roadIndex), [1, 2, 3]);
  assert.deepEqual(discovery.worlds[9].courses.map((entry) => entry.roadIndex), [28, 29, 30]);

  discovery = createSourceDiscovery(fakeIndex(new Set([5])), { corruptRoads: [7] });
  assert.equal(discovery.courses.find((entry) => entry.roadIndex === 5).disabledReason, 'Missing local road 5');
  assert.equal(discovery.courses.find((entry) => entry.roadIndex === 7).disabledReason, 'Corrupt local road 7');

  const duplicate = fakeIndex();
  duplicate.levels.push({ ...duplicate.levels.find((entry) => entry.roadIndex === 4), file: 'dup.json' });
  discovery = createSourceDiscovery(duplicate);
  assert.equal(discovery.courses.find((entry) => entry.roadIndex === 4).disabledReason, 'Duplicate road 4 in local index');

  discovery = createSourceDiscovery(null);
  assert.equal(discovery.ok, false);
  assert.equal(discovery.availableCampaignCourses, 0);
});

test('VAL-PROGRESSION-001 medal thresholds are strict at boundaries', () => {
  for (const course of CONTENT_MANIFEST.courses.filter((entry) => entry.campaignSlot)) {
    const t = course.medalThresholds;
    assert.equal(medalForTicks(course, t.gold), MEDAL.GOLD, course.id);
    assert.equal(medalForTicks(course, t.gold + 1), t.gold + 1 <= t.silver ? MEDAL.SILVER : MEDAL.BRONZE, course.id);
    assert.equal(medalForTicks(course, t.silver), MEDAL.SILVER, course.id);
    assert.equal(medalForTicks(course, t.bronze), MEDAL.BRONZE, course.id);
    assert.equal(medalForTicks(course, t.bronze + 1), MEDAL.NONE, course.id);
  }
});

test('VAL-RACE-001 tick time is derived only from integer 70 Hz race ticks', () => {
  assert.equal(ticksToMilliseconds(0), 0);
  assert.equal(ticksToMilliseconds(35), 500);
  assert.equal(ticksToMilliseconds(70), 1000);
  assert.equal(formatTicks(70), '00:01.000');
});

test('VAL-RACE-001 RaceSessionModel records win/fail terminal state and reconstructs retry snapshot', () => {
  const training = createStarterCourse(STARTER_COURSE_IDS.TRAINING);
  const won = runTrace(training, training.traces.win);
  assert.equal(won.frame.sessionState, SESSION_STATE.WON);
  assert.equal(won.record.outcome, 'won');
  assert.equal(won.record.raceTicks, won.frame.raceTicks);
  assert.equal(won.record.tickHz, 70);
  assert.equal(Object.isFrozen(won.record), true);

  const before = JSON.stringify(won.session.initialSnapshot);
  won.session.tick({ turn: 1, accel: 1, jump: true });
  const restarted = won.session.restart();
  assert.equal(JSON.stringify(restarted), before);

  const impact = makeLevel({ name: 'impact' });
  setCell(impact, 3, CENTER_COLUMN, { tile: true, tileEffect: TOUCH_EFFECT.KILL });
  let failed = runUntilTerminal(impact, { name: 'impact' });
  assert.equal(failed.record.failureReason, 'exploded');
  assert.equal(failed.record.recoveryMessage.includes('destroyed'), true);

  const fallen = makeLevel({ name: 'fallen', fill: makeCell(), length: 20 });
  failed = runUntilTerminal(fallen, { name: 'fallen', maxTicks: 80 });
  assert.equal(failed.record.failureReason, 'fallen');

  const noFuel = makeLevel({ name: 'fuel', fuel: 1, oxygen: 100000 });
  failed = runUntilTerminal(noFuel, { name: 'fuel', maxTicks: 80 });
  assert.equal(failed.record.failureReason, 'out-of-fuel');

  const noOxygen = makeLevel({ name: 'oxygen', fuel: 100000, oxygen: 1 });
  failed = runUntilTerminal(noOxygen, { name: 'oxygen', maxTicks: 80 });
  assert.equal(failed.record.failureReason, 'out-of-oxygen');
});

test('VAL-PROGRESSION-001 rewards are explicit, idempotent, and only improve best/medal', () => {
  const training = createStarterCourse(STARTER_COURSE_IDS.TRAINING);
  const { record } = runTrace(training, training.traces.win);
  let save = createDefaultSave();
  let applied = applyRunRecordToProgress(save, record);
  save = applied.save;
  assert.equal(applied.result.medal, MEDAL.GOLD);
  assert.equal(applied.result.newBest, true);
  assert.equal(applied.result.cleanRun, true);
  assert.deepEqual(applied.result.rewardComponents.map((item) => item.label), [
    'Completion credits',
    'Bronze medal bonus',
    'Silver medal bonus',
    'Gold medal bonus',
    'Clean run bonus',
  ]);
  const creditsAfterFirstWin = save.credits;
  assert.ok(creditsAfterFirstWin > 0);

  applied = applyRunRecordToProgress(save, record);
  assert.equal(applied.save.credits, creditsAfterFirstWin);
  assert.equal(applied.result.creditsAwarded, 0);
  assert.equal(applied.result.rewardComponents.length, 0);
  assert.equal(applied.save.levels[record.courseId].medal, MEDAL.GOLD);

  const slower = createRunRecord({
    courseId: record.courseId,
    sourceKind: 'starter',
    level: training,
    frame: { sessionState: SESSION_STATE.WON, state: SHIP_STATE.ALIVE, row: 91 },
    raceTicks: getCourseEntry(record.courseId).medalThresholds.bronze,
    events: [GAMEPLAY_EVENT.SHIP_BUMPED_WALL],
  });
  applied = applyRunRecordToProgress(save, slower);
  assert.equal(applied.save.levels[record.courseId].bestTicks, record.raceTicks);
  assert.equal(applied.save.levels[record.courseId].medal, MEDAL.GOLD);
  assert.equal(applied.result.cleanRun, false);
});

test('VAL-PROGRESSION-001 Starter Cup and BYO worlds unlock through one rule engine but separate chains', () => {
  let save = createDefaultSave();
  let view = createCampaignView(save, createSourceDiscovery(fakeIndex()));
  assert.deepEqual(view.courses.map((course) => course.launchable), [true, false, false]);
  assert.deepEqual(view.sourceWorlds[0].courses.map((course) => course.launchable), [true, true, true]);
  assert.deepEqual(view.sourceWorlds[1].courses.map((course) => course.launchable), [false, false, false]);

  for (const courseId of CONTENT_MANIFEST.sourceCampaign.worlds[0].courseIds) {
    save.levels[courseId] = { bestTicks: 900, medal: MEDAL.BRONZE, completed: true, clean: false };
  }
  save = recomputeCampaignUnlocks(save);
  view = createCampaignView(save, createSourceDiscovery(fakeIndex()));
  assert.deepEqual(view.sourceWorlds[1].courses.map((course) => course.launchable), [true, true, true]);
  assert.deepEqual(view.courses.map((course) => course.launchable), [true, false, false]);
});

test('VAL-CAMPAIGN-001 repeated swaps leave one active race scope and no stale resources', () => {
  const lifecycle = new RaceSessionLifecycle();
  let activeResources = 0;
  let peakResources = 0;
  for (let i = 0; i < 100; i++) {
    const scope = lifecycle.begin(`swap-${i}`);
    activeResources += 4;
    peakResources = Math.max(peakResources, activeResources);
    for (let resource = 0; resource < 4; resource++) {
      scope.add(`resource-${resource}`, () => {
        activeResources -= 1;
      });
    }
  }
  const snapshot = lifecycle.snapshot();
  assert.equal(snapshot.generation, 100);
  assert.equal(snapshot.disposed.length, 99);
  assert.equal(snapshot.active.resources.length, 4);
  assert.equal(activeResources, 4);
  assert.equal(peakResources <= 8, true);
  lifecycle.disposeCurrent();
  assert.equal(activeResources, 0);
});

test('VAL-CAMPAIGN/RACE/SAVE/PROGRESSION title-map-race-results-reload headless flow persists progression', () => {
  const storage = new MemoryStorage();
  const manager = createSaveManager({ storage });
  let boot = manager.load();
  let view = createCampaignView(boot.save, createSourceDiscovery(fakeIndex()));
  assert.equal(view.courses[0].launchable, true);
  assert.equal(view.courses[1].launchable, false);

  const training = createStarterCourse(STARTER_COURSE_IDS.TRAINING);
  const race = runTrace(training, training.traces.win);
  const applied = applyRunRecordToProgress(boot.save, race.record);
  manager.write(applied.save);

  const reloaded = createSaveManager({ storage }).load();
  view = createCampaignView(reloaded.save, createSourceDiscovery(fakeIndex()));
  assert.equal(view.courses[0].completed, true);
  assert.equal(view.courses[1].launchable, true);
  assert.equal(view.courses[0].bestTicks, race.record.raceTicks);
  assert.equal(view.courses[0].medal, MEDAL.GOLD);
  assert.equal(nextCourseAfter(reloaded.save, STARTER_COURSE_IDS.TRAINING, createSourceDiscovery(fakeIndex())).id, STARTER_COURSE_IDS.HANDLING);
});

test('VAL-RACE-001 failed results never expose Next even when later courses are unlocked', () => {
  const training = createStarterCourse(STARTER_COURSE_IDS.TRAINING);
  const manager = createSaveManager({ storage: new MemoryStorage() });
  let save = manager.load().save;
  save = applyRunRecordToProgress(save, runTrace(training, training.traces.win).record).save;
  const unlockedNext = nextCourseAfter(save, STARTER_COURSE_IDS.TRAINING, createSourceDiscovery(fakeIndex()));
  assert.equal(unlockedNext.id, STARTER_COURSE_IDS.HANDLING);

  const failed = runTrace(training, training.traces.failure);
  const appliedFailure = applyRunRecordToProgress(save, failed.record);
  const actions = resultActionsForRace({
    progressResult: appliedFailure.result,
    nextCourse: unlockedNext,
  });
  assert.equal(appliedFailure.result.outcome, 'failed');
  assert.equal(actions.nextVisible, false);
  assert.equal(actions.nextDisabled, true);
  assert.equal(actions.nextCourse, null);
});

test('VAL-ORIGINAL-CONTENT-001 Starter Cup content remains exactly three tracked courses', () => {
  const courses = createStarterCupCourses();
  assert.deepEqual(courses.map((level) => level.cup.courseId), Object.values(STARTER_COURSE_IDS));
});

let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

console.log(JSON.stringify({ tests: passed, target: 'VAL-CAMPAIGN-001 VAL-RACE-001 VAL-PROGRESSION-001' }, null, 2));
