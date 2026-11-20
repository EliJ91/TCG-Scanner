/** Estimate focus settling from preview sharpness and reported lens movement. */
export class FocusDetector {
  private previousSharpness?: number;
  private previousDistance?: number;
  private peakSharpness = 0;
  private settledFrames = 0;

  reset() {
    this.previousSharpness = this.previousDistance = undefined;
    this.peakSharpness = this.settledFrames = 0;
  }

  update(gray: Uint8Array, width: number, freshFrame: boolean, distance?: number) {
    const height = gray.length / width;
    let detail = 0, sum = 0, squares = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        const value = gray[index];
        sum += value;
        squares += value * value;
        const laplacian = 4 * value - gray[index - 1] - gray[index + 1] - gray[index - width] - gray[index + width];
        detail += laplacian * laplacian;
      }
    }
    const samples = (width - 2) * (height - 2);
    // Normalize contrast so automatic exposure changes do not look like focus changes.
    const sharpness = detail / Math.max(1, squares - sum * sum / samples);
    const sharpnessSettled = this.previousSharpness !== undefined
      && Math.abs(sharpness - this.previousSharpness) <= Math.max(0.001, sharpness * 0.03);
    const lensMoving = distance !== undefined && this.previousDistance !== undefined
      && Math.abs(distance - this.previousDistance) > 0.0001;
    if (!sharpnessSettled || lensMoving) this.settledFrames = 0;
    else if (freshFrame) this.settledFrames++;
    this.previousSharpness = sharpness;
    this.previousDistance = distance;
    this.peakSharpness = Math.max(this.peakSharpness, sharpness);
    // Stable blur must not count as focus, including a drop after a sharper frame.
    return this.settledFrames > 0 && detail / samples >= 36 && sharpness >= 0.036 && sharpness >= this.peakSharpness * 0.85;
  }
}
