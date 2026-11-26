import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { FeedbackLimits } from '../feedback/limits';

const databases: DatabaseSync[] = [];

function setup() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  const storage = {
    sql: {
      exec<T>(query: string, ...bindings: (string | number)[]): T[] {
        const statement = database.prepare(query);
        if (statement.columns().length) return statement.all(...bindings) as T[];
        statement.run(...bindings);
        return [];
      },
    },
    transactionSync<T>(callback: () => T): T {
      database.exec('BEGIN');
      try { const result = callback(); database.exec('COMMIT'); return result; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
  const counter = new FeedbackLimits({ storage });
  const reserve = (client = 0, target = counter) => target.fetch(new Request('https://counter/reserve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client: client.toString(36).padStart(43, 'a') }),
  }));
  return { database, storage, counter, reserve };
}

afterEach(() => { vi.useRealTimers(); databases.splice(0).forEach(database => database.close()); });

it('enforces a global daily budget across concurrent clients and a restarted counter', async () => {
  const { database, storage, reserve } = setup();
  const responses = await Promise.all(Array.from({ length: 105 }, (_, index) => reserve(index)));
  expect(responses.filter(response => response.status === 204)).toHaveLength(100);
  expect(responses.filter(response => response.status === 429)).toHaveLength(5);
  const row = database.prepare('SELECT total, clients FROM feedback_limit').get()!;
  expect(row.total).toBe(100);
  expect(Object.keys(JSON.parse(String(row.clients)))).toHaveLength(100);
  expect((await reserve(200, new FeedbackLimits({ storage }))).status).toBe(429);
  expect(database.prepare('SELECT total FROM feedback_limit').get()!.total).toBe(100);
});

it('limits each connection to three messages a day with a minute between messages', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-11-25T12:00:00Z');
  const { reserve } = setup();
  expect((await reserve()).status).toBe(204);
  const rapid = await reserve();
  expect(rapid.status).toBe(429);
  expect(rapid.headers.get('Retry-After')).toBe('60');
  for (let count = 0; count < 2; count++) {
    vi.setSystemTime(Date.now() + 60_000);
    expect((await reserve()).status).toBe(204);
  }
  vi.setSystemTime(Date.now() + 60_000);
  const daily = await reserve();
  expect(daily.status).toBe(429);
  expect((await daily.json()).error).toContain('daily limit of 3');
  expect((await reserve(1)).status).toBe(204);
});

it('resets both budgets at midnight UTC and discards the previous day’s client records', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-11-25T23:59:50Z');
  const { reserve, database } = setup();
  await Promise.all(Array.from({ length: 100 }, (_, index) => reserve(index)));
  const full = await reserve(100);
  expect(full.status).toBe(429);
  expect(full.headers.get('Retry-After')).toBe('10');
  vi.setSystemTime('2026-11-26T00:00:00Z');
  expect((await reserve(0)).status).toBe(204);
  const row = database.prepare('SELECT day, total, clients FROM feedback_limit').get()!;
  expect(row.day).toBe('2026-11-26');
  expect(row.total).toBe(1);
  expect(Object.keys(JSON.parse(String(row.clients)))).toHaveLength(1);
});

it('rejects malformed client keys without creating a reservation', async () => {
  const { counter, database } = setup();
  expect((await counter.fetch(new Request('https://counter/reserve'))).status).toBe(405);
  expect((await counter.fetch(new Request('https://counter/reserve', { method: 'POST', body: JSON.stringify({ client: 'not-a-hash' }) }))).status).toBe(400);
  expect(database.prepare('SELECT count(*) AS count FROM feedback_limit').get()!.count).toBe(0);
});
