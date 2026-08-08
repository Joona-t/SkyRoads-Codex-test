import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { relativeLuminance } from '../src/course-colors.js';
import {
  INPUT_ACTION,
  InputController,
  bindKeyCode,
  createInputController,
  keyLabel,
  normalizeKeyBindings,
} from '../src/input.js';
import { validateSaveObject } from '../src/save.js';
import {
  QUALITY_TIER,
  applyDocumentPresentationState,
  effectivePresentationSettings,
} from '../src/presentation-settings.js';

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(hexToRgb(foreground));
  const b = relativeLuminance(hexToRgb(background));
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function fakeKey(code, key = code, repeat = false) {
  return {
    code,
    key,
    repeat,
    prevented: 0,
    stopped: 0,
    preventDefault() {
      this.prevented += 1;
    },
    stopPropagation() {
      this.stopped += 1;
    },
  };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('VAL-ACCESS-001 saved accessibility settings clamp and include keyboard bindings', () => {
  const { save } = validateSaveObject({
    v: 1,
    settings: {
      reducedMotionForce: true,
      highContrast: true,
      renderScale: 8,
      qualityTier: QUALITY_TIER.BATTERY,
      keyBindings: {
        [INPUT_ACTION.LEFT]: ['KeyJ'],
        [INPUT_ACTION.RESTART]: [],
      },
    },
  });
  assert.equal(save.settings.reducedMotionForce, true);
  assert.equal(save.settings.highContrast, true);
  assert.equal(save.settings.renderScale, 1);
  assert.equal(save.settings.qualityTier, QUALITY_TIER.BATTERY);
  assert.deepEqual(save.settings.keyBindings.left.slice(0, 3), ['KeyJ', 'ArrowLeft', 'KeyA']);
  assert.ok(save.settings.keyBindings.restart.includes('KeyR'));
  assert.ok(save.settings.keyBindings.restart.includes('Enter'));
});

test('VAL-ACCESS-001 keyboard remaps are additive and recovery bindings remain live', () => {
  const bindings = normalizeKeyBindings({
    [INPUT_ACTION.LEFT]: ['KeyJ'],
    [INPUT_ACTION.ACCELERATE]: ['KeyI'],
    [INPUT_ACTION.RESTART]: ['KeyX'],
  });
  const input = new InputController({ keyBindings: bindings });
  input.handleKeyDown(fakeKey('KeyJ', 'j'));
  assert.deepEqual(input.snapshot(), { turn: -1, accel: 0, jump: false });
  input.clear();
  input.handleKeyDown(fakeKey('KeyA', 'a'));
  assert.deepEqual(input.snapshot(), { turn: -1, accel: 0, jump: false });
  input.clear();
  input.handleKeyDown(fakeKey('KeyI', 'i'));
  assert.equal(input.snapshot().accel, 1);
  input.clear();
  input.handleKeyDown(fakeKey('KeyX', 'x'));
  assert.equal(input.consumeRestartRequested(), true);
  input.handleKeyUp(fakeKey('KeyX', 'x'));
  input.handleKeyDown(fakeKey('Enter'));
  assert.equal(input.consumeRestartRequested(), true);

  const rebound = bindKeyCode(bindings, INPUT_ACTION.LEFT, 'KeyD');
  const conflictInput = new InputController({ keyBindings: rebound });
  conflictInput.handleKeyDown(fakeKey('KeyD', 'd'));
  assert.equal(conflictInput.snapshot().turn, -1);
  conflictInput.clear();
  conflictInput.handleKeyDown(fakeKey('ArrowRight'));
  assert.equal(conflictInput.snapshot().turn, 1);
  assert.equal(keyLabel('KeyD'), 'D');
});

test('VAL-ACCESS-001 input factory honors persisted key bindings at boot', () => {
  const input = createInputController({
    keyBindings: {
      [INPUT_ACTION.PAUSE]: ['KeyO'],
    },
  });
  input.handleKeyDown(fakeKey('KeyO', 'o'));
  assert.equal(input.consumePauseRequested(), true);
  input.handleKeyUp(fakeKey('KeyO', 'o'));
  input.handleKeyDown(fakeKey('Escape'));
  assert.equal(input.consumePauseRequested(), true);
});

test('VAL-ACCESS-001 presentation settings honor OS reduced motion and quality render scale ceilings', () => {
  const effective = effectivePresentationSettings({
    reducedMotionForce: false,
    highContrast: true,
    renderScale: 1,
    qualityTier: QUALITY_TIER.BATTERY,
  }, { prefersReducedMotion: true });
  assert.equal(effective.reducedMotion, true);
  assert.equal(effective.highContrast, true);
  assert.equal(effective.effectiveRenderScale, 0.65);
  assert.equal(effective.bloom, false);

  const root = {
    dataset: {},
    style: {
      values: {},
      setProperty(name, value) {
        this.values[name] = value;
      },
    },
  };
  const applied = applyDocumentPresentationState(root, effective);
  assert.deepEqual(applied, {
    reducedMotion: 'true',
    highContrast: 'true',
    qualityTier: QUALITY_TIER.BATTERY,
    renderScale: 0.65,
  });
});

test('VAL-ACCESS-001 HTML exposes semantic screens, labeled controls, and safe touch layout', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const phrase of [
    'aria-labelledby="title-heading"',
    'aria-labelledby="world-map-heading"',
    'aria-labelledby="garage-heading"',
    'aria-labelledby="settings-heading"',
    'role="list" aria-label="Starter Cup route list"',
    'role="list" aria-label="Keyboard bindings"',
    'aria-label="Race controls"',
    'id="access-reduced-motion"',
    'id="access-high-contrast"',
    'id="render-scale" type="range" min="0.5" max="1"',
    'id="quality-tier"',
    'html[data-reduced-motion="true"]',
    'html[data-high-contrast="true"]',
    '#controls{ position:fixed; right:18px; bottom:16px;',
    '#minimap-wrap{ left:10px; bottom:172px;',
    '.screen-panel{ width:min(960px,calc(100vw - 32px)); max-width:100%; min-width:0; }',
    '.route-grid{ display:grid; grid-template-columns:minmax(220px,320px) minmax(0,1fr);',
    '.settings-columns{ display:grid; grid-template-columns:repeat(auto-fit,minmax(360px,1fr));',
    '.settings-panel{ border:1px solid var(--line); border-radius:8px; padding:14px; background:rgba(5,20,32,.72); min-width:0; }',
    '.keybind-row{ display:grid; grid-template-columns:minmax(84px,.9fr) minmax(96px,1.1fr) minmax(76px,auto);',
    '.keybind-row button{ justify-self:stretch; min-width:76px; }',
  ]) {
    assert.ok(html.includes(phrase), `missing ${phrase}`);
  }
  assert.equal(html.includes('left:50%; bottom:14px; transform:translateX(-50%)'), false);

  const keybindMinimumWidth = 84 + 96 + 76 + 10 + 10 + 8 + 8;
  const settingsPanelHorizontalTrim = 14 + 14 + 1 + 1;
  const desktopSettingsTrack = (Math.min(960, 1280 - 32) - 16) / 2;
  // The failing in-app screenshot had roughly this much usable shell width.
  const capturedInAppTrack = (Math.min(960, 806 - 32) - 16) / 2;
  assert.ok(desktopSettingsTrack - settingsPanelHorizontalTrim >= keybindMinimumWidth, '1280px settings keyboard track clips controls');
  assert.ok(capturedInAppTrack - settingsPanelHorizontalTrim >= keybindMinimumWidth, 'captured in-app settings keyboard track clips controls');
  assert.ok(html.includes('@media (max-width:720px){') && html.includes('.keybind-row{ grid-template-columns:1fr; }'));

  const buttonTags = html.match(/<button\b[\s\S]*?<\/button>/g) ?? [];
  assert.ok(buttonTags.length > 0);
  for (const tag of buttonTags) {
    assert.ok(/aria-label=|title=|>\s*[^<\s]/.test(tag), `unlabeled button: ${tag}`);
  }
});

test('VAL-ACCESS-001 source wires reduced-motion media query, settings handlers, and read-only hooks', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const phrase of [
    'prefers-reduced-motion: reduce',
    'handlePresentationSettingInput',
    'capturePendingRemap',
    'data-remap-action',
    "Object.defineProperty(window, '__NEONDRIFT__'",
    "Object.defineProperty(window, '__NEONDRIFT_PERF__'",
    'writable: false',
    'configurable: false',
  ]) {
    assert.ok(main.includes(phrase), `missing ${phrase}`);
  }
});

test('VAL-ACCESS-001 representative text and UI colors meet AA contrast floors', () => {
  const pairs = [
    ['#eafcff', '#071222', 4.5, 'button text'],
    ['#cdeff4', '#051420', 4.5, 'panel copy'],
    ['#ffe66d', '#05010d', 4.5, 'setting value'],
    ['#9ecbd3', '#05010d', 4.5, 'muted status'],
    ['#eafcff', '#05010d', 4.5, 'HUD text'],
    ['#ffe66d', '#05010d', 3, 'large heading/accent'],
  ];
  for (const [foreground, background, minimum, label] of pairs) {
    assert.ok(contrastRatio(foreground, background) >= minimum, `${label} contrast`);
  }
});

let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

console.log(JSON.stringify({ tests: passed, target: 'VAL-ACCESS-001' }, null, 2));
