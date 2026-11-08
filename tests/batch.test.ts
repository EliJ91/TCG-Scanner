import { describe, it, expect } from 'vitest';
import { BatchController } from '../src/core/batch';
function setup(target = 3, initial = 0) {
  const saved: number[] = [], failures: unknown[] = [];
  const c = new BatchController<number>(target, initial, 0, 3, async v => { saved.push(v); }, e => { failures.push(e); });
  c.start(); return { c, saved, failures };
}
describe('batch reservations and ordered durable commits', () => {
  it('preserves capture order when processing finishes out of order', async () => {
    const { c, saved } = setup(); const a = c.reserve()!, b = c.reserve()!, d = c.reserve()!;
    c.settle(d, { value: 3 }); c.settle(b, { value: 2 }); expect(saved).toEqual([]);
    c.settle(a, { value: 1 }); await c.idle(); expect(saved).toEqual([1,2,3]); expect(c.complete).toBe(true);
  });
  it('enforces the exact limit with pending captures and prevents any capture after completion', async () => {
    const { c } = setup(2); const a = c.reserve()!, b = c.reserve()!;
    expect(c.reserve()).toBeNull(); expect(c.atBatchLimit).toBe(true);
    c.settle(a, { value: 1 }); expect(c.reserve()).toBeNull();
    c.settle(b, { value: 2 }); await c.idle(); expect(c.count).toBe(2); expect(c.reserve()).toBeNull();
    c.start(); expect(c.running).toBe(false);
  });
  it('recovers a failed slot without counting it', async () => {
    const { c, failures } = setup(1); const a = c.reserve()!;
    c.settle(a, { error: new Error('No corners') }); await c.idle();
    expect(c.count).toBe(0); expect(failures).toHaveLength(1); expect(c.running).toBe(true);
    const replacement = c.reserve()!; c.settle(replacement, { value: 8 }); await c.idle(); expect(c.count).toBe(1);
  });
  it('continues saving pending images when paused', async () => {
    const { c, saved } = setup(); const a = c.reserve()!; c.pause();
    expect(c.reserve()).toBeNull(); c.settle(a, { value: 1 }); await c.idle(); expect(saved).toEqual([1]);
    c.start(); expect(c.reserve()).not.toBeNull();
  });
  it('counts only successfully stored images', async () => {
    const errors: unknown[] = [];
    const c = new BatchController(1,0,0,2, async () => { throw new Error('QuotaExceededError'); }, e => errors.push(e));
    c.start(); c.settle(c.reserve()!, { value: 1 }); await c.idle();
    expect(c.count).toBe(0); expect(c.pending).toBe(0); expect(errors).toHaveLength(1);
  });
  it('keeps slots reserved until storage completes', async () => {
    let finish!: () => void;
    const c = new BatchController(1,0,0,2, () => new Promise<void>(resolve => { finish = resolve; }), () => {});
    c.start(); c.settle(c.reserve()!, { value: 1 });
    expect(c.count).toBe(0); expect(c.pending).toBe(1); expect(c.reserve()).toBeNull();
    finish(); await c.idle(); expect(c.count).toBe(1);
  });
  it('keeps pending slots on resize and requires a restart after expanding a complete batch', async () => {
    const { c } = setup(5, 2);
    const ticket = c.reserve()!;
    expect(() => c.resize(2)).toThrow('pending photos');
    c.resize(3);
    expect(c.reserve()).toBeNull();
    await c.settle(ticket, { value: 1 });
    expect(c.complete).toBe(true);
    c.resize(6);
    expect(c.complete).toBe(false);
    expect(c.reserve()).toBeNull();
    c.start();
    expect(c.reserve()).not.toBeNull();
  });
  it('ignores duplicate processing results', async () => {
    const { c, saved } = setup(); const a = c.reserve()!;
    c.settle(a, { value: 1 }); c.settle(a, { value: 99 }); await c.idle(); expect(saved).toEqual([1]);
  });
  it('does not silently resume after deleting a completed image', async () => {
    const { c } = setup(1); c.settle(c.reserve()!, { value: 1 }); await c.idle(); c.removeStored();
    expect(c.complete).toBe(false); expect(c.running).toBe(false); expect(c.reserve()).toBeNull();
    c.start(); expect(c.reserve()).not.toBeNull();
  });
  it('limits the queue independently of the batch size', () => {
    const { c } = setup(50); expect(c.reserve()).not.toBeNull(); expect(c.reserve()).not.toBeNull(); expect(c.reserve()).not.toBeNull(); expect(c.reserve()).toBeNull();
  });
});
