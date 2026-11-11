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

export function obstructedFrame() {
  const frame = emptyFrame();
  for (let y = 18; y < 102; y++) frame.fill(120 + Math.round(y / 4), y * previewWidth + 40, y * previewWidth + 120);
  return frame;
}

export function printedCard(seed = 0, background = 248, border = 241, bounds = { left: 50, top: 24, right: 110, bottom: 96 }) {
  const { left, top, right, bottom } = bounds;
  const frame = emptyFrame(background);
  for (let y = Math.max(0, top); y < Math.min(previewHeight, bottom); y++) {
    for (let x = Math.max(0, left); x < Math.min(previewWidth, right); x++) {
      const artwork = x >= left + 3 && x < right - 3 && y >= top + 4 && y < bottom - 4;
      frame[y * previewWidth + x] = artwork ? 25 + (x * 23 + y * 17 + seed * 37) % 163 : border;
    }
  }
  return frame;
}
