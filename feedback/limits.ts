export const feedbackDailyLimit = 100;
export const feedbackConnectionLimit = 3;
export const feedbackCooldownSeconds = 60;

interface Counter {
  day: string;
  total: number;
  clients: string;
}

interface CounterStorage {
  sql: { exec<T>(query: string, ...bindings: (string | number)[]): Iterable<T> };
  transactionSync<T>(callback: () => T): T;
}

/** One SQLite-backed Durable Object serializes reservations across all locations. */
export class FeedbackLimits {
  private readonly storage: CounterStorage;

  constructor(state: { storage: CounterStorage }) {
    this.storage = state.storage;
    this.storage.sql.exec('CREATE TABLE IF NOT EXISTS feedback_limit (id INTEGER PRIMARY KEY CHECK(id=1), day TEXT NOT NULL, total INTEGER NOT NULL, clients TEXT NOT NULL)');
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const { client } = await request.json() as { client?: unknown };
    if (typeof client !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(client)) return new Response(null, { status: 400 });
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const resetSeconds = Math.max(1, Math.ceil((Date.parse(day + 'T00:00:00Z') + 86_400_000 - now) / 1000));
    const limited = (error: string, retryAfter: number) => Response.json({ error }, {
      status: 429, headers: { 'Retry-After': String(retryAfter) },
    });

    return this.storage.transactionSync(() => {
      const saved = [...this.storage.sql.exec<Counter>('SELECT day, total, clients FROM feedback_limit WHERE id=1')][0];
      const current = saved?.day === day ? saved : { day, total: 0, clients: '{}' };
      if (current.total >= feedbackDailyLimit) return limited('Feedback has reached its daily limit. Please try again after midnight UTC.', resetSeconds);
      const clients = JSON.parse(current.clients) as Record<string, { count: number; last: number }>;
      const previous = clients[client];
      if (previous?.count >= feedbackConnectionLimit) return limited('You have reached the daily limit of 3 messages from this internet connection. Please try again after midnight UTC.', resetSeconds);
      if (previous && now - previous.last < feedbackCooldownSeconds * 1000) {
        return limited('Please wait a minute between messages.', Math.max(1, Math.ceil((previous.last + feedbackCooldownSeconds * 1000 - now) / 1000)));
      }
      clients[client] = { count: (previous?.count ?? 0) + 1, last: now };
      // Reserve before writing feedback. Failed writes keep their reservation so
      // retries cannot exceed the KV write budget. No raw IP or message is stored here.
      this.storage.sql.exec('INSERT INTO feedback_limit (id, day, total, clients) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET day=excluded.day, total=excluded.total, clients=excluded.clients', day, current.total + 1, JSON.stringify(clients));
      return new Response(null, { status: 204 });
    });
  }
}
