import * as THREE from 'three';
import { loadRequestedLevel } from './loader.js';
import { TILE, buildLevelScene, addBaselineLighting } from './scene.js';

const canvas = document.getElementById('c');
const hud = document.getElementById('hud');
const errorBox = document.getElementById('err');

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function createFrameProbe(renderer, base) {
  const warmupFrames = 60;
  const sampleFrames = 600;
  const samples = new Float64Array(sampleFrames);
  let previous = 0;
  let frame = 0;
  let sample = 0;

  return function probe(now) {
    if (previous !== 0) {
      const delta = now - previous;
      if (frame >= warmupFrames && sample < sampleFrames) samples[sample++] = delta;
    }
    previous = now;
    frame++;
    if (sample !== sampleFrames) return null;

    const sorted = Array.from(samples).sort((a, b) => a - b);
    const total = samples.reduce((sum, value) => sum + value, 0);
    const metrics = {
      ...base,
      frames: sampleFrames,
      meanFps: 1000 / (total / sampleFrames),
      p95FrameMs: percentile(sorted, 0.95),
      worstFrameMs: sorted[sorted.length - 1],
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      points: renderer.info.render.points,
      lines: renderer.info.render.lines,
    };
    window.__NEONDRIFT_METRICS__ = metrics;
    return metrics;
  };
}

function setHud(level, sceneMetrics, runtimeMetrics) {
  const counts = sceneMetrics.counts;
  const perf = runtimeMetrics
    ? `\n${runtimeMetrics.meanFps.toFixed(1)} FPS  p95 ${runtimeMetrics.p95FrameMs.toFixed(2)}ms  worst ${runtimeMetrics.worstFrameMs.toFixed(2)}ms`
    : '\nprofiling 600 frames…';
  hud.textContent =
    `NEONDRIFT // ${level.name} [${level.roadIndex}]\n` +
    `${sceneMetrics.chunks} chunks  ${sceneMetrics.drawables} drawables  ${sceneMetrics.totalInstances} instances\n` +
    `flat ${counts.flat}  short ${counts.short}  tall ${counts.tall}  tunnel ${counts.tunnel}` + perf;
}

async function boot() {
  const loadStarted = performance.now();
  const { level } = await loadRequestedLevel();
  const loadMs = performance.now() - loadStarted;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05010d);
  scene.fog = new THREE.FogExp2(0x120622, 0.012);
  addBaselineLighting(scene);

  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, Math.max(900, level.length * TILE + 100));
  const startX = (level.start.x - level.constants.levelCenterX) * (TILE / level.constants.tileStrideX);
  camera.position.set(startX, 6.5, 13);
  camera.lookAt(startX, 1.1, -32);

  const built = buildLevelScene(level);
  scene.add(built.group);

  // A sparse grid gives depth cues without adding per-row objects.
  const grid = new THREE.GridHelper(900, 225, 0x2a0b55, 0x130725);
  grid.position.set(0, -0.13, -420);
  scene.add(grid);

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const pixelWidth = Math.floor(width * renderer.getPixelRatio());
    const pixelHeight = Math.floor(height * renderer.getPixelRatio());
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  const baseMetrics = {
    level: level.roadIndex,
    loadMs,
    ...built.metrics,
  };
  const probe = createFrameProbe(renderer, baseMetrics);
  let complete = false;
  setHud(level, built.metrics, null);

  renderer.setAnimationLoop((now) => {
    resize();
    renderer.render(scene, camera);
    if (!complete) {
      const metrics = probe(now);
      if (metrics) {
        complete = true;
        setHud(level, built.metrics, metrics);
        console.info('NEONDRIFT_METRICS', metrics);
      }
    }
  });

  window.__NEONDRIFT__ = {
    level,
    sceneMetrics: built.metrics,
    renderer,
    camera,
    dispose() {
      renderer.setAnimationLoop(null);
      built.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
      renderer.dispose();
    },
  };
}

boot().catch((error) => {
  console.error(error);
  errorBox.textContent = `BOOT FAILED\n${error?.stack || error}`;
  hud.textContent = 'NEONDRIFT // OFFLINE';
});
