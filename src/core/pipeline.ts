import { BatchController } from './batch';
import { storage } from './storage';
import { message, originalScan, type AttemptInfo, type Batch, type Scan, type Snapshot } from './types';

interface Events {
  changed(): void;
  saved(scan: Scan): void;
  storageIssue(reason: string): void;
}

/** Saves each camera JPEG directly. A failed write retains the same JPEG for retry. */
export class CapturePipeline {
  private controller: BatchController<Scan>;
  private unsaved?: Scan;
  private saveError = '';
  private disposed = false;

  constructor(private batch: Batch, count: number, private events: Events) {
    this.controller = new BatchController<Scan>(batch.target, count, batch.nextOrdinal, 1,
      async scan => {
        await storage.accept(scan);
        this.unsaved = undefined;
        if (!this.disposed) {
          this.events.storageIssue('');
          this.events.saved(scan);
        }
      },
      (error, _ticket, scan) => {
        if (!scan) return;
        this.unsaved = scan;
        this.saveError = `Storage unavailable: ${message(error)}. Keep this page open to retry saving the photo.`;
        if (!this.disposed) this.events.storageIssue(this.saveError);
      },
      () => { if (!this.disposed) this.events.changed(); });
  }

  get count() { return this.controller.count; }
  get pending() { return this.controller.pending; }
  get nextOrdinal() { return this.controller.nextOrdinal; }
  get complete() { return this.controller.complete; }
  get running() { return this.controller.running; }
  get atBatchLimit() { return this.controller.atBatchLimit; }
  get hasCapacity() { return !this.unsaved && this.controller.hasCapacity; }
  get retained(): AttemptInfo | undefined {
    const scan = this.unsaved;
    if (scan) {
      const { id, batchId, ordinal, capturedAt } = scan;
      return { id, batchId, ordinal, capturedAt, reason: this.saveError };
    }
  }

  start() { this.controller.start(); }
  pause() { this.controller.pause(); }
  removeStored() { this.controller.removeStored(); }
  dispose() { this.disposed = true; }

  async capture(snapshot: () => Promise<Snapshot>) {
    if (!this.hasCapacity) return;
    const ticket = this.controller.reserve();
    if (!ticket) return;
    const capturedAt = Date.now();
    try {
      const image = await snapshot();
      await this.controller.settle(ticket, {
        value: { ...image, id: crypto.randomUUID(), batchId: this.batch.id, ordinal: ticket.ordinal, capturedAt, rotated: false },
      });
    } catch (error) {
      await this.controller.settle(ticket, { error });
      throw error;
    }
  }

  async original(id: string) {
    if (this.unsaved?.id === id) return this.unsaved.blob;
    return (await storage.getAttempt(id))?.raw;
  }

  async keepOriginal(info: AttemptInfo) {
    if (this.running || this.unsaved || this.pending || this.complete) return;
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
    if (this.unsaved?.id === info.id) {
      this.unsaved = undefined;
      this.events.storageIssue('');
      this.events.changed();
    }
  }

  async retryStorage() {
    if (!this.unsaved || this.pending || this.disposed) return;
    const ticket = this.controller.reserve(this.unsaved.ordinal, true);
    if (ticket) await this.controller.settle(ticket, { value: this.unsaved });
  }
}
