import assert from 'node:assert/strict';

import {
  APP_STATE,
  AppStateController,
  policyForState,
} from '../src/app-state.js';
import {
  CONTENT_MANIFEST,
  GARAGE_CATEGORY,
  MEDAL,
  SOURCE_CAMPAIGN_COURSE_COUNT,
  SOURCE_COURSES_PER_WORLD,
  STARTER_COURSE_IDS,
  createSourceDiscovery,
} from '../src/content-manifest.js';
import {
  buyGarageItem,
  createGarageView,
  equipGarageItem,
} from '../src/garage.js';
import {
  loadRequestedLevel,
  shouldProbeSourceCatalog,
} from '../src/loader.js';
import {
  applyRunRecordToProgress,
  createCampaignView,
  nextCourseAfter,
  recomputeCampaignUnlocks,
} from '../src/progression.js';
import { RaceSessionModel, RACE_OUTCOME } from '../src/race-session.js';
import {
  QUARANTINE_KEY,
  SAVE_KEY,
  MemoryStorage,
  createSaveManager,
} from '../src/save.js';
import { createStarterCourse } from '../src/starter-cup.js';
import { createCoursePreview } from '../src/preview.js';
import { createMinimapModel } from '../src/minimap.js';
import { normalizeAudioSettings } from '../src/audio.js';
import { normalizePresentationSettings } from '../src/presentation-settings.js';
import { SESSION_STATE } from '../src/sim.js';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function assertTransition(controller, to, reason) {
  const from = controller.state;
  const result = controller.transition(to, { reason });
  assert.equal(result.ok, true, `${from} -> ${to}`);
  assert.equal(controller.state, to);
  assert.equal(policyForState(to).visibleRoot, result.policy.visibleRoot);
}

function fakeIndex(exclude = new Set()) {
  return {
    version: 1,
    generatedFrom: 'ROADS.LZS',
    count: 31,
    levels: Array.from({ length: 31 }, (_, roadIndex) => ({
      roadIndex,
      world: roadIndex === 0 ? 0 : Math.floor((roadIndex - 1) / SOURCE_COURSES_PER_WORLD),
      length: 96 + roadIndex,
      name: `Export ${roadIndex}`,
      file: `level_${String(roadIndex).padStart(2, '0')}.json`,
    })).filter((entry) => !exclude.has(entry.roadIndex)),
  };
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
  const session = new RaceSessionModel(level, {
    courseId: level.cup.courseId,
    sourceKind: 'starter',
  });
  let frame = session.snapshot();
  for (let tick = 0; tick < trace.maxTicks; tick++) {
    frame = session.tick(controlsAt(trace, tick));
    if (frame.sessionState !== SESSION_STATE.PLAYING) break;
  }
  const record = session.terminalRunRecord();
  assert.ok(record, `${level.cup.courseId} ${trace.name} did not finish`);
  return { session, frame, record };
}

function writeResult(manager, result) {
  const written = manager.write(result.save);
  assert.equal(written.save.v, 1);
  return written.save;
}

test('VAL-E2E-001 tracked-only boot does not require generated source assets', async () => {
  assert.equal(shouldProbeSourceCatalog(''), false);
  assert.equal(shouldProbeSourceCatalog('?bench=starter-ion-gauntlet'), false);
  assert.equal(shouldProbeSourceCatalog('?byo=1'), true);
  assert.equal(shouldProbeSourceCatalog('?source=true'), true);
  assert.equal(shouldProbeSourceCatalog('?level=0'), true);

  const previousFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('tracked Starter Cup boot must not fetch generated source assets');
  };
  try {
    const loaded = await loadRequestedLevel('');
    assert.equal(loaded.sourceKind, 'starter');
    assert.equal(loaded.courseId, STARTER_COURSE_IDS.TRAINING);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('VAL-E2E-001 corrupt save is quarantined and recovers to a launchable Starter Cup', async () => {
  const storage = new MemoryStorage({ [SAVE_KEY]: '{bad json' });
  const manager = createSaveManager({ storage });
  const loaded = manager.load();
  assert.equal(loaded.quarantined, true);
  assert.equal(loaded.reason, 'corrupt-json');
  assert.equal(storage.getItem(QUARANTINE_KEY), '{bad json');

  const trackedDiscovery = createSourceDiscovery(null);
  const view = createCampaignView(loaded.save, trackedDiscovery);
  assert.deepEqual(view.courses.map((course) => course.id), Object.values(STARTER_COURSE_IDS));
  assert.deepEqual(view.courses.map((course) => course.launchable), [true, false, false]);
  assert.equal(view.legacyDemo.launchable, false);
  assert.match(view.legacyDemo.disabledReason, /unavailable/);
});

test('VAL-E2E-001 fresh save completes title-map-preview-countdown-race-pause-fail-retry-win-results-map-garage-settings-reload', async () => {
  const controller = new AppStateController();
  assertTransition(controller, APP_STATE.TITLE, 'boot-complete');
  assertTransition(controller, APP_STATE.WORLD_MAP, 'world-map');

  const trackedDiscovery = createSourceDiscovery(null);
  const storage = new MemoryStorage();
  const manager = createSaveManager({ storage });
  let save = manager.load().save;
  let view = createCampaignView(save, trackedDiscovery);
  assert.deepEqual(view.courses.map((course) => course.launchable), [true, false, false]);
  assert.equal(view.sourceWorlds.flatMap((world) => world.courses).every((course) => !course.launchable), true);

  const training = createStarterCourse(STARTER_COURSE_IDS.TRAINING);
  const preview = createCoursePreview(training);
  const minimap = createMinimapModel(training, {
    x: training.start.x,
    z: training.start.z,
    row: Math.floor(training.start.z),
  });
  assert.ok(preview.classes.road > 0);
  assert.ok(minimap.counts.road > 0);

  assertTransition(controller, APP_STATE.LEVEL_SELECT, 'select-level');
  assertTransition(controller, APP_STATE.COUNTDOWN, 'launch-level');
  assertTransition(controller, APP_STATE.RACING, 'countdown-complete');
  assertTransition(controller, APP_STATE.PAUSED, 'pause-key');
  assertTransition(controller, APP_STATE.RACING, 'resume');

  const failed = runTrace(training, training.traces.failure);
  assert.equal(failed.record.outcome, RACE_OUTCOME.FAILED);
  assert.equal(failed.record.failureReason, 'exploded');
  let applied = applyRunRecordToProgress(save, failed.record);
  assert.equal(applied.result.creditsAwarded, 0);
  assert.equal(Object.hasOwn(applied.save.levels, STARTER_COURSE_IDS.TRAINING), false);
  assertTransition(controller, APP_STATE.RESULTS, 'failed');

  assertTransition(controller, APP_STATE.COUNTDOWN, 'retry');
  assertTransition(controller, APP_STATE.RACING, 'countdown-complete');
  const won = runTrace(training, training.traces.win);
  assert.equal(won.record.outcome, RACE_OUTCOME.WON);
  assert.equal(won.frame.didWin, true);
  applied = applyRunRecordToProgress(save, won.record);
  assert.equal(applied.result.medal, MEDAL.GOLD);
  assert.equal(applied.result.creditsAwarded > 0, true);
  assert.deepEqual(applied.result.unlockedCourseIds, [STARTER_COURSE_IDS.HANDLING]);
  save = writeResult(manager, applied);
  assertTransition(controller, APP_STATE.RESULTS, 'won');

  view = createCampaignView(save, trackedDiscovery);
  assert.equal(view.courses[0].completed, true);
  assert.equal(view.courses[1].launchable, true);
  assert.equal(nextCourseAfter(save, STARTER_COURSE_IDS.TRAINING, trackedDiscovery).id, STARTER_COURSE_IDS.HANDLING);

  assertTransition(controller, APP_STATE.WORLD_MAP, 'return-map');
  assertTransition(controller, APP_STATE.TITLE, 'title');
  assertTransition(controller, APP_STATE.GARAGE, 'garage');
  let purchase = buyGarageItem(save, GARAGE_CATEGORY.PAINTS, 'sunset-magenta');
  assert.equal(purchase.ok, true);
  save = writeResult(manager, purchase);
  const equip = equipGarageItem(save, GARAGE_CATEGORY.PAINTS, 'sunset-magenta');
  assert.equal(equip.ok, true);
  save = writeResult(manager, equip);
  assert.equal(createGarageView(save).equipped.paint, 'sunset-magenta');

  assertTransition(controller, APP_STATE.TITLE, 'title');
  assertTransition(controller, APP_STATE.SETTINGS, 'settings');
  const audio = normalizeAudioSettings({ ...save.audio, muted: true, music: false, volume: 0.35, retroMuzax: true });
  const settings = normalizePresentationSettings({
    ...save.settings,
    highContrast: true,
    reducedMotionForce: true,
    renderScale: 0.7,
    qualityTier: 'battery',
  });
  save = manager.write({ ...save, audio, settings: { ...settings, keyBindings: save.settings.keyBindings } }).save;
  assertTransition(controller, APP_STATE.TITLE, 'title');

  const reloaded = createSaveManager({ storage }).load();
  assert.equal(reloaded.quarantined, false);
  assert.equal(reloaded.save.levels[STARTER_COURSE_IDS.TRAINING].completed, true);
  assert.equal(reloaded.save.cosmetics.paint, 'sunset-magenta');
  assert.equal(reloaded.save.audio.muted, true);
  assert.equal(reloaded.save.audio.music, false);
  assert.equal(reloaded.save.audio.volume, 0.35);
  assert.equal(reloaded.save.audio.retroMuzax, false);
  assert.equal(reloaded.save.settings.highContrast, true);
  assert.equal(reloaded.save.settings.reducedMotionForce, true);
  assert.equal(reloaded.save.settings.renderScale, 0.7);
  assert.equal(reloaded.save.settings.qualityTier, 'battery');
});

test('VAL-E2E-001 BYO discovery exposes thirty campaign entries under unlock rules', async () => {
  const discovery = createSourceDiscovery(fakeIndex());
  assert.equal(discovery.ok, true);
  assert.equal(discovery.availableCampaignCourses, SOURCE_CAMPAIGN_COURSE_COUNT);
  assert.equal(discovery.legacyDemo.available, true);
  assert.equal(discovery.worlds.length, 10);

  let save = createSaveManager({ storage: new MemoryStorage() }).load().save;
  let view = createCampaignView(save, discovery);
  assert.deepEqual(view.sourceWorlds[0].courses.map((course) => course.launchable), [true, true, true]);
  assert.deepEqual(view.sourceWorlds[1].courses.map((course) => course.launchable), [false, false, false]);

  for (const courseId of CONTENT_MANIFEST.sourceCampaign.worlds[0].courseIds) {
    save.levels[courseId] = {
      bestTicks: 900,
      medal: MEDAL.BRONZE,
      completed: true,
      clean: false,
    };
  }
  save = recomputeCampaignUnlocks(save);
  view = createCampaignView(save, discovery);
  assert.deepEqual(view.sourceWorlds[1].courses.map((course) => course.launchable), [true, true, true]);
  assert.equal(view.sourceWorlds.flatMap((world) => world.courses).length, SOURCE_CAMPAIGN_COURSE_COUNT);
});

let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

console.log(JSON.stringify({
  tests: passed,
  targets: ['VAL-E2E-001'],
}, null, 2));
