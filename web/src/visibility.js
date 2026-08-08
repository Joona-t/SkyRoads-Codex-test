import { surfaceColorRgb, relativeLuminance } from './course-colors.js';
import { createCoursePreview, COURSE_CLASS } from './preview.js';
import { gameToWorldPosition, computeChaseCamera, cameraProfileForAspect } from './view.js';
import { gameXToWorld, TILE } from './units.js';

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v) {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function initialFrame(level) {
  return {
    x: level.start?.x ?? level.constants.levelCenterX,
    y: level.start?.y ?? level.constants.groundY,
    z: level.start?.z ?? 3,
    zVel: 0,
    fuelPct: 1,
    oxygenPct: 1,
    controls: { turn: 0, accel: 0, jump: false },
  };
}

function cellCenter(level, row, column) {
  const constants = level.constants;
  const gameX = constants.levelMinX + column * constants.tileStrideX + constants.tileStrideX / 2;
  return {
    x: gameXToWorld(gameX, constants.levelCenterX),
    y: 0.12,
    z: -row * TILE,
  };
}

function makeFrustum(level, aspect) {
  const position = gameToWorldPosition(initialFrame(level), level.constants);
  const chase = computeChaseCamera(position, { aspect });
  const camera = chase.position;
  const forward = normalize(sub(chase.lookAt, camera));
  const right = normalize(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = normalize(cross(right, forward));
  const vFov = cameraProfileForAspect(aspect).fov * Math.PI / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  return {
    camera,
    forward,
    right,
    up,
    tanHalfV: Math.tan(vFov / 2),
    tanHalfH: Math.tan(hFov / 2),
    far: Math.max(900, level.length * 5 + 120),
  };
}

function isPointInFrustum(frustum, point) {
  const rel = sub(point, frustum.camera);
  const depth = dot(rel, frustum.forward);
  if (depth <= 0.1 || depth >= frustum.far) return false;
  const x = dot(rel, frustum.right);
  const y = dot(rel, frustum.up);
  return Math.abs(x / depth) <= frustum.tanHalfH && Math.abs(y / depth) <= frustum.tanHalfV;
}

export function initialRaceVisibilityMetrics(level, options = {}) {
  const aspect = options.aspect ?? 1474 / 695;
  const frustum = makeFrustum(level, aspect);
  const firstRows = options.firstRows ?? 20;
  const visibleRows = new Set();
  const roadLuminance = [];
  let visibleRoadInstances = 0;

  for (let row = 0; row < Math.min(level.length, firstRows); row++) {
    for (let column = 0; column < level.columns; column++) {
      const cell = level.cells[row][column];
      if (!cell.tile) continue;
      const luminance = relativeLuminance(surfaceColorRgb(cell, level.palette, 'tile'));
      roadLuminance.push(luminance);
      if (isPointInFrustum(frustum, cellCenter(level, row, column))) {
        visibleRoadInstances += 1;
        visibleRows.add(row);
      }
    }
  }

  const preview = createCoursePreview(level);
  return {
    aspect,
    firstRows,
    visibleFirstRoadInstances: visibleRoadInstances,
    visibleRows: [...visibleRows].sort((a, b) => a - b),
    firstChunkIntersectsFrustum: [...visibleRows].some((row) => row < 16),
    minFirstRoadLuminance: roadLuminance.length > 0 ? Math.min(...roadLuminance) : null,
    roadLuminanceCount: roadLuminance.length,
    semanticClasses: Object.fromEntries(
      Object.values(COURSE_CLASS).map((name) => [name, preview.classes[name] > 0])
    ),
  };
}
