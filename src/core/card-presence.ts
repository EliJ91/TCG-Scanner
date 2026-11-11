export type CardPresence = 'card' | 'empty' | 'uncertain' | 'clipped';

export const previewWidth = 160;
export const previewHeight = 120;
const columns = 10, rows = 8, tileWidth = previewWidth / columns, tileHeight = previewHeight / rows;
const corners = [0, columns - 1, (rows - 1) * columns, rows * columns - 1];
const edgeMargin = 4;
const edgeSampleWidth = 8;
const edges = [
  { start: 0, length: previewWidth, step: 1, inward: previewWidth },
  { start: (previewHeight - 1) * previewWidth, length: previewWidth, step: 1, inward: -previewWidth },
  { start: 0, length: previewHeight, step: previewWidth, inward: 1 },
  { start: previewWidth - 1, length: previewHeight, step: previewWidth, inward: -1 },
];

function localDetail(before: number, center: number, after: number) {
  const rise = center - before, fall = center - after;
  return rise * fall > 0 ? Math.min(Math.abs(rise), Math.abs(fall)) : 0;
}

function hasBlockedMargin(gray: Uint8Array, dark: number, light: number, surfaceDetail: number) {
  const contrast = Math.max(4, surfaceDetail * 1.5);
  const texture = Math.max(4, surfaceDetail + 2.5);
  for (const { start, length, step, inward } of edges) {
    for (let offset = 0; offset < length; offset += edgeSampleWidth) {
      const end = Math.min(length, offset + edgeSampleWidth);
      let sum = 0, detail = 0;
      for (let depth = 0; depth < edgeMargin; depth++) {
        for (let position = offset; position < end; position++) {
          const index = start + position * step + depth * inward;
          const value = gray[index];
          sum += value;
          if (position > 0 && position + 1 < length) detail += localDetail(gray[index - step], value, gray[index + step]);
        }
      }
      const samples = (end - offset) * edgeMargin;
      const mean = sum / samples;
      if (mean < dark - contrast || mean > light + contrast || detail / samples > texture) return true;
    }
  }
  return false;
}

/** Looks for printed detail spread across the center, against the surrounding surface.
 * Optionally checks that the preview has room around the card before allowing the shutter. */
export class CardPresenceDetector {
  private means = new Float32Array(columns * rows);
  private details = new Float32Array(columns * rows);

  detect(gray: Uint8Array, checkFraming = false): CardPresence {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        let sum = 0, detail = 0, samples = 0;
        for (let y = row * tileHeight + 2; y + 2 < (row + 1) * tileHeight; y += 2) {
          // Sample both column parities so a half-turn preserves the measurements.
          for (let x = col * tileWidth + 2; x + 2 < (col + 1) * tileWidth; x++) {
            const index = y * previewWidth + x, value = gray[index];
            sum += value;
            detail += localDetail(gray[index - 2], value, gray[index + 2]);
            detail += localDetail(gray[index - 2 * previewWidth], value, gray[index + 2 * previewWidth]);
            samples++;
          }
        }
        this.means[row * columns + col] = sum / samples;
        this.details[row * columns + col] = detail / (samples * 2);
      }
    }

    let dark = 255, light = 0, surfaceDetail = 0;
    for (const index of corners) {
      dark = Math.min(dark, this.means[index]);
      light = Math.max(light, this.means[index]);
      surfaceDetail += this.details[index] / 4;
    }
    let different = 0, textured = 0, firstRow = -1, firstCol = -1;
    let variedRows = false, variedCols = false;
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 2; col < columns - 2; col++) {
        const index = row * columns + col, mean = this.means[index], detail = this.details[index];
        const printed = detail > Math.max(3.5, surfaceDetail + 2.5);
        if (printed || mean < dark - 18 || mean > light + 18) different++;
        if (!printed) continue;
        if (textured === 0) { firstRow = row; firstCol = col; }
        variedRows ||= row !== firstRow;
        variedCols ||= col !== firstCol;
        textured++;
      }
    }
    if (checkFraming && (different > 1 || surfaceDetail > 3.5)) {
      // Use the middle corner samples so one corner occupied by the card does not mask clipping.
      const cornerMeans = corners.map(index => this.means[index]).sort((a, b) => a - b);
      if (hasBlockedMargin(gray, cornerMeans[1], cornerMeans[2], surfaceDetail)) return 'clipped';
    }
    if (different >= 6 && textured >= 4 && variedRows && variedCols) return 'card';
    if (different <= 1) return 'empty';
    return 'uncertain';
  }
}
