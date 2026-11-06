import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Exercise the generated production service worker with a real build asset cache
// and a disconnected network. No browser-profile data is touched.
const root = resolve('dist');
const handlers = new Map(), cache = new Map();
let base = '/', prefix = '';
const deletedCaches = [];
let onlineFetches = 0;
let skippedWaiting = 0;
const context = {
  URL, Promise, Request,
  self: { location: { origin: 'https://scanner.test' }, clients: { claim: async () => {} }, skipWaiting: async () => { skippedWaiting++; }, addEventListener: (name, handler) => handlers.set(name, handler) },
  caches: {
    open: async () => ({
      addAll: async files => {
        for (const request of files) {
          assert.equal(request.cache, 'reload', 'Updated workers must bypass stale HTTP-cached cropper/runtime files');
          const url = new URL(request.url); assert.equal(url.origin, 'https://scanner.test');
          const file = url.pathname;
          assert.ok(file.startsWith(base), `Cache URL stays inside app scope: ${file}`);
          const local = resolve(root, file.slice(base.length));
          assert.ok(local.startsWith(root + '\\') || local.startsWith(root + '/'), 'Cache path stays inside dist');
          assert.ok((await stat(local)).isFile(), `Precache asset exists: ${file}`);
          cache.set(file, new Response(await readFile(local)));
        }
      },
      match: async file => cache.get(file)?.clone(),
    }),
    keys: async () => [`${prefix}old-version`, 'another-app-cache'],
    delete: async name => { deletedCaches.push(name); return true; },
  },
  fetch: async () => { onlineFetches++; throw new Error('Network disconnected'); },
};
vm.createContext(context);
vm.runInContext(await readFile(resolve(root, 'sw.js'), 'utf8'), context);
base = vm.runInContext('BASE', context);
prefix = vm.runInContext('PREFIX', context);
let installation;
handlers.get('install')({ waitUntil: promise => { installation = promise; } });
await installation;
assert.equal(skippedWaiting, 1, 'Fully cached updates activate without requiring all app tabs to close');
for (const required of ['index.html','vendor/opencv.js','vision.js','processor.worker.js','manifest.webmanifest','icons/icon-192.png']) assert.ok(cache.has(base + required), `Offline asset: ${required}`);
assert.ok([...cache.keys()].some(p => p.endsWith('.woff2')), 'Fonts are cached locally');
for (const [path, mode] of [[base, 'navigate'], [base + 'vendor/opencv.js','cors'], [base + 'processor.worker.js','same-origin']]) {
  let response;
  handlers.get('fetch')({ request: { url: 'https://scanner.test' + path, method:'GET', mode }, respondWith: promise => { response = promise; } });
  assert.ok((await response).ok, `Offline response for ${path}`);
}
assert.equal(onlineFetches, 0, 'Core assets require no network after caching');
let activation;
handlers.get('activate')({ waitUntil: promise => { activation = promise; } });
await activation;
assert.deepEqual(deletedCaches, [`${prefix}old-version`], 'Updates preserve other apps’ caches');
if (base !== '/') {
  handlers.get('fetch')({ request: { url:'https://scanner.test/other-app/', method:'GET', mode:'navigate' }, respondWith: () => assert.fail('Worker must not intercept another app') });
}
const html = await cache.get(base + 'index.html').clone().text();
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(match[1].startsWith(base), `HTML asset uses deployment base: ${match[1]}`);
const manifest = JSON.parse(await cache.get(base + 'manifest.webmanifest').clone().text());
const manifestUrl = new URL(base + 'manifest.webmanifest', 'https://scanner.test');
assert.equal(new URL(manifest.start_url, manifestUrl).pathname, base, 'PWA starts in the correct app scope');
assert.equal(new URL(manifest.scope, manifestUrl).pathname, base, 'PWA scope respects deployment path');
for (const icon of manifest.icons) assert.ok(cache.has(new URL(icon.src, manifestUrl).pathname), `PWA icon is cached: ${icon.src}`);
const bundleNames = [...cache.keys()].filter(p => p.startsWith(base + 'assets/') && p.endsWith('.js'));
for (const name of bundleNames) assert.doesNotMatch(await cache.get(name).clone().text(), /test-card-slide|synthetic-camera|test-camera|test-processing-delay/, 'Production excludes synthetic-camera fixture');
console.log(`Verified ${cache.size} production assets at ${base}, offline navigation/worker/OpenCV, app cache isolation, PWA paths, local fonts, and fixture exclusion.`);
