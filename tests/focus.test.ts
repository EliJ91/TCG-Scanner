import { describe, expect, it } from 'vitest';
import { FocusDetector } from '../src/core/focus';
import { previewWidth } from '../src/core/card-presence';
import { emptyFrame, printedCard, softenedFrame } from './card-frame';

describe('autofocus settling', () => {
  it('requires fresh, consistently sharp frames instead of counting a timer check as a frame', () => {
    const focus = new FocusDetector(), card = printedCard();
    expect(focus.update(card, previewWidth, true)).toBe(false);
    expect(focus.update(card, previewWidth, false)).toBe(false);
    expect(focus.update(card, previewWidth, true)).toBe(true);
  });

  it('waits through a sharpness drop and cannot accept consistently blurred frames after it', () => {
    const focus = new FocusDetector(), card = printedCard(), blurred = softenedFrame(card);
    focus.update(card, previewWidth, true);
    expect(focus.update(card, previewWidth, true)).toBe(true);
    expect(focus.update(blurred, previewWidth, false)).toBe(false);
    for (let i = 0; i < 5; i++) expect(focus.update(blurred, previewWidth, true)).toBe(false);
    expect(focus.update(card, previewWidth, true)).toBe(false);
    expect(focus.update(card, previewWidth, true)).toBe(true);
  });

  it('waits while the reported lens position changes even when image sharpness is stable', () => {
    const focus = new FocusDetector(), card = printedCard();
    focus.update(card, previewWidth, true, 1);
    expect(focus.update(card, previewWidth, true, 1)).toBe(true);
    expect(focus.update(card, previewWidth, false, 2)).toBe(false);
    expect(focus.update(card, previewWidth, true, 3)).toBe(false);
    expect(focus.update(card, previewWidth, true, 3)).toBe(true);
  });

  it('keeps focus through automatic exposure changes without retaining a brighter sharpness peak', () => {
    const focus = new FocusDetector(), card = printedCard();
    focus.update(card, previewWidth, true);
    expect(focus.update(card, previewWidth, true)).toBe(true);
    const adjusted = card.map(value => value * 0.7 + 30);
    expect(focus.update(adjusted, previewWidth, true)).toBe(true);
  });

  it('rejects a stable image without sharp detail and starts fresh for a new card', () => {
    const focus = new FocusDetector();
    for (let i = 0; i < 5; i++) expect(focus.update(emptyFrame(), previewWidth, true)).toBe(false);
    focus.reset();
    const next = printedCard(2);
    expect(focus.update(next, previewWidth, true)).toBe(false);
    expect(focus.update(next, previewWidth, true)).toBe(true);
  });
});
