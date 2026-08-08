export const TILE = 4;
export const GAME_SCALE = TILE / 46;
export const CHUNK_ROWS = 16;
export const CRAFT_GROUND_CLEARANCE = 0.64;

export function gameXToWorld(gameX, centerX) {
  return (gameX - centerX) * GAME_SCALE;
}

export function gameYToWorld(gameY, groundY) {
  return (gameY - groundY) * GAME_SCALE;
}

export function gameZToWorld(gameZ) {
  return -gameZ * TILE;
}
