import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { validateLevel, expectedCounts, maxChunkDrawables } from '../src/level-contract.mjs';

const root = process.argv[2] ?? new URL('../assets/levels/', import.meta.url).pathname;
const files = (await readdir(root)).filter((name) => /^level_\d+\.json$/.test(name)).sort();
if (files.length === 0) throw new Error(`no level JSON files in ${root}`);

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

const invalid = structuredClone(validateLevel(JSON.parse(encoded[0].text)));
invalid.cells[0][0].cube = 999;
let rejected = false;
try {
  validateLevel(invalid);
} catch {
  rejected = true;
}
if (!rejected) throw new Error('invalid cube height was accepted');

const bytes = encoded.reduce((sum, file) => sum + Buffer.byteLength(file.text), 0);
const report = {
  levels: files.length,
  bytes,
  ...summary,
  parseValidateMedianMs: timings[Math.floor(timings.length / 2)],
  parseValidateMinMs: timings[0],
  parseValidateMaxMs: timings[timings.length - 1],
  repetitions,
  invalidFixtureRejected: rejected,
};
console.log(JSON.stringify(report, null, 2));
