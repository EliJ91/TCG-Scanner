import { expect, it } from 'vitest';
import { CardPresenceDetector } from '../src/core/card-presence';
import { FirstPlacementGuard } from '../src/core/first-placement';
import { emptyFrame, noisySurface, obstructedFrame, printedCard, shadowedSurface, softenedFrame } from './card-frame';

function setup() {
  const detector = new CardPresenceDetector();
  const guard = new FirstPlacementGuard();
  const changed = (frame: Uint8Array, calibrating = false) => {
    const appearance = detector.detect(frame);
    return guard.changed(detector.brightnessPattern, calibrating, appearance === 'empty');
  };
  return { guard, changed };
}

it('ignores a static card-like background through exposure changes and focus settling', () => {
  const { changed } = setup();
  const background = printedCard(0, 180);
  expect(changed(background)).toBe(false);
  for (const frame of [background, background.map(value => Math.round(value * 0.65 + 30)), background.map(value => value + 8), softenedFrame(background)]) {
    expect(changed(frame)).toBe(false);
  }
});

it('rejects changing sensor noise on the bare surface and detects a real first placement', () => {
  const { changed } = setup();
  changed(noisySurface(1));
  for (let seed = 2; seed < 20; seed++) expect(changed(noisySurface(seed))).toBe(false);
  expect(changed(printedCard(1, 180))).toBe(true);
});

it.each([false, true])('does not normalize away a real card added over a low-contrast shadow (flipped %s)', flipped => {
  const { changed } = setup();
  const background = shadowedSurface(), card = printedCard();
  expect(changed(flipped ? background.slice().reverse() : background)).toBe(false);
  expect(changed(flipped ? card.slice().reverse() : card)).toBe(true);
});

it('closes the gate again when an obstruction leaves the original background visible', () => {
  const { changed } = setup();
  const background = printedCard(0, 180);
  changed(background);
  expect(changed(obstructedFrame())).toBe(true);
  expect(changed(background)).toBe(false);
});

it('supports recalibration for a different camera view and stops checking after capture', () => {
  const { guard, changed } = setup();
  changed(emptyFrame());
  const reframed = printedCard();
  expect(changed(reframed, true)).toBe(false);
  expect(changed(reframed)).toBe(false);
  expect(changed(emptyFrame())).toBe(true);
  guard.complete();
  expect(changed(reframed)).toBe(true);
  expect(guard.waiting).toBe(false);
  guard.reset();
  expect(guard.waiting).toBe(true);
  expect(changed(reframed)).toBe(false);
});
