import { describe, it, expect } from 'vitest';
import { CardPresenceDetector, previewWidth } from '../src/core/card-presence';
import { MotionDetector } from '../src/core/motion';
import { emptyFrame, printedCard } from './card-frame';

const presence = new CardPresenceDetector();
function sample(d: MotionDetector, frame: Uint8Array, now: number) {
  return d.update(frame, now, presence.detect(frame));
}

describe('card-gated motion', () => {
  it.each([248, 45])('distinguishes a silver-bordered card from a plain surface at brightness %i', level => {
    expect(presence.detect(emptyFrame(level))).toBe('empty');
    expect(presence.detect(printedCard(0, level))).toBe('card');
  });

  it('does not mistake a smooth obstruction or an exposure shift for a card', () => {
    const obstructed = emptyFrame();
    for (let y = 18; y < 102; y++) obstructed.fill(120 + Math.round(y / 4), y * previewWidth + 40, y * previewWidth + 120);
    expect(presence.detect(obstructed)).toBe('uncertain');
    const d = new MotionDetector();
    for (let t = 0; t <= 900; t += 30) {
      const frame = t % 60 ? obstructed : emptyFrame(150 + t % 80);
      expect(sample(d, frame, t).state).toBe('waiting');
      expect(d.deadline).toBeNull();
    }
  });

  it('starts at zero on confirmed stillness and reaches full at the configured time', () => {
    const d = new MotionDetector(200), card = printedCard();
    expect(sample(d, card, 0).state).toBe('waiting');
    expect(sample(d, card, 33)).toMatchObject({ state: 'stabilizing', stability: 0 });
    expect(d.advance(133)).toMatchObject({ state: 'stabilizing', stability: 0.5 });
    expect(d.advance(233)).toMatchObject({ state: 'ready', stability: 1 });
  });

  it('restarts the countdown when a new frame moves', () => {
    const d = new MotionDetector(200), first = printedCard(0), moved = printedCard(1);
    sample(d, first, 0); sample(d, first, 33);
    expect(sample(d, moved, 232).state).toBe('moving');
    expect(d.deadline).toBeNull();
    expect(sample(d, moved, 260).stability).toBe(0);
    expect(d.advance(459).state).toBe('stabilizing');
    expect(d.advance(460).state).toBe('ready');
  });

  it('starts the default countdown on the first quiet comparison, tolerating minor camera variation', () => {
    const d = new MotionDetector(), card = printedCard();
    d.update(card, 0, 'uncertain');
    const slightlyChanged = card.slice();
    slightlyChanged.fill(215, 0, 240);
    expect(sample(d, slightlyChanged, 33)).toMatchObject({ state: 'stabilizing', stability: 0 });
    expect(d.deadline).toBe(133);
    expect(d.advance(132).state).toBe('stabilizing');
    expect(d.advance(133).state).toBe('ready');
  });

  it('does not photograph removal, duplicate a card, or rearm on a single empty frame', () => {
    const d = new MotionDetector(10), card = printedCard(), empty = emptyFrame();
    sample(d, card, 0); sample(d, card, 33); expect(d.advance(43).state).toBe('ready');
    d.consume();
    for (const [i, frame] of [card, printedCard(1), empty, card, card].entries()) {
      expect(sample(d, frame, 66 + i * 33)).toMatchObject({ state: 'waiting', needsRemoval: true });
    }
    expect(sample(d, empty, 240).needsRemoval).toBe(true);
    expect(sample(d, empty, 273)).toMatchObject({ state: 'waiting', needsRemoval: false });
    expect(d.advance(600).state).toBe('waiting');
    sample(d, card, 633); sample(d, card, 666);
    expect(d.advance(676).state).toBe('ready');
  });

  it('cancels a countdown when the card disappears', () => {
    const d = new MotionDetector(200), card = printedCard();
    sample(d, card, 0); sample(d, card, 33);
    expect(sample(d, emptyFrame(), 232).state).toBe('waiting');
    expect(d.advance(233).state).toBe('waiting');
  });

  it('preserves the removal requirement on reset and across camera stalls', () => {
    const d = new MotionDetector(10), card = printedCard();
    d.consume(); d.reset();
    expect(sample(d, card, 0).needsRemoval).toBe(true);
    expect(sample(d, card, 1000).needsRemoval).toBe(true);
    expect(sample(d, card, 1033).state).toBe('waiting');
  });

  it('drops interrupted stability without firing from a frozen video frame', () => {
    const d = new MotionDetector(1000), card = printedCard();
    sample(d, card, 0); sample(d, card, 33);
    expect(d.advance(1033).state).toBe('waiting');
    expect(sample(d, card, 2000).state).toBe('waiting');
  });

  it('keeps a still countdown through small sensor noise and uniform exposure changes', () => {
    const d = new MotionDetector(100), card = printedCard(0, 220);
    sample(d, card, 0);
    for (const now of [33, 66, 99, 132]) {
      const adjusted = card.map((v, index) => v - now % 25 + index % 3);
      expect(sample(d, adjusted, now).state).toBe('stabilizing');
    }
    expect(d.advance(133).state).toBe('ready');
  });
});
