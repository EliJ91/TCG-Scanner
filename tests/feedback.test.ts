import { afterEach, expect, it, vi } from 'vitest';
import worker from '../feedback/worker';

const origin = 'https://elij91.github.io';
const workerOrigin = 'https://feedback.example.com';
const ownerId = 59631669;

function setup() {
  const messages = new Map<string, string>();
  const env: Parameters<typeof worker.fetch>[1] = {
    SCANNER_URL: origin + '/TCG-Scanner/',
    OWNER_GITHUB_ID: String(ownerId),
    GITHUB_CLIENT_ID: 'test-client',
    GITHUB_CLIENT_SECRET: 'test-secret',
    SESSION_SECRET: 'a-test-only-key-longer-than-thirty-two-characters',
    FEEDBACK: {
      put: async (key, value) => { messages.set(key, value); },
      get: async keys => new Map(keys.map(key => [key, JSON.parse(messages.get(key) ?? 'null')])),
      list: vi.fn(async () => ({ keys: [...messages.keys()].sort().map(name => ({ name })), list_complete: true as const })),
      delete: async key => { messages.delete(key); },
    },
    SUBMISSION_LIMIT: { limit: vi.fn(async () => ({ success: true })) },
  };
  const request = (path: string, options?: RequestInit) => worker.fetch(new Request(workerOrigin + path, options), env);
  const post = (message: string, category = 'issue', from = origin) => request('/feedback', {
    method: 'POST',
    headers: { Origin: from, 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, message }),
  });
  async function signIn(id: number, expectedState = true) {
    const github = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'temporary-token' }))
      .mockResolvedValueOnce(Response.json({ id, login: 'EliJ91' }));
    vi.stubGlobal('fetch', github);
    const login = await request('/login');
    const authorize = new URL(login.headers.get('Location')!);
    expect(authorize.origin).toBe('https://github.com');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    const state = expectedState ? authorize.searchParams.get('state') : 'wrong';
    const temporary = login.headers.get('Set-Cookie')!.split(';')[0];
    const result = await request(`/oauth/callback?code=code&state=${state}`, { headers: { Cookie: temporary } });
    return { result, github };
  }
  return { messages, env, request, post, signIn };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('accepts anonymous feedback while denying public reads and deletes', async () => {
  const { messages, env, request, post } = setup();
  const sent = await post('  Thank you!  ', 'thanks');
  expect(sent.status).toBe(201);
  expect(sent.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  const [key, value] = [...messages][0];
  expect(JSON.parse(value)).toEqual({ id: key.slice('feedback/'.length), message: 'Thank you!', category: 'thanks', createdAt: expect.any(String) });
  const signIn = await request('/inbox');
  expect(await signIn.text()).toContain('Sign in with GitHub');
  expect(env.FEEDBACK.list).not.toHaveBeenCalled();
  const remove = await request('/inbox/delete/' + key.slice('feedback/'.length), { method: 'POST', headers: { Origin: workerOrigin } });
  expect(remove.status).toBe(403);
  expect(messages.size).toBe(1);
});

it('rejects foreign origins, invalid submissions, oversized bodies and rate limited requests', async () => {
  const { messages, env, request, post } = setup();
  expect((await post('hello', 'review', 'https://other.example.com')).status).toBe(403);
  expect((await post('hello', 'constructor')).status).toBe(400);
  expect((await post('   ')).status).toBe(400);
  expect((await post('x'.repeat(17_000))).status).toBe(400);
  expect((await request('/feedback', { method: 'OPTIONS', headers: { Origin: origin } })).status).toBe(204);
  vi.mocked(env.SUBMISSION_LIMIT.limit).mockResolvedValue({ success: false });
  expect((await post('hello')).status).toBe(429);
  expect(messages.size).toBe(0);
});

it('waits for the inbox to be configured before accepting feedback', async () => {
  const { messages, env, request, post } = setup();
  env.SESSION_SECRET = '';
  expect((await post('Thank you!', 'thanks')).status).toBe(503);
  expect((await request('/inbox')).status).toBe(503);
  expect(messages.size).toBe(0);
});

it('checks the signed OAuth state and denies a GitHub account with the wrong ID', async () => {
  const { signIn } = setup();
  const invalid = await signIn(ownerId, false);
  expect(invalid.result.status).toBe(400);
  expect(invalid.github).not.toHaveBeenCalled();
  const other = await signIn(7);
  expect(other.result.status).toBe(403);
  expect(other.result.headers.getSetCookie().join(';')).not.toContain('__Host-feedback_session');
});

it('lets only the signed-in owner read and delete escaped messages from the inbox', async () => {
  const { messages, request, post, signIn } = setup();
  await post('<script>alert(1)</script>');
  const [key] = messages.keys();
  const path = '/inbox/delete/' + key.slice('feedback/'.length);
  const { result, github } = await signIn(ownerId);
  expect(result.status).toBe(303);
  expect(github).toHaveBeenLastCalledWith('https://api.github.com/user', expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer temporary-token' }),
  }));
  const cookie = result.headers.getSetCookie().find(value => value.startsWith('__Host-feedback_session='))!;
  expect(cookie).toContain('Secure; HttpOnly; SameSite=Lax');
  const Cookie = cookie.split(';')[0];
  const inbox = await request('/inbox', { headers: { Cookie } });
  expect(inbox.headers.get('Cache-Control')).toBe('no-store');
  const html = await inbox.text();
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toContain('<script>alert(1)</script>');
  expect((await request(path, { method: 'POST', headers: { Cookie, Origin: origin } })).status).toBe(403);
  expect((await request(path, { method: 'POST', headers: { Cookie: Cookie + 'x', Origin: workerOrigin } })).status).toBe(403);
  expect((await request(path, { method: 'POST', headers: { Cookie, Origin: workerOrigin } })).status).toBe(303);
  expect(messages.size).toBe(0);
  expect(await (await request('/inbox', { headers: { Cookie } })).text()).toContain('No messages here.');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 8 * 60 * 60 * 1000 + 1000);
  expect(await (await request('/inbox', { headers: { Cookie } })).text()).toContain('Sign in with GitHub');
});
