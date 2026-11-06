import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), {
    name: 'local-offline-scanner', apply: 'build',
    async closeBundle() {
      const entries = (await readdir('dist', { recursive: true, withFileTypes: true }))
        .filter(e => e.isFile() && e.name !== 'sw.js')
        .map(e => path.relative('dist', path.join(e.parentPath, e.name)).replaceAll('\\', '/')).sort();
      const hash = createHash('sha256');
      for (const name of entries) { hash.update(name); hash.update(await readFile(path.join('dist', name))); }
      const version = `cardslinger-${hash.digest('hex').slice(0, 16)}`;
      await writeFile('dist/sw.js', `// Generated from this exact production build. Waits for old tabs to close before activation.
const CACHE = ${JSON.stringify(version)};
const FILES = ${JSON.stringify(entries.map(e => '/' + e))};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('cardslinger-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/index.html').then(hit => hit || fetch(event.request))));
  } else if (FILES.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname).then(hit => hit || fetch(event.request))));
  }
});\n`);
    },
  }],
  worker: { format: 'iife' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30000 },
} as Parameters<typeof defineConfig>[0]);
