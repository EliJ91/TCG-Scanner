import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { describe, it, expect } from 'vitest';
import { storage } from '../src/core/storage';
import { createZip } from '../src/core/export';
import { archiveFilename, defaultBatchName, defaults, filename, type Scan } from '../src/core/types';
const scan = (batchId: string, ordinal: number): Scan => ({
  id: crypto.randomUUID(), batchId, ordinal, capturedAt: Date.now(), blob: new Blob([`image-${ordinal}`]), thumbnail: new Blob(),
  width: 900, height: 1257, processingMs: 10, sharpness: 100, confidence: 0.9, corners: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}], rotated: false,
});
describe('storage, recovery, filenames, ZIP', () => {
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
  it('persists raw captures, accepts atomically, and recovers the unfinished batch', async () => {
    const b = await storage.create(3), a = scan(b.id, 2);
    await storage.stage({ id: a.id, batchId: b.id, ordinal: a.ordinal, capturedAt: a.capturedAt, raw: a.blob, reason: '', settings: defaults }, { ...b, nextOrdinal: 3 });
    expect((await storage.load()).attempts).toHaveLength(1);
    await storage.accept(a);
    const recovered = await storage.load();
    expect(recovered.scans).toHaveLength(1); expect(recovered.attempts).toHaveLength(0); expect(recovered.batch?.nextOrdinal).toBe(3);
    await storage.clear(b.id); expect((await storage.load()).batch).toBeUndefined();
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
