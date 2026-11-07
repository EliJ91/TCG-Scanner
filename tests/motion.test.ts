import { describe, it, expect } from 'vitest';
import { MotionDetector } from '../src/core/motion';
const frame = (value = 100) => new Uint8Array(1200).fill(value);
const pattern = (seed: number) => Uint8Array.from({ length: 1200 }, (_, i) => 30 + (i * 37 + seed * 57) % 180);
function settle(d: MotionDetector, f: Uint8Array, start: number) {
  return [0,70,140,210,280].map(t => d.update(f, start + t));
}
describe('motion state machine', () => {
  it('can arm a first auto photo after a full quiet placement interval without requiring a slide', () => {
    const d = new MotionDetector(1200); d.reset(true);
    for (let t = 0; t < 1200; t += 100) expect(d.update(pattern(1), t).capture).toBe(false);
    expect(d.update(pattern(1), 1200).capture).toBe(false);
    expect(d.update(pattern(1), 1300).capture).toBe(true);
    d.consume(); expect(d.update(pattern(1), 1400).capture).toBe(false);
  });
  it('restarts the quiet countdown whenever placement movement continues', () => {
    const d = new MotionDetector(1200); d.reset(true); d.update(pattern(1), 0);
    d.update(pattern(1), 400); d.update(pattern(2), 800); d.update(pattern(3), 1000);
    for (const t of [1100,1400,1700,2000]) expect(d.update(pattern(3), t).capture).toBe(false);
    expect(d.update(pattern(3), 2300).capture).toBe(true);
  });
  it('requires motion then stabilization', () => {
    const d = new MotionDetector(200); d.update(frame(), 0);
    expect(d.update(pattern(1), 70).state).toBe('moving');
    const readings = settle(d, pattern(1), 140);
    expect(readings.filter(r => r.capture)).toHaveLength(1);
  });
  it('does not capture a stationary card on start', () => {
    const d = new MotionDetector();
    expect(Array.from({ length: 40 }, (_, i) => d.update(pattern(1), i * 70)).some(r => r.capture)).toBe(false);
  });
  it('does not capture twice after a movement cycle', () => {
    const d = new MotionDetector(200); d.update(frame(), 0); d.update(pattern(1), 70);
    settle(d, pattern(1), 140); d.consume();
    expect(settle(d, pattern(1), 500).some(r => r.capture)).toBe(false);
  });
  it('captures two identical cards when each physically slides in', () => {
    const d = new MotionDetector(200); const card = pattern(1);
    d.update(frame(), 0); d.update(pattern(2), 70); d.update(card, 140);
    expect(settle(d, card, 210).filter(r => r.capture)).toHaveLength(1); d.consume();
    d.update(pattern(3), 560); d.update(pattern(2), 630); d.update(card, 700);
    expect(settle(d, card, 770).filter(r => r.capture)).toHaveLength(1);
  });
  it('does not capture during rapid consecutive movement', () => {
    const d = new MotionDetector(220); d.update(pattern(0), 0);
    for (let i = 1; i <= 10; i++) expect(d.update(pattern(i), i * 70).capture).toBe(false);
    expect(settle(d, pattern(10), 770).filter(r => r.capture)).toHaveLength(1);
  });
  it('ignores global brightness changes', () => {
    const d = new MotionDetector(200);
    expect(Array.from({ length: 20 }, (_, i) => d.update(frame(i % 2 ? 140 : 100), i * 70)).some(r => r.capture)).toBe(false);
  });
  it('rejects a short flash that returns to baseline', () => {
    const d = new MotionDetector(); d.update(pattern(1), 0); d.update(pattern(2), 70); d.update(pattern(1), 105);
    expect(settle(d, pattern(1), 140).some(r => r.capture)).toBe(false);
  });
  it('resets the baseline on pause/resume', () => {
    const d = new MotionDetector(); d.update(frame(), 0); d.update(pattern(1), 70); d.reset();
    expect(settle(d, pattern(1), 1000).some(r => r.capture)).toBe(false);
  });
  it('drops interrupted stability after a long frame gap', () => {
    const d = new MotionDetector(); d.update(frame(), 0); d.update(pattern(1), 70);
    d.update(pattern(1), 140); expect(d.update(pattern(1), 2000).capture).toBe(false);
  });
  it('ignores small camera noise', () => {
    const d = new MotionDetector(); const a = pattern(1);
    for (let i = 0; i < 40; i++) {
      const b = a.map((v, j) => v + ((j + i) % 5) - 2);
      expect(d.update(b, i * 70).capture).toBe(false);
    }
  });
});
