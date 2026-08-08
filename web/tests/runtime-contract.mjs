import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { computeHudView, HudPresenter } from '../src/hud.js';
import { InputController, INPUT_ACTION } from '../src/input.js';
import { validateLevel, expectedCounts } from '../src/level-contract.mjs';
import {
  DEFAULT_MAX_CATCH_UP_TICKS,
  FIXED_STEP_MS,
  FIXED_TICK_HZ,
  FixedStepRuntime,
} from '../src/runtime.js';
import { SESSION_STATE, SHIP_STATE } from '../src/sim.js';
import { countDrawBatches, summarizeRenderStructure } from '../src/structure.js';
import { TelemetrySampler, summarizeRendererInfo } from '../src/telemetry.js';
import {
  cameraProfileForAspect,
  computeChaseCamera,
  createCraftPresentation,
  gameToWorldPosition,
  interpolateFrames,
} from '../src/view.js';

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function makeFrame(overrides = {}) {
  return {
    frameIndex: overrides.frameIndex ?? 0,
    controls: overrides.controls ?? { turn: 0, accel: 0, jump: false },
    x: overrides.x ?? 256,
    y: overrides.y ?? 80,
    z: overrides.z ?? 3,
    zVel: overrides.zVel ?? 0,
    state: overrides.state ?? SHIP_STATE.ALIVE,
    craftState: overrides.craftState ?? overrides.state ?? SHIP_STATE.ALIVE,
    oxygenPct: overrides.oxygenPct ?? 1,
    o2Pct: overrides.o2Pct ?? overrides.oxygenPct ?? 1,
    fuelPct: overrides.fuelPct ?? 1,
    events: overrides.events ?? [],
    didWin: overrides.didWin ?? false,
    row: overrides.row ?? 3,
    sessionState: overrides.sessionState ?? SESSION_STATE.PLAYING,
    frozen: overrides.frozen ?? false,
  };
}

function makeLevel(overrides = {}) {
  return {
    name: 'fixture',
    roadIndex: 0,
    length: overrides.length ?? 160,
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
  };
}

class FakeSession {
  constructor() {
    this.tickInputs = [];
    this.frame = makeFrame();
  }

  tick(controls) {
    this.tickInputs.push({ ...controls });
    this.frame = makeFrame({
      frameIndex: this.tickInputs.length,
      controls,
      z: 3 + this.tickInputs.length,
      zVel: 0.1,
    });
    return this.frame;
  }

  snapshot() {
    return this.frame;
  }

  restart() {
    this.tickInputs = [];
    this.frame = makeFrame();
    return this.frame;
  }
}

class FakeEmitter {
  constructor() {
    this.listeners = new Map();
    this.hidden = false;
  }

  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== fn));
  }

  emit(type, event = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
}

class FakeButton extends FakeEmitter {
  constructor(action) {
    super();
    this.dataset = { action };
    this.attrs = {};
  }

  setAttribute(name, value) {
    this.attrs[name] = value;
  }

  hasPointerCapture() {
    return false;
  }
}

class FakeRoot {
  constructor(buttons) {
    this.buttons = buttons;
  }

  querySelectorAll() {
    return this.buttons;
  }
}

function fakeKey(code, key = code, repeat = false) {
  return {
    code,
    key,
    repeat,
    prevented: 0,
    stopped: 0,
    preventDefault() {
      this.prevented += 1;
    },
    stopPropagation() {
      this.stopped += 1;
    },
  };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('VAL-INPUT-001 keyboard mappings are bounded, repeat-safe, and prevent page scroll', () => {
  const input = new InputController();
  const left = fakeKey('ArrowLeft');
  assert.equal(input.handleKeyDown(left), true);
  assert.equal(left.prevented, 1);
  assert.deepEqual(input.snapshot(), { turn: -1, accel: 0, jump: false });

  input.handleKeyDown(fakeKey('KeyD', 'd'));
  assert.deepEqual(input.snapshot(), { turn: 0, accel: 0, jump: false });
  input.handleKeyUp(fakeKey('ArrowLeft'));
  assert.deepEqual(input.snapshot(), { turn: 1, accel: 0, jump: false });

  input.handleKeyDown(fakeKey('ArrowUp'));
  input.handleKeyDown(fakeKey('KeyS', 's'));
  input.handleKeyDown(fakeKey('Space', ' ', true));
  assert.deepEqual(input.snapshot(), { turn: 1, accel: 0, jump: false });

  const restart = fakeKey('KeyR', 'r');
  input.handleKeyDown(restart);
  input.handleKeyDown(fakeKey('KeyR', 'r', true));
  assert.equal(input.consumeRestartRequested(), true);
  assert.equal(input.consumeRestartRequested(), false);
  input.handleKeyUp(fakeKey('KeyR', 'r'));
  input.handleKeyDown(fakeKey('Enter'));
  assert.equal(input.consumeRestartRequested(), true);
});

test('VAL-INPUT-001 blur, visibility, pointer cancel, and on-screen controls clear held input', () => {
  const input = new InputController();
  const target = new FakeEmitter();
  const doc = new FakeEmitter();
  input.attachKeyboard(target, doc);
  target.emit('keydown', fakeKey('KeyW', 'w'));
  assert.equal(input.snapshot().accel, 1);
  target.emit('blur');
  assert.equal(input.snapshot().accel, 0);

  target.emit('keydown', fakeKey('KeyA', 'a'));
  doc.hidden = true;
  doc.emit('visibilitychange');
  assert.equal(input.snapshot().turn, 0);

  const left = new FakeButton(INPUT_ACTION.LEFT);
  const restart = new FakeButton(INPUT_ACTION.RESTART);
  input.attachControls(new FakeRoot([left, restart]));
  left.emit('pointerdown', fakeKey('Pointer', 'Pointer'));
  assert.equal(input.snapshot().turn, -1);
  left.emit('pointercancel', fakeKey('Pointer', 'Pointer'));
  assert.equal(input.snapshot().turn, 0);
  restart.emit('click', fakeKey('Pointer', 'Pointer'));
  assert.equal(input.consumeRestartRequested(), true);
});

test('VAL-RUNTIME-001 fixed-step runtime uses exact 70 Hz ticks and interpolation', () => {
  const session = new FakeSession();
  const runtime = new FixedStepRuntime(session);
  assert.equal(FIXED_TICK_HZ, 70);
  runtime.advance(0);
  let state = runtime.advance(FIXED_STEP_MS / 2, { turn: 1, accel: 1, jump: false });
  assert.equal(state.ticksThisFrame, 0);
  near(state.alpha, 0.5);
  state = runtime.advance(FIXED_STEP_MS, { turn: 1, accel: 1, jump: false });
  assert.equal(state.ticksThisFrame, 1);
  assert.equal(session.tickInputs.length, 1);
  assert.deepEqual(session.tickInputs[0], { turn: 1, accel: 1, jump: false });
  near(state.alpha, 0);
});

test('VAL-RUNTIME-001 long stalls are bounded and excess catch-up is dropped', () => {
  const runtime = new FixedStepRuntime(new FakeSession(), { maxCatchUpTicks: 3 });
  runtime.advance(100);
  const state = runtime.advance(1100, { turn: 0, accel: 1, jump: true });
  assert.equal(state.ticksThisFrame, 3);
  assert.equal(state.counters.simTickCount, 3);
  assert.ok(state.droppedThisFrame > 0);
  assert.ok(state.counters.droppedCatchUpCount > 0);
  near(state.alpha, 0);
  assert.equal(DEFAULT_MAX_CATCH_UP_TICKS, 5);
});

test('VAL-RUNTIME-001 restart reconstructs session state and resets runtime counters', () => {
  const session = new FakeSession();
  const runtime = new FixedStepRuntime(session);
  runtime.advance(0);
  runtime.advance(FIXED_STEP_MS * 2);
  assert.equal(runtime.counters().simTickCount, 2);
  const restarted = runtime.restart(500);
  assert.equal(restarted.current.frameIndex, 0);
  assert.equal(runtime.counters().simTickCount, 0);
  assert.equal(runtime.counters().frameCount, 0);
  assert.equal(runtime.counters().restartCount, 1);
  assert.equal(session.tickInputs.length, 0);
});

test('VAL-VIEW-001 transform, craft interpolation, bank, and chase camera are pure view math', () => {
  const level = makeLevel();
  const previous = makeFrame({ x: 256, y: 80, z: 3, zVel: 0.1 });
  const current = makeFrame({ x: 302, y: 126, z: 4, zVel: 0.2, controls: { turn: 1, accel: 1, jump: true } });
  const original = JSON.stringify(current);
  const world = gameToWorldPosition(current, level.constants);
  near(world.x, 4);
  near(world.y, 4.64);
  near(world.z, -16);
  const interpolated = interpolateFrames(previous, current, 0.5);
  near(interpolated.x, 279);
  near(interpolated.z, 3.5);
  const presentation = createCraftPresentation(previous, current, 0.5, level);
  assert.ok(presentation.bank > 0);
  assert.ok(presentation.rotation.z < 0);
  const camera = computeChaseCamera(presentation.position);
  assert.ok(camera.position.z > presentation.position.z);
  assert.ok(camera.lookAt.z < presentation.position.z);
  assert.ok(cameraProfileForAspect(1474 / 695).fov <= 100);
  assert.equal(JSON.stringify(current), original);
});

test('VAL-HUD-001 HUD maps alive, win, and every failure state to text states', () => {
  const level = makeLevel();
  const alive = computeHudView({
    level,
    frame: makeFrame({ zVel: 0.12, fuelPct: 0.5, oxygenPct: 0.75 }),
    runtimeCounters: { simTickCount: 7, droppedCatchUpCount: 0 },
    telemetry: { collectedFrames: 4, sampleFrames: 600, report: null },
  });
  assert.equal(alive.status, 'RUNNING');
  assert.ok(alive.lines.join('\n').includes('Fuel 50%'));
  assert.ok(alive.lines.join('\n').includes('WASD/Arrows'));
  assert.equal(alive.lines.join('\n').includes('u/tick'), false);
  assert.equal(alive.lines.join('\n').includes('Ticks'), false);

  const states = [
    [SESSION_STATE.WON, SHIP_STATE.ALIVE, 'VICTORY'],
    [SESSION_STATE.FAILED, SHIP_STATE.EXPLODED, 'IMPACT FAILURE'],
    [SESSION_STATE.FAILED, SHIP_STATE.FALLEN, 'VOID FALL'],
    [SESSION_STATE.FAILED, SHIP_STATE.OUT_OF_FUEL, 'FUEL EMPTY'],
    [SESSION_STATE.FAILED, SHIP_STATE.OUT_OF_OXYGEN, 'OXYGEN EMPTY'],
  ];
  for (const [sessionState, state, title] of states) {
    const view = computeHudView({
      level,
      frame: makeFrame({ sessionState, state }),
      runtimeCounters: {},
      telemetry: { collectedFrames: 0, sampleFrames: 600, report: null },
    });
    assert.equal(view.terminal.title, title);
  }
});

test('VAL-HUD-001 HUD presenter throttles DOM writes to at most 10 Hz', () => {
  const elements = {
    root: { textContent: '' },
    terminal: { hidden: true, dataset: {} },
    terminalTitle: { textContent: '' },
    terminalDetail: { textContent: '' },
  };
  const presenter = new HudPresenter(elements);
  const model = {
    level: makeLevel(),
    frame: makeFrame(),
    runtimeCounters: {},
    telemetry: { collectedFrames: 0, sampleFrames: 600, report: null },
  };
  assert.equal(presenter.update(model, 0), true);
  assert.equal(presenter.update(model, 50), false);
  assert.equal(presenter.update(model, 100), true);
  assert.equal(presenter.writeCount, 2);
});

test('VAL-HUD-001 results state suppresses the legacy HUD terminal dialog', () => {
  const elements = {
    root: { textContent: '' },
    terminal: { hidden: true, dataset: {} },
    terminalTitle: { textContent: '' },
    terminalDetail: { textContent: '' },
  };
  const presenter = new HudPresenter(elements);
  const terminalModel = {
    level: makeLevel(),
    frame: makeFrame({ sessionState: SESSION_STATE.FAILED, state: SHIP_STATE.EXPLODED }),
    runtimeCounters: {},
    telemetry: { collectedFrames: 0, sampleFrames: 600, report: null },
  };
  assert.equal(presenter.update(terminalModel, 0), true);
  assert.equal(elements.terminal.hidden, false);
  assert.equal(elements.terminalTitle.textContent, 'IMPACT FAILURE');

  assert.equal(presenter.update({ ...terminalModel, suppressTerminal: true, force: true }, 50), true);
  assert.equal(elements.terminal.hidden, true);
  assert.equal(elements.terminal.dataset.state, 'playing');
  assert.equal(elements.terminalTitle.textContent, '');
  assert.equal(elements.terminalDetail.textContent, '');
});

test('VAL-PERF-TELEMETRY-001 telemetry schema reports frame and runtime counters', () => {
  const sampler = new TelemetrySampler({ warmupFrames: 1, sampleFrames: 3, base: { loadMs: 2, buildMs: 3 } });
  const info = {
    render: { calls: 7, triangles: 99, points: 1, lines: 2 },
    memory: { geometries: 4, textures: 5 },
    programs: [{}, {}],
  };
  assert.equal(sampler.sample(100, info, { simTickCount: 1, droppedCatchUpCount: 0 }), null);
  assert.equal(sampler.sample(116, info, { simTickCount: 2, droppedCatchUpCount: 0 }), null);
  assert.equal(sampler.sample(132, info, { simTickCount: 3, droppedCatchUpCount: 1 }), null);
  const report = sampler.sample(148, info, { simTickCount: 4, droppedCatchUpCount: 2 });
  assert.equal(report.frames, 3);
  near(report.meanFps, 62.5);
  assert.equal(report.p95FrameMs, 16);
  assert.equal(report.worstFrameMs, 16);
  assert.equal(report.drawCalls, 7);
  assert.equal(report.triangles, 99);
  assert.equal(report.geometries, 4);
  assert.equal(report.textures, 5);
  assert.equal(report.programs, 2);
  assert.equal(report.loadMs, 2);
  assert.equal(report.buildMs, 3);
  assert.equal(report.simTicks, 4);
  assert.equal(report.droppedCatchUpCount, 2);
  assert.deepEqual(summarizeRendererInfo(info), {
    drawCalls: 7,
    triangles: 99,
    points: 1,
    lines: 2,
    geometries: 4,
    textures: 5,
    programs: 2,
  });
});

test('VAL-PERF-STRUCT-001 and VAL-TRACK-001 level 0 chunk batches and counts stay bounded', async () => {
  const level = validateLevel(JSON.parse(await readFile(new URL('../assets/levels/level_00.json', import.meta.url), 'utf8')));
  const counts = expectedCounts(level);
  const structure = summarizeRenderStructure(level);
  assert.equal(structure.drawables, countDrawBatches(level));
  assert.ok(structure.drawables <= 30, `drawables ${structure.drawables} > 30`);
  assert.deepEqual(structure.counts, {
    flat: counts.flat,
    short: counts.short,
    tall: counts.tall,
    tunnel: counts.tunnel,
  });
  assert.ok(counts.flat > 0);
  assert.ok(counts.short > 0);
  assert.ok(counts.tall > 0);
  assert.ok(counts.tunnel > 0);
});

test('VAL-PERF-STRUCT-001 no bloom/postprocessing imports and manual actor checklist exists', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.equal(/UnrealBloomPass|EffectComposer|RenderPass|ShaderPass/.test(main), false);
  assert.ok(main.includes("Object.defineProperty(window, '__NEONDRIFT__'"));
  assert.ok(main.includes('writable: false'));
  assert.ok(main.includes('Object.freeze'));
  const checklist = await readFile(new URL('../../docs/neondrift-alpha-manual-checklist.md', import.meta.url), 'utf8');
  for (const phrase of [
    'start',
    'accelerate',
    'steer left',
    'steer right',
    'jump',
    'terminal failure',
    'restart without reload',
    'finish tunnel',
    'window.__neondrift__',
    'blocked',
  ]) {
    assert.ok(checklist.toLowerCase().includes(phrase), `missing checklist phrase ${phrase}`);
  }
});

for (const { name, fn } of tests) {
  await fn();
  console.log(`ok - ${name}`);
}
console.log(JSON.stringify({ tests: tests.length }, null, 2));
