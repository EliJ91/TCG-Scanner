import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { describe, it, expect } from 'vitest';
import { storage } from '../src/core/storage';
import { createZip } from '../src/core/export';
import { archiveFilename, defaultBatchName, filename, type Scan } from '../src/core/types';
const scan = (batchId: string, ordinal: number): Scan => ({
  id: crypto.randomUUID(), batchId, ordinal, capturedAt: Date.now(), blob: new Blob([`image-${ordinal}`]), thumbnail: new Blob(),
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
  it('generates gap-free names including numbers above 9999', () => {
    expect([0,1,9,99].map(filename)).toEqual(['Pokemon_0001.jpg','Pokemon_0002.jpg','Pokemon_0010.jpg','Pokemon_0100.jpg']);
    expect(filename(9999)).toBe('Pokemon_10000.jpg');
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
  it('exports in capture order, with no gaps from failures or deletion', async () => {
    const data = [scan('test', 9), scan('test', 1), scan('test', 4)];
    const progress: number[] = [];
    const blob = await createZip(data, p => progress.push(p));
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files)).toEqual(['Pokemon_0001.jpg','Pokemon_0002.jpg','Pokemon_0003.jpg']);
    expect(await zip.file('Pokemon_0001.jpg')!.async('string')).toBe('image-1');
    expect(await zip.file('Pokemon_0003.jpg')!.async('string')).toBe('image-9');
    expect(progress.at(-1)).toBe(100);
  });
  it('creates increasing batch archive numbers and resets image numbering', async () => {
    const a = await storage.create(10), b = await storage.create(10);
    expect(b.number).toBe(a.number + 1); expect(b.nextOrdinal).toBe(0);
  });
});
