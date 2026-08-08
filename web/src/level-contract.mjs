const CUBE_HEIGHTS = new Set([100, 120]);
const TOUCH_EFFECTS = new Set(['none', 'accelerate', 'decelerate', 'kill', 'slide', 'refillOxygen']);
const EXPECTED_CONSTANTS = Object.freeze({
  tileStrideX: 46,
  groundY: 80,
  roadColumns: 7,
  levelMinX: 95,
  levelMaxX: 417,
  levelCenterX: 256,
  cubeShortTop: 100,
  cubeTallTop: 120,
  zPerRow: 1,
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteNumber(value, message) {
  invariant(Number.isFinite(value), message);
}

function integerIn(value, min, max, message) {
  invariant(Number.isInteger(value) && value >= min && value <= max, message);
}

function validateColorTriplet(color, label) {
  invariant(Array.isArray(color) && color.length === 3, `${label} must be an RGB triplet`);
  for (let channel = 0; channel < color.length; channel++) {
    integerIn(color[channel], 0, 255, `${label}[${channel}] must be 0..255`);
  }
}

export function validateLevel(level, options = {}) {
  const sourceCorpus = options.sourceCorpus ?? true;
  invariant(level && typeof level === 'object', 'level must be an object');
  invariant(level.version === 1, `unsupported level version ${level.version}`);
  if (sourceCorpus) {
    integerIn(level.roadIndex, 0, 30, `roadIndex ${level.roadIndex} outside source corpus`);
  } else {
    invariant(
      typeof level.roadIndex === 'string' || Number.isInteger(level.roadIndex),
      `roadIndex ${level.roadIndex} must identify a playable level`
    );
  }
  invariant(typeof level.name === 'string' && level.name.length > 0, 'level name must be non-empty');
  integerIn(level.world, 0, 9, `world ${level.world} outside exported palette range`);
  integerIn(level.gravity, 0, 0xffff, 'gravity must be a u16 integer');
  integerIn(level.fuel, 0, 0xffff, 'fuel must be a u16 integer');
  integerIn(level.oxygen, 0, 0xffff, 'oxygen must be a u16 integer');
  invariant(Number.isInteger(level.length) && level.length > 0, 'level length must be a positive integer');
  invariant(level.columns === EXPECTED_CONSTANTS.roadColumns,
    `level columns ${level.columns} != ${EXPECTED_CONSTANTS.roadColumns}`);
  invariant(Array.isArray(level.palette) && level.palette.length > 0, 'palette is missing');
  for (let index = 0; index < level.palette.length; index++) {
    validateColorTriplet(level.palette[index], `palette[${index}]`);
  }
  invariant(level.start && typeof level.start === 'object', 'start is missing');
  finiteNumber(level.start.x, 'start.x must be finite');
  finiteNumber(level.start.y, 'start.y must be finite');
  finiteNumber(level.start.z, 'start.z must be finite');
  invariant(level.constants && typeof level.constants === 'object', 'constants are missing');
  for (const [name, expected] of Object.entries(EXPECTED_CONSTANTS)) {
    invariant(level.constants[name] === expected, `constants.${name} ${level.constants[name]} != ${expected}`);
  }
  invariant(Array.isArray(level.cells) && level.cells.length === level.length,
    `cells length ${level.cells?.length} != declared ${level.length}`);

  for (let rowIndex = 0; rowIndex < level.cells.length; rowIndex++) {
    const row = level.cells[rowIndex];
    invariant(Array.isArray(row) && row.length === level.columns,
      `row ${rowIndex} width ${row?.length} != ${level.columns}`);
    for (let column = 0; column < row.length; column++) {
      const cell = row[column];
      invariant(cell && typeof cell === 'object', `cell ${rowIndex}:${column} is invalid`);
      integerIn(cell.raw, 0, 0xffff, `cell ${rowIndex}:${column} raw must be u16`);
      integerIn(cell.kind, 0, 5, `cell ${rowIndex}:${column} kind ${cell.kind} is invalid`);
      invariant(typeof cell.tile === 'boolean', `cell ${rowIndex}:${column} tile must be boolean`);
      invariant(typeof cell.tunnel === 'boolean', `cell ${rowIndex}:${column} tunnel must be boolean`);
      invariant(cell.cube == null || CUBE_HEIGHTS.has(cell.cube),
        `cell ${rowIndex}:${column} cube ${cell.cube} is invalid`);
      const cubeBits = cell.cube == null ? 0 : cell.cube === level.constants.cubeShortTop ? 2 : 4;
      const expectedKind = cubeBits + (cell.tunnel ? 1 : 0);
      invariant(cell.kind === expectedKind,
        `cell ${rowIndex}:${column} kind ${cell.kind} != expected ${expectedKind}`);
      invariant(Number.isInteger(cell.tileColor) && cell.tileColor >= 0 && cell.tileColor < level.palette.length,
        `cell ${rowIndex}:${column} tileColor ${cell.tileColor} outside palette`);
      invariant(Number.isInteger(cell.cubeColor) && cell.cubeColor >= 0 && cell.cubeColor < level.palette.length,
        `cell ${rowIndex}:${column} cubeColor ${cell.cubeColor} outside palette`);
      invariant(TOUCH_EFFECTS.has(cell.tileEffect),
        `cell ${rowIndex}:${column} tileEffect ${cell.tileEffect} is invalid`);
      invariant(TOUCH_EFFECTS.has(cell.cubeEffect),
        `cell ${rowIndex}:${column} cubeEffect ${cell.cubeEffect} is invalid`);
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
