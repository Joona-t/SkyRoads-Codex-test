import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { validateLevel, expectedCounts, maxChunkDrawables } from '../src/level-contract.mjs';

const root = process.argv[2] ?? new URL('../assets/levels/', import.meta.url).pathname;
const assetsRoot = dirname(root.replace(/\/$/, ''));
const files = (await readdir(root)).filter((name) => /^level_\d+\.json$/.test(name)).sort();
if (files.length === 0) throw new Error(`no level JSON files in ${root}`);

const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8'));
assert.equal(index.version, 1);
assert.equal(index.generatedFrom, 'ROADS.LZS');
assert.equal(index.count, 31);
assert.equal(index.levels.length, 31);
assert.equal(new Set(index.levels.map((entry) => entry.roadIndex)).size, 31);
assert.deepEqual(index.levels.map((entry) => entry.roadIndex).sort((a, b) => a - b),
  Array.from({ length: 31 }, (_, roadIndex) => roadIndex));
assert.deepEqual(files, index.levels.map((entry) => entry.file).sort());

const paletteFiles = (await readdir(join(assetsRoot, 'palettes')))
  .filter((name) => /^world_\d+\.json$/.test(name))
  .sort();
assert.deepEqual(paletteFiles, Array.from({ length: 10 }, (_, world) => `world_${world}.json`));
for (const name of paletteFiles) {
  const palette = JSON.parse(await readFile(join(assetsRoot, 'palettes', name), 'utf8'));
  assert.ok(Array.isArray(palette) && palette.length > 0, `${name} is empty`);
  for (const [index, color] of palette.entries()) {
    assert.ok(Array.isArray(color) && color.length === 3, `${name}[${index}] must be RGB`);
    for (const channel of color) assert.ok(Number.isInteger(channel) && channel >= 0 && channel <= 255);
  }
}

const encoded = await Promise.all(files.map(async (name) => ({
  name,
  text: await readFile(join(root, name), 'utf8'),
})));
const repetitions = 9;
const timings = [];
let summary;
for (let repetition = 0; repetition < repetitions; repetition++) {
  const started = performance.now();
  const totals = { cells: 0, instances: 0, nonEmpty: 0, maxDrawables: 0 };
  for (const { text } of encoded) {
    const level = validateLevel(JSON.parse(text));
    const counts = expectedCounts(level);
    totals.cells += level.length * level.columns;
    totals.instances += counts.flat + counts.short + counts.tall + counts.tunnel;
    totals.nonEmpty += counts.nonEmpty;
    totals.maxDrawables += maxChunkDrawables(level);
  }
  timings.push(performance.now() - started);
  summary = totals;
}
timings.sort((a, b) => a - b);

assert.deepEqual(summary, {
  cells: 30436,
  instances: 17357,
  nonEmpty: 15265,
  maxDrawables: 681,
});

const kindTotals = {};
for (const { text } of encoded) {
  const level = validateLevel(JSON.parse(text));
  for (const row of level.cells) {
    for (const cell of row) kindTotals[cell.kind] = (kindTotals[cell.kind] ?? 0) + 1;
  }
}
assert.deepEqual(kindTotals, {
  0: 25781,
  1: 987,
  2: 2132,
  3: 268,
  4: 1079,
  5: 189,
});

const validFixture = validateLevel(JSON.parse(encoded[0].text));
function assertRejected(name, mutate) {
  const invalid = structuredClone(validFixture);
  mutate(invalid);
  assert.throws(() => validateLevel(invalid), undefined, `${name} was accepted`);
}
assertRejected('malformed dimensions', (level) => { level.length += 1; });
assertRejected('malformed constants', (level) => { level.constants.tileStrideX = -1; });
assertRejected('malformed palette index', (level) => { level.cells[0][0].tileColor = level.palette.length; });
assertRejected('malformed cube height', (level) => { level.cells[0][0].cube = 999; });
assertRejected('malformed cell object', (level) => { level.cells[0][0].kind = 5; });

const bytes = encoded.reduce((sum, file) => sum + Buffer.byteLength(file.text), 0);
const report = {
  levels: files.length,
  palettes: paletteFiles.length,
  bytes,
  ...summary,
  kindTotals,
  parseValidateMedianMs: timings[Math.floor(timings.length / 2)],
  parseValidateMinMs: timings[0],
  parseValidateMaxMs: timings[timings.length - 1],
  repetitions,
  negativeFixtures: 5,
};
console.log(JSON.stringify(report, null, 2));
