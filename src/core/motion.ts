export type MotionState = 'waiting' | 'moving' | 'stabilizing' | 'ready';
export interface MotionReading {
  score: number; noise: number; stability: number; state: MotionState;
  capture: boolean; cycle: number; lightingShift: number;
}

/** Geometry/artwork-independent, exposure-compensated motion analysis. Times are milliseconds. */
export class MotionDetector {
  private previous?: Uint8Array;
  private baseline?: Uint8Array;
  private baselineMean = 0;
  private noise = 2;
  private state: MotionState = 'waiting';
  private motionStart: number | null = null;
  private lastMotion: number | null = null;
  private stableStart: number | null = null;
  private peak = 0;
  private cycle = 0;
  private lastTime: number | null = null;
  constructor(public stabilityMs = 220, public sensitivity = 0.055) {}

  reset() {
    this.previous = undefined; this.baseline = undefined; this.state = 'waiting';
    this.motionStart = null; this.lastMotion = null; this.stableStart = null; this.peak = 0; this.lastTime = null;
  }

  /** Consuming a cycle requires another physical movement before another capture. */
  consume() { this.state = 'waiting'; this.motionStart = null; this.lastMotion = null; this.stableStart = null; this.peak = 0; this.baseline = undefined; }

  update(gray: Uint8Array, now: number): MotionReading {
    let score = 0, shift = 0, capture = false;
    if (!this.previous || this.previous.length !== gray.length || (this.lastTime !== null && now - this.lastTime > 650)) {
      this.reset(); this.previous = gray.slice(); this.lastTime = now;
      return this.reading(0, 0, false, now);
    }
    const n = gray.length;
    for (let i = 0; i < n; i++) shift += gray[i] - this.previous[i];
    shift /= n;
    const threshold = Math.max(11, this.noise * 3.5);
    let residual = 0, changed = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(gray[i] - this.previous[i] - shift);
      residual += d;
      if (d > threshold) changed++;
    }
    score = changed / n;
    this.lastTime = now;
    // Freeze the noise estimate during motion, otherwise moving cards become "noise".
    if (score < this.sensitivity * 0.35) this.noise = this.noise * 0.95 + Math.min(residual / n, 5) * 0.05;
    const high = score >= this.sensitivity;
    const low = score < this.sensitivity * 0.35;
    if (this.state === 'waiting' || this.state === 'ready') {
      if (high) {
        this.baseline = this.previous.slice(); this.baselineMean = this.mean(this.baseline);
        this.state = 'moving'; this.motionStart = now; this.lastMotion = now; this.peak = score; this.stableStart = null; this.cycle++;
      }
    } else if (high) {
      this.state = 'moving'; this.lastMotion = now; this.stableStart = null; this.peak = Math.max(this.peak, score);
    } else if (low) {
      if (this.stableStart === null) this.stableStart = now;
      this.state = 'stabilizing';
      if (now - this.stableStart >= this.stabilityMs) {
        // Reject a one-frame flash or brief camera noise spike returning to baseline.
        let displacement = 0;
        if (this.baseline) {
          const meanShift = this.mean(gray) - this.baselineMean;
          for (let i = 0; i < n; i++) if (Math.abs(gray[i] - this.baseline[i] - meanShift) > threshold) displacement++;
        }
        const duration = (this.lastMotion ?? now) - (this.motionStart ?? now);
        if (duration >= 65 || (displacement / n >= this.sensitivity && this.peak > this.sensitivity * 1.5)) {
          this.state = 'ready'; capture = true;
        } else { this.consume(); }
      }
    } else { this.stableStart = null; this.state = 'moving'; }
    this.previous.set(gray);
    return this.reading(score, shift, capture, now);
  }
  private mean(data: Uint8Array) { let sum = 0; for (const v of data) sum += v; return sum / data.length; }
  private reading(score: number, lightingShift: number, capture: boolean, now: number): MotionReading {
    return { score, noise: this.noise, lightingShift, state: this.state, capture, cycle: this.cycle,
      stability: this.stableStart === null ? 0 : Math.min(1, (now - this.stableStart) / this.stabilityMs) };
  }
}

/** Reused luma buffer from the center 90% of the camera, excluding UI overlays. */
export function toLuma(rgba: Uint8ClampedArray, output: Uint8Array) {
  for (let i = 0, p = 0; p < output.length; i += 4, p++) output[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
}
