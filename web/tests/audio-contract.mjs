import assert from 'node:assert/strict';

import {
  AUDIO_EVENT,
  RuntimeAudioEventMapper,
  audioEventsForFrame,
  createAudioController,
  createRetroMuzaxCapability,
} from '../src/audio.js';
import { TOUCH_EFFECT } from '../src/level-physics.js';
import { FixedStepRuntime, FIXED_STEP_MS } from '../src/runtime.js';
import { MemoryStorage, SAVE_KEY, createDefaultSave, createSaveManager, validateSaveObject } from '../src/save.js';
import { GAMEPLAY_EVENT, SESSION_STATE } from '../src/sim.js';

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];
  }

  setValueAtTime(value, at) {
    this.value = value;
    this.calls.push(['set', value, at]);
  }

  linearRampToValueAtTime(value, at) {
    this.value = value;
    this.calls.push(['linear', value, at]);
  }

  exponentialRampToValueAtTime(value, at) {
    this.value = value;
    this.calls.push(['exp', value, at]);
  }

  cancelScheduledValues(at) {
    this.calls.push(['cancel', at]);
  }
}

class FakeNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.connections = [];
    this.disconnected = false;
  }

  connect(destination) {
    this.connections.push(destination);
    return destination;
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakeGainNode extends FakeNode {
  constructor(context) {
    super(context, 'gain');
    this.gain = new FakeAudioParam(1);
  }
}

class FakeOscillatorNode extends FakeNode {
  constructor(context) {
    super(context, 'oscillator');
    this.type = 'sine';
    this.frequency = new FakeAudioParam(440);
    this.startCount = 0;
    this.stopCount = 0;
  }

  start() {
    this.startCount += 1;
    this.context.startedOscillators += 1;
  }

  stop() {
    this.stopCount += 1;
    this.context.stoppedOscillators += 1;
  }
}

class FakeAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = new FakeNode(this, 'destination');
    this.createdOscillators = [];
    this.createdGains = [];
    this.startedOscillators = 0;
    this.stoppedOscillators = 0;
    this.resumeCount = 0;
    this.suspendCount = 0;
    this.closeCount = 0;
  }

  createOscillator() {
    const node = new FakeOscillatorNode(this);
    this.createdOscillators.push(node);
    return node;
  }

  createGain() {
    const node = new FakeGainNode(this);
    this.createdGains.push(node);
    return node;
  }

  async resume() {
    this.resumeCount += 1;
    this.state = 'running';
  }

  async suspend() {
    this.suspendCount += 1;
    this.state = 'suspended';
  }

  close() {
    this.closeCount += 1;
    this.state = 'closed';
  }
}

class FakeTimerApi {
  constructor() {
    this.nextId = 1;
    this.active = new Set();
    this.started = 0;
    this.cleared = 0;
  }

  setInterval(_fn, _ms) {
    const id = this.nextId;
    this.nextId += 1;
    this.started += 1;
    this.active.add(id);
    return id;
  }

  clearInterval(id) {
    this.cleared += 1;
    this.active.delete(id);
  }
}

class EventSession {
  constructor(frames) {
    this.frames = frames;
    this.index = 0;
    this.frame = {
      frameIndex: 0,
      x: 256,
      y: 80,
      z: 3,
      row: 3,
      events: [],
      sessionState: SESSION_STATE.PLAYING,
      controls: { turn: 0, accel: 0, jump: false },
    };
  }

  tick() {
    this.frame = { ...this.frame, ...(this.frames[this.index] ?? {}) };
    this.index += 1;
    return this.frame;
  }

  snapshot() {
    return this.frame;
  }

  restart() {
    this.index = 0;
    return this.frame;
  }
}

function makeController(settings = {}) {
  const contexts = [];
  const timers = new FakeTimerApi();
  const controller = createAudioController({
    settings,
    timerApi: timers,
    contextFactory() {
      const context = new FakeAudioContext();
      contexts.push(context);
      return context;
    },
  });
  return { controller, contexts, timers };
}

function makeFrame(overrides = {}) {
  return {
    frameIndex: overrides.frameIndex ?? 0,
    x: overrides.x ?? 256,
    y: overrides.y ?? 80,
    z: overrides.z ?? 3,
    row: overrides.row ?? Math.floor(overrides.z ?? 3),
    events: overrides.events ?? [],
    sessionState: overrides.sessionState ?? SESSION_STATE.PLAYING,
  };
}

function makeEffectLevel(effect = TOUCH_EFFECT.ACCELERATE) {
  return {
    name: 'audio-effect-fixture',
    columns: 7,
    length: 8,
    constants: {
      groundY: 80,
      tileStrideX: 46,
      roadColumns: 7,
      levelMinX: 95,
      levelMaxX: 417,
      levelCenterX: 256,
      cubeShortTop: 100,
      cubeTallTop: 120,
      zPerRow: 1,
    },
    cells: Array.from({ length: 8 }, (_, row) =>
      Array.from({ length: 7 }, () => ({
        raw: 0,
        tile: true,
        tunnel: false,
        cube: null,
        tileColor: 1,
        cubeColor: 0,
        tileEffect: row === 4 ? effect : TOUCH_EFFECT.NONE,
        cubeEffect: TOUCH_EFFECT.NONE,
      }))
    ),
  };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('VAL-AUDIO-001 no AudioContext is created or resumed before a trusted gesture', async () => {
  const { controller, contexts } = makeController();
  controller.applySettings({ muted: false, volume: 1, music: true });
  await controller.setShellAudioPolicy('race');
  const before = controller.handleRuntimeEvents([AUDIO_EVENT.BUMP]);
  assert.equal(contexts.length, 0);
  assert.equal(before.played, 0);
  assert.equal(before.snapshot.suppressedEventCount, 1);

  await controller.activateFromGesture({ isTrusted: false });
  assert.equal(contexts.length, 0);
  assert.equal(controller.snapshot().activated, false);

  await controller.activateFromGesture({ isTrusted: true });
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].resumeCount, 1);
  assert.equal(contexts[0].startedOscillators, 12);
  assert.equal(controller.snapshot().activated, true);
});

test('VAL-AUDIO-001 pause and visibility suspend, resume, and dispose the central graph', async () => {
  const { controller, contexts, timers } = makeController();
  await controller.activateFromGesture({ isTrusted: true });
  await controller.setShellAudioPolicy('race');
  assert.equal(contexts[0].state, 'running');
  assert.equal(timers.active.size, 1);

  await controller.setShellAudioPolicy('ducked');
  assert.equal(contexts[0].state, 'suspended');
  assert.equal(contexts[0].suspendCount, 1);
  assert.equal(timers.active.size, 0);

  await controller.setShellAudioPolicy('race');
  assert.equal(contexts[0].state, 'running');
  assert.equal(contexts[0].resumeCount, 2);
  assert.equal(timers.active.size, 1);

  await controller.setVisibilityHidden(true);
  assert.equal(contexts[0].state, 'suspended');
  assert.equal(contexts[0].suspendCount, 2);
  assert.equal(timers.active.size, 0);

  await controller.setVisibilityHidden(false);
  assert.equal(contexts[0].state, 'running');
  controller.dispose();
  assert.equal(contexts[0].state, 'closed');
  assert.equal(contexts[0].stoppedOscillators, 12);
  assert.equal(timers.active.size, 0);
});

test('VAL-AUDIO-001 runtime mapper emits distinct bump, bounce, pad, refill, win, and failure events once per tick frame', () => {
  const level = makeEffectLevel();
  const mapper = new RuntimeAudioEventMapper({ level });
  const renderState = {
    ticksThisFrame: 5,
    current: makeFrame({ frameIndex: 4 }),
    tickFramesThisFrame: [
      makeFrame({ frameIndex: 0, events: [GAMEPLAY_EVENT.SHIP_BUMPED_WALL] }),
      makeFrame({ frameIndex: 1, events: [GAMEPLAY_EVENT.SHIP_BOUNCED] }),
      makeFrame({ frameIndex: 2, z: 4, row: 4 }),
      makeFrame({ frameIndex: 3, events: [GAMEPLAY_EVENT.SHIP_REFILLED] }),
      makeFrame({ frameIndex: 4, sessionState: SESSION_STATE.WON }),
    ],
  };
  assert.deepEqual(mapper.collect(renderState), [
    AUDIO_EVENT.BUMP,
    AUDIO_EVENT.BOUNCE,
    AUDIO_EVENT.PAD,
    AUDIO_EVENT.REFILL,
    AUDIO_EVENT.WIN,
  ]);
  assert.deepEqual(mapper.collect({ ...renderState, ticksThisFrame: 0, tickFramesThisFrame: [] }), []);
  mapper.reset(level);
  assert.deepEqual(
    mapper.collect({
      ticksThisFrame: 1,
      current: makeFrame({ frameIndex: 0, events: [GAMEPLAY_EVENT.SHIP_EXPLODED], sessionState: SESSION_STATE.FAILED }),
      tickFramesThisFrame: [
        makeFrame({ frameIndex: 0, events: [GAMEPLAY_EVENT.SHIP_EXPLODED], sessionState: SESSION_STATE.FAILED }),
      ],
    }),
    [AUDIO_EVENT.FAILURE]
  );

  assert.deepEqual(
    audioEventsForFrame(
      makeFrame({ frameIndex: 8, sessionState: SESSION_STATE.FAILED }),
      makeFrame({ frameIndex: 7, sessionState: SESSION_STATE.PLAYING }),
      level,
      {}
    ),
    [AUDIO_EVENT.FAILURE]
  );
});

test('VAL-AUDIO-001 controller handles runtime events with a fixed node budget', async () => {
  const { controller, contexts } = makeController();
  await controller.activateFromGesture({ isTrusted: true });
  await controller.setShellAudioPolicy('race');
  const context = contexts[0];
  const oscillatorCount = context.createdOscillators.length;
  const gainCount = context.createdGains.length;
  for (let index = 0; index < 100; index += 1) {
    controller.handleRuntimeEvents([
      AUDIO_EVENT.BUMP,
      AUDIO_EVENT.BOUNCE,
      AUDIO_EVENT.PAD,
      AUDIO_EVENT.REFILL,
      AUDIO_EVENT.WIN,
      AUDIO_EVENT.FAILURE,
    ]);
  }
  assert.equal(context.createdOscillators.length, oscillatorCount);
  assert.equal(context.createdGains.length, gainCount);
  assert.equal(controller.snapshot().handledEventCount, 600);
  assert.equal(controller.snapshot().nodeBudget.sfxVoices, 8);
});

test('VAL-AUDIO-001 FixedStepRuntime exposes immutable event batches without mutating simulation state', () => {
  const runtime = new FixedStepRuntime(new EventSession([
    { frameIndex: 0, events: [GAMEPLAY_EVENT.SHIP_BUMPED_WALL] },
    { frameIndex: 1, events: [GAMEPLAY_EVENT.SHIP_BOUNCED] },
  ]), { maxCatchUpTicks: 4 });
  runtime.advance(0);
  const state = runtime.advance(FIXED_STEP_MS * 2);
  assert.equal(state.ticksThisFrame, 2);
  assert.deepEqual(state.eventsThisFrame, [GAMEPLAY_EVENT.SHIP_BUMPED_WALL, GAMEPLAY_EVENT.SHIP_BOUNCED]);
  state.tickFramesThisFrame[0].events.push('mutated');
  const next = runtime.advance(FIXED_STEP_MS * 3);
  assert.equal(next.eventsThisFrame.includes('mutated'), false);
});

test('VAL-AUDIO-001 mute, volume, and music settings persist through reload and apply without creating audio', async () => {
  const storage = new MemoryStorage();
  const manager = createSaveManager({ storage });
  const loaded = manager.load();
  manager.write({
    ...loaded.save,
    audio: { muted: true, volume: 0.25, music: false, retroMuzax: true },
  });
  const reloaded = createSaveManager({ storage }).load();
  assert.deepEqual(reloaded.save.audio, { muted: true, volume: 0.25, music: false, retroMuzax: false });
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).audio.retroMuzax, false);

  const { controller, contexts } = makeController();
  controller.applySettings(reloaded.save.audio);
  await controller.setShellAudioPolicy('race');
  assert.equal(contexts.length, 0);
  assert.equal(controller.snapshot().settings.muted, true);
  assert.equal(controller.snapshot().settings.music, false);
});

test('VAL-AUDIO-001 retro/MUZAX capability is unavailable, attributed, and off by default', () => {
  const defaults = createDefaultSave();
  assert.equal(defaults.audio.retroMuzax, false);
  const normalized = validateSaveObject({ v: 1, audio: { retroMuzax: true } }).save;
  assert.equal(normalized.audio.retroMuzax, false);
  const capability = createRetroMuzaxCapability();
  assert.equal(capability.available, false);
  assert.equal(capability.enabledByDefault, false);
  assert.match(capability.attribution, /BYO|user-provided/);
  assert.match(capability.attribution, /ships no source music/);
});

let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

console.log(JSON.stringify({ tests: passed, target: 'VAL-AUDIO-001' }, null, 2));
