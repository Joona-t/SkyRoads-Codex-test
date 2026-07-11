import * as THREE from 'three';
import { expectedCounts } from './loader.js';

// Render boundary: simulation remains in original SkyRoads units.
export const TILE = 4;
export const GAME_SCALE = TILE / 46;
export const CHUNK_ROWS = 16;

const EFFECT_COLORS = Object.freeze({
  accelerate: 0x00ffa3,
  decelerate: 0xff9f2d,
  kill: 0xff2b4e,
  slide: 0x9d4bff,
  refillOxygen: 0x16f0e6,
});

function gameXToWorld(gameX, centerX) {
  return (gameX - centerX) * GAME_SCALE;
}

function cellCenterX(column, constants) {
  const gameX = constants.levelMinX + column * constants.tileStrideX + constants.tileStrideX / 2;
  return gameXToWorld(gameX, constants.levelCenterX);
}

function setCellColor(target, cell, palette, surface) {
  const effect = surface === 'tile' ? cell.tileEffect : cell.cubeEffect;
  const effectColor = EFFECT_COLORS[effect];
  if (effectColor != null) return target.setHex(effectColor);
  const index = surface === 'tile' ? cell.tileColor : cell.cubeColor;
  const rgb = palette[index] ?? [120, 136, 160];
  return target.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
}

function makeTunnelGeometry() {
  const width = TILE * 0.98;
  const height = TILE * 1.35;
  const wall = TILE * 0.12;
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();

  const opening = new THREE.Path();
  opening.moveTo(-width / 2 + wall, 0);
  opening.lineTo(-width / 2 + wall, height - wall);
  opening.lineTo(width / 2 - wall, height - wall);
  opening.lineTo(width / 2 - wall, 0);
  opening.closePath();
  shape.holes.push(opening);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: TILE * 0.98,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -TILE * 0.49);
  return geometry;
}

function countBucket(bucket) {
  return bucket.flat.length + bucket.short.length + bucket.tall.length + bucket.tunnel.length;
}

function createBuckets(level, chunkRows) {
  const chunkCount = Math.ceil(level.length / chunkRows);
  const chunks = Array.from({ length: chunkCount }, (_, index) => ({
    index,
    flat: [],
    short: [],
    tall: [],
    tunnel: [],
  }));

  for (let row = 0; row < level.length; row++) {
    const chunk = chunks[Math.floor(row / chunkRows)];
    for (let column = 0; column < level.columns; column++) {
      const cell = level.cells[row][column];
      const cellIndex = row * level.columns + column;
      if (cell.tile) chunk.flat.push(cellIndex);
      if (cell.cube === level.constants.cubeShortTop) chunk.short.push(cellIndex);
      else if (cell.cube === level.constants.cubeTallTop) chunk.tall.push(cellIndex);
      else if (cell.cube != null) throw new Error(`unknown cube height ${cell.cube}`);
      if (cell.tunnel) chunk.tunnel.push(cellIndex);
    }
  }
  return chunks.filter(countBucket);
}

function makeInstancedMesh(entries, geometry, material, level, kind, counts) {
  if (entries.length === 0) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  const quaternion = new THREE.Quaternion();
  const color = new THREE.Color();
  const constants = level.constants;

  for (let i = 0; i < entries.length; i++) {
    const cellIndex = entries[i];
    const row = Math.floor(cellIndex / level.columns);
    const column = cellIndex - row * level.columns;
    const cell = level.cells[row][column];
    const x = cellCenterX(column, constants);
    const z = -row * TILE;
    let y = 0;
    let surface = 'tile';
    if (kind === 'flat') y = -TILE * 0.025;
    else if (kind === 'short' || kind === 'tall') {
      const height = (cell.cube - constants.groundY) * GAME_SCALE;
      y = height / 2;
      scale.y = height;
      surface = 'cube';
    }
    position.set(x, y, z);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, setCellColor(color, cell, level.palette, surface));
    scale.set(1, 1, 1);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.name = kind;
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = true;
  counts[kind] += entries.length;
  return mesh;
}

export function buildLevelScene(level, options = {}) {
  const started = performance.now();
  const chunkRows = options.chunkRows ?? CHUNK_ROWS;
  const group = new THREE.Group();
  group.name = `level-${level.roadIndex}`;

  const geometries = {
    flat: new THREE.BoxGeometry(TILE * 0.98, TILE * 0.05, TILE * 0.98),
    short: new THREE.BoxGeometry(TILE * 0.98, 1, TILE * 0.98),
    tall: new THREE.BoxGeometry(TILE * 0.98, 1, TILE * 0.98),
    tunnel: makeTunnelGeometry(),
  };
  const materials = {
    flat: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0.18 }),
    short: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.72, metalness: 0.24 }),
    tall: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.68, metalness: 0.28 }),
    tunnel: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }),
  };
  const chunks = createBuckets(level, chunkRows);
  const counts = { flat: 0, short: 0, tall: 0, tunnel: 0 };
  let drawables = 0;

  for (const bucket of chunks) {
    const chunk = new THREE.Group();
    chunk.name = `chunk-${bucket.index}`;
    for (const kind of ['flat', 'short', 'tall', 'tunnel']) {
      const mesh = makeInstancedMesh(bucket[kind], geometries[kind], materials[kind], level, kind, counts);
      if (mesh) {
        chunk.add(mesh);
        drawables++;
      }
    }
    group.add(chunk);
  }

  const expected = expectedCounts(level);
  for (const kind of ['flat', 'short', 'tall', 'tunnel']) {
    if (counts[kind] !== expected[kind]) {
      throw new Error(`${kind} instances ${counts[kind]} != expected ${expected[kind]}`);
    }
  }

  const metrics = {
    buildMs: performance.now() - started,
    chunkRows,
    chunks: chunks.length,
    drawables,
    counts,
    expected,
    totalInstances: counts.flat + counts.short + counts.tall + counts.tunnel,
  };

  function dispose() {
    group.removeFromParent();
    for (const geometry of Object.values(geometries)) geometry.dispose();
    for (const material of Object.values(materials)) material.dispose();
  }

  return { group, metrics, dispose };
}

export function addBaselineLighting(scene) {
  scene.add(new THREE.HemisphereLight(0x8ad8ff, 0x14051f, 1.35));
  const sun = new THREE.DirectionalLight(0xffc3f3, 2.1);
  sun.position.set(-8, 16, 10);
  scene.add(sun);
}
