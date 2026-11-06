import { ProcessingDeferred, type Processed, type Settings } from './types';
type VisionWindow = typeof globalThis & {
  cv?: unknown;
  CardVision?: { processCard(cv: unknown, bitmap: ImageBitmap | HTMLImageElement, settings: Settings): Promise<Processed> };
};
const globals = globalThis as VisionWindow;
function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src = src;
    script.onload = () => resolve(); script.onerror = () => { script.remove(); reject(new Error(`Could not load ${src}. Open the app online once to cache its processing engine.`)); };
    document.head.appendChild(script);
  });
}
let fallbackRuntime: Promise<unknown> | undefined;
export class Processor {
  private worker?: Worker;
  private jobs = new Map<number, { resolve: (value: Processed) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 0;
  private initialized?: Promise<void>;
  public fallback = false;
  init() { return this.initialized ??= this.initialize().catch(error => { this.initialized = undefined; throw error; }); }
  private async initialize() {
    try {
      await new Promise<void>((resolve, reject) => {
        const worker = new Worker(`${import.meta.env.BASE_URL}processor.worker.js`); this.worker = worker;
        const timeout = setTimeout(() => reject(new Error('Processing engine startup timed out.')), 30000);
        worker.onerror = () => { clearTimeout(timeout); worker.terminate(); this.worker = undefined; this.initialized = undefined; reject(new Error('Image worker unavailable.')); this.rejectAll('The image worker stopped. Original photos are retained for retry.'); };
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') { clearTimeout(timeout); resolve(); return; }
          if (data.type === 'init-error') { clearTimeout(timeout); reject(new Error(data.error)); return; }
          const job = this.jobs.get(data.id); if (!job) return;
          this.jobs.delete(data.id); clearTimeout(job.timer);
          if (data.error) job.reject(new Error(data.error)); else job.resolve(data.result);
        };
      });
      this.fallback = false;
    } catch {
      this.worker?.terminate(); this.worker = undefined; this.fallback = true;
    }
  }
  private loadFallback() {
    return fallbackRuntime ??= (async () => {
      await loadScript(`${import.meta.env.BASE_URL}vendor/opencv.js`); await loadScript(`${import.meta.env.BASE_URL}vision.js`);
      const cv = await globals.cv;
      if (!(cv as { Mat?: unknown })?.Mat) throw new Error('OpenCV initialization failed. Reload the application while online.');
      return cv;
    })().catch(error => { fallbackRuntime = undefined; throw error; });
  }
  async process(raw: Blob, settings: Settings, allowFallback = true): Promise<Processed> {
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('test-camera') === '1') {
      const delay = Math.min(5000, Math.max(0, Number(new URLSearchParams(location.search).get('test-processing-delay')) || 0));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    }
    await this.init();
    if (this.worker) return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.worker?.terminate(); this.worker = undefined; this.initialized = undefined;
        this.rejectAll('Image processing timed out. Pause the card feed; raw images are retained for retry.');
      }, 45000);
      this.jobs.set(id, { resolve, reject, timer }); this.worker!.postMessage({ id, raw, settings });
    });
    if (!allowFallback) throw new ProcessingDeferred('Photos are saved. Processing will run after capture pauses.');
    // The pipeline calls this path only after capture pauses or reaches the batch limit.
    const runtime = await this.loadFallback();
    let image: ImageBitmap | HTMLImageElement;
    if (typeof createImageBitmap === 'function') image = await createImageBitmap(raw);
    else {
      const url = URL.createObjectURL(raw); const img = new Image();
      try { img.src = url; await img.decode(); image = img; } finally { URL.revokeObjectURL(url); }
    }
    return globals.CardVision!.processCard(runtime, image, settings);
  }
  private rejectAll(reason: string) {
    for (const job of this.jobs.values()) { clearTimeout(job.timer); job.reject(new Error(reason)); }
    this.jobs.clear();
  }
  destroy() { this.worker?.terminate(); this.rejectAll('Processing stopped. Raw captures are retained.'); }
}
