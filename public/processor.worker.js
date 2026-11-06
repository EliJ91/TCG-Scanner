/* Classic worker keeps the packaged UMD OpenCV runtime fully local. */
let ready;
async function initialize() {
  importScripts('/vendor/opencv.js', '/vision.js');
  const runtime = self.cv;
  const cv = runtime && typeof runtime.then === 'function' ? await runtime : runtime;
  if (!cv?.Mat) throw new Error('OpenCV could not initialize. Reload while online once, then try again.');
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('Worker canvas is unavailable.');
  return cv;
}
ready = initialize();
ready.then(() => self.postMessage({ type: 'ready' })).catch(error => self.postMessage({ type: 'init-error', error: error.message }));
let chain = Promise.resolve();
self.onmessage = ({ data }) => {
  chain = chain.then(async () => {
    try {
      const cv = await ready;
      const bitmap = await createImageBitmap(data.raw);
      const result = await self.CardVision.processCard(cv, bitmap, data.settings);
      self.postMessage({ id: data.id, result });
    } catch (error) { self.postMessage({ id: data.id, error: error?.message || String(error) }); }
  });
};
