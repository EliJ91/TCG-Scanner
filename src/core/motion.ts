import type { CardPresence } from './card-presence';
import { defaults } from './types';

export type MotionState = 'waiting' | 'moving' | 'stabilizing' | 'ready';
export interface MotionReading {
  score: number; noise: number; stability: number; state: MotionState;
  presence: CardPresence; awaitingNextCard: boolean; cycle: number;
}

/** One quiet interval per placement, with optional motion-based rearming for stacks. */
export class MotionDetector {
  private previous?: Uint8Array;
  private noise = 2;
  private score = 0;
  private presence: CardPresence = 'uncertain';
  private state: MotionState = 'waiting';
  private stableStart: number | null = null;
  private lastTime: number | null = null;
  private needsRemoval = false;
  private emptyFrames = 0;
  private stackCards = defaults.stackCards;
  private movedSinceCapture = false;
  private cycle = 0;
  constructor(public stabilityMs = defaults.stabilityMs, public sensitivity = defaults.sensitivity) {}

  get deadline() { return this.state === 'stabilizing' && this.stableStart !== null ? this.stableStart + this.stabilityMs : null; }
  private get awaitingNextCard() { return this.needsRemoval && !this.movedSinceCapture; }

  setStackCards(enabled: boolean) {
    if (enabled === this.stackCards) return;
    this.stackCards = enabled;
    this.reset();
  }

  reset(requireRemoval = this.needsRemoval) {
    this.previous = undefined;
    this.presence = 'uncertain';
    this.state = 'waiting';
    this.stableStart = this.lastTime = null;
    this.needsRemoval = requireRemoval;
    this.movedSinceCapture = false;
    this.emptyFrames = this.score = 0;
  }

  consume() {
    this.cycle++;
    const { previous, lastTime } = this;
    this.reset(true);
    if (this.stackCards) {
      // Compare the next frame to the one just captured, even during JPEG encoding.
      this.previous = previous;
      this.lastTime = lastTime;
    }
  }

  update(gray: Uint8Array, now: number, presence: CardPresence): MotionReading {
    if (this.lastTime !== null && now - this.lastTime > 650) this.reset();
    const previous = this.previous;
    this.lastTime = now;
    this.presence = presence;
    this.score = 0;
    if (previous) {
      // Remove a uniform exposure shift before counting changed pixels.
      let shift = 0;
      for (let i = 0; i < gray.length; i++) shift += gray[i] - previous[i];
      shift /= gray.length;
      const threshold = Math.max(11, this.noise * 3.5);
      let residual = 0, changed = 0;
      for (let i = 0; i < gray.length; i++) {
        const difference = Math.abs(gray[i] - previous[i] - shift);
        residual += difference;
        if (difference > threshold) changed++;
      }
      this.score = changed / gray.length;
      if (this.score < this.sensitivity * 0.35) this.noise = this.noise * 0.95 + Math.min(residual / gray.length, 5) * 0.05;
      previous.set(gray);
    } else this.previous = gray.slice();

    const moving = this.score >= this.sensitivity;
    if (this.needsRemoval) {
      this.emptyFrames = presence === 'empty' ? this.emptyFrames + 1 : 0;
      if (this.emptyFrames >= 2) this.needsRemoval = false;
      if (this.stackCards && moving) this.movedSinceCapture = true;
    }
    if (presence !== 'card' || this.awaitingNextCard || !previous) {
      this.state = 'waiting';
      this.stableStart = null;
    } else if (moving) {
      this.state = 'moving';
      this.stableStart = null;
    } else if (this.state !== 'ready') {
      this.state = 'stabilizing';
      this.stableStart ??= now;
    }
    return this.advance(now);
  }

  /** A confirmed still frame can reach its deadline between camera frames. */
  advance(now: number): MotionReading {
    if (this.lastTime !== null && now - this.lastTime > 650) this.reset();
    const deadline = this.deadline;
    if (deadline !== null && now >= deadline) this.state = 'ready';
    return { score: this.score, noise: this.noise, state: this.state, presence: this.presence,
      awaitingNextCard: this.awaitingNextCard, cycle: this.cycle,
      stability: this.stableStart === null ? 0 : Math.min(1, Math.max(0, (now - this.stableStart) / this.stabilityMs)) };
  }
}

/** Reused luma buffer for the entire visible camera image, excluding UI overlays. */
export function toLuma(rgba: Uint8ClampedArray, output: Uint8Array) {
  for (let i = 0, p = 0; p < output.length; i += 4, p++) output[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
}
