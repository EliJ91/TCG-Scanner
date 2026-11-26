/** Prevent the starting scene from counting as a newly placed card. */
export class FirstPlacementGuard {
  waiting = true;
  private reference?: Float32Array;
  private startedAt?: number;
  private emptyFrames = 0;

  start(now: number) { return this.startedAt ??= now; }
  reset() { this.waiting = true; this.reference = undefined; this.startedAt = undefined; this.emptyFrames = 0; }

  changed(pattern: Float32Array, calibrating = false, emptyFrame = false) {
    if (!this.waiting) return true;
    if (calibrating || !this.reference || this.reference.length !== pattern.length) {
      if (!this.reference || this.reference.length !== pattern.length) this.reference = new Float32Array(pattern.length);
      this.reference.set(pattern);
      this.emptyFrames = 0;
      return false;
    }
    this.emptyFrames = emptyFrame ? this.emptyFrames + 1 : 0;
    if (this.emptyFrames >= 2) {
      // A card present before Start can be lifted and replaced in the same spot.
      this.reference.set(pattern);
      return false;
    }
    const reference = this.reference;
    let mean = 0, referenceMean = 0;
    for (let i = 0; i < pattern.length; i++) { mean += pattern[i]; referenceMean += reference[i]; }
    mean /= pattern.length;
    referenceMean /= pattern.length;
    let variance = 0, referenceVariance = 0;
    for (let i = 0; i < pattern.length; i++) {
      variance += (pattern[i] - mean) ** 2;
      referenceVariance += (reference[i] - referenceMean) ** 2;
    }
    // Compare coarse spatial detail, removing uniform exposure/gain changes.
    // Averaged regions also suppress sensor noise and small focus changes.
    const gain = Math.min(variance, referenceVariance) >= pattern.length * 9
      ? Math.max(0.5, Math.min(2, Math.sqrt(referenceVariance / variance))) : 1;
    let different = 0;
    for (let i = 0; i < pattern.length; i++) {
      if (Math.abs((pattern[i] - mean) * gain - (reference[i] - referenceMean)) > 14) different++;
    }
    // Do not latch a passing hand: returning to the starting view closes the gate.
    return different >= 4;
  }

  complete() { this.waiting = false; this.reference = undefined; }
}
