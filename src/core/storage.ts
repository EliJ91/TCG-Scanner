import { openDB, type DBSchema } from 'idb';
import { defaultBatchName, type Attempt, type Batch, type Scan, type Settings } from './types';
interface ScannerDB extends DBSchema {
  batches: { key: string; value: Batch };
  scans: { key: string; value: Scan; indexes: { 'by-batch': string } };
  attempts: { key: string; value: Attempt; indexes: { 'by-batch': string } };
  preferences: { key: string; value: Settings | string | number };
}
const db = () => openDB<ScannerDB>('cardslinger', 1, { upgrade(db) {
  db.createObjectStore('batches', { keyPath: 'id' });
  db.createObjectStore('scans', { keyPath: 'id' }).createIndex('by-batch', 'batchId');
  db.createObjectStore('attempts', { keyPath: 'id' }).createIndex('by-batch', 'batchId');
  db.createObjectStore('preferences');
} });
export const storage = {
  async load() {
    const d = await db();
    const id = await d.get('preferences', 'active');
    const batch = typeof id === 'string' ? await d.get('batches', id) : undefined;
    return { batch, scans: batch ? await d.getAllFromIndex('scans', 'by-batch', batch.id) : [],
      attempts: batch ? await d.getAllFromIndex('attempts', 'by-batch', batch.id) : [],
      settings: await d.get('preferences', 'settings') as Settings | undefined,
      nextBatchNumber: Number(await d.get('preferences', 'number') ?? 0) + 1 };
  },
  async create(target: number, name?: string): Promise<Batch> {
    const d = await db();
    const tx = d.transaction(['preferences', 'batches'], 'readwrite');
    const number = Number(await tx.objectStore('preferences').get('number') ?? 0) + 1;
    const batch: Batch = { id: crypto.randomUUID(), target, number, name: name?.trim() || defaultBatchName(number), createdAt: Date.now(), status: 'paused', nextOrdinal: 0 };
    await tx.objectStore('batches').put(batch);
    await tx.objectStore('preferences').put(batch.id, 'active');
    await tx.objectStore('preferences').put(number, 'number');
    await tx.done; return batch;
  },
  async saveBatch(batch: Batch) {
    const d = await db(); const tx = d.transaction('batches', 'readwrite'); const current = await tx.store.get(batch.id);
    await tx.store.put({ ...batch, name: current?.name ?? batch.name, nextOrdinal: Math.max(current?.nextOrdinal ?? 0, batch.nextOrdinal) }); await tx.done;
  },
  async renameBatch(id: string, name: string) {
    const d = await db(); const tx = d.transaction('batches', 'readwrite');
    const current = await tx.store.get(id);
    if (current) await tx.store.put({ ...current, name });
    await tx.done;
  },
  async settings(settings: Settings) { await (await db()).put('preferences', settings, 'settings'); },
  async stage(attempt: Attempt, batch: Batch) {
    const d = await db(); const tx = d.transaction(['attempts', 'batches'], 'readwrite');
    const current = await tx.objectStore('batches').get(batch.id);
    await tx.objectStore('attempts').put(attempt);
    await tx.objectStore('batches').put({ ...batch, name: current?.name ?? batch.name, nextOrdinal: Math.max(current?.nextOrdinal ?? 0, batch.nextOrdinal) }); await tx.done;
  },
  async accept(scan: Scan) {
    const d = await db(); const tx = d.transaction(['scans', 'attempts'], 'readwrite');
    await tx.objectStore('scans').put(scan); await tx.objectStore('attempts').delete(scan.id); await tx.done;
  },
  async saveAttempt(attempt: Attempt) { await (await db()).put('attempts', attempt); },
  async deleteScan(id: string) { await (await db()).delete('scans', id); },
  async deleteAttempt(id: string) { await (await db()).delete('attempts', id); },
  async clear(id: string) {
    const d = await db(); const tx = d.transaction(['batches', 'scans', 'attempts', 'preferences'], 'readwrite');
    for (const name of ['scans', 'attempts'] as const) {
      for (const key of await tx.objectStore(name).index('by-batch').getAllKeys(id)) await tx.objectStore(name).delete(key);
    }
    await tx.objectStore('batches').delete(id); await tx.objectStore('preferences').delete('active'); await tx.done;
  },
};
