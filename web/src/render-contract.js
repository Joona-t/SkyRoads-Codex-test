import { relativeLuminance } from './course-colors.js';

export const LIGHT_BUDGET = Object.freeze({
  hemisphere: 1,
  directional: 1,
  craftUnderglow: 1,
  perTile: 0,
});

export const VISUAL_THRESHOLDS = Object.freeze({
  roadVoidMedianRatio: 3,
  desktopCraftWidthViewportRatio: 0.06,
  firstRoadMinLuminance: 0.15,
});

export const MATERIAL_ROLE = Object.freeze({
  ROAD: 'road',
  GAP_BOUNDARY: 'gap-boundary',
  OBSTACLE: 'obstacle',
  EFFECT_PAD: 'effect-pad',
  CRAFT: 'craft',
  GHOST: 'ghost',
  FINISH: 'finish',
});

export function luminanceRatio(foregroundRgb, backgroundRgb) {
  return (relativeLuminance(foregroundRgb) + 0.001) / (relativeLuminance(backgroundRgb) + 0.001);
}

export function materialReadabilityPlan(options = {}) {
  return Object.freeze({
    highContrast: options.highContrast === true,
    roles: Object.values(MATERIAL_ROLE),
    nonColorCues: Object.freeze([
      'guide-rails',
      'hazard-rims',
      'effect-bars',
      'finish-ring',
      'ghost-translucency',
      'preview-minimap-classes',
    ]),
    lightBudget: LIGHT_BUDGET,
    thresholds: VISUAL_THRESHOLDS,
  });
}
