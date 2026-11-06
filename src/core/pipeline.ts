import { BatchController, type Ticket } from './batch';
import { storage } from './storage';
import { ProcessingDeferred, attemptInfo, message, ordered, type Attempt, type AttemptInfo, type Batch, type Processed, type Scan, type Settings } from './types';

interface Engine { fallback: boolean; init(): Promise<void>; process(raw: Blob, settings: Settings, allowFallback?: boolean): Promise<Processed> }
interface Events {
  changed(): void; attempts(items: AttemptInfo[]): void; photographed(): void;
  processed(scan: Scan, settings: Settings): void; failed(info: AttemptInfo): void; storageIssue(reason: string): void;
  processingIssue?(reason: string): void;
}
interface Work { id: string; ticket: Ticket }
interface Job { attempt: Attempt; result?: Processed }
class StorageIssue extends Error {}

/** Raw capture is persisted first. The single processing reader never gates subsequent photos. */
export class CapturePipeline {
  private controller: BatchController<Job>;
  private queue: Work[] = [];
  private info: AttemptInfo[];
  private storageRetries = new Map<string, { attempt: Attempt; ticket?: Ticket }>();
  private working = false;
  private readBlocked = false;
  private disposed = false;
  public staging = false;
  public fallback = false;
  constructor(public batch: Batch, count: number, infos: AttemptInfo[], private engine: Engine, private events: Events) {
    this.info = ordered(infos);
    // The durable queue is bounded by remaining batch slots, not by worker speed.
    this.controller = new BatchController(batch.target, count, batch.nextOrdinal, batch.target,
      async ({ attempt, result }) => {
        if (!result) throw new Error('Processing returned no image.');
        const scan: Scan = { ...result, id: attempt.id, batchId: batch.id, ordinal: attempt.ordinal, capturedAt: attempt.capturedAt, rotated: false };
        try { await storage.accept(scan); } catch (err) { throw new StorageIssue(`Storage unavailable: ${message(err)}. Saved photos will retry automatically.`); }
        if (this.disposed) return;
        this.info = this.info.filter(a => a.id !== scan.id); this.events.attempts(this.info); this.events.processed(scan, attempt.settings);
      },
      async (error, _ticket, job) => {
        if (!job || this.disposed) return;
        const { attempt } = job, reason = message(error), info = { ...attemptInfo(attempt), reason };
        this.replace(info);
        if (error instanceof StorageIssue) { this.storageRetries.set(attempt.id, { attempt }); this.events.storageIssue(reason); }
        else {
          try { await storage.markAttempt(attempt.id, reason); }
          catch (err) { this.storageRetries.set(attempt.id, { attempt }); this.events.storageIssue(`Storage unavailable: ${message(err)}. Original photos are retained.`); }
          this.events.failed(info);
        }
      }, () => { if (!this.disposed) this.events.changed(); });
    // Recovered queued originals resume processing without taking new camera photos.
    for (const info of this.info.filter(a => !a.reason)) {
      const ticket = this.controller.reserve(info.ordinal, true);
      if (ticket) this.queue.push({ id: info.id, ticket });
    }
  }
  get count() { return this.controller.count; }
  get pending() { return this.controller.pending; }
  get nextOrdinal() { return this.controller.nextOrdinal; }
  get complete() { return this.controller.complete; }
  get running() { return this.controller.running; }
  get atBatchLimit() { return this.controller.atBatchLimit; }
  get hasCapacity() { return !this.staging && !this.readBlocked && !this.storageRetries.size && this.controller.hasCapacity; }
  start() { this.controller.start(); this.kick(); }
  pause() { this.controller.pause(); this.kick(); }
  removeStored() { this.controller.removeStored(); }
  dispose() { this.disposed = true; }
  private replace(info: AttemptInfo) {
    this.info = ordered([...this.info.filter(a => a.id !== info.id), info]); this.events.attempts(this.info);
  }
  private metadata(): Batch { return { ...this.batch, nextOrdinal: this.nextOrdinal }; }
  async capture(snapshot: () => Promise<Blob>, settings: Settings) {
    if (!this.hasCapacity) return;
    const ticket = this.controller.reserve(); if (!ticket) return;
    this.staging = true; this.events.changed();
    try {
      const capturedAt = Date.now(), raw = await snapshot();
      const attempt: Attempt = { id: crypto.randomUUID(), batchId: this.batch.id, ordinal: ticket.ordinal, capturedAt, raw, reason: '', settings: { ...settings } };
      await this.stage(attempt, ticket, true);
    } catch (error) { void this.controller.settle(ticket, { error }); throw error; }
    finally { this.staging = false; if (!this.disposed) { this.events.changed(); this.kick(); } }
  }
  private async stage(attempt: Attempt, ticket: Ticket, ding = false) {
    try { await storage.stage(attempt, this.metadata()); }
    catch (error) {
      const reason = `Storage unavailable: ${message(error)}. Keep this page open; the original photo will retry automatically.`;
      this.storageRetries.set(attempt.id, { attempt, ticket }); this.replace({ ...attemptInfo(attempt), reason }); this.events.storageIssue(reason); return;
    }
    if (this.disposed) return;
    this.storageRetries.delete(attempt.id); this.replace(attemptInfo(attempt));
    this.queue.push({ id: attempt.id, ticket });
    if (ding) this.events.photographed();
  }
  async original(id: string) { return this.storageRetries.get(id)?.attempt ?? storage.getAttempt(id); }
  async retry(info: AttemptInfo, settings: Settings) {
    if (this.running || this.staging || this.complete || this.storageRetries.has(info.id)) return;
    const attempt = await this.original(info.id); if (!attempt) throw new Error('This original photo is no longer available.');
    const ticket = this.controller.reserve(info.ordinal, true); if (!ticket) return;
    this.staging = true; this.events.changed();
    try { await this.stage({ ...attempt, reason: '', settings: { ...settings } }, ticket); }
    finally { this.staging = false; this.events.changed(); this.kick(); }
  }
  async discard(info: AttemptInfo) {
    if (this.pending || this.running) return;
    await storage.deleteAttempt(info.id); this.storageRetries.delete(info.id);
    this.info = this.info.filter(a => a.id !== info.id); this.events.attempts(this.info);
  }
  async retryStorage() {
    if (this.staging || this.disposed) return;
    if (this.readBlocked) { this.kick(); return; }
    if (!this.storageRetries.size) return;
    this.staging = true; this.events.changed();
    try {
      for (const { attempt, ticket: reserved } of this.storageRetries.values()) {
        const ticket = reserved ?? this.controller.reserve(attempt.ordinal, true); if (!ticket) continue;
        await this.stage({ ...attempt, reason: '' }, ticket, !!reserved);
        // A failed retry retains this exact reservation instead of reserving another slot.
        if (this.storageRetries.has(attempt.id)) { this.storageRetries.set(attempt.id, { attempt, ticket }); break; }
      }
      if (!this.storageRetries.size) this.events.storageIssue('');
    } finally { this.staging = false; this.events.changed(); this.kick(); }
  }
  kick() { void this.drain(); }
  private async drain() {
    if (this.working || this.disposed || !this.queue.length || this.storageRetries.size) return;
    this.working = true;
    try {
      await this.engine.init(); this.fallback = this.engine.fallback; this.events.changed();
      while (!this.disposed && this.queue.length && !this.storageRetries.size) {
        // A compatibility fallback runs only when capture is paused or all batch photos are saved.
        if (this.fallback && this.running && (!this.atBatchLimit || this.staging)) break;
        const work = this.queue.shift()!;
        let attempt: Attempt | undefined;
        try {
          attempt = await storage.getAttempt(work.id);
          if (!attempt) throw new Error('Saved original could not be read.');
          if (this.readBlocked) { this.readBlocked = false; this.events.storageIssue(''); }
          let result: Processed;
          try { result = await this.engine.process(attempt.raw, attempt.settings, !this.running || this.atBatchLimit && !this.staging); }
          catch (error) {
            if (error instanceof ProcessingDeferred) { this.fallback = true; this.queue.unshift(work); this.events.changed(); break; }
            await this.controller.settle(work.ticket, { error, value: { attempt } }); continue;
          }
          await this.controller.settle(work.ticket, { value: { attempt, result } });
        } catch (error) {
          if (this.disposed) return;
          this.queue.unshift(work); this.readBlocked = true;
          this.events.storageIssue(`Original photo could not be loaded: ${message(error)}. It will retry automatically.`); return;
        }
      }
    } catch (error) { if (!this.disposed) this.events.processingIssue?.(`Cropping will retry: ${message(error)}. Original photos are saved; capture can continue.`); }
    finally { this.working = false; }
  }
}
