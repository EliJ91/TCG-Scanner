import { describe, it, expect } from 'vitest';
import { CardPresenceDetector } from '../src/core/card-presence';
import { MotionDetector, toLuma } from '../src/core/motion';
import { emptyFrame, noisySurface, obstructedFrame, printedCard, shadowedSurface } from './card-frame';

const presence = new CardPresenceDetector();
function sample(d: MotionDetector, frame: Uint8Array, now: number) {
  return d.update(frame, now, presence.detect(frame));
}

describe('card-gated motion', () => {
  it.each([1, 8, 144])('does not identify noise on an empty surface as a card (seed %s)', seed => {
    const frame = noisySurface(seed);
    expect(presence.detect(frame)).not.toBe('card');
    expect(presence.detect(frame.slice().reverse())).not.toBe('card');
  });
  it('detects a one-level pixel change at zero tolerance and still permits stillness', () => {
    const detector = new MotionDetector(100, 0);
    const card = printedCard();
    sample(detector, card, 0);
    expect(sample(detector, card, 33).state).toBe('stabilizing');
    const moved = card.slice();
    moved[0]--;
    expect(sample(detector, moved, 66).state).toBe('moving');
    expect(detector.deadline).toBeNull();
    expect(sample(detector, moved, 99).state).toBe('stabilizing');
    expect(detector.advance(199).state).toBe('ready');
    detector.consume();
    expect(sample(detector, moved, 232)).toMatchObject({ state: 'waiting', awaitingNextCard: true });
  });

  it('ignores even full-frame movement at maximum tolerance without duplicating a card', () => {
    const detector = new MotionDetector(100, 1);
    const first = emptyFrame().map((_, index) => index % 2 ? 30 : 220);
    const moved = first.map(value => 250 - value);
    detector.update(first, 0, 'card');
    expect(detector.update(moved, 33, 'card')).toMatchObject({ score: 1, state: 'stabilizing' });
    expect(detector.update(first, 66, 'card').state).toBe('stabilizing');
    expect(detector.advance(133).state).toBe('ready');
    detector.consume();
    detector.update(first, 166, 'card');
    expect(detector.update(moved, 199, 'card')).toMatchObject({ score: 1, state: 'waiting', awaitingNextCard: true });
    detector.update(emptyFrame(), 232, 'empty');
    expect(detector.update(emptyFrame(), 265, 'empty').awaitingNextCard).toBe(false);
  });

  it.each([248, 45])('distinguishes a silver-bordered card from a plain surface at brightness %i', level => {
    expect(presence.detect(emptyFrame(level))).toBe('empty');
    expect(presence.detect(printedCard(0, level))).toBe('card');
  });

  it.each([
    { left: 0, top: 0, right: 30, bottom: 55 },
    { left: 130, top: 0, right: 160, bottom: 55 },
    { left: 0, top: 65, right: 30, bottom: 120 },
    { left: 130, top: 65, right: 160, bottom: 120 },
  ])('recognizes a card near the corners of the preview', bounds => {
    const frame = printedCard(0, 248, 241, bounds);
    expect(presence.detect(frame)).toBe('card');
  });

  it('recognizes a shadowed bare surface in either orientation', () => {
    const surface = shadowedSurface();
    expect([presence.detect(surface), presence.detect(surface.slice().reverse())]).toEqual(['empty', 'empty']);
  });

  it('reads the flipped preview pixels in the same order as the saved photo', () => {
    const pixels = new Uint8ClampedArray([80, 80, 80, 255, 120, 120, 120, 255, 200, 200, 200, 255]);
    const gray = new Uint8Array(3);
    toLuma(pixels, gray, true);
    expect([...gray]).toEqual([200, 120, 80]);
  });

  it('does not mistake a smooth obstruction or an exposure shift for a card', () => {
    const obstructed = obstructedFrame();
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
    const d = new MotionDetector(200), first = printedCard();
    const moved = printedCard(1, 0, 7);
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

  it('does not photograph the empty surface or repeat a stationary card before a replacement', () => {
    const d = new MotionDetector(10), card = printedCard(), empty = emptyFrame();
    sample(d, card, 0); sample(d, card, 33); expect(d.advance(43).state).toBe('ready');
    d.consume();
    for (const now of [66,99,132]) expect(sample(d, card, now)).toMatchObject({ state: 'waiting', awaitingNextCard: true });
    expect(sample(d, empty, 165).state).toBe('waiting');
    expect(sample(d, empty, 198).state).toBe('waiting');
    expect(d.advance(220).state).toBe('waiting');
    sample(d, card, 231); sample(d, card, 264);
    expect(d.advance(274).state).toBe('ready');
  });

  it('waits for motion after a stack capture and still requires a visible, settled card', () => {
    const d = new MotionDetector(10), card = printedCard(), next = printedCard(1, 0, 7), empty = emptyFrame();
    sample(d, card, 0); sample(d, card, 33);
    expect(d.advance(43).state).toBe('ready');
    d.consume();
    expect(sample(d, card, 66)).toMatchObject({ state: 'waiting', awaitingNextCard: true });
    expect(d.advance(100).state).toBe('waiting');
    expect(sample(d, next, 110)).toMatchObject({ state: 'moving', awaitingNextCard: false });
    expect(sample(d, next, 143)).toMatchObject({ state: 'stabilizing', stability: 0 });
    expect(d.advance(153).state).toBe('ready');
    d.consume();
    expect(sample(d, empty, 176).state).toBe('waiting');
    expect(sample(d, empty, 209).state).toBe('waiting');
    expect(d.advance(250).state).toBe('waiting');
  });

  it.each([false,true])('supports removal and stacking in the same batch at tolerance 90 (flipped %s)', flipped => {
    const d = new MotionDetector(10,0.999), bounds = { left:10,top:12,right:150,bottom:108 };
    const orient = (frame:Uint8Array) => flipped ? frame.slice().reverse() : frame;
    const first=orient(printedCard(0,248,241,bounds)), second=orient(printedCard(1,248,241,bounds)), third=orient(printedCard(2,248,241,bounds));
    sample(d, first, 0); sample(d, first, 33); expect(d.advance(43).state).toBe('ready'); d.consume();
    expect(sample(d, first, 66).state).toBe('waiting');
    expect(sample(d, emptyFrame(), 99).state).toBe('waiting');
    expect(sample(d, emptyFrame(), 132).state).toBe('waiting');
    expect(d.advance(160).state).toBe('waiting');
    sample(d, second, 165); sample(d, second, 198); expect(d.advance(208).state).toBe('ready'); d.consume();
    expect(sample(d, second, 231).state).toBe('waiting');
    sample(d, third, 264); sample(d, third, 297); expect(d.advance(307).state).toBe('ready'); d.consume();
    expect(sample(d, third, 330).state).toBe('waiting');
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
    expect(sample(d, card, 0).awaitingNextCard).toBe(true);
    expect(sample(d, card, 1000).awaitingNextCard).toBe(true);
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
