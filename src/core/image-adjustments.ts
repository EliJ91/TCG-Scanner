export interface ImageAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
}

export const imageAdjustmentDefaults: ImageAdjustments = { brightness: 100, contrast: 100, saturation: 100, gamma: 1 };
export const imageAdjustmentControls = [
  { key: 'brightness', label: 'Brightness', min: 50, max: 150, step: 1, unit: '%', hint: 'Make the image lighter or darker.' },
  { key: 'contrast', label: 'Contrast', min: 50, max: 150, step: 1, unit: '%', hint: 'Adjust the difference between light and dark areas.' },
  { key: 'saturation', label: 'Saturation', min: 50, max: 150, step: 1, unit: '%', hint: 'Adjust how strong the colors look.' },
  { key: 'gamma', label: 'Gamma', min: 0.5, max: 2, step: 0.01, unit: '', hint: 'Higher values brighten the middle tones; lower values darken them.' },
] as const;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export function normalizeImageAdjustments(value: Partial<ImageAdjustments> = {}): ImageAdjustments {
  const next = { ...imageAdjustmentDefaults };
  for (const control of imageAdjustmentControls) {
    const v = value[control.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const scale = control.key === 'gamma' ? 100 : 1;
      next[control.key] = Math.round(Math.max(control.min, Math.min(control.max, v)) * scale) / scale;
    }
  }
  return next;
}
export const neutralAdjustments = (a: ImageAdjustments) => a.brightness === 100 && a.contrast === 100 && a.saturation === 100 && a.gamma === 1;

// These coefficients are shared with the SVG preview's color matrix. All
// operations use sRGB channel values, with clipping after each operation.
export const luminance = [0.2126, 0.7152, 0.0722] as const;
export function saturationMatrix(saturation: number) {
  const s = saturation / 100, rest = 1 - s;
  return [
    luminance[0] * rest + s, luminance[1] * rest, luminance[2] * rest, 0, 0,
    luminance[0] * rest, luminance[1] * rest + s, luminance[2] * rest, 0, 0,
    luminance[0] * rest, luminance[1] * rest, luminance[2] * rest + s, 0, 0,
    0, 0, 0, 1, 0,
  ].join(' ');
}

/** One pass over the final crop. Lookup tables avoid per-pixel exponentiation. */
export function pixelAdjustment(a: ImageAdjustments): (pixels: Uint8ClampedArray) => void {
  if (neutralAdjustments(a)) return () => {};
  const b = a.brightness / 100, c = a.contrast / 100, s = a.saturation / 100;
  const tone = new Float64Array(256);
  const power = 1 / a.gamma;
  for (let i = 0; i < 256; i++) tone[i] = clamp((clamp(i / 255 * b) - 0.5) * c + 0.5);
  if (s === 1) {
    const table = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) table[i] = Math.round(Math.pow(tone[i], power) * 255);
    return pixels => { for (let i = 0; i < pixels.length; i += 4) { pixels[i] = table[pixels[i]]; pixels[i + 1] = table[pixels[i + 1]]; pixels[i + 2] = table[pixels[i + 2]]; } };
  }
  const gamma = a.gamma === 1 ? undefined : new Uint8ClampedArray(65536);
  if (gamma) for (let i = 0; i < gamma.length; i++) gamma[i] = Math.round(Math.pow(i / 65535, power) * 255);
  const channel = gamma ? (v: number) => gamma[Math.round(clamp(v) * 65535)] : (v: number) => Math.round(clamp(v) * 255);
  return pixels => {
    for (let i = 0; i < pixels.length; i += 4) {
      const r = tone[pixels[i]], g = tone[pixels[i + 1]], b = tone[pixels[i + 2]];
      const gray = r * luminance[0] + g * luminance[1] + b * luminance[2];
      pixels[i] = channel(gray + (r - gray) * s);
      pixels[i + 1] = channel(gray + (g - gray) * s);
      pixels[i + 2] = channel(gray + (b - gray) * s);
    }
  };
}
