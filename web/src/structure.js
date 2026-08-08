import { CHUNK_ROWS } from './units.js';

export const DRAW_KINDS = Object.freeze(['flat', 'short', 'tall', 'tunnel']);

function emptyBucket(index) {
  return {
    index,
    flat: [],
    short: [],
    tall: [],
    tunnel: [],
  };
}

function countBucket(bucket) {
  return bucket.flat.length + bucket.short.length + bucket.tall.length + bucket.tunnel.length;
}

export function classifyCell(cell, constants = {}) {
  const shortTop = constants.cubeShortTop ?? 100;
  const tallTop = constants.cubeTallTop ?? 120;
  return {
    flat: Boolean(cell.tile),
    short: cell.cube === shortTop,
    tall: cell.cube === tallTop,
    tunnel: Boolean(cell.tunnel),
  };
}

export function createRenderBuckets(level, chunkRows = CHUNK_ROWS) {
  const chunkCount = Math.ceil(level.length / chunkRows);
  const chunks = Array.from({ length: chunkCount }, (_, index) => emptyBucket(index));

  for (let row = 0; row < level.length; row++) {
    const chunk = chunks[Math.floor(row / chunkRows)];
    for (let column = 0; column < level.columns; column++) {
      const cell = level.cells[row][column];
      const cellIndex = row * level.columns + column;
      const flags = classifyCell(cell, level.constants);
      if (flags.flat) chunk.flat.push(cellIndex);
      if (flags.short) chunk.short.push(cellIndex);
      if (flags.tall) chunk.tall.push(cellIndex);
      if (cell.cube != null && !flags.short && !flags.tall) {
        throw new Error(`unknown cube height ${cell.cube}`);
      }
      if (flags.tunnel) chunk.tunnel.push(cellIndex);
    }
  }

  return chunks.filter(countBucket);
}

export function countDrawBatches(level, chunkRows = CHUNK_ROWS) {
  return createRenderBuckets(level, chunkRows).reduce(
    (sum, bucket) => sum + DRAW_KINDS.filter((kind) => bucket[kind].length > 0).length,
    0
  );
}

export function summarizeRenderStructure(level, chunkRows = CHUNK_ROWS) {
  const counts = { flat: 0, short: 0, tall: 0, tunnel: 0 };
  const buckets = createRenderBuckets(level, chunkRows);
  let drawables = 0;
  for (const bucket of buckets) {
    for (const kind of DRAW_KINDS) {
      counts[kind] += bucket[kind].length;
      if (bucket[kind].length > 0) drawables++;
    }
  }
  return {
    chunkRows,
    chunks: buckets.length,
    drawables,
    counts,
    totalInstances: counts.flat + counts.short + counts.tall + counts.tunnel,
  };
}
