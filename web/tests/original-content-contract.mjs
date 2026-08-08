import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { validateLevel, expectedCounts } from '../src/level-contract.mjs';
import { selectRequestedLevel, loadRequestedLevel } from '../src/loader.js';
import { createCoursePreview, COURSE_CLASS } from '../src/preview.js';
import {
  STARTER_COURSE_IDS,
  STARTER_CUP_MANIFEST,
  createStarterCupCourses,
  createStarterCupProgression,
} from '../src/starter-cup.js';
import { AlphaSimSession, SESSION_STATE, SHIP_STATE } from '../src/sim.js';

const assetsRoot = new URL('../assets/levels/', import.meta.url).pathname;

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function compactCell(cell) {
  if (!cell.tile && cell.cube == null && !cell.tunnel) return '.';
  if (cell.tileEffect === 'kill' || cell.cubeEffect === 'kill') return 'K';
  if (cell.tunnel) return 'T';
  if (cell.cube === 120) return 'H';
  if (cell.cube === 100) return 'C';
  if (cell.tileEffect !== 'none' || cell.cubeEffect !== 'none') return 'E';
  return 'R';
}

function layoutDistance(a, b) {
  const rows = Math.max(a.length, b.length);
  const columns = 7;
  let differing = 0;
  let total = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const left = a.cells[row]?.[column] ? compactCell(a.cells[row][column]) : '.';
      const right = b.cells[row]?.[column] ? compactCell(b.cells[row][column]) : '.';
      if (left !== right) differing += 1;
      total += 1;
    }
  }
  return differing / total;
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
  const session = new AlphaSimSession(level);
  let frame = session.snapshot();
  for (let tick = 0; tick < trace.maxTicks; tick++) {
    frame = session.tick(controlsAt(trace, tick));
    if (frame.sessionState !== SESSION_STATE.PLAYING) {
      return { tick: tick + 1, frame, session };
    }
  }
  return { tick: trace.maxTicks, frame, session };
}

function hasFinishTunnel(level) {
  return level.cells.some((row) => row.some((cell) => cell.tile && cell.tunnel));
}

function hasNonColorHazardCue(level) {
  return (
    (level.visualHints?.hazardRims?.length ?? 0) > 0 ||
    (level.visualHints?.guideRails?.length ?? 0) > 0 ||
    (level.visualHints?.effectCueRows?.length ?? 0) > 0
  );
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const courses = createStarterCupCourses().map((level) => validateLevel(level, { sourceCorpus: false }));

test('VAL-ORIGINAL-CONTENT-001 manifest has exactly three stable tracked Starter Cup entries', () => {
  assert.equal(STARTER_CUP_MANIFEST.version, 1);
  assert.equal(STARTER_CUP_MANIFEST.id, 'starter-cup');
  assert.equal(STARTER_CUP_MANIFEST.courses.length, 3);
  assert.deepEqual(STARTER_CUP_MANIFEST.courses.map((entry) => entry.id), [
    STARTER_COURSE_IDS.TRAINING,
    STARTER_COURSE_IDS.HANDLING,
    STARTER_COURSE_IDS.JUMP_EFFECT,
  ]);
  assert.deepEqual(STARTER_CUP_MANIFEST.courses.map((entry) => entry.role), [
    'training',
    'handling',
    'jump-effect',
  ]);
  assert.equal(new Set(STARTER_CUP_MANIFEST.courses.map((entry) => entry.name)).size, 3);
  assert.equal(new Set(courses.map((level) => level.roadIndex)).size, 3);
  assert.equal(new Set(courses.map((level) => hashJson(level.palette))).size, 3);
});

test('VAL-ORIGINAL-CONTENT-001 every tracked course validates, has metadata, finish, hazards, and preview classes', () => {
  for (const [index, level] of courses.entries()) {
    const manifest = STARTER_CUP_MANIFEST.courses[index];
    assert.equal(level.cup.id, STARTER_CUP_MANIFEST.id, level.name);
    assert.equal(level.cup.courseId, manifest.id, level.name);
    assert.equal(level.cup.parTicks, manifest.parTicks, level.name);
    assert.equal(level.length > 80, true, level.name);
    assert.equal(hasFinishTunnel(level), true, level.name);
    assert.equal(hasNonColorHazardCue(level), true, level.name);
    const counts = expectedCounts(level);
    assert.ok(counts.flat > 0, level.name);
    assert.ok(counts.tunnel > 0, level.name);
    assert.ok(counts.short + counts.tall > 0, level.name);

    const preview = createCoursePreview(level);
    assert.equal(preview.levelId, level.roadIndex, level.name);
    assert.ok(preview.classes[COURSE_CLASS.ROAD] > 0, level.name);
    assert.ok(preview.classes[COURSE_CLASS.OBSTACLE] > 0, level.name);
    assert.ok(preview.classes[COURSE_CLASS.EFFECT_PAD] > 0, level.name);
    assert.ok(preview.classes[COURSE_CLASS.FINISH] > 0, level.name);
    assert.ok(preview.minRoadLuminance >= 0.15, level.name);
  }
});

test('VAL-ORIGINAL-CONTENT-001 tracked course layouts are distinct from each other', () => {
  for (let left = 0; left < courses.length; left++) {
    for (let right = left + 1; right < courses.length; right++) {
      assert.ok(
        layoutDistance(courses[left], courses[right]) > 0.18,
        `${courses[left].roadIndex} too close to ${courses[right].roadIndex}`
      );
      assert.notEqual(hashJson(courses[left].cells), hashJson(courses[right].cells));
    }
  }
});

test('VAL-ORIGINAL-CONTENT-001 tracked courses are not copied exported source layouts or palettes', async () => {
  const files = (await readdir(assetsRoot)).filter((name) => /^level_\d+\.json$/.test(name)).sort();
  assert.equal(files.length, 31);
  const exported = await Promise.all(files.map(async (file) => ({
    file,
    level: JSON.parse(await readFile(join(assetsRoot, file), 'utf8')),
  })));

  for (const course of courses) {
    const courseCells = hashJson(course.cells);
    const coursePalette = hashJson(course.palette);
    for (const source of exported) {
      assert.notEqual(courseCells, hashJson(source.level.cells), `${course.name} copied ${source.file} cells`);
      assert.notEqual(coursePalette, hashJson(source.level.palette), `${course.name} copied ${source.file} palette`);
      assert.ok(
        layoutDistance(course, source.level) > 0.25,
        `${course.name} layout too close to ${source.file}`
      );
    }
  }
});

test('VAL-ORIGINAL-CONTENT-001 each course has safe launch, deterministic win, failure, and restart', () => {
  for (const level of courses) {
    const launch = runTrace(level, {
      maxTicks: 160,
      segments: [{ until: 160, turn: 0, accel: 1, jump: false }],
    });
    assert.equal(launch.frame.sessionState, SESSION_STATE.PLAYING, `${level.name} unsafe launch`);
    assert.equal(launch.frame.state, SHIP_STATE.ALIVE, `${level.name} unsafe launch`);

    const won = runTrace(level, level.traces.win);
    assert.equal(won.frame.sessionState, SESSION_STATE.WON, `${level.name} win trace`);
    assert.equal(won.frame.didWin, true, `${level.name} win trace`);
    assert.ok(won.tick <= level.cup.parTicks + 160, `${level.name} trace outside proof budget`);

    const failed = runTrace(level, level.traces.failure);
    assert.equal(failed.frame.sessionState, SESSION_STATE.FAILED, `${level.name} failure trace`);
    assert.notEqual(failed.frame.state, SHIP_STATE.ALIVE, `${level.name} failure trace`);

    const restarted = failed.session.restart();
    assert.equal(restarted.sessionState, SESSION_STATE.PLAYING, `${level.name} restart`);
    assert.equal(restarted.state, SHIP_STATE.ALIVE, `${level.name} restart`);
    assert.equal(restarted.row, 3, `${level.name} restart`);
  }
});

test('VAL-ORIGINAL-CONTENT-001 map selection is tracked-first and BYO source remains additive', async () => {
  const previousFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('tracked course load should not fetch assets');
  };
  try {
    assert.equal((await loadRequestedLevel('')).courseId, STARTER_COURSE_IDS.TRAINING);
    assert.equal((await loadRequestedLevel('?course=starter-handling')).courseId, STARTER_COURSE_IDS.HANDLING);
    assert.equal((await loadRequestedLevel('?course=starter-jump-effect')).courseId, STARTER_COURSE_IDS.JUMP_EFFECT);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }

  const index = JSON.parse(await readFile(join(assetsRoot, 'index.json'), 'utf8'));
  assert.equal(selectRequestedLevel(index, '?level=0').type, 'source');
  assert.equal(selectRequestedLevel(index, '?level=30').type, 'source');
  assert.equal(selectRequestedLevel(index, '?level=31').type, 'starter');
});

test('VAL-ORIGINAL-CONTENT-001 Starter Cup completion state requires all three tracked wins', () => {
  const fresh = createStarterCupProgression();
  assert.equal(fresh.complete, false);
  assert.deepEqual(fresh.courses.map((course) => course.unlocked), [true, false, false]);

  const one = createStarterCupProgression([STARTER_COURSE_IDS.TRAINING]);
  assert.equal(one.complete, false);
  assert.deepEqual(one.courses.map((course) => course.unlocked), [true, true, false]);

  const two = createStarterCupProgression([STARTER_COURSE_IDS.TRAINING, STARTER_COURSE_IDS.HANDLING]);
  assert.equal(two.complete, false);
  assert.deepEqual(two.courses.map((course) => course.unlocked), [true, true, true]);

  const complete = createStarterCupProgression(Object.values(STARTER_COURSE_IDS));
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.completedCourseIds, Object.values(STARTER_COURSE_IDS));
});

let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

console.log(JSON.stringify({
  tests: passed,
  target: 'VAL-ORIGINAL-CONTENT-001',
  courses: courses.map((level) => level.roadIndex),
}, null, 2));
