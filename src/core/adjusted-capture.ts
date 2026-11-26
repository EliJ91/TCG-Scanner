import { pixelAdjustment, type ImageAdjustments } from './image-adjustments';

let worker: Worker | undefined;
let sequence = 0;
let idle: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, { resolve(blob: Blob): void; reject(error: Error): void }>();
function stop() { clearTimeout(idle); worker?.terminate(); worker = undefined; }
function encoder() {
  clearTimeout(idle);
  if (worker) return worker;
  worker = new Worker(new URL('../image-adjustments.worker.ts', import.meta.url), { type: 'module', name: 'image-adjustments' });
  worker.onmessage = (event: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
    const { id, blob, error } = event.data, job = pending.get(id);
    pending.delete(id);
    if (blob) job?.resolve(blob);
    else job?.reject(new Error(error || 'Image adjustments could not be saved.'));
    if (!pending.size) idle = setTimeout(stop, 30000);
  };
  worker.onerror = event => {
    event.preventDefault();
    for (const job of pending.values()) job.reject(new Error('The image adjustment worker stopped. Try taking the photo again.'));
    pending.clear(); stop();
  };
  return worker;
}

async function fallback(bitmap: ImageBitmap, adjustments: ImageAdjustments, quality: number) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  try {
    if (!context) throw new Error('Image adjustments are unavailable in this browser.');
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    pixelAdjustment(adjustments)(image.data); context.putImageData(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image encoding failed.')), 'image/jpeg', quality));
  } finally { bitmap.close(); canvas.width = canvas.height = 0; }
}

/** The caller snapshots before invoking this, so detection/capture never await pixel processing. */
export async function encodeAdjustedFrame(frame: Promise<ImageBitmap>, adjustments: ImageAdjustments, quality: number) {
  const bitmap = await frame;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return fallback(bitmap, adjustments, quality);
  let target: Worker;
  try { target = encoder(); } catch { return fallback(bitmap, adjustments, quality); }
  const id = ++sequence;
  return new Promise<Blob>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try { target.postMessage({ id, bitmap, adjustments, quality }, [bitmap]); }
    catch (error) { pending.delete(id); bitmap.close(); reject(error); if (!pending.size) idle = setTimeout(stop, 30000); }
  });
}
