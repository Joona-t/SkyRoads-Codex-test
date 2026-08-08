export const TOUCH_EFFECT = Object.freeze({
  NONE: 'none',
  ACCELERATE: 'accelerate',
  DECELERATE: 'decelerate',
  KILL: 'kill',
  SLIDE: 'slide',
  REFILL_OXYGEN: 'refillOxygen',
});

export const LEVEL_TILE_STRIDE_X = 46;
export const LEVEL_CENTER_X = 0x8000 / 0x80;
export const LEVEL_MIN_X = 0x2f80 / 0x80;
export const LEVEL_MAX_X = 0xd080 / 0x80;
export const GROUND_Y = 0x2800 / 0x80;

const EMPTY_COLLISION_MIN_Y = 0x1e80 / 0x80;
const EMPTY_COLLISION_MAX_Y = 80;
const TUNNEL_ENTRY_MIN_Y = 0x2180 / 0x80;
const TUNNEL_BASE_Y = 68;
const X_OFFSET = 95;
const PROBE_RADIUS_X = 14;

const TUNNEL_CEILS = Object.freeze([
  0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20,
  0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x1f, 0x1f, 0x1f,
  0x1f, 0x1f, 0x1e, 0x1e, 0x1e, 0x1d, 0x1d, 0x1d, 0x1c, 0x1b,
  0x1a, 0x19, 0x18, 0x16, 0x14, 0x12, 0x11, 0x0e,
]);

const TUNNEL_LOWS = Object.freeze([
  0x10, 0x10, 0x10, 0x10, 0x0f, 0x0e, 0x0d, 0x0b, 0x08, 0x07,
  0x06, 0x05, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x02, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

export const EMPTY_CELL = Object.freeze({
  raw: 0,
  tile: false,
  tunnel: false,
  cube: null,
  tileColor: 0,
  cubeColor: 0,
  tileEffect: TOUCH_EFFECT.NONE,
  cubeEffect: TOUCH_EFFECT.NONE,
});

export function rustRound(value) {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

export function floor16(value) {
  return Math.floor(value * 0x80) / 0x80;
}

export function floor32(value) {
  return Math.floor(value * 0x10000) / 0x10000;
}

export function round16Nearest(value) {
  return rustRound(value * 0x80) / 0x80;
}

export function round32Nearest(value) {
  return rustRound(value * 0x10000) / 0x10000;
}

export function sFloor(value) {
  return value >= 0 ? Math.floor(value) : -Math.floor(-value);
}

export function normalizeLevel(level) {
  if (!level || typeof level !== 'object') throw new Error('level must be an object');
  const constants = {
    tileStrideX: level.constants?.tileStrideX ?? LEVEL_TILE_STRIDE_X,
    groundY: level.constants?.groundY ?? GROUND_Y,
    roadColumns: level.constants?.roadColumns ?? level.columns ?? 7,
    levelMinX: level.constants?.levelMinX ?? LEVEL_MIN_X,
    levelMaxX: level.constants?.levelMaxX ?? LEVEL_MAX_X,
    levelCenterX: level.constants?.levelCenterX ?? LEVEL_CENTER_X,
    cubeShortTop: level.constants?.cubeShortTop ?? 100,
    cubeTallTop: level.constants?.cubeTallTop ?? 120,
    zPerRow: level.constants?.zPerRow ?? 1,
  };
  return {
    ...level,
    constants,
    columns: level.columns ?? constants.roadColumns,
    length: level.length ?? level.cells?.length ?? 0,
  };
}

export function gravityAcceleration(level) {
  return -Math.floor(level.gravity * 0x1680 / 0x190) / 0x80;
}

export function isEmptyCell(cell) {
  return !cell.tunnel && !cell.tile && cell.cube == null;
}

export function cellAtIndices(levelInput, xIndex, zIndex) {
  const level = normalizeLevel(levelInput);
  return level.cells?.[zIndex]?.[xIndex] ?? EMPTY_CELL;
}

export function getCell(levelInput, xPos, _yPos, zPos) {
  const level = normalizeLevel(levelInput);
  let x = xPos - X_OFFSET;
  if (x < 0 || x > 322) return EMPTY_CELL;

  const z = Math.floor(Math.floor(zPos * 8) / 8);
  x /= LEVEL_TILE_STRIDE_X;
  const xIndex = Math.floor(x);
  if (xIndex < 0 || z < 0) return EMPTY_CELL;
  return cellAtIndices(level, xIndex, z);
}

function distanceFromCenter(xPos) {
  let distanceFromCenterValue = 23 - ((xPos - 49) % 46);
  let varA = -46;
  if (distanceFromCenterValue < 0) {
    distanceFromCenterValue = 1 - distanceFromCenterValue;
    varA = -varA;
  }
  return [distanceFromCenterValue, varA];
}

function isInsideTileY(yPos, distanceFromCenterValue, cell) {
  let distanceIndex = rustRound(distanceFromCenterValue);
  if (distanceIndex > 37) return false;
  distanceIndex = Number(distanceIndex);
  const y2 = yPos - TUNNEL_BASE_Y;
  const hasTunnel = Boolean(cell.tunnel);
  const cubeHeight = cell.cube;
  if (hasTunnel && cubeHeight == null) {
    return y2 > TUNNEL_LOWS[distanceIndex] && y2 < TUNNEL_CEILS[distanceIndex];
  }
  if (!hasTunnel && cubeHeight != null) return yPos < cubeHeight;
  if (hasTunnel && cubeHeight != null) {
    return y2 > TUNNEL_LOWS[distanceIndex] && yPos < cubeHeight;
  }
  return false;
}

function isInsideTunnelY(yPos, distanceFromCenterValue, cell) {
  let distanceIndex = rustRound(distanceFromCenterValue);
  if (distanceIndex > 29) return false;
  distanceIndex = Number(distanceIndex);
  const y2 = yPos - TUNNEL_BASE_Y;
  return Boolean(cell.tunnel) && Boolean(cell.tile) && y2 < TUNNEL_LOWS[distanceIndex] && yPos >= 80;
}

export function isInsideTile(levelInput, xPos, yPos, zPos) {
  const level = normalizeLevel(levelInput);
  const leftTile = getCell(level, xPos - PROBE_RADIUS_X, yPos, zPos);
  const rightTile = getCell(level, xPos + PROBE_RADIUS_X, yPos, zPos);

  if (isEmptyCell(leftTile) && isEmptyCell(rightTile)) return false;
  if (yPos < EMPTY_COLLISION_MAX_Y && yPos > EMPTY_COLLISION_MIN_Y) return true;
  if (yPos < TUNNEL_ENTRY_MIN_Y) return false;

  const [distanceFromCenterValue, varA] = distanceFromCenter(xPos);
  const centerTile = getCell(level, xPos, yPos, zPos);
  if (isInsideTileY(yPos, distanceFromCenterValue, centerTile)) return true;

  const adjacentTile = getCell(level, xPos + varA, yPos, zPos);
  return isInsideTileY(yPos, 47 - distanceFromCenterValue, adjacentTile);
}

export function isInsideTunnel(levelInput, xPos, yPos, zPos) {
  const level = normalizeLevel(levelInput);
  const leftTile = getCell(level, xPos - PROBE_RADIUS_X, yPos, zPos);
  const rightTile = getCell(level, xPos + PROBE_RADIUS_X, yPos, zPos);

  if (isEmptyCell(leftTile) && isEmptyCell(rightTile)) return false;

  const [distanceFromCenterValue, varA] = distanceFromCenter(xPos);
  const centerTile = getCell(level, xPos, yPos, zPos);
  if (isInsideTunnelY(yPos, distanceFromCenterValue, centerTile)) return true;

  const adjacentTile = getCell(level, xPos + varA, yPos, zPos);
  return isInsideTunnelY(yPos, 47 - distanceFromCenterValue, adjacentTile);
}
