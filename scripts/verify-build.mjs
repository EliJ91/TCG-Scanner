import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Exercise the generated production service worker with a real build asset cache
// and a disconnected network. No browser-profile data is touched.
const root = resolve('dist');
const handlers = new Map(), cache = new Map();
let onlineFetches = 0;
const context = {
  URL, Promise,
  self: { location: { origin: 'https://scanner.test' }, clients: { claim: async () => {} }, addEventListener: (name, handler) => handlers.set(name, handler) },
  caches: {
    open: async () => ({
      addAll: async files => {
        for (const file of files) {
          const local = resolve(root, '.' + file);
          assert.ok(local.startsWith(root + '\\') || local.startsWith(root + '/'), 'Cache path stays inside dist');
          assert.ok((await stat(local)).isFile(), `Precache asset exists: ${file}`);
          cache.set(file, new Response(await readFile(local)));
        }
      },
      match: async file => cache.get(file)?.clone(),
    }),
    keys: async () => [], delete: async () => true,
  },
  fetch: async () => { onlineFetches++; throw new Error('Network disconnected'); },
};
vm.runInNewContext(await readFile(resolve(root, 'sw.js'), 'utf8'), context);
let installation;
handlers.get('install')({ waitUntil: promise => { installation = promise; } });
await installation;
for (const required of ['/index.html','/vendor/opencv.js','/vision.js','/processor.worker.js','/manifest.webmanifest','/icons/icon-192.png']) assert.ok(cache.has(required), `Offline asset: ${required}`);
assert.ok([...cache.keys()].some(p => p.endsWith('.woff2')), 'Fonts are cached locally');
for (const [path, mode] of [['/', 'navigate'], ['/vendor/opencv.js','cors'], ['/processor.worker.js','same-origin']]) {
  let response;
  handlers.get('fetch')({ request: { url: 'https://scanner.test' + path, method:'GET', mode }, respondWith: promise => { response = promise; } });
  assert.ok((await response).ok, `Offline response for ${path}`);
}
assert.equal(onlineFetches, 0, 'Core assets require no network after caching');
const bundleNames = [...cache.keys()].filter(p => /^\/assets\/.*\.js$/.test(p));
for (const name of bundleNames) assert.doesNotMatch(await cache.get(name).clone().text(), /test-card-slide|synthetic-camera|test-camera/, 'Production excludes synthetic-camera fixture');
console.log(`Verified ${cache.size} production precache assets, offline navigation/worker/OpenCV, local fonts, and fixture exclusion.`);
