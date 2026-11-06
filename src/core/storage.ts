import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { attemptInfo, defaultBatchName, type Attempt, type AttemptInfo, type Batch, type Scan, type Settings } from './types';
interface ScannerDB extends DBSchema {
  batches: { key: string; value: Batch };
  scans: { key: string; value: Scan; indexes: { 'by-batch': string } };
  attempts: { key: string; value: Attempt; indexes: { 'by-batch': string } };
  captureInfo: { key: string; value: AttemptInfo; indexes: { 'by-batch': string } };
  preferences: { key: string; value: Settings | string | number };
}
let connection: Promise<IDBPDatabase<ScannerDB>> | undefined;
const db = () => connection ??= openDB<ScannerDB>('cardslinger', 2, { upgrade(db, oldVersion, _newVersion, tx) {
  if (oldVersion < 1) {
    db.createObjectStore('batches', { keyPath: 'id' });
    db.createObjectStore('scans', { keyPath: 'id' }).createIndex('by-batch', 'batchId');
    db.createObjectStore('attempts', { keyPath: 'id' }).createIndex('by-batch', 'batchId');
    db.createObjectStore('preferences');
  }
  if (oldVersion < 2) {
    const info = db.createObjectStore('captureInfo', { keyPath: 'id' }); info.createIndex('by-batch', 'batchId');
    // Copy only metadata. Queued JPEGs remain in their original store, including after an upgrade.
    void (async () => {
      let cursor = await tx.objectStore('attempts').openCursor();
      while (cursor) { await info.put(attemptInfo(cursor.value)); cursor = await cursor.continue(); }
    })().catch(() => tx.abort());
  }
}, blocking(_current, _next, event) { (event.target as IDBDatabase).close(); connection = undefined; },
terminated() { connection = undefined; } }).catch(error => { connection = undefined; throw error; });
export const storage = {
  async load() {
    const d = await db();
    const id = await d.get('preferences', 'active');
    const batch = typeof id === 'string' ? await d.get('batches', id) : undefined;
    return { batch, scans: batch ? await d.getAllFromIndex('scans', 'by-batch', batch.id) : [],
      attempts: batch ? await d.getAllFromIndex('captureInfo', 'by-batch', batch.id) : [],
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
    const d = await db(); const tx = d.transaction(['attempts', 'captureInfo', 'batches'], 'readwrite');
    const current = await tx.objectStore('batches').get(batch.id);
    await tx.objectStore('attempts').put(attempt);
    await tx.objectStore('captureInfo').put(attemptInfo(attempt));
    await tx.objectStore('batches').put({ ...batch, name: current?.name ?? batch.name, nextOrdinal: Math.max(current?.nextOrdinal ?? 0, batch.nextOrdinal) }); await tx.done;
  },
  async accept(scan: Scan) {
    const d = await db(); const tx = d.transaction(['scans', 'attempts', 'captureInfo'], 'readwrite');
    await tx.objectStore('scans').put(scan); await tx.objectStore('attempts').delete(scan.id); await tx.objectStore('captureInfo').delete(scan.id); await tx.done;
  },
  async getAttempt(id: string) {
    const d = await db(); const tx = d.transaction(['attempts','captureInfo']);
    const [raw, info] = await Promise.all([tx.objectStore('attempts').get(id),tx.objectStore('captureInfo').get(id)]);
    await tx.done; return raw ? { ...raw, ...info } : undefined;
  },
  async markAttempt(id: string, reason: string) {
    const d = await db(); const tx = d.transaction('captureInfo','readwrite'); const info = await tx.store.get(id);
    if (info) await tx.store.put({ ...info, reason }); await tx.done;
  },
  async deleteScan(id: string) { await (await db()).delete('scans', id); },
  async deleteAttempt(id: string) {
    const d = await db(); const tx = d.transaction(['attempts','captureInfo'],'readwrite');
    await tx.objectStore('attempts').delete(id); await tx.objectStore('captureInfo').delete(id); await tx.done;
  },
  async clear(id: string) {
    const d = await db(); const tx = d.transaction(['batches', 'scans', 'attempts', 'captureInfo', 'preferences'], 'readwrite');
    for (const name of ['scans', 'attempts', 'captureInfo'] as const) {
      for (const key of await tx.objectStore(name).index('by-batch').getAllKeys(id)) await tx.objectStore(name).delete(key);
    }
    await tx.objectStore('batches').delete(id); await tx.objectStore('preferences').delete('active'); await tx.done;
  },
};
