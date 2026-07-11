const CUBE_HEIGHTS = new Set([100, 120]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateLevel(level) {
  invariant(level && typeof level === 'object', 'level must be an object');
  invariant(level.version === 1, `unsupported level version ${level.version}`);
  invariant(Number.isInteger(level.length) && level.length > 0, 'level length must be a positive integer');
  invariant(Number.isInteger(level.columns) && level.columns > 0, 'level columns must be a positive integer');
  invariant(Array.isArray(level.palette) && level.palette.length > 0, 'palette is missing');
  invariant(level.constants?.roadColumns === level.columns, 'constants.roadColumns mismatch');
  invariant(level.constants?.tileStrideX > 0, 'constants.tileStrideX must be positive');
  invariant(level.constants?.zPerRow > 0, 'constants.zPerRow must be positive');
  invariant(Array.isArray(level.cells) && level.cells.length === level.length,
    `cells length ${level.cells?.length} != declared ${level.length}`);

  for (let rowIndex = 0; rowIndex < level.cells.length; rowIndex++) {
    const row = level.cells[rowIndex];
    invariant(Array.isArray(row) && row.length === level.columns,
      `row ${rowIndex} width ${row?.length} != ${level.columns}`);
    for (let column = 0; column < row.length; column++) {
      const cell = row[column];
      invariant(cell && typeof cell === 'object', `cell ${rowIndex}:${column} is invalid`);
      invariant(typeof cell.tile === 'boolean', `cell ${rowIndex}:${column} tile must be boolean`);
      invariant(typeof cell.tunnel === 'boolean', `cell ${rowIndex}:${column} tunnel must be boolean`);
      invariant(cell.cube == null || CUBE_HEIGHTS.has(cell.cube),
        `cell ${rowIndex}:${column} cube ${cell.cube} is invalid`);
      invariant(Number.isInteger(cell.tileColor) && cell.tileColor >= 0 && cell.tileColor < level.palette.length,
        `cell ${rowIndex}:${column} tileColor ${cell.tileColor} outside palette`);
      invariant(Number.isInteger(cell.cubeColor) && cell.cubeColor >= 0 && cell.cubeColor < level.palette.length,
        `cell ${rowIndex}:${column} cubeColor ${cell.cubeColor} outside palette`);
    }
  }
  return level;
}

export function expectedCounts(level) {
  const shortTop = level.constants?.cubeShortTop ?? 100;
  const tallTop = level.constants?.cubeTallTop ?? 120;
  const counts = { flat: 0, short: 0, tall: 0, tunnel: 0, nonEmpty: 0 };
  for (const row of level.cells) for (const cell of row) {
    if (cell.tile || cell.tunnel || cell.cube != null) counts.nonEmpty++;
    if (cell.tile) counts.flat++;
    if (cell.cube === shortTop) counts.short++;
    else if (cell.cube === tallTop) counts.tall++;
    else if (cell.cube != null) throw new Error(`unknown cube height ${cell.cube}`);
    if (cell.tunnel) counts.tunnel++;
  }
  return counts;
}

export function maxChunkDrawables(level, chunkRows = 16) {
  const chunks = Array.from({ length: Math.ceil(level.length / chunkRows) }, () => new Uint8Array(4));
  for (let row = 0; row < level.length; row++) for (const cell of level.cells[row]) {
    const flags = chunks[Math.floor(row / chunkRows)];
    if (cell.tile) flags[0] = 1;
    if (cell.cube === 100) flags[1] = 1;
    if (cell.cube === 120) flags[2] = 1;
    if (cell.tunnel) flags[3] = 1;
  }
  return chunks.reduce((sum, flags) => sum + flags[0] + flags[1] + flags[2] + flags[3], 0);
}
