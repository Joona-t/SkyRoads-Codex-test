import assert from 'node:assert/strict';

import {
  APP_STATE,
  AppStateController,
  FOCUS_TARGETS,
  LEGAL_TRANSITIONS,
  canUseRestartShortcut,
  pauseForVisibilityLoss,
  policyForState,
  shouldAdvanceSimulation,
} from '../src/app-state.js';
import { InputController } from '../src/input.js';
import { loadRequestedLevel } from '../src/loader.js';
import { createCoursePreview, COURSE_CLASS } from '../src/preview.js';
import {
  STARTER_COURSE_IDS,
  STARTER_CUP_MANIFEST,
  createStarterCupProgression,
} from '../src/starter-cup.js';
import { createSourceDiscovery } from '../src/content-manifest.js';
import { createCampaignView } from '../src/progression.js';
import { createDefaultSave } from '../src/save.js';
import { createMinimapModel } from '../src/minimap.js';
import { initialRaceVisibilityMetrics } from '../src/visibility.js';
import {
  ListenerRegistry,
  RaceSessionLifecycle,
  ResourceScope,
  advanceRuntimeForShellState,
} from '../src/session-lifecycle.js';
import { FixedStepRuntime, FIXED_STEP_MS } from '../src/runtime.js';
import { createTutorialLevel } from '../src/tutorial-level.js';
import {
  buildRouteMapView,
  consumePauseRequestForShell,
  visibleScreenNamesForState,
} from '../src/shell-ui.js';

function fakeKey(code, key = code, repeat = false) {
  return {
    code,
    key,
    repeat,
    preventDefault() {},
    stopPropagation() {},
  };
}

class FakeSession {
  constructor() {
    this.frame = {
      frameIndex: 0,
      controls: { turn: 0, accel: 0, jump: false },
      x: 256,
      y: 80,
      z: 3,
      zVel: 0,
      fuelPct: 1,
      oxygenPct: 1,
      events: [],
      row: 3,
      sessionState: 'playing',
    };
  }

  tick(controls) {
    this.frame = {
      ...this.frame,
      frameIndex: this.frame.frameIndex + 1,
      controls: { ...controls },
      z: this.frame.z + 1,
      row: this.frame.row + 1,
    };
    return this.frame;
  }

  snapshot() {
    return this.frame;
  }

  restart() {
    this.frame = { ...this.frame, frameIndex: 0, z: 3, row: 3 };
    return this.frame;
  }
}

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== fn));
  }

  count(type) {
    return (this.listeners.get(type) ?? []).length;
  }
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('VAL-SHELL-001 transition table is explicit, legal, and typed on rejection', () => {
  assert.deepEqual(LEGAL_TRANSITIONS[APP_STATE.LOADING], [APP_STATE.TITLE]);
  assert.deepEqual(LEGAL_TRANSITIONS[APP_STATE.RACING], [APP_STATE.PAUSED, APP_STATE.RESULTS]);
  assert.deepEqual(LEGAL_TRANSITIONS[APP_STATE.RESULTS], [APP_STATE.COUNTDOWN, APP_STATE.WORLD_MAP]);

  const controller = new AppStateController();
  assert.equal(controller.transition(APP_STATE.RACING, { reason: 'bad' }).ok, false);
  assert.equal(controller.state, APP_STATE.LOADING);
  const rejection = controller.transition(APP_STATE.RACING).error;
  assert.equal(rejection.code, 'ILLEGAL_TRANSITION');
  assert.equal(rejection.from, APP_STATE.LOADING);
  assert.equal(rejection.to, APP_STATE.RACING);

  for (const next of [
    APP_STATE.TITLE,
    APP_STATE.WORLD_MAP,
    APP_STATE.LEVEL_SELECT,
    APP_STATE.COUNTDOWN,
    APP_STATE.RACING,
    APP_STATE.PAUSED,
    APP_STATE.RACING,
    APP_STATE.RESULTS,
    APP_STATE.WORLD_MAP,
  ]) {
    const result = controller.transition(next, { reason: 'test' });
    assert.equal(result.ok, true, `${controller.state} -> ${next}`);
  }
});

test('VAL-SHELL-001 every state has one input, simulation, audio, UI, and focus owner', () => {
  for (const state of Object.values(APP_STATE)) {
    const policy = policyForState(state);
    assert.equal(typeof policy.input, 'string', state);
    assert.equal(typeof policy.simulation, 'string', state);
    assert.equal(typeof policy.audio, 'string', state);
    assert.equal(typeof policy.visibleRoot, 'string', state);
    assert.equal(typeof FOCUS_TARGETS[state], 'string', state);
  }
  assert.equal(shouldAdvanceSimulation(APP_STATE.RACING), true);
  assert.equal(shouldAdvanceSimulation(APP_STATE.PAUSED), false);
  assert.equal(canUseRestartShortcut(APP_STATE.RACING), false);
  assert.equal(canUseRestartShortcut(APP_STATE.RESULTS), true);
});

test('VAL-SHELL-001 pause and visibility loss freeze ticks and clear held input', () => {
  const controller = new AppStateController();
  for (const next of [APP_STATE.TITLE, APP_STATE.WORLD_MAP, APP_STATE.LEVEL_SELECT, APP_STATE.COUNTDOWN, APP_STATE.RACING]) {
    assert.equal(controller.transition(next, { reason: 'setup' }).ok, true);
  }

  const input = new InputController();
  input.handleKeyDown(fakeKey('ArrowUp'));
  assert.equal(input.snapshot().accel, 1);

  const runtime = new FixedStepRuntime(new FakeSession());
  advanceRuntimeForShellState(runtime, APP_STATE.RACING, 0, () => input.snapshot());
  advanceRuntimeForShellState(runtime, APP_STATE.RACING, FIXED_STEP_MS, () => input.snapshot());
  assert.equal(runtime.counters().simTickCount, 1);

  const paused = pauseForVisibilityLoss(controller, input, { reason: 'test-hidden' });
  assert.equal(paused.paused, true);
  assert.equal(controller.state, APP_STATE.PAUSED);
  assert.deepEqual(input.snapshot(), { turn: 0, accel: 0, jump: false });

  advanceRuntimeForShellState(runtime, APP_STATE.PAUSED, FIXED_STEP_MS * 80, () => ({ turn: 0, accel: 1, jump: true }));
  assert.equal(runtime.counters().simTickCount, 1);

  assert.equal(controller.transition(APP_STATE.RACING, { reason: 'resume' }).ok, true);
  advanceRuntimeForShellState(runtime, APP_STATE.RACING, FIXED_STEP_MS * 81, () => ({ turn: 0, accel: 1, jump: false }));
  assert.equal(runtime.counters().simTickCount, 2);
});

test('VAL-SHELL-001 keyboard and touch pause requests rerender modal state immediately', () => {
  const controller = new AppStateController();
  for (const next of [APP_STATE.TITLE, APP_STATE.WORLD_MAP, APP_STATE.LEVEL_SELECT, APP_STATE.COUNTDOWN, APP_STATE.RACING]) {
    assert.equal(controller.transition(next, { reason: 'setup' }).ok, true);
  }
  const input = new InputController();
  const renders = [];
  const focus = [];
  const audio = [];
  const context = {
    state: controller,
    input,
    render: () => renders.push(controller.state),
    focus: (state) => focus.push(state),
    syncAudio: () => audio.push(controller.state),
  };

  input.setAction('pause', true);
  input.setAction('pause', false);
  let handled = consumePauseRequestForShell(context, { reason: 'pause-key' });
  assert.equal(handled.toggled, true);
  assert.equal(controller.state, APP_STATE.PAUSED);
  assert.deepEqual(renders, [APP_STATE.PAUSED]);
  assert.deepEqual(focus, [APP_STATE.PAUSED]);
  assert.deepEqual(audio, [APP_STATE.PAUSED]);

  input.setAction('pause', true);
  input.setAction('pause', false);
  handled = consumePauseRequestForShell(context, { reason: 'pause-button' });
  assert.equal(handled.toggled, true);
  assert.equal(controller.state, APP_STATE.RACING);
  assert.deepEqual(renders, [APP_STATE.PAUSED, APP_STATE.RACING]);
  assert.deepEqual(focus, [APP_STATE.PAUSED, APP_STATE.RACING]);
});

test('VAL-SHELL-001 result and pause visibility expose one modal owner beside the race view', () => {
  assert.deepEqual([...visibleScreenNamesForState(APP_STATE.PAUSED)].sort(), ['pause', 'race']);
  assert.deepEqual([...visibleScreenNamesForState(APP_STATE.RESULTS)].sort(), ['race', 'results']);
  assert.equal(visibleScreenNamesForState(APP_STATE.RESULTS).has('pause'), false);
});

test('VAL-COURSE-001 tracked Starter Cup loads do not fetch generated assets', async () => {
  const previousFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('fetch should not be called for tracked Starter Cup loads');
  };
  try {
    const loaded = await loadRequestedLevel('');
    assert.equal(loaded.sourceKind, 'starter');
    assert.equal(loaded.level.source, 'tracked-original-neondrift-tutorial');
    assert.equal(loaded.courseId, STARTER_COURSE_IDS.TRAINING);
    const handling = await loadRequestedLevel('?course=starter-handling');
    assert.equal(handling.sourceKind, 'starter');
    assert.equal(handling.courseId, STARTER_COURSE_IDS.HANDLING);
    assert.equal(handling.level.source, 'tracked-original-neondrift-starter-cup');
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('VAL-ORIGINAL-CONTENT-001 Starter Cup manifest unlocks in order and completes after three wins', () => {
  assert.equal(STARTER_CUP_MANIFEST.courses.length, 3);
  assert.deepEqual(STARTER_CUP_MANIFEST.courses.map((entry) => entry.role), ['training', 'handling', 'jump-effect']);

  const fresh = createStarterCupProgression();
  assert.deepEqual(fresh.courses.map((entry) => entry.unlocked), [true, false, false]);
  assert.equal(fresh.complete, false);

  const afterTraining = createStarterCupProgression([STARTER_COURSE_IDS.TRAINING]);
  assert.deepEqual(afterTraining.courses.map((entry) => entry.unlocked), [true, true, false]);
  assert.equal(afterTraining.complete, false);

  const complete = createStarterCupProgression(Object.values(STARTER_COURSE_IDS));
  assert.deepEqual(complete.courses.map((entry) => entry.completed), [true, true, true]);
  assert.equal(complete.complete, true);
});

test('VAL-E2E-001 tracked-only map compacts optional source roads to one explanation', () => {
  const discovery = createSourceDiscovery(null);
  const view = createCampaignView(createDefaultSave(), discovery);
  const routeMap = buildRouteMapView({ ok: false, skipped: true, discovery }, view);
  assert.equal(routeMap.starterCourses.length, 3);
  assert.equal(routeMap.sourceCards.length, 0);
  assert.equal(routeMap.sourceSummary.id, 'optional-source-unavailable');
  assert.match(routeMap.statusText, /Starter Cup is ready/);
});

test('VAL-COURSE-001 preview, minimap, frustum, and linear luminance are semantic', () => {
  const level = createTutorialLevel();
  const preview = createCoursePreview(level);
  for (const courseClass of Object.values(COURSE_CLASS)) {
    assert.ok(preview.classes[courseClass] > 0, `missing preview class ${courseClass}`);
  }
  assert.ok(preview.minRoadLuminance >= 0.15);

  const minimap = createMinimapModel(level, {
    x: level.start.x,
    z: level.start.z,
    row: Math.floor(level.start.z),
  });
  assert.ok(minimap.counts.road > 0);
  assert.ok(minimap.counts.gapBoundary > 0);
  assert.ok(minimap.counts.obstacle > 0);
  assert.ok(minimap.counts.effect > 0);
  assert.ok(minimap.counts.finish > 0);

  for (const aspect of [1474 / 695, 390 / 844]) {
    const metrics = initialRaceVisibilityMetrics(level, { aspect });
    assert.equal(metrics.firstChunkIntersectsFrustum, true, `aspect ${aspect}`);
    assert.ok(metrics.visibleFirstRoadInstances > 0, `aspect ${aspect}`);
    assert.ok(metrics.minFirstRoadLuminance >= 0.15, `aspect ${aspect}`);
    for (const [name, visible] of Object.entries(metrics.semanticClasses)) {
      assert.equal(visible, true, `missing semantic class ${name}`);
    }
  }
});

test('VAL-SHELL-001 lifecycle disposes listeners and renderer-owned race resources on swaps', () => {
  const calls = [];
  const scope = new ResourceScope('unit');
  scope.add('a', () => calls.push('a'));
  scope.add('b', () => calls.push('b'));
  assert.deepEqual(scope.dispose(), { label: 'unit', disposed: 2, remaining: 0 });
  assert.deepEqual(calls, ['b', 'a']);
  assert.equal(scope.dispose().disposed, 0);

  const target = new FakeTarget();
  const registry = new ListenerRegistry('listeners');
  registry.add(target, 'click', () => {});
  registry.add(target, 'keydown', () => {});
  assert.equal(registry.snapshot().count, 2);
  registry.dispose();
  assert.equal(registry.snapshot().count, 0);
  assert.equal(target.count('click'), 0);
  assert.equal(target.count('keydown'), 0);

  const lifecycle = new RaceSessionLifecycle();
  lifecycle.begin('first').add('mesh', () => calls.push('mesh-1'));
  lifecycle.begin('second').add('mesh', () => calls.push('mesh-2'));
  assert.ok(calls.includes('mesh-1'));
  assert.equal(lifecycle.snapshot().disposed.length, 1);
  lifecycle.disposeCurrent();
  assert.ok(calls.includes('mesh-2'));
  assert.equal(lifecycle.snapshot().active, null);
});

let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

console.log(JSON.stringify({
  tests: passed,
  targets: ['VAL-COURSE-001', 'VAL-SHELL-001'],
}, null, 2));
