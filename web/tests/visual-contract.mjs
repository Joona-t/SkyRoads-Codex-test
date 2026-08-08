import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { relativeLuminance, surfaceColorRgb } from '../src/course-colors.js';
import { STARTER_COURSE_IDS, createStarterCupCourses } from '../src/starter-cup.js';
import { createCoursePreview, COURSE_CLASS } from '../src/preview.js';
import { initialRaceVisibilityMetrics } from '../src/visibility.js';
import {
  LIGHT_BUDGET,
  VISUAL_THRESHOLDS,
  luminanceRatio,
  materialReadabilityPlan,
} from '../src/render-contract.js';
import { QUALITY_PROFILES } from '../src/presentation-settings.js';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('VAL-VISUAL-001 all Starter Cup courses expose semantic non-color preview/minimap classes', () => {
  let gapBoundaryCourses = 0;
  for (const level of createStarterCupCourses()) {
    const preview = createCoursePreview(level);
    for (const courseClass of [
      COURSE_CLASS.ROAD,
      COURSE_CLASS.OBSTACLE,
      COURSE_CLASS.EFFECT_PAD,
      COURSE_CLASS.FINISH,
      COURSE_CLASS.PLAYER,
    ]) {
      assert.ok(preview.classes[courseClass] > 0, `${level.roadIndex} missing ${courseClass}`);
    }
    if (preview.classes[COURSE_CLASS.GAP_BOUNDARY] > 0) gapBoundaryCourses += 1;
    assert.ok(preview.minRoadLuminance >= VISUAL_THRESHOLDS.firstRoadMinLuminance, level.roadIndex);
    assert.ok(level.visualHints.guideRails.length > 0, `${level.roadIndex} missing guide rails`);
    assert.ok(level.visualHints.hazardRims.length > 0, `${level.roadIndex} missing hazard rims`);
    assert.ok(level.visualHints.effectCueRows.length > 0, `${level.roadIndex} missing effect cue rows`);
  }
  assert.ok(gapBoundaryCourses >= 1, 'Starter Cup needs at least one explicit hole/gap-boundary course');
});

test('VAL-VISUAL-001 initial frustum and road luminance are readable on desktop and narrow viewports', () => {
  for (const level of createStarterCupCourses()) {
    for (const aspect of [1474 / 695, 390 / 844]) {
      const metrics = initialRaceVisibilityMetrics(level, { aspect });
      assert.equal(metrics.firstChunkIntersectsFrustum, true, `${level.roadIndex} aspect ${aspect}`);
      assert.ok(metrics.visibleFirstRoadInstances > 0, `${level.roadIndex} aspect ${aspect}`);
      assert.ok(metrics.minFirstRoadLuminance >= VISUAL_THRESHOLDS.firstRoadMinLuminance, level.roadIndex);
    }
  }
});

test('VAL-VISUAL-001 road-to-void luminance structure exceeds the mask threshold without relying on hue', () => {
  const voidRgb = [5, 1, 13];
  for (const level of createStarterCupCourses()) {
    const roadLuminance = [];
    for (let row = 0; row < Math.min(level.length, 20); row++) {
      for (const cell of level.cells[row]) {
        if (cell.tile) roadLuminance.push(relativeLuminance(surfaceColorRgb(cell, level.palette, 'tile')));
      }
    }
    const sorted = roadLuminance.sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const ratio = (median + 0.001) / (relativeLuminance(voidRgb) + 0.001);
    assert.ok(ratio >= VISUAL_THRESHOLDS.roadVoidMedianRatio, `${level.roadIndex} ratio ${ratio}`);
  }
  assert.ok(luminanceRatio([118, 246, 255], voidRgb) >= VISUAL_THRESHOLDS.roadVoidMedianRatio);
});

test('VAL-VISUAL-001 renderer source uses the bounded light/material plan and no per-tile lights', async () => {
  const sceneSource = await readFile(new URL('../src/scene.js', import.meta.url), 'utf8');
  assert.ok(sceneSource.includes('neondrift-hemisphere-light'));
  assert.ok(sceneSource.includes('neondrift-directional-key-light'));
  assert.ok(sceneSource.includes('craft-underglow-light'));
  assert.equal((sceneSource.match(/new THREE\.PointLight/g) ?? []).length, LIGHT_BUDGET.craftUnderglow);
  assert.equal((sceneSource.match(/new THREE\.HemisphereLight/g) ?? []).length, LIGHT_BUDGET.hemisphere);
  assert.equal((sceneSource.match(/new THREE\.DirectionalLight/g) ?? []).length, LIGHT_BUDGET.directional);
  assert.ok(sceneSource.includes('tutorial-hazard-rim'));
  assert.ok(sceneSource.includes('tutorial-effect-shape-cues'));
  assert.ok(sceneSource.includes('finish-ring-vertical'));
  const levelSceneBlock = sceneSource.slice(
    sceneSource.indexOf('export function buildLevelScene'),
    sceneSource.indexOf('function edgeX')
  );
  assert.equal(/new THREE\.(?:Point|Spot|Directional|Hemisphere)Light/.test(levelSceneBlock), false);
});

test('VAL-VISUAL-001 quality tiers are bounded and postprocessing is removable', async () => {
  for (const [tier, profile] of Object.entries(QUALITY_PROFILES)) {
    assert.ok(profile.renderScaleMax >= 0.5 && profile.renderScaleMax <= 1, tier);
    assert.equal(profile.bloom, false, tier);
  }
  const plan = materialReadabilityPlan({ highContrast: true });
  assert.deepEqual(plan.lightBudget, LIGHT_BUDGET);
  assert.ok(plan.nonColorCues.includes('hazard-rims'));
  assert.ok(plan.nonColorCues.includes('effect-bars'));

  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.equal(/UnrealBloomPass|EffectComposer|RenderPass|ShaderPass/.test(mainSource), false);
  assert.ok(mainSource.includes('applyRendererPresentation'));
});

test('VAL-VISUAL-001 benchmark visual fixture is the manifest Ion Gauntlet course', () => {
  assert.equal(STARTER_COURSE_IDS.JUMP_EFFECT, 'starter-ion-gauntlet');
});

test('VAL-VISUAL-001 luminance mask procedure documents desktop masks and exclusion checks', async () => {
  const procedure = await readFile(new URL('../../docs/neondrift-luminance-mask-procedure.md', import.meta.url), 'utf8');
  for (const phrase of [
    '1474x695',
    'road-top-near',
    'road-top-mid',
    'adjacent-void',
    'craft',
    'hazard',
    'ui',
    '>= 3.0',
  ]) {
    assert.ok(procedure.includes(phrase), `missing ${phrase}`);
  }
});

let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

console.log(JSON.stringify({ tests: passed, target: 'VAL-VISUAL-001' }, null, 2));
