import { BatchController } from './batch';
import { storage } from './storage';
import { message, originalScan, type AttemptInfo, type Batch, type Scan, type Snapshot } from './types';

interface Events {
  changed(): void;
  saved(scan: Scan): void;
  storageIssue(reason: string): void;
}

const saveQueueLimit = 8;

/** Captures JPEGs into a bounded queue. IndexedDB writes run in capture order. */
export class CapturePipeline {
  private controller: BatchController<Scan>;
  private unsaved = new Map<string, Scan>();
  private saveError = '';
  private disposed = false;

  constructor(private batch: Batch, count: number, private events: Events) {
    this.controller = new BatchController<Scan>(batch.target, count, batch.nextOrdinal, saveQueueLimit,
      async scan => {
        if (this.unsaved.size && !this.unsaved.has(scan.id)) throw new Error(this.saveError);
        await storage.accept(scan);
        const recovered = this.unsaved.delete(scan.id) && !this.unsaved.size;
        if (!this.disposed) {
          if (recovered) this.events.storageIssue('');
          this.events.saved(scan);
        }
      },
      (error, _ticket, scan) => {
        if (!scan) return;
        const firstFailure = !this.unsaved.size;
        this.unsaved.set(scan.id, scan);
        if (firstFailure) {
          this.saveError = `Storage unavailable: ${message(error)}. Keep this page open while the scanner retries saving.`;
          if (!this.disposed) this.events.storageIssue(this.saveError);
        }
      },
      () => { if (!this.disposed) this.events.changed(); });
  }

  get count() { return this.controller.count; }
  get pending() { return this.controller.pending; }
  get nextOrdinal() { return this.controller.nextOrdinal; }
  get complete() { return this.controller.complete; }
  get atBatchLimit() { return this.controller.atBatchLimit; }
  get running() { return this.controller.running; }
  get queueFull() { return this.pending >= saveQueueLimit; }
  get hasCapacity() { return !this.unsaved.size && this.controller.hasCapacity; }
  get retained(): AttemptInfo[] {
    return [...this.unsaved.values()].map(({ id, batchId, ordinal, capturedAt }) => ({ id, batchId, ordinal, capturedAt, reason: this.saveError }));
  }

  start() { this.controller.start(); }
  pause() { this.controller.pause(); }
  resize(target: number) { this.controller.resize(target); }
  removeStored(count: number) { this.controller.removeStored(count); }
  dispose() { this.disposed = true; }

  async capture(snapshot: () => Promise<Snapshot>) {
    if (!this.hasCapacity) return;
    const ticket = this.controller.reserve();
    if (!ticket) return;
    const capturedAt = Date.now();
    try {
      const image = await snapshot();
      void this.controller.settle(ticket, {
        value: { ...image, id: crypto.randomUUID(), batchId: this.batch.id, ordinal: ticket.ordinal, capturedAt, rotated: false },
      });
    } catch (error) {
      void this.controller.settle(ticket, { error });
      throw error;
    }
  }

  async original(id: string) {
    const unsaved = this.unsaved.get(id);
    if (unsaved) return unsaved.blob;
    return (await storage.getAttempt(id))?.raw;
  }

  async keepOriginal(info: AttemptInfo) {
    if (this.running || this.unsaved.size || this.pending || this.complete) return;
    const ticket = this.controller.reserve(info.ordinal, true);
    if (!ticket) return;
    try {
      const attempt = await storage.getAttempt(info.id);
      if (!attempt) throw new Error('This original photo is no longer available.');
      await this.controller.settle(ticket, { value: originalScan(attempt) });
    } catch (error) {
      await this.controller.settle(ticket, { error });
      throw error;
    }
  }

  async discard(info: AttemptInfo) {
    if (this.pending || this.running) return;
    await storage.deleteAttempt(info.id);
    if (this.unsaved.delete(info.id)) {
      if (!this.unsaved.size) this.events.storageIssue('');
      this.events.changed();
    }
  }

  async retryStorage() {
    while (this.unsaved.size && !this.pending && !this.disposed) {
      const scan = this.unsaved.values().next().value!;
      const ticket = this.controller.reserve(scan.ordinal, true);
      if (!ticket) return;
      await this.controller.settle(ticket, { value: scan });
      if (this.unsaved.has(scan.id)) return;
    }
  }
}
