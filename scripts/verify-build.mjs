import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Exercise online updates and offline launches with a real build asset cache.
const root = resolve('dist');
const handlers = new Map(), cache = new Map();
let base = '/', prefix = '';
const deletedCaches = [];
const networkRequests = [];
let networkResponse;
let skippedWaiting = 0;
const context = {
  URL, Promise, Request, Response,
  self: { location: { origin: 'https://scanner.test' }, clients: { claim: async () => {} }, skipWaiting: async () => { skippedWaiting++; }, addEventListener: (name, handler) => handlers.set(name, handler) },
  caches: {
    open: async () => ({
      addAll: async files => {
        for (const request of files) {
          assert.equal(request.cache, 'reload', 'Updates must bypass stale HTTP-cached assets');
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
  fetch: async (request, options) => {
    networkRequests.push({ request, options });
    if (networkResponse) return networkResponse.clone();
    throw new Error('Network disconnected');
  },
};
vm.createContext(context);
vm.runInContext(await readFile(resolve(root, 'sw.js'), 'utf8'), context);
base = vm.runInContext('BASE', context);
prefix = vm.runInContext('PREFIX', context);
let installation;
handlers.get('install')({ waitUntil: promise => { installation = promise; } });
await installation;
assert.equal(skippedWaiting, 1, 'Fully cached updates activate without requiring all app tabs to close');
for (const required of ['index.html','manifest.webmanifest','icons/icon-192.png']) assert.ok(cache.has(base + required), `Offline asset: ${required}`);
for (const removed of ['vendor/opencv.js', 'vision.js', 'processor.worker.js']) assert.ok(!cache.has(base + removed), `Obsolete image processing asset: ${removed}`);
assert.ok([...cache.keys()].some(p => p.endsWith('.woff2')), 'Fonts are cached locally');
const appScript = [...cache.keys()].find(file => file.startsWith(base + 'assets/') && file.endsWith('.js'));
assert.ok(appScript, 'App script is cached');
function fetchThroughWorker(path, mode) {
  let response;
  handlers.get('fetch')({ request: { url: 'https://scanner.test' + path, method:'GET', mode }, respondWith: promise => { response = promise; } });
  return response;
}
assert.ok((await fetchThroughWorker(appScript, 'same-origin')).ok, 'App assets are available offline');
assert.equal(networkRequests.length, 0, 'Cached app assets require no network');
const offlineHtml = await cache.get(base + 'index.html').clone().text();
assert.equal(await (await fetchThroughWorker(base, 'navigate')).text(), offlineHtml, 'Offline launch uses the installed app');

networkResponse = new Response('<html>Latest scanner</html>');
assert.equal(await (await fetchThroughWorker(base, 'navigate')).text(), await networkResponse.clone().text(), 'Online launch prefers the current deployment over cached HTML');
assert.equal(networkRequests.at(-1).options.cache, 'no-cache', 'Online launch revalidates HTTP-cached HTML');

networkResponse = new Response('Service unavailable', { status: 503 });
assert.equal(await (await fetchThroughWorker(base, 'navigate')).text(), offlineHtml, 'An unavailable deployment falls back to the installed app');
let activation;
handlers.get('activate')({ waitUntil: promise => { activation = promise; } });
await activation;
assert.deepEqual(deletedCaches, [`${prefix}old-version`], 'Updates preserve other apps’ caches');
if (base !== '/') {
  handlers.get('fetch')({ request: { url:'https://scanner.test/other-app/', method:'GET', mode:'navigate' }, respondWith: () => assert.fail('Worker must not intercept another app') });
}
for (const match of offlineHtml.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(cache.has(match[1]), `HTML asset is cached at the deployment base: ${match[1]}`);
const manifest = JSON.parse(await cache.get(base + 'manifest.webmanifest').clone().text());
const manifestUrl = new URL(base + 'manifest.webmanifest', 'https://scanner.test');
assert.equal(new URL(manifest.start_url, manifestUrl).pathname, base, 'PWA starts in the correct app scope');
assert.equal(new URL(manifest.scope, manifestUrl).pathname, base, 'PWA scope respects deployment path');
for (const icon of manifest.icons) assert.ok(cache.has(new URL(icon.src, manifestUrl).pathname), `PWA icon is cached: ${icon.src}`);
const bundleNames = [...cache.keys()].filter(p => p.startsWith(base + 'assets/') && p.endsWith('.js'));
for (const name of bundleNames) assert.doesNotMatch(await cache.get(name).clone().text(), /test-card-slide|synthetic-camera|test-camera|test-processing-delay/, 'Production excludes synthetic-camera fixture');
console.log(`Verified ${cache.size} production assets at ${base}, online and offline navigation, app cache isolation, PWA paths, local fonts, and fixture exclusion.`);
