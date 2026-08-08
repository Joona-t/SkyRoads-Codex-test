export const EFFECT_COLOR_RGB = Object.freeze({
  accelerate: Object.freeze([0, 255, 163]),
  decelerate: Object.freeze([255, 159, 45]),
  kill: Object.freeze([255, 43, 78]),
  slide: Object.freeze([157, 75, 255]),
  refillOxygen: Object.freeze([22, 240, 230]),
});

export const ROAD_MIX_RGB = Object.freeze([118, 246, 255]);

export function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function rgbToHex(rgb) {
  return rgb.reduce((hex, channel) => (hex << 8) | Math.max(0, Math.min(255, channel)), 0);
}

export function surfaceColorRgb(cell, palette, surface) {
  const effect = surface === 'tile' ? cell.tileEffect : cell.cubeEffect;
  const effectColor = EFFECT_COLOR_RGB[effect];
  if (effectColor) return [...effectColor];

  const index = surface === 'tile' ? cell.tileColor : cell.cubeColor;
  const rgb = palette[index] ?? [120, 136, 160];
  if (surface === 'cube') {
    return rgb.map((channel) => Math.max(18, Math.min(255, channel + 12)));
  }

  const luminance = relativeLuminance(rgb);
  const mix = luminance < 0.22 ? 0.52 : 0.28;
  return rgb.map((channel, index) =>
    Math.round(channel * (1 - mix) + ROAD_MIX_RGB[index] * mix)
  );
}
