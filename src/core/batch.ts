export interface Ticket { id: number; ordinal: number }
interface Slot<T> { ticket: Ticket; result?: { value: T } | { error: unknown; value?: T }; done?: Promise<void>; finish?: () => void }

/** Reservations include capture, processing AND durable storage. Only commit increments count. */
export class BatchController<T> {
  private slots: Slot<T>[] = [];
  private serial = 0;
  private draining = false;
  private waiters: (() => void)[] = [];
  public running = false;
  public count: number;
  public nextOrdinal: number;
  constructor(
    public readonly target: number, initial: number, nextOrdinal: number,
    public queueLimit: number,
    private readonly commit: (value: T, ticket: Ticket) => Promise<void>,
    private readonly failed: (error: unknown, ticket: Ticket, value?: T) => unknown,
    private readonly changed: () => void = () => {},
  ) { this.count = initial; this.nextOrdinal = nextOrdinal; }
  get pending() { return this.slots.length; }
  get complete() { return this.count >= this.target; }
  get hasCapacity() { return this.running && !this.complete && this.pending < this.queueLimit && this.count + this.pending < this.target; }
  get atBatchLimit() { return this.count + this.pending >= this.target; }
  start() { if (!this.complete) this.running = true; this.changed(); }
  pause() { this.running = false; this.changed(); }
  reserve(ordinal?: number, retained = false): Ticket | null {
    if ((!this.running && !retained) || this.complete || this.pending >= this.queueLimit || this.count + this.pending >= this.target) return null;
    const ticket = { id: ++this.serial, ordinal: ordinal ?? this.nextOrdinal++ };
    this.nextOrdinal = Math.max(this.nextOrdinal, ticket.ordinal + 1);
    this.slots.push({ ticket }); this.changed(); return ticket;
  }
  settle(ticket: Ticket, result: { value: T } | { error: unknown; value?: T }) {
    const slot = this.slots.find(s => s.ticket.id === ticket.id);
    if (!slot || slot.result) return slot?.done ?? Promise.resolve();
    slot.done = new Promise<void>(resolve => { slot.finish = resolve; });
    slot.result = result;
    void this.drain();
    return slot.done;
  }
  async idle() {
    if (!this.pending && !this.draining) return;
    await new Promise<void>(resolve => this.waiters.push(resolve));
  }
  removeStored() { if (this.count > 0) this.count--; this.pause(); }
  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.slots[0]?.result) {
        const slot = this.slots[0], { ticket, result } = slot;
        try {
          if ('error' in result!) throw result.error;
          await this.commit(result!.value, ticket);
          this.count++;
          if (this.complete) this.running = false;
        } catch (error) {
          // Failed captures release their slot; the operator's running/paused choice is preserved.
          await this.failed(error, ticket, result && 'value' in result ? result.value : undefined);
        } finally { this.slots.shift(); this.changed(); slot.finish?.(); }
      }
    } finally {
      this.draining = false;
      if (!this.pending) this.waiters.splice(0).forEach(resolve => resolve());
    }
  }
}
