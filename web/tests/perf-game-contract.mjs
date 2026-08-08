import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { getCourseEntry } from '../src/content-manifest.js';
import { createDefaultSave } from '../src/save.js';
import { createRaceTuningConfig } from '../src/garage.js';
import { createMinimapPresenter } from '../src/minimap.js';
import {
  BENCHMARK_FIXTURE_ID,
  LEAK_RETRIES_PER_LOAD,
  benchmarkDescriptor,
  controlsAtTraceTick,
  leakLoadSequence,
  validateBenchmarkTrace,
} from '../src/performance-contract.js';
import { RaceSessionModel } from '../src/race-session.js';
import {
  DEFAULT_MAX_CATCH_UP_TICKS,
  FIXED_STEP_MS,
  FIXED_TICK_HZ,
  FixedStepRuntime,
} from '../src/runtime.js';
import { createStarterCourse } from '../src/starter-cup.js';
import { RaceSessionLifecycle } from '../src/session-lifecycle.js';
import { SESSION_STATE } from '../src/sim.js';
import { summarizeRendererInfo } from '../src/telemetry.js';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function loadTrace() {
  return JSON.parse(await readFile(new URL('./fixtures/perf-ion-gauntlet.trace.json', import.meta.url), 'utf8'));
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
      sessionState: SESSION_STATE.PLAYING,
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

class FakeStyle {
  constructor() {
    this.values = {};
  }

  setProperty(name, value) {
    this.values[name] = value;
  }
}

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.className = '';
    this.style = new FakeStyle();
    this.dataset = {};
    this.children = [];
    this.ownerDocument = null;
    this.attributes = {};
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  append(child) {
    this.children.push(child);
  }

  replaceChildren() {
    this.children = [];
  }

  querySelector(selector) {
    if (selector === '.mini-player') return this.children.find((child) => child.className === 'mini-player') ?? null;
    return null;
  }
}

function fakeContainer() {
  const container = new FakeNode('div');
  container.ownerDocument = {
    createElement(tag) {
      const node = new FakeNode(tag);
      node.ownerDocument = container.ownerDocument;
      return node;
    },
  };
  return container;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('VAL-PERF-GAME-001 fixed 1000 ms stall probe processes five ticks and drops 65', () => {
  const runtime = new FixedStepRuntime(new FakeSession());
  runtime.advance(0);
  const state = runtime.advance(1000, { turn: 0, accel: 1, jump: false });
  assert.equal(FIXED_TICK_HZ, 70);
  assert.equal(DEFAULT_MAX_CATCH_UP_TICKS, 5);
  assert.equal(state.ticksThisFrame, 5);
  assert.equal(state.droppedThisFrame, 65);
  assert.equal(state.counters.simTickCount, 5);
  assert.equal(state.counters.droppedCatchUpCount, 65);
  assert.equal(state.counters.maxCatchUpTicks, 5);
  assert.equal(runtime.advance(1000 + FIXED_STEP_MS).ticksThisFrame, 1);
});

test('VAL-PERF-GAME-001 benchmark fixture id, content hash, controls hash, and replay are exact', async () => {
  const trace = await loadTrace();
  assert.equal(validateBenchmarkTrace(trace), true);
  assert.equal(trace.fixtureId, BENCHMARK_FIXTURE_ID);
  assert.equal(trace.courseId, 'starter-ion-gauntlet');

  const level = createStarterCourse(trace.courseId);
  const entry = getCourseEntry(trace.courseId);
  assert.equal(sha256(canonicalJson(level)), entry.contentHash);
  const tracePayload = {
    schema: trace.schema,
    fixtureId: trace.fixtureId,
    courseId: trace.courseId,
    tickHz: trace.tickHz,
    maxTicks: trace.maxTicks,
    segments: trace.segments,
  };
  assert.equal(sha256(canonicalJson(tracePayload)), trace.controlsHash);

  const session = new RaceSessionModel(level, {
    courseId: trace.courseId,
    sourceKind: 'starter',
    tuningConfig: createRaceTuningConfig(createDefaultSave()),
  });
  let frame = session.snapshot();
  for (let tick = 0; tick < trace.maxTicks; tick++) {
    frame = session.tick(controlsAtTraceTick(trace, tick));
    if (frame.sessionState !== SESSION_STATE.PLAYING) break;
  }
  assert.equal(frame.sessionState, SESSION_STATE.WON);
  assert.equal(frame.didWin, true);
  assert.equal(session.terminalRunRecord().courseId, trace.courseId);
});

test('VAL-PERF-GAME-001 named 20-load leak sequence alternates training and Ion Gauntlet with one retry', () => {
  const sequence = leakLoadSequence(10);
  const descriptor = benchmarkDescriptor();
  assert.equal(sequence.length, 20);
  assert.deepEqual(sequence, descriptor.leakSequence);
  assert.equal(LEAK_RETRIES_PER_LOAD, 1);

  const lifecycle = new RaceSessionLifecycle();
  let activeResources = 0;
  let peakResources = 0;
  for (const [index, courseId] of sequence.entries()) {
    const scope = lifecycle.begin(`load-${index}-${courseId}`);
    for (const label of ['level-scene', 'backdrop', 'craft', 'audio-mapper', 'minimap']) {
      activeResources += 1;
      peakResources = Math.max(peakResources, activeResources);
      scope.add(label, () => {
        activeResources -= 1;
      });
    }
    const runtime = new FixedStepRuntime(new FakeSession());
    runtime.restart(index);
    assert.equal(runtime.counters().restartCount, 1, courseId);
  }
  assert.equal(activeResources, 5);
  assert.equal(peakResources, 5);
  assert.equal(lifecycle.snapshot().disposed.length, 19);
  lifecycle.disposeCurrent();
  assert.equal(activeResources, 0);
});

test('VAL-PERF-GAME-001 minimap presenter keeps static DOM cells stable across frames', () => {
  const level = createStarterCourse('starter-ion-gauntlet');
  const container = fakeContainer();
  const presenter = createMinimapPresenter(level, container);
  const first = presenter.update({ x: level.start.x, z: level.start.z, row: 3 });
  const childCount = container.children.length;
  const signature = container.dataset.minimapSignature;
  const second = presenter.update({ x: level.start.x, z: 60, row: 60 });
  assert.equal(container.children.length, childCount);
  assert.equal(container.dataset.minimapSignature, signature);
  assert.equal(first.cells, second.cells);
  assert.equal(presenter.snapshot().signature, signature);
});

test('VAL-PERF-GAME-001 renderer/audio/input readback schemas are bounded and browser-ready', async () => {
  assert.deepEqual(summarizeRendererInfo({
    render: { calls: 11, triangles: 222, points: 3, lines: 4 },
    memory: { geometries: 5, textures: 6 },
    programs: [{}, {}, {}],
  }), {
    drawCalls: 11,
    triangles: 222,
    points: 3,
    lines: 4,
    geometries: 5,
    textures: 6,
    programs: 3,
  });

  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const phrase of [
    'benchmarkSearchParams',
    'loadBenchmarkTraceForSearch',
    'controlsAtTraceTick',
    'performanceReadback',
    '__NEONDRIFT_PERF__',
    'summarizeRendererInfo(context.renderer.info)',
    'context.input.listenerSnapshot()',
    'context.audio?.snapshot?.()',
  ]) {
    assert.ok(mainSource.includes(phrase), `missing ${phrase}`);
  }
});

let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

console.log(JSON.stringify({ tests: passed, target: 'VAL-PERF-GAME-001' }, null, 2));
