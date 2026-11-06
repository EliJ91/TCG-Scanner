import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

let buildBase = '/';
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), {
    name: 'local-offline-scanner', apply: 'build',
    configResolved(config) {
      buildBase = config.base;
      if (!buildBase.startsWith('/') || !buildBase.endsWith('/')) throw new Error('Use an absolute deployment base with leading and trailing slashes, e.g. /TCG-Scanner/.');
    },
    async closeBundle() {
      const entries = (await readdir('dist', { recursive: true, withFileTypes: true }))
        .filter(e => e.isFile() && e.name !== 'sw.js')
        .map(e => path.relative('dist', path.join(e.parentPath, e.name)).replaceAll('\\', '/')).sort();
      const hash = createHash('sha256').update('scanner-precache-reload-v2');
      for (const name of entries) { hash.update(name); hash.update(await readFile(path.join('dist', name))); }
      const prefix = `cardslinger-${createHash('sha256').update(buildBase).digest('hex').slice(0, 8)}-`;
      const version = `${prefix}${hash.digest('hex').slice(0, 16)}`;
      await writeFile('dist/sw.js', `// Generated from this exact production build. Activates cached updates without reloading active scans.
const BASE = ${JSON.stringify(buildBase)};
const PREFIX = ${JSON.stringify(prefix)};
const CACHE = ${JSON.stringify(version)};
const FILES = ${JSON.stringify(entries.map(e => buildBase + e))};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(file => new Request(new URL(file, self.location.origin), { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(BASE + 'index.html').then(hit => hit || fetch(event.request))));
  } else if (FILES.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname).then(hit => hit || fetch(event.request))));
  }
});\n`);
    },
  }],
  worker: { format: 'iife' },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 30000 },
} as Parameters<typeof defineConfig>[0]);
