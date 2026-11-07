import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { CapturePipeline } from '../src/core/pipeline';
import { storage } from '../src/core/storage';
import type { Batch } from '../src/core/types';

let batch: Batch;
let pipeline: CapturePipeline;
const photo = () => Promise.resolve({ blob: new Blob(['camera JPEG'], { type: 'image/jpeg' }), width: 1280, height: 720 });

async function setup(target: number) {
  batch = await storage.create(target);
  const events = { changed: vi.fn(), saved: vi.fn(), storageIssue: vi.fn() };
  pipeline = new CapturePipeline(batch, 0, events);
  pipeline.start();
  return events;
}

afterEach(async () => {
  pipeline.dispose();
  vi.restoreAllMocks();
  await storage.clear(batch.id);
});

it('saves camera bytes and dimensions directly and stops at the batch limit', async () => {
  const events = await setup(2);
  const snapshot = vi.fn(photo);
  await pipeline.capture(snapshot);
  await pipeline.capture(snapshot);
  await pipeline.capture(snapshot);
  expect(snapshot).toHaveBeenCalledTimes(2);
  await vi.waitFor(() => expect(pipeline.complete).toBe(true));
  expect(events.saved).toHaveBeenCalledTimes(2);
  const saved = await storage.load();
  expect(saved.attempts).toEqual([]);
  expect(saved.scans.map(scan => scan.ordinal).sort()).toEqual([0, 1]);
  for (const scan of saved.scans) {
    expect(await scan.blob.text()).toBe('camera JPEG');
    expect([scan.width, scan.height]).toEqual([1280, 720]);
  }
});

it('retains the same JPEG for retry after a failed save', async () => {
  const events = await setup(1);
  vi.spyOn(storage, 'accept').mockRejectedValueOnce(new Error('Quota exceeded'));
  const snapshot = vi.fn(photo);
  await pipeline.capture(snapshot);
  await vi.waitFor(() => expect(pipeline.pending).toBe(0));
  expect(pipeline.count).toBe(0);
  expect(pipeline.hasCapacity).toBe(false);
  expect(await (await pipeline.original(pipeline.retained[0].id))?.text()).toBe('camera JPEG');
  expect(events.saved).not.toHaveBeenCalled();
  await pipeline.retryStorage();
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(pipeline.complete).toBe(true);
  expect(pipeline.retained).toEqual([]);
});

it('releases the slot after a camera encoding error', async () => {
  await setup(1);
  await expect(pipeline.capture(async () => { throw new Error('Encoding failed'); })).rejects.toThrow('Encoding failed');
  expect(pipeline.hasCapacity).toBe(true);
  await pipeline.capture(photo);
  await vi.waitFor(() => expect(pipeline.complete).toBe(true));
});

it('queues several shutters during a blocked write and saves in capture order', async () => {
  const events = await setup(3);
  const accept = storage.accept;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const writes = vi.spyOn(storage, 'accept').mockImplementationOnce(async scan => {
    await blocked;
    await accept(scan);
  });
  const snapshot = vi.fn(photo);
  for (let i = 0; i < 4; i++) await pipeline.capture(snapshot);
  expect(snapshot).toHaveBeenCalledTimes(3);
  expect(writes).toHaveBeenCalledTimes(1);
  expect(pipeline.pending).toBe(3);
  expect(pipeline.count).toBe(0);
  release();
  await vi.waitFor(() => expect(pipeline.complete).toBe(true));
  expect(events.saved.mock.calls.map(([scan]) => scan.ordinal)).toEqual([0, 1, 2]);
});

it('retains every queued JPEG when the first write fails and retries in order', async () => {
  const events = await setup(3);
  let fail!: (error: Error) => void;
  const blocked = new Promise<void>((_resolve, reject) => { fail = reject; });
  const writes = vi.spyOn(storage, 'accept').mockImplementationOnce(() => blocked);
  const snapshot = vi.fn(photo);
  for (let i = 0; i < 3; i++) await pipeline.capture(snapshot);
  fail(new Error('Disk full'));
  await vi.waitFor(() => expect(pipeline.pending).toBe(0));
  expect(writes).toHaveBeenCalledTimes(1);
  expect(pipeline.retained.map(scan => scan.ordinal)).toEqual([0, 1, 2]);
  expect(pipeline.hasCapacity).toBe(false);
  await pipeline.retryStorage();
  expect(pipeline.complete).toBe(true);
  expect(pipeline.retained).toEqual([]);
  expect(snapshot).toHaveBeenCalledTimes(3);
  expect(events.saved.mock.calls.map(([scan]) => scan.ordinal)).toEqual([0, 1, 2]);
});
