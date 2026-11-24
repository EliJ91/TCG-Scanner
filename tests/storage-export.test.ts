import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { describe, it, expect } from 'vitest';
import { storage } from '../src/core/storage';
import { createZip } from '../src/core/export';
import { archiveFilename, defaultBatchName, filename, type Scan } from '../src/core/types';
const scan = (batchId: string, ordinal: number): Scan => ({
  id: crypto.randomUUID(), batchId, ordinal, capturedAt: new Date(2026, 10, 24, 13, 4, 5, ordinal).getTime(), blob: new Blob([`image-${ordinal}`]), thumbnail: new Blob(),
  width: 900, height: 1257, rotated: false,
});
describe('storage, recovery, filenames, ZIP', () => {
  it('keeps a renamed batch and its next ordinal during concurrent scan metadata writes', async () => {
    const b = await storage.create(5, 'Before scanning');
    await Promise.all([
      storage.renameBatch(b.id, 'Renamed while scanning'),
      storage.saveBatch({ ...b, nextOrdinal: 4 }),
    ]);
    await storage.saveBatch(b);
    const restored = await storage.load();
    expect(restored.batch?.name).toBe('Renamed while scanning'); expect(restored.batch?.nextOrdinal).toBe(4);
    await storage.clear(b.id);
  });
  it('defaults to Batch#XXX and safely uses the user-edited archive name', () => {
    expect(defaultBatchName(1)).toBe('Batch#001');
    expect(defaultBatchName(1234)).toBe('Batch#1234');
    expect(archiveFilename(undefined, 12)).toBe('Batch#012.zip');
    expect(archiveFilename(' Trade night 2026 ', 1)).toBe('Trade night 2026.zip');
    expect(archiveFilename('collection.zip', 1)).toBe('collection.zip');
    expect(archiveFilename('set/a:b?', 1)).toBe('set_a_b_.zip');
    expect(archiveFilename('..', 1)).toBe('Batch#001.zip');
    expect(archiveFilename('CON', 1)).toBe('_CON.zip');
  });
  it('formats local capture timestamps with 24-hour time and three-digit milliseconds', () => {
    expect(filename(new Date(2026, 0, 2, 3, 4, 5, 6).getTime())).toBe('01-02-26-03-04-05-006.jpg');
    expect(filename(new Date(2026, 10, 24, 23, 59, 58, 987).getTime())).toBe('11-24-26-23-59-58-987.jpg');
  });
  it('persists a photo directly and recovers the unfinished batch', async () => {
    const b = await storage.create(3), a = scan(b.id, 2);
    await storage.saveBatch({ ...b, nextOrdinal: 3 });
    await storage.accept(a);
    const recovered = await storage.load();
    expect(recovered.scans).toHaveLength(1); expect(recovered.attempts).toHaveLength(0); expect(recovered.batch?.nextOrdinal).toBe(3);
    await storage.clear(b.id); expect((await storage.load()).batch).toBeUndefined();
  });
  it('validates the saved count and protects a resized batch from stale metadata writes', async () => {
    const batch = await storage.create(5, 'Card binder');
    await storage.accept(scan(batch.id, 0));
    await storage.accept(scan(batch.id, 1));
    await expect(storage.resizeBatch(batch.id, 1)).rejects.toThrow('2 saved photos');
    await storage.resizeBatch(batch.id, 2);
    await storage.saveBatch({ ...batch, status: 'scanning', nextOrdinal: 2 });
    expect((await storage.load()).batch).toMatchObject({ name: batch.name, target: 2, status: 'complete', nextOrdinal: 2 });
    await storage.resizeBatch(batch.id, 8);
    const restored = await storage.load();
    expect(restored.batch).toMatchObject({ target: 8, status: 'paused' });
    expect(restored.scans).toHaveLength(2);
    await storage.clear(batch.id);
  });
  it('persists bulk deletion while keeping the other saved scans', async () => {
    const batch = await storage.create(3);
    const photos = [scan(batch.id, 0), scan(batch.id, 1), scan(batch.id, 2)];
    await Promise.all(photos.map(photo => storage.accept(photo)));
    await storage.deleteScans([photos[0].id, photos[2].id]);
    expect((await storage.load()).scans.map(photo => photo.id)).toEqual([photos[1].id]);
    await storage.clear(batch.id);
  });
  it('exports capture timestamps in capture order after failures or deletion', async () => {
    const data = [scan('test', 9), scan('test', 1), scan('test', 4)];
    const progress: number[] = [];
    const blob = await createZip(data, p => progress.push(p));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual([filename(data[1].capturedAt), filename(data[2].capturedAt), filename(data[0].capturedAt)]);
    expect(await zip.file(filename(data[1].capturedAt))!.async('string')).toBe('image-1');
    expect(await zip.file(filename(data[0].capturedAt))!.async('string')).toBe('image-9');
    expect(progress.at(-1)).toBe(100);
  });
  it('keeps timestamp names when exporting the newest photos first', async () => {
    const scans = [scan('test', 4), scan('test', 1), scan('test', 9)];
    const blob = await createZip(scans, () => {}, true);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual([filename(scans[2].capturedAt), filename(scans[0].capturedAt), filename(scans[1].capturedAt)]);
    expect(await Promise.all(Object.values(zip.files).map(file => file.async('string'))))
      .toEqual(['image-9', 'image-4', 'image-1']);
  });
  it('keeps every photo when timestamps collide and keeps names stable when order is reversed', async () => {
    const photos = [scan('test', 0), scan('test', 1), scan('test', 2)];
    photos[1].capturedAt = photos[0].capturedAt;
    const forward = await createZip(photos, () => {});
    const reversed = await createZip(photos, () => {}, true);
    const forwardZip = await JSZip.loadAsync(await forward.arrayBuffer());
    const reverseZip = await JSZip.loadAsync(await reversed.arrayBuffer());
    const names = Object.keys(forwardZip.files);
    expect(names).toEqual(photos.map((_, index) => filename(photos[0].capturedAt + index)));
    expect(Object.keys(reverseZip.files)).toEqual([...names].reverse());
    expect(await Promise.all(Object.values(forwardZip.files).map(file => file.async('string')))).toEqual(['image-0', 'image-1', 'image-2']);
  });
  it('creates increasing batch archive numbers and resets image numbering', async () => {
    const a = await storage.create(10), b = await storage.create(10);
    expect(b.number).toBe(a.number + 1); expect(b.nextOrdinal).toBe(0);
  });
});
