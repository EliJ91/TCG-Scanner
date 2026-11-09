import { previewHeight, previewWidth } from '../src/core/card-presence';

export function emptyFrame(level = 248) {
  return new Uint8Array(previewWidth * previewHeight).fill(level);
}

export function shadowedSurface() {
  const frame = emptyFrame(240);
  for (let y = 26; y < 94; y++) {
    const falloff = Math.min(1, (y - 26) / 5, (94 - y) / 5);
    for (let x = 46; x <= 54; x++) {
      frame[y * previewWidth + x] = Math.round(240 - 75 * (1 - Math.abs(x - 50) / 4) * falloff);
    }
  }
  return frame;
}

export function printedCard(seed = 0, background = 248, border = 241) {
  const frame = emptyFrame(background);
  for (let y = 24; y < 96; y++) {
    for (let x = 50; x < 110; x++) {
      const artwork = x >= 53 && x < 107 && y >= 28 && y < 92;
      frame[y * previewWidth + x] = artwork ? 25 + (x * 23 + y * 17 + seed * 37) % 163 : border;
    }
  }
  return frame;
}
