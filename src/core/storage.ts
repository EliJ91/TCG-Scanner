import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { attemptInfo, defaultBatchName, ordered, originalScan, validBatchTarget, type Attempt, type AttemptInfo, type Batch, type Scan, type Settings } from './types';
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
    const tx = d.transaction(['batches', 'scans', 'attempts', 'captureInfo', 'preferences'], 'readwrite');
    const prefs = tx.objectStore('preferences');
    const id = await prefs.get('active');
    const batch = typeof id === 'string' ? await tx.objectStore('batches').get(id) : undefined;
    const scans = batch ? await tx.objectStore('scans').index('by-batch').getAll(batch.id) : [];
    const attempts = batch ? await tx.objectStore('captureInfo').index('by-batch').getAll(batch.id) : [];
    const retained: AttemptInfo[] = [];
    // Keep originals queued by earlier versions without decoding or changing their JPEGs.
    for (const info of ordered(attempts)) {
      if (batch && !info.reason && scans.length < batch.target) {
        const original = await tx.objectStore('attempts').get(info.id);
        if (original) {
          const scan = originalScan(original);
          await tx.objectStore('scans').put(scan);
          await tx.objectStore('attempts').delete(info.id);
          await tx.objectStore('captureInfo').delete(info.id);
          scans.push(scan);
          continue;
        }
      }
      retained.push(info);
    }
    const settings = await prefs.get('settings') as Settings | undefined;
    const nextBatchNumber = Number(await prefs.get('number') ?? 0) + 1;
    await tx.done;
    return { batch, scans, attempts: retained, settings, nextBatchNumber };
  },
  async create(target: number, name?: string): Promise<Batch> {
    if (!validBatchTarget(target)) throw new Error('Choose a valid batch size.');
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
    if (current) await tx.store.put({
      ...current,
      status: current.target === batch.target ? batch.status : current.status,
      nextOrdinal: Math.max(current.nextOrdinal, batch.nextOrdinal),
    });
    await tx.done;
  },
  async resizeBatch(id: string, target: number) {
    if (!validBatchTarget(target)) throw new Error('Choose a valid batch size.');
    const d = await db();
    const tx = d.transaction(['batches', 'scans'], 'readwrite');
    const batches = tx.objectStore('batches');
    const current = await batches.get(id);
    if (!current) throw new Error('This batch is no longer available.');
    const count = await tx.objectStore('scans').index('by-batch').count(id);
    if (target < count) throw new Error(`The batch already has ${count} saved photos.`);
    const status = target === count ? 'complete' : current.status === 'complete' ? 'paused' : current.status;
    await batches.put({ ...current, target, status });
    await tx.done;
  },
  async renameBatch(id: string, name: string) {
    const d = await db(); const tx = d.transaction('batches', 'readwrite');
    const current = await tx.store.get(id);
    if (current) await tx.store.put({ ...current, name });
    await tx.done;
  },
  async settings(settings: Settings) { await (await db()).put('preferences', settings, 'settings'); },
  async accept(scan: Scan) {
    const d = await db(); const tx = d.transaction(['scans', 'attempts', 'captureInfo'], 'readwrite');
    await Promise.all([
      tx.objectStore('scans').put(scan),
      tx.objectStore('attempts').delete(scan.id),
      tx.objectStore('captureInfo').delete(scan.id),
      tx.done,
    ]);
  },
  async getAttempt(id: string) {
    const d = await db(); const tx = d.transaction(['attempts','captureInfo']);
    const [raw, info] = await Promise.all([tx.objectStore('attempts').get(id),tx.objectStore('captureInfo').get(id)]);
    await tx.done; return raw ? { ...raw, ...info } : undefined;
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
