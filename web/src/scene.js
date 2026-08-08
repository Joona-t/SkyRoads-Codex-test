import * as THREE from 'three';
import { surfaceColorRgb } from './course-colors.js';
import { expectedCounts } from './loader.js';
import { LIGHT_BUDGET, materialReadabilityPlan } from './render-contract.js';
import { createRenderBuckets, DRAW_KINDS } from './structure.js';
import { CHUNK_ROWS, GAME_SCALE, TILE, gameXToWorld } from './units.js';

// Render boundary: simulation remains in original SkyRoads units.
export { CHUNK_ROWS, GAME_SCALE, TILE };

const OBSTACLE_RIM = 0x9dfcff;

function cellCenterX(column, constants) {
  const gameX = constants.levelMinX + column * constants.tileStrideX + constants.tileStrideX / 2;
  return gameXToWorld(gameX, constants.levelCenterX);
}

function setCellColor(target, cell, palette, surface) {
  const rgb = surfaceColorRgb(cell, palette, surface);
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
  let presentation = options.presentation ?? {};
  const highContrast = () => presentation.highContrast === true;
  const group = new THREE.Group();
  group.name = `level-${level.roadIndex}`;

  const geometries = {
    flat: new THREE.BoxGeometry(TILE * 0.98, TILE * 0.05, TILE * 0.98),
    short: new THREE.BoxGeometry(TILE * 0.98, 1, TILE * 0.98),
    tall: new THREE.BoxGeometry(TILE * 0.98, 1, TILE * 0.98),
    tunnel: makeTunnelGeometry(),
  };
  const materials = {
    flat: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.36,
      metalness: 0.12,
      emissive: 0x12345a,
      emissiveIntensity: highContrast() ? 0.58 : 0.42,
    }),
    short: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.18,
      emissive: OBSTACLE_RIM,
      emissiveIntensity: highContrast() ? 0.34 : 0.2,
    }),
    tall: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.38,
      metalness: 0.2,
      emissive: OBSTACLE_RIM,
      emissiveIntensity: highContrast() ? 0.38 : 0.24,
    }),
    tunnel: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }),
  };
  const chunks = createRenderBuckets(level, chunkRows);
  const counts = { flat: 0, short: 0, tall: 0, tunnel: 0 };
  let drawables = 0;

  for (const bucket of chunks) {
    const chunk = new THREE.Group();
    chunk.name = `chunk-${bucket.index}`;
    for (const kind of DRAW_KINDS) {
      const mesh = makeInstancedMesh(bucket[kind], geometries[kind], materials[kind], level, kind, counts);
      if (mesh) {
        chunk.add(mesh);
        drawables++;
      }
    }
    group.add(chunk);
  }

  const tutorialHints = createTutorialVisualHints(level, presentation);
  if (tutorialHints) group.add(tutorialHints.group);

  const expected = expectedCounts(level);
  for (const kind of DRAW_KINDS) {
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
    tutorialHints: tutorialHints?.metrics ?? null,
    materialPlan: materialReadabilityPlan({ highContrast: highContrast() }),
  };

  function setPresentationOptions(nextPresentation = {}) {
    presentation = nextPresentation;
    materials.flat.emissiveIntensity = highContrast() ? 0.58 : 0.42;
    materials.short.emissiveIntensity = highContrast() ? 0.34 : 0.2;
    materials.tall.emissiveIntensity = highContrast() ? 0.38 : 0.24;
    tutorialHints?.setPresentationOptions?.(nextPresentation);
  }

  function dispose() {
    group.removeFromParent();
    for (const geometry of Object.values(geometries)) geometry.dispose();
    for (const material of Object.values(materials)) material.dispose();
    tutorialHints?.dispose();
  }

  return { group, metrics, setPresentationOptions, dispose };
}

function edgeX(column, side, constants) {
  return cellCenterX(column, constants) + side * TILE * 0.5;
}

function rowCenterZ(rowStart, rowEnd) {
  return -((rowStart + rowEnd) / 2) * TILE;
}

function addRail(group, meshes, level, rowStart, rowEnd, column, side, material) {
  const length = (rowEnd - rowStart + 1) * TILE;
  const geometry = new THREE.BoxGeometry(0.08, 0.08, length);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'tutorial-road-edge-rail';
  mesh.position.set(edgeX(column, side, level.constants), 0.17, rowCenterZ(rowStart, rowEnd));
  group.add(mesh);
  meshes.push(mesh);
}

function addBoxCue(group, meshes, name, position, size, material) {
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(position.x, position.y, position.z);
  group.add(mesh);
  meshes.push(mesh);
}

function createTutorialVisualHints(level, presentation = {}) {
  const hints = level.visualHints;
  if (!hints) return null;
  const group = new THREE.Group();
  group.name = 'tutorial-visual-cues';
  const meshes = [];
  const materials = [
    new THREE.MeshBasicMaterial({ color: 0x9dfcff }),
    new THREE.MeshBasicMaterial({ color: 0xffe66d }),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  ];

  for (const rail of hints.guideRails ?? []) {
    addRail(group, meshes, level, rail.rowStart, rail.rowEnd, rail.leftColumn, -1, materials[0]);
    addRail(group, meshes, level, rail.rowStart, rail.rowEnd, rail.rightColumn, 1, materials[0]);
  }

  for (const rim of hints.hazardRims ?? []) {
    const left = edgeX(rim.columnStart, -1, level.constants);
    const right = edgeX(rim.columnEnd, 1, level.constants);
    const front = -rim.rowStart * TILE + TILE * 0.5;
    const back = -rim.rowEnd * TILE - TILE * 0.5;
    const width = right - left;
    const depth = front - back;
    addBoxCue(group, meshes, 'tutorial-hazard-rim', { x: (left + right) / 2, y: 0.21, z: front }, { x: width, y: 0.08, z: 0.08 }, materials[1]);
    addBoxCue(group, meshes, 'tutorial-hazard-rim', { x: (left + right) / 2, y: 0.21, z: back }, { x: width, y: 0.08, z: 0.08 }, materials[1]);
    addBoxCue(group, meshes, 'tutorial-hazard-rim', { x: left, y: 0.21, z: (front + back) / 2 }, { x: 0.08, y: 0.08, z: depth }, materials[1]);
    addBoxCue(group, meshes, 'tutorial-hazard-rim', { x: right, y: 0.21, z: (front + back) / 2 }, { x: 0.08, y: 0.08, z: depth }, materials[1]);
  }

  const effectEntries = [];
  for (const row of hints.effectCueRows ?? []) {
    for (let column = 0; column < level.columns; column++) {
      const tile = level.cells[row]?.[column];
      if (tile?.tile && tile.tileEffect !== 'none') effectEntries.push({ row, column });
    }
  }
  if (effectEntries.length > 0) {
    const geometry = new THREE.BoxGeometry(TILE * 0.56, 0.045, TILE * 0.07);
    const mesh = new THREE.InstancedMesh(geometry, materials[2], effectEntries.length);
    mesh.name = 'tutorial-effect-shape-cues';
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const quaternion = new THREE.Quaternion();
    for (let i = 0; i < effectEntries.length; i++) {
      const { row, column } = effectEntries[i];
      position.set(cellCenterX(column, level.constants), 0.22, -row * TILE);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    meshes.push(mesh);
  }

  function setPresentationOptions(nextPresentation = {}) {
    presentation = nextPresentation;
    const intensity = presentation.highContrast === true ? 1 : (presentation.profile?.railIntensity ?? 1);
    materials[0].color.setHex(intensity >= 1 ? 0xd8ffff : 0x9dfcff);
    materials[1].color.setHex(intensity >= 1 ? 0xffff9b : 0xffe66d);
    materials[2].color.setHex(intensity >= 1 ? 0xffffff : 0xeafcff);
  }

  setPresentationOptions(presentation);

  return {
    group,
    metrics: {
      guideRailSegments: (hints.guideRails?.length ?? 0) * 2,
      hazardRims: meshes.filter((mesh) => mesh.name === 'tutorial-hazard-rim').length,
      effectCueInstances: effectEntries.length,
    },
    setPresentationOptions,
    dispose() {
      for (const mesh of meshes) mesh.geometry?.dispose?.();
      for (const material of materials) material.dispose();
    },
  };
}

export function addBaselineLighting(scene) {
  const hemisphere = new THREE.HemisphereLight(0x8ad8ff, 0x14051f, 1.35);
  hemisphere.name = 'neondrift-hemisphere-light';
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffc3f3, 2.1);
  sun.name = 'neondrift-directional-key-light';
  sun.position.set(-8, 16, 10);
  scene.add(sun);
  scene.userData.neondriftLightBudget = { ...LIGHT_BUDGET };
  return { hemisphere, directional: sun, budget: { ...LIGHT_BUDGET } };
}

const DEFAULT_CRAFT_APPEARANCE = Object.freeze({
  body: '#28f6ff',
  emissive: '#07304c',
  wing: '#ff3bd4',
  canopy: '#ffe66d',
  underglow: '#45ff8a',
  underglowIntensity: 1.2,
  livery: Object.freeze({
    pattern: 'none',
    accent: '#16f0e6',
    secondary: '#ffffff',
    opacity: 0,
  }),
});

function colorValue(hex, fallback) {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return Number.parseInt(hex.slice(1), 16);
}

function normalizeCraftAppearance(appearance = DEFAULT_CRAFT_APPEARANCE) {
  return {
    body: appearance.body ?? DEFAULT_CRAFT_APPEARANCE.body,
    emissive: appearance.emissive ?? DEFAULT_CRAFT_APPEARANCE.emissive,
    wing: appearance.wing ?? DEFAULT_CRAFT_APPEARANCE.wing,
    canopy: appearance.canopy ?? DEFAULT_CRAFT_APPEARANCE.canopy,
    underglow: appearance.underglow ?? DEFAULT_CRAFT_APPEARANCE.underglow,
    underglowIntensity: Number.isFinite(appearance.underglowIntensity)
      ? Math.max(0, Math.min(2, appearance.underglowIntensity))
      : DEFAULT_CRAFT_APPEARANCE.underglowIntensity,
    livery: {
      pattern: appearance.livery?.pattern ?? DEFAULT_CRAFT_APPEARANCE.livery.pattern,
      accent: appearance.livery?.accent ?? DEFAULT_CRAFT_APPEARANCE.livery.accent,
      secondary: appearance.livery?.secondary ?? DEFAULT_CRAFT_APPEARANCE.livery.secondary,
      opacity: Number.isFinite(appearance.livery?.opacity)
        ? Math.max(0, Math.min(1, appearance.livery.opacity))
        : DEFAULT_CRAFT_APPEARANCE.livery.opacity,
    },
  };
}

function hexString(color) {
  return `#${color.getHexString()}`;
}

export function createProceduralCraft(options = {}) {
  const group = new THREE.Group();
  group.name = 'player-craft';
  group.scale.setScalar(1.55);
  let appearance = normalizeCraftAppearance(options.appearance);
  let presentation = options.presentation ?? {};
  const useUnderglowLight = options.underglowLight === true;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: colorValue(appearance.body, 0x28f6ff),
    emissive: colorValue(appearance.emissive, 0x07304c),
    roughness: 0.28,
    metalness: 0.56,
  });
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: colorValue(appearance.wing, 0xff3bd4),
    emissive: 0x3d0932,
    roughness: 0.34,
    metalness: 0.42,
  });
  const canopyMaterial = new THREE.MeshStandardMaterial({
    color: colorValue(appearance.canopy, 0xffe66d),
    emissive: 0x3c2b04,
    roughness: 0.24,
    metalness: 0.2,
  });
  const liveryMaterial = new THREE.MeshBasicMaterial({
    color: colorValue(appearance.livery.accent, 0x16f0e6),
    transparent: true,
    opacity: appearance.livery.opacity,
    depthWrite: false,
  });
  const liverySecondaryMaterial = new THREE.MeshBasicMaterial({
    color: colorValue(appearance.livery.secondary, 0xffffff),
    transparent: true,
    opacity: appearance.livery.opacity,
    depthWrite: false,
  });

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.65, 4, 1), bodyMaterial);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.48;
  group.add(nose);

  const core = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.34, 1.25), bodyMaterial);
  core.position.z = 0.24;
  group.add(core);

  const leftWing = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 0.48), wingMaterial);
  leftWing.position.set(-0.74, -0.05, 0.42);
  leftWing.rotation.z = 0.16;
  group.add(leftWing);

  const rightWing = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 0.48), wingMaterial);
  rightWing.position.set(0.74, -0.05, 0.42);
  rightWing.rotation.z = -0.16;
  group.add(rightWing);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), canopyMaterial);
  canopy.scale.set(1, 0.42, 1.35);
  canopy.position.set(0, 0.25, -0.12);
  group.add(canopy);

  const trail = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 1.2, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: colorValue(appearance.underglow, 0x16f0e6),
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    })
  );
  trail.rotation.x = Math.PI / 2;
  trail.position.z = 1.08;
  group.add(trail);

  const underglow = new THREE.Mesh(
    new THREE.CircleGeometry(0.96, 24),
    new THREE.MeshBasicMaterial({
      color: colorValue(appearance.underglow, 0x45ff8a),
      transparent: true,
      opacity: 0.22 * appearance.underglowIntensity,
      depthWrite: false,
    })
  );
  underglow.name = 'craft-underglow';
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = -0.23;
  group.add(underglow);

  const underglowLight = useUnderglowLight ? new THREE.PointLight(
    colorValue(appearance.underglow, 0x45ff8a),
    presentation.highContrast === true ? 0.82 : 0.58,
    3.2,
    2.4
  ) : null;
  if (underglowLight) {
    underglowLight.name = 'craft-underglow-light';
    underglowLight.position.set(0, -0.12, 0.18);
    group.add(underglowLight);
  }

  const liveryMeshes = [
    new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.022, 1.1), liveryMaterial),
    new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.022, 1.1), liveryMaterial),
    new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.024, 0.1), liverySecondaryMaterial),
    new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.026, 0.22), liverySecondaryMaterial),
  ];
  for (const mesh of liveryMeshes) {
    mesh.name = 'craft-procedural-livery';
    mesh.position.y = 0.425;
    group.add(mesh);
  }

  function arrangeLivery() {
    const [leftStripe, rightStripe, crossLine, badge] = liveryMeshes;
    for (const mesh of liveryMeshes) mesh.visible = appearance.livery.pattern !== 'none' && appearance.livery.opacity > 0;
    liveryMaterial.color.setHex(colorValue(appearance.livery.accent, 0x16f0e6));
    liverySecondaryMaterial.color.setHex(colorValue(appearance.livery.secondary, 0xffffff));
    liveryMaterial.opacity = appearance.livery.opacity;
    liverySecondaryMaterial.opacity = appearance.livery.opacity;

    leftStripe.rotation.set(0, 0, 0);
    rightStripe.rotation.set(0, 0, 0);
    crossLine.rotation.set(0, 0, 0);
    badge.rotation.set(0, 0, 0);
    leftStripe.position.set(-0.17, 0.425, 0.18);
    rightStripe.position.set(0.17, 0.425, 0.18);
    crossLine.position.set(0, 0.438, -0.2);
    badge.position.set(0, 0.446, 0.38);

    if (appearance.livery.pattern === 'splitter-stripes') {
      crossLine.visible = false;
      badge.visible = false;
    } else if (appearance.livery.pattern === 'circuit-lines') {
      leftStripe.position.x = -0.11;
      rightStripe.position.x = 0.11;
      crossLine.position.z = 0.08;
      badge.visible = false;
    } else if (appearance.livery.pattern === 'void-check') {
      leftStripe.rotation.y = Math.PI / 4;
      rightStripe.rotation.y = -Math.PI / 4;
      crossLine.visible = false;
      badge.position.set(-0.22, 0.446, 0.28);
    }
  }

  function applyBaseAppearance() {
    bodyMaterial.color.setHex(colorValue(appearance.body, 0x28f6ff));
    bodyMaterial.emissive.setHex(colorValue(appearance.emissive, 0x07304c));
    wingMaterial.color.setHex(colorValue(appearance.wing, 0xff3bd4));
    canopyMaterial.color.setHex(colorValue(appearance.canopy, 0xffe66d));
    trail.material.color.setHex(colorValue(appearance.underglow, 0x16f0e6));
    underglow.material.color.setHex(colorValue(appearance.underglow, 0x45ff8a));
    underglow.material.opacity = 0.22 * appearance.underglowIntensity;
    if (underglowLight) underglowLight.color.setHex(colorValue(appearance.underglow, 0x45ff8a));
    arrangeLivery();
  }

  function setAppearance(nextAppearance) {
    appearance = normalizeCraftAppearance(nextAppearance);
    applyBaseAppearance();
  }

  function setVisualState(frame, presentation = null) {
    const terminal = frame.sessionState !== 'playing';
    if (frame.sessionState === 'won') {
      bodyMaterial.color.setHex(0x45ff8a);
      wingMaterial.color.setHex(0xffe66d);
      trail.material.color.setHex(0x45ff8a);
      trail.material.opacity = 0.5;
    } else if (terminal) {
      bodyMaterial.color.setHex(0xff2b4e);
      wingMaterial.color.setHex(0xff9f2d);
      trail.material.color.setHex(0xff2b4e);
      trail.material.opacity = 0.18;
    } else {
      applyBaseAppearance();
      trail.material.opacity = Math.max(0.22, Math.min(0.58, 0.24 + (frame.zVel ?? 0) * 2.2)) *
        (presentation.profile?.trailMultiplier ?? 1) *
        Math.max(0.7, appearance.underglowIntensity / 1.2);
    }
    const fade = presentation?.terminalFade ?? 1;
    for (const material of [bodyMaterial, wingMaterial, canopyMaterial]) {
      material.transparent = fade < 1;
      material.opacity = fade;
    }
    trail.material.opacity *= fade;
    underglow.material.opacity = terminal ? 0.06 * fade : 0.22 * appearance.underglowIntensity * fade;
    if (underglowLight) {
      underglowLight.intensity = terminal || presentation.reducedMotion
        ? 0.22
        : presentation.highContrast === true ? 0.82 : 0.58;
    }
    for (const material of [liveryMaterial, liverySecondaryMaterial]) {
      material.opacity = appearance.livery.opacity * fade;
    }
  }

  function setPresentationOptions(nextPresentation = {}) {
    presentation = nextPresentation;
    if (underglowLight) {
      underglowLight.intensity = presentation.highContrast === true ? 0.82 : 0.58;
      underglowLight.visible = presentation.qualityTier !== 'battery';
    }
  }

  function materialSnapshot() {
    return {
      body: hexString(bodyMaterial.color),
      emissive: hexString(bodyMaterial.emissive),
      wing: hexString(wingMaterial.color),
      canopy: hexString(canopyMaterial.color),
      underglow: hexString(underglow.material.color),
      trail: hexString(trail.material.color),
      underglowOpacity: underglow.material.opacity,
      underglowLight: underglowLight ? {
        visible: underglowLight.visible,
        intensity: underglowLight.intensity,
        distance: underglowLight.distance,
      } : null,
      livery: {
        pattern: appearance.livery.pattern,
        accent: hexString(liveryMaterial.color),
        secondary: hexString(liverySecondaryMaterial.color),
        opacity: liveryMaterial.opacity,
        visibleMeshes: liveryMeshes.filter((mesh) => mesh.visible).length,
      },
    };
  }

  function dispose() {
    group.removeFromParent();
    const disposedMaterials = new Set();
    for (const child of group.children) {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) {
        for (const material of child.material) {
          if (disposedMaterials.has(material)) continue;
          disposedMaterials.add(material);
          material.dispose?.();
        }
      } else {
        if (!disposedMaterials.has(child.material)) {
          disposedMaterials.add(child.material);
          child.material?.dispose?.();
        }
      }
    }
  }

  applyBaseAppearance();

  setPresentationOptions(presentation);

  return { group, setAppearance, setPresentationOptions, setVisualState, materialSnapshot, dispose };
}

function materialList(material) {
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

function applyGhostOpacity(group, opacity) {
  group.traverse((child) => {
    for (const material of materialList(child.material)) {
      const previousApplied = material.userData?.neondriftGhostAppliedOpacity;
      const baseOpacity = previousApplied != null && Math.abs(material.opacity - previousApplied) < 1e-9
        ? material.userData.neondriftGhostBaseOpacity
        : material.opacity;
      material.userData.neondriftGhostBaseOpacity = baseOpacity;
      material.transparent = true;
      material.depthWrite = false;
      material.opacity = baseOpacity * opacity;
      material.userData.neondriftGhostAppliedOpacity = material.opacity;
    }
  });
}

export function createGhostCraft(options = {}) {
  const ownerId = options.ownerId ?? 'ghost';
  const opacity = Number.isFinite(options.opacity) ? Math.max(0.12, Math.min(0.72, options.opacity)) : 0.38;
  const craft = createProceduralCraft({
    appearance: options.appearance,
    presentation: options.presentation,
    underglowLight: false,
  });
  craft.group.name = `ghost-craft-${ownerId}`;
  craft.group.userData = {
    role: 'ghost',
    ownerId,
    collision: 'none',
    nonColliding: true,
  };
  applyGhostOpacity(craft.group, opacity);
  return {
    group: craft.group,
    setAppearance(nextAppearance) {
      craft.setAppearance(nextAppearance);
      applyGhostOpacity(craft.group, opacity);
    },
    setPresentationOptions(nextPresentation) {
      craft.setPresentationOptions(nextPresentation);
      applyGhostOpacity(craft.group, opacity);
    },
    setVisualState(frame, presentation = null) {
      craft.setVisualState(frame, presentation);
      applyGhostOpacity(craft.group, opacity);
    },
    materialSnapshot: craft.materialSnapshot,
    dispose() {
      craft.dispose();
    },
  };
}

export function createNeonBackdrop(level, options = {}) {
  let presentation = options.presentation ?? {};
  const group = new THREE.Group();
  group.name = 'neon-backdrop';

  const grid = new THREE.GridHelper(900, 225, 0x1b0a33, 0x0b0715);
  grid.position.set(0, -0.13, -420);
  group.add(grid);

  const starCount = 260;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const lane = i % 26;
    const band = Math.floor(i / 26);
    positions[i * 3] = (lane - 12.5) * 3.8 + Math.sin(i * 17.1) * 0.8;
    positions[i * 3 + 1] = 8 + (band % 10) * 2.4 + Math.cos(i * 5.3) * 0.9;
    positions[i * 3 + 2] = -18 - (i * 13 % Math.max(80, level.length * TILE));
  }
  const starsGeometry = new THREE.BufferGeometry();
  starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const starsMaterial = new THREE.PointsMaterial({
    color: 0x9dfcff,
    size: 0.055,
    transparent: true,
    opacity: presentation.profile?.backdropOpacity ?? 0.72,
    depthWrite: false,
  });
  const stars = new THREE.Points(
    starsGeometry,
    starsMaterial
  );
  group.add(stars);

  const finish = new THREE.Mesh(
    new THREE.TorusGeometry(3.25, 0.08, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x45ff8a })
  );
  finish.name = 'finish-ring-vertical';
  finish.position.set(0, 2.15, -(level.length - 1) * TILE);
  group.add(finish);

  function setPresentationOptions(nextPresentation = {}) {
    presentation = nextPresentation;
    stars.visible = presentation.reducedMotion !== true && presentation.profile?.backdropStars !== false;
    stars.material.opacity = presentation.profile?.backdropOpacity ?? 0.72;
    finish.material.color.setHex(presentation.highContrast === true ? 0xffff9b : 0x45ff8a);
    grid.visible = presentation.qualityTier !== 'battery';
  }

  setPresentationOptions(presentation);

  function dispose() {
    grid.geometry.dispose();
    grid.material.dispose();
    stars.geometry.dispose();
    stars.material.dispose();
    finish.geometry.dispose();
    finish.material.dispose();
  }

  return { group, setPresentationOptions, dispose };
}
