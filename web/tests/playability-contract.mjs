import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { InputController } from '../src/input.js';
import { selectRequestedLevel } from '../src/loader.js';
import { validateLevel, expectedCounts } from '../src/level-contract.mjs';
import { AlphaSimSession, SESSION_STATE, SHIP_STATE } from '../src/sim.js';
import { createTutorialLevel, TUTORIAL_LEVEL_ID } from '../src/tutorial-level.js';
import { computeHudView } from '../src/hud.js';
import {
  cameraProfileForAspect,
  createCraftPresentation,
} from '../src/view.js';

const assetsRoot = new URL('../assets/levels/', import.meta.url).pathname;

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function makeKey(code, key = code, repeat = false) {
  return {
    code,
    key,
    repeat,
    preventDefault() {},
    stopPropagation() {},
  };
}

function runPolicy(level, policy, maxTicks) {
  const session = new AlphaSimSession(level);
  let frame = session.snapshot();
  for (let tick = 0; tick < maxTicks; tick++) {
    frame = session.tick(policy(tick, frame));
    if (frame.sessionState !== SESSION_STATE.PLAYING) {
      return { tick: tick + 1, frame, session };
    }
  }
  return { tick: maxTicks, frame, session };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const tutorial = validateLevel(createTutorialLevel(), { sourceCorpus: false });

test('VAL-ENTRY-001 tutorial is tracked original content, not exported source road or palette', async () => {
  assert.equal(tutorial.roadIndex, TUTORIAL_LEVEL_ID);
  assert.equal(tutorial.source, 'tracked-original-neondrift-tutorial');
  assert.equal(tutorial.columns, 7);
  assert.equal(tutorial.coaching.hazard.row, 44);
  assert.ok(expectedCounts(tutorial).flat > 0);
  assert.ok(expectedCounts(tutorial).short > 0);
  assert.ok(expectedCounts(tutorial).tall > 0);
  assert.ok(expectedCounts(tutorial).tunnel > 0);

  const tutorialCells = hashJson(tutorial.cells);
  const tutorialPalette = hashJson(tutorial.palette);
  const files = (await readdir(assetsRoot)).filter((name) => /^level_\d+\.json$/.test(name)).sort();
  assert.equal(files.length, 31);
  for (const file of files) {
    const exported = JSON.parse(await readFile(join(assetsRoot, file), 'utf8'));
    assert.notEqual(hashJson(exported.cells), tutorialCells, `${file} copied tutorial cells`);
    assert.notEqual(hashJson(exported.palette), tutorialPalette, `${file} copied tutorial palette`);
  }
});

test('VAL-ENTRY-001 root routes to Starter Cup training and ?level=0..30 stays exact source corpus', async () => {
  const index = JSON.parse(await readFile(join(assetsRoot, 'index.json'), 'utf8'));
  assert.equal(selectRequestedLevel(index, '').type, 'starter');
  assert.equal(selectRequestedLevel(index, '?debug=1').type, 'starter');
  assert.equal(selectRequestedLevel(index, '').entry.id, TUTORIAL_LEVEL_ID);
  const first = selectRequestedLevel(index, '?level=0');
  const last = selectRequestedLevel(index, '?level=30');
  assert.equal(first.type, 'source');
  assert.equal(first.entry.file, 'level_00.json');
  assert.equal(last.type, 'source');
  assert.equal(last.entry.file, 'level_30.json');
  assert.equal(selectRequestedLevel(index, '?level=31').type, 'starter');
});

test('VAL-ENTRY-001 four fixed 210-tick launch probes stay non-terminal', () => {
  const policies = {
    accelerateOnly: (tick) => ({ turn: 0, accel: 1, jump: false }),
    leftTap: (tick) => ({ turn: tick >= 40 && tick < 54 ? -1 : 0, accel: 1, jump: false }),
    rightTap: (tick) => ({ turn: tick >= 40 && tick < 54 ? 1 : 0, accel: 1, jump: false }),
    alternatingTap: (tick) => ({
      turn: tick >= 40 && tick < 54 ? -1 : tick >= 54 && tick < 68 ? 1 : 0,
      accel: 1,
      jump: false,
    }),
  };
  for (const [name, policy] of Object.entries(policies)) {
    const result = runPolicy(tutorial, policy, 210);
    assert.equal(result.frame.sessionState, SESSION_STATE.PLAYING, name);
    assert.equal(result.frame.state, SHIP_STATE.ALIVE, name);
    assert.equal(result.frame.row, 25, name);
  }
});

test('VAL-ENTRY-001 hazard, finish, failure, and restart probes are deterministic', () => {
  const early = runPolicy(tutorial, (tick) => ({ turn: 0, accel: 1, jump: tick >= 250 && tick < 270 }), 700);
  assert.equal(early.frame.sessionState, SESSION_STATE.FAILED);
  assert.equal(early.frame.row, 44);
  assert.equal(early.frame.state, SHIP_STATE.EXPLODED);

  const missed = runPolicy(tutorial, () => ({ turn: 0, accel: 1, jump: false }), 700);
  assert.equal(missed.tick, 320);
  assert.equal(missed.frame.row, 44);
  assert.equal(missed.frame.state, SHIP_STATE.EXPLODED);

  const success = runPolicy(tutorial, (tick) => ({ turn: 0, accel: 1, jump: tick >= 300 && tick < 320 }), 900);
  assert.equal(success.tick, 604);
  assert.equal(success.frame.sessionState, SESSION_STATE.WON);
  assert.equal(success.frame.didWin, true);
  assert.equal(success.frame.row, 91);

  const restarted = missed.session.restart();
  assert.equal(restarted.sessionState, SESSION_STATE.PLAYING);
  assert.equal(restarted.state, SHIP_STATE.ALIVE);
  assert.equal(restarted.row, 3);
  assert.equal(restarted.z, 3);
});

test('VAL-FEEDBACK-001 HUD coaching is contextual and debug counters are opt-in', () => {
  const before = computeHudView({
    level: tutorial,
    frame: { row: 20, z: 20, zVel: 0.08, fuelPct: 0.8, oxygenPct: 0.9, sessionState: SESSION_STATE.PLAYING },
    runtimeCounters: { simTickCount: 20, droppedCatchUpCount: 0 },
    telemetry: { collectedFrames: 12, sampleFrames: 600, report: null },
  });
  assert.equal(before.lines.join('\n').includes('u/tick'), false);
  assert.equal(before.lines.join('\n').includes('Ticks'), false);
  assert.equal(before.lines.join('\n').includes('profiling'), false);

  const hazard = computeHudView({
    level: tutorial,
    frame: { row: 30, z: 30, zVel: 0.1, fuelPct: 0.75, oxygenPct: 0.85, sessionState: SESSION_STATE.PLAYING },
    runtimeCounters: { simTickCount: 240, droppedCatchUpCount: 0 },
    telemetry: { collectedFrames: 22, sampleFrames: 600, report: null },
  });
  assert.equal(hazard.cue, 'Jump the red hazard at row 44');
  assert.ok(tutorial.coaching.hazard.row - 30 > tutorial.coaching.hazard.protectedRows);
  assert.equal(hazard.lines.join('\n').includes('Jump the red hazard'), true);

  const debug = computeHudView({
    level: tutorial,
    frame: { row: 30, z: 30, zVel: 0.1, fuelPct: 0.75, oxygenPct: 0.85, sessionState: SESSION_STATE.PLAYING },
    runtimeCounters: { simTickCount: 240, droppedCatchUpCount: 2 },
    telemetry: { collectedFrames: 22, sampleFrames: 600, report: null },
    debug: true,
  });
  assert.equal(debug.lines.join('\n').includes('Debug ticks 240'), true);
  assert.equal(debug.lines.join('\n').includes('drops 2'), true);
});

test('VAL-FEEDBACK-001 Enter and visible restart use one queued restart action', () => {
  const input = new InputController();
  input.handleKeyDown(makeKey('Enter'));
  assert.equal(input.consumeRestartRequested(), true);
  assert.equal(input.consumeRestartRequested(), false);
});

test('VAL-READABILITY-001 camera profile, finish orientation, and terminal fall are view-only', async () => {
  const wide = cameraProfileForAspect(1474 / 695);
  const tall = cameraProfileForAspect(390 / 844);
  assert.ok(wide.fov <= 100);
  assert.ok(wide.fov < 62);
  assert.ok(wide.distance < tall.distance);

  const current = {
    ...runPolicy(tutorial, () => ({ turn: 0, accel: 1, jump: false }), 210).frame,
    state: SHIP_STATE.FALLEN,
    sessionState: SESSION_STATE.FAILED,
  };
  const previous = { ...current, y: 80, z: current.z - 0.1 };
  const presentation = createCraftPresentation(previous, current, 0, tutorial, { terminalElapsedMs: 750 });
  assert.equal(presentation.simPosition.y >= presentation.position.y, true);
  assert.ok(presentation.position.y < presentation.simPosition.y);
  assert.ok(presentation.terminalFade < 1 && presentation.terminalFade >= 0.5);
  assert.equal(current.y, 80);

  const sceneSource = await readFile(new URL('../src/scene.js', import.meta.url), 'utf8');
  assert.ok(sceneSource.includes('finish-ring-vertical'));
  assert.equal(/finish\\.rotation\\.x\\s*=/.test(sceneSource), false);
  assert.ok(sceneSource.includes('tutorial-hazard-rim'));
  assert.ok(sceneSource.includes('tutorial-effect-shape-cues'));
  assert.ok(sceneSource.includes('emissiveIntensity'));
});

test('VAL-FEEDBACK-001 UI source keeps controls and terminal out of the center focal lane', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('#controls{ position:fixed; right:18px; bottom:16px;'));
  assert.equal(html.includes('left:50%; bottom:14px; transform:translateX(-50%)'), false);
  assert.ok(html.includes('#terminal{ position:fixed; top:88px; right:18px;'));
  assert.ok(html.includes('data-action="restart"'));
});

test('VAL-READABILITY-001 normalized luminance-mask procedure is checked in', async () => {
  const procedure = await readFile(new URL('../../docs/neondrift-luminance-mask-procedure.md', import.meta.url), 'utf8');
  for (const phrase of [
    '1474x695',
    'road-top-near',
    'road-top-mid',
    'adjacent-void',
    'craft',
    'hazard',
    'ui',
    '(road + 0.001) / (void + 0.001)',
  ]) {
    assert.ok(procedure.includes(phrase), `missing ${phrase}`);
  }
});

for (const { name, fn } of tests) {
  await fn();
  console.log(`ok - ${name}`);
}

console.log(JSON.stringify({ tests: tests.length }, null, 2));
