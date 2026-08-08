import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { SkyRoadsSim } from '../src/sim.js';

const repoRoot = resolve(new URL('../..', import.meta.url).pathname);
const frameCount = Number(process.argv[2] ?? 300);
const tolerance = 1e-4;

function parseEvents(raw) {
  return raw === '-' ? [] : raw.split(',');
}

function parseRustFrame(line) {
  const match = line.match(
    /^frame=(\d+)\s+turn=([+-]?\d+)\s+accel=([+-]?\d+)\s+jump=([01])\s+row=(\d+)\s+pos=\(([-0-9.]+),([-0-9.]+),([-0-9.]+)\)\s+zvel=([-0-9.]+)\s+oxygen=([-0-9.]+)\s+fuel=([-0-9.]+)\s+state=([A-Za-z]+)\s+events=([A-Za-z,.-]+)$/
  );
  if (!match) return null;
  return {
    frameIndex: Number(match[1]),
    controls: {
      turn: Number(match[2]),
      accel: Number(match[3]),
      jump: match[4] === '1',
    },
    row: Number(match[5]),
    x: Number(match[6]),
    y: Number(match[7]),
    z: Number(match[8]),
    zVel: Number(match[9]),
    oxygenPct: Number(match[10]),
    fuelPct: Number(match[11]),
    state: match[12],
    events: parseEvents(match[13]),
  };
}

function eventKey(events) {
  return events.join(',');
}

function bumpMismatch(counts, field, firstMismatch, detail) {
  counts[field] += 1;
  return firstMismatch ?? detail;
}

const rustOutput = execFileSync(
  'cargo',
  ['run', '-q', '-p', 'skyroads-cli', '--', 'demo-sim', '.', String(frameCount)],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CARGO_TARGET_DIR: '/tmp/skyroads-alpha-target' },
    maxBuffer: 1024 * 1024 * 16,
  }
);

const rustFrames = rustOutput
  .split(/\r?\n/)
  .map(parseRustFrame)
  .filter(Boolean);

assert.equal(rustFrames.length, frameCount, `Rust trace emitted ${rustFrames.length} frames`);

const level = JSON.parse(await readFile(resolve(repoRoot, 'web/assets/levels/level_00.json'), 'utf8'));
const sim = new SkyRoadsSim(level);
const mismatchCounts = {
  controls: 0,
  row: 0,
  state: 0,
  events: 0,
  x: 0,
  y: 0,
  z: 0,
  zVel: 0,
  oxygen: 0,
  fuel: 0,
};
const maxAbsDelta = {
  x: 0,
  y: 0,
  z: 0,
  zVel: 0,
  oxygen: 0,
  fuel: 0,
};
let firstMismatch = null;

for (const rust of rustFrames) {
  const js = sim.tick(rust.controls);
  const detailBase = { frame: rust.frameIndex, rust, js };
  if (
    js.controls.turn !== rust.controls.turn ||
    js.controls.accel !== rust.controls.accel ||
    js.controls.jump !== rust.controls.jump
  ) {
    firstMismatch = bumpMismatch(mismatchCounts, 'controls', firstMismatch, {
      ...detailBase,
      field: 'controls',
    });
  }
  if (js.row !== rust.row) {
    firstMismatch = bumpMismatch(mismatchCounts, 'row', firstMismatch, { ...detailBase, field: 'row' });
  }
  if (js.state !== rust.state) {
    firstMismatch = bumpMismatch(mismatchCounts, 'state', firstMismatch, { ...detailBase, field: 'state' });
  }
  if (eventKey(js.events) !== eventKey(rust.events)) {
    firstMismatch = bumpMismatch(mismatchCounts, 'events', firstMismatch, { ...detailBase, field: 'events' });
  }

  for (const [field, rustValue, jsValue] of [
    ['x', rust.x, js.x],
    ['y', rust.y, js.y],
    ['z', rust.z, js.z],
    ['zVel', rust.zVel, js.zVel],
    ['oxygen', rust.oxygenPct, js.oxygenPct],
    ['fuel', rust.fuelPct, js.fuelPct],
  ]) {
    const delta = Math.abs(rustValue - jsValue);
    maxAbsDelta[field] = Math.max(maxAbsDelta[field], delta);
    if (delta > tolerance) {
      firstMismatch = bumpMismatch(mismatchCounts, field, firstMismatch, {
        ...detailBase,
        field,
        rustValue,
        jsValue,
        delta,
      });
    }
  }
}

const totalMismatches = Object.values(mismatchCounts).reduce((sum, value) => sum + value, 0);
const report = {
  frames: frameCount,
  tolerance,
  mismatchCounts,
  maxAbsDelta,
  firstMismatch,
};
console.log(JSON.stringify(report, null, 2));
assert.equal(totalMismatches, 0, 'Rust-vs-JS differential mismatch');
