export interface Ticket { id: number; ordinal: number }
interface Slot<T> { ticket: Ticket; result?: { value: T } | { error: unknown } }

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
    private readonly failed: (error: unknown, ticket: Ticket, value?: T) => void,
    private readonly changed: () => void = () => {},
  ) { this.count = initial; this.nextOrdinal = nextOrdinal; }
  get pending() { return this.slots.length; }
  get complete() { return this.count >= this.target; }
  get hasCapacity() { return this.running && !this.complete && this.pending < this.queueLimit && this.count + this.pending < this.target; }
  get atBatchLimit() { return this.count + this.pending >= this.target; }
  start() { if (!this.complete) this.running = true; this.changed(); }
  pause() { this.running = false; this.changed(); }
  reserve(ordinal?: number): Ticket | null {
    if (!this.hasCapacity) return null;
    const ticket = { id: ++this.serial, ordinal: ordinal ?? this.nextOrdinal++ };
    this.slots.push({ ticket }); this.changed(); return ticket;
  }
  settle(ticket: Ticket, result: { value: T } | { error: unknown }) {
    const slot = this.slots.find(s => s.ticket.id === ticket.id);
    if (!slot || slot.result) return;
    slot.result = result;
    void this.drain();
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
        const { ticket, result } = this.slots[0];
        try {
          if ('error' in result!) throw result.error;
          await this.commit(result!.value, ticket);
          this.count++;
          if (this.complete) this.running = false;
        } catch (error) {
          this.running = false;
          this.failed(error, ticket, result && 'value' in result ? result.value : undefined);
        } finally { this.slots.shift(); this.changed(); }
      }
    } finally {
      this.draining = false;
      if (!this.pending) this.waiters.splice(0).forEach(resolve => resolve());
    }
  }
}
