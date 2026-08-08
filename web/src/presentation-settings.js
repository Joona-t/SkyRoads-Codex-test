export const QUALITY_TIER = Object.freeze({
  DESKTOP: 'desktop',
  BALANCED: 'balanced',
  BATTERY: 'battery',
});

export const QUALITY_PROFILES = Object.freeze({
  [QUALITY_TIER.DESKTOP]: Object.freeze({
    label: 'Desktop',
    renderScaleMax: 1,
    backdropStars: true,
    backdropOpacity: 0.72,
    trailMultiplier: 1,
    railIntensity: 1,
    bloom: false,
  }),
  [QUALITY_TIER.BALANCED]: Object.freeze({
    label: 'Balanced',
    renderScaleMax: 0.85,
    backdropStars: true,
    backdropOpacity: 0.46,
    trailMultiplier: 0.82,
    railIntensity: 0.9,
    bloom: false,
  }),
  [QUALITY_TIER.BATTERY]: Object.freeze({
    label: 'Battery',
    renderScaleMax: 0.65,
    backdropStars: false,
    backdropOpacity: 0,
    trailMultiplier: 0.58,
    railIntensity: 0.78,
    bloom: false,
  }),
});

export const DEFAULT_PRESENTATION_SETTINGS = Object.freeze({
  reducedMotionForce: false,
  highContrast: false,
  renderScale: 1,
  qualityTier: QUALITY_TIER.DESKTOP,
});

export function clampRenderScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_PRESENTATION_SETTINGS.renderScale;
  return Math.max(0.5, Math.min(1, number));
}

export function normalizeQualityTier(tier) {
  return Object.hasOwn(QUALITY_PROFILES, tier) ? tier : QUALITY_TIER.DESKTOP;
}

export function qualityProfile(tier) {
  return QUALITY_PROFILES[normalizeQualityTier(tier)];
}

export function normalizePresentationSettings(input = {}) {
  return Object.freeze({
    reducedMotionForce: input?.reducedMotionForce === true,
    highContrast: input?.highContrast === true,
    renderScale: clampRenderScale(input?.renderScale),
    qualityTier: normalizeQualityTier(input?.qualityTier),
  });
}

export function prefersReducedMotion(matchMedia = globalThis.matchMedia) {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch (_error) {
    return false;
  }
}

export function effectivePresentationSettings(input = {}, env = {}) {
  const settings = normalizePresentationSettings(input);
  const profile = qualityProfile(settings.qualityTier);
  const osReducedMotion = env.prefersReducedMotion ?? prefersReducedMotion(env.matchMedia);
  const reducedMotion = settings.reducedMotionForce || osReducedMotion === true;
  const effectiveRenderScale = clampRenderScale(Math.min(settings.renderScale, profile.renderScaleMax));
  return Object.freeze({
    ...settings,
    osReducedMotion: osReducedMotion === true,
    reducedMotion,
    effectiveRenderScale,
    profile,
    postprocessing: 'none',
    bloom: false,
  });
}

export function applyDocumentPresentationState(root, effective) {
  if (!root) return null;
  root.dataset.reducedMotion = String(effective.reducedMotion);
  root.dataset.highContrast = String(effective.highContrast);
  root.dataset.qualityTier = effective.qualityTier;
  root.style?.setProperty?.('--render-scale', String(effective.effectiveRenderScale));
  return {
    reducedMotion: root.dataset.reducedMotion,
    highContrast: root.dataset.highContrast,
    qualityTier: root.dataset.qualityTier,
    renderScale: effective.effectiveRenderScale,
  };
}

export function applyRendererPresentation(renderer, effective, dpr = globalThis.devicePixelRatio || 1) {
  const pixelRatio = Math.max(0.5, Math.min(2, dpr)) * effective.effectiveRenderScale;
  renderer?.setPixelRatio?.(pixelRatio);
  return {
    pixelRatio,
    renderScale: effective.effectiveRenderScale,
    qualityTier: effective.qualityTier,
    highContrast: effective.highContrast,
    reducedMotion: effective.reducedMotion,
    postprocessing: effective.postprocessing,
    bloom: effective.bloom,
  };
}
