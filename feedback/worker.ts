import { feedbackCategories, feedbackMessageLimit, type FeedbackCategory } from '../src/core/feedback';
import { inbox, page, type Feedback } from './inbox';

interface Env {
  SCANNER_URL: string;
  OWNER_GITHUB_ID: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  FEEDBACK: {
    put(key: string, value: string): Promise<unknown>;
    get<T>(keys: string[], type: 'json'): Promise<Map<string, T | null>>;
    list(options: { prefix: string; limit: number; cursor?: string }): Promise<
      { keys: { name: string }[] } & ({ list_complete: false; cursor: string } | { list_complete: true })
    >;
    delete(key: string): Promise<void>;
  };
  SUBMISSION_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const oauthCookie = '__Host-feedback_oauth';
const sessionCookie = '__Host-feedback_session';
const prefix = 'feedback/';
const messageId = /^\d{13}-[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/;
const encoder = new TextEncoder();

function signInConfigured(env: Env) {
  return !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSION_SECRET?.length >= 32);
}

type SignedData =
  | { kind: 'oauth'; exp: number; state: string; verifier: string }
  | { kind: 'session'; exp: number; owner: string };

function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decode(value: string) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
}

function signingKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(data: SignedData, secret: string) {
  const payload = encode(encoder.encode(JSON.stringify(data)));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}

async function readSigned(request: Request, name: string, secret: string): Promise<SignedData | undefined> {
  const value = request.headers.get('Cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(name + '='))?.slice(name.length + 1);
  if (!value || value.length > 1024) return;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return;
  try {
    if (!await crypto.subtle.verify('HMAC', await signingKey(secret), decode(signature), encoder.encode(payload))) return;
    const data: SignedData = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (data.exp > Date.now()) return data;
  } catch { /* Invalid cookies require a fresh sign-in. */ }
}

function cookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Lax`;
}

function redirect(location: string, ...cookies: string[]) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 303, headers });
}

async function login(env: Env, url: URL) {
  const state = encode(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
  const temporary = await sign({ kind: 'oauth', exp: Date.now() + 600_000, state, verifier }, env.SESSION_SECRET);
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: new URL('/oauth/callback', url).href,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return redirect(authorize.href, cookie(oauthCookie, temporary, 600));
}

function signInError(env: Env, message: string, status: number) {
  const response = page(env.SCANNER_URL, `<p>${message}</p><a class="button" href="/inbox">Back to inbox</a>`, status);
  response.headers.append('Set-Cookie', cookie(oauthCookie, '', 0));
  return response;
}

async function callback(request: Request, env: Env, url: URL) {
  const temporary = await readSigned(request, oauthCookie, env.SESSION_SECRET);
  const code = url.searchParams.get('code');
  if (temporary?.kind !== 'oauth' || !code || temporary.state !== url.searchParams.get('state')) {
    return signInError(env, 'Sign-in expired. Open the inbox and try again.', 400);
  }
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      code_verifier: temporary.verifier,
      redirect_uri: new URL('/oauth/callback', url).href,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const { access_token: token } = await tokenResponse.json() as { access_token?: string };
  if (!tokenResponse.ok || !token) return signInError(env, 'GitHub sign-in could not finish. Try again.', 502);

  const identity = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'CardSlinger-Feedback' },
    signal: AbortSignal.timeout(10000),
  });
  if (!identity.ok) return signInError(env, 'GitHub sign-in could not finish. Try again.', 502);
  const { id } = await identity.json() as { id?: number };
  if (!Number.isSafeInteger(id) || String(id) !== env.OWNER_GITHUB_ID) {
    return signInError(env, 'This GitHub account does not have access to the inbox.', 403);
  }
  const session = await sign({ kind: 'session', exp: Date.now() + 28_800_000, owner: String(id) }, env.SESSION_SECRET);
  return redirect('/inbox', cookie(oauthCookie, '', 0), cookie(sessionCookie, session, 28_800));
}

async function readSubmission(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let size = 0, body = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) { await reader.cancel(); return; }
    body += decoder.decode(value, { stream: true });
  }
  try {
    const { category, message } = JSON.parse(body + decoder.decode()) as { category?: unknown; message?: unknown };
    if (typeof category !== 'string' || !Object.hasOwn(feedbackCategories, category) || typeof message !== 'string') return;
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > feedbackMessageLimit) return;
    return { category: category as FeedbackCategory, message: trimmed };
  } catch { /* The form only accepts valid JSON. */ }
}

async function submit(request: Request, env: Env) {
  const origin = new URL(env.SCANNER_URL).origin;
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
  const reply = (status: number) => new Response(null, { status, headers });
  if (request.headers.get('Origin') !== origin) return reply(403);
  headers.set('Access-Control-Allow-Origin', origin);
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'POST');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return reply(204);
  }
  if (request.method !== 'POST') return reply(405);
  if (!signInConfigured(env)) return reply(503);
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return reply(415);
  const { success } = await env.SUBMISSION_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
  if (!success) return reply(429);
  const submission = await readSubmission(request);
  if (!submission) return reply(400);
  const now = Date.now();
  const id = `${String(9_999_999_999_999 - now).padStart(13, '0')}-${crypto.randomUUID()}`;
  const feedback: Feedback = { ...submission, id, createdAt: new Date(now).toISOString() };
  await env.FEEDBACK.put(prefix + id, JSON.stringify(feedback));
  return reply(201);
}

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname === '/feedback') return submit(request, env);
  if (request.method === 'GET' && url.pathname === '/') return redirect('/inbox');
  if (!signInConfigured(env)) return page(env.SCANNER_URL, '<p>The inbox sign-in is being configured.</p>', 503);
  if (request.method === 'GET' && url.pathname === '/login') return login(env, url);
  if (request.method === 'GET' && url.pathname === '/oauth/callback') return callback(request, env, url);

  const session = await readSigned(request, sessionCookie, env.SESSION_SECRET);
  const isOwner = session?.kind === 'session' && session.owner === env.OWNER_GITHUB_ID;
  if (request.method === 'GET' && url.pathname === '/inbox') {
    if (!isOwner) return page(env.SCANNER_URL, '<p>Sign in to read and manage scanner feedback.</p><a class="button primary" href="/login">Sign in with GitHub</a>');
    const cursor = url.searchParams.get('cursor') || undefined;
    if (cursor && cursor.length > 2048) return redirect('/inbox');
    const result = await env.FEEDBACK.list({ prefix, limit: 20, cursor });
    const keys = result.keys.map(({ name }) => name);
    const values = keys.length ? await env.FEEDBACK.get<Feedback>(keys, 'json') : undefined;
    const messages = keys.map(key => values?.get(key)).filter((message): message is Feedback => !!message);
    return inbox(env.SCANNER_URL, messages, result.list_complete ? undefined : result.cursor, !!cursor);
  }
  if (request.method === 'POST' && (url.pathname === '/logout' || url.pathname.startsWith('/inbox/delete/'))) {
    if (!isOwner || request.headers.get('Origin') !== url.origin) return new Response(null, { status: 403 });
    if (url.pathname === '/logout') return redirect('/inbox', cookie(sessionCookie, '', 0));
    const id = url.pathname.slice('/inbox/delete/'.length);
    if (!messageId.test(id)) return new Response(null, { status: 404 });
    await env.FEEDBACK.delete(prefix + id);
    return redirect('/inbox');
  }
  return new Response(null, { status: 404 });
}

export default {
  async fetch(request: Request, env: Env) {
    try { return await route(request, env); }
    catch {
      if (new URL(request.url).pathname === '/feedback') {
        return new Response(null, {
          status: 503,
          headers: { 'Access-Control-Allow-Origin': new URL(env.SCANNER_URL).origin, Vary: 'Origin', 'Cache-Control': 'no-store' },
        });
      }
      return page(env.SCANNER_URL, '<p>Could not load the inbox. Try again.</p><a class="button" href="/inbox">Try again</a>', 503);
    }
  },
};
