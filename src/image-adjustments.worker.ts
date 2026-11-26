import { pixelAdjustment, type ImageAdjustments } from './core/image-adjustments';

let canvas: OffscreenCanvas | undefined;
let context: OffscreenCanvasRenderingContext2D | null | undefined;
let previous = '', apply: ReturnType<typeof pixelAdjustment>;
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<{ id: number; bitmap: ImageBitmap; adjustments: ImageAdjustments; quality: number }>) => {
  const { id, bitmap, adjustments, quality } = event.data;
  // Keep one reusable working canvas; queued shots remain independent bitmaps.
  queue = queue.then(async () => {
    try {
      canvas ??= new OffscreenCanvas(bitmap.width, bitmap.height);
      if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
      if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
      context ??= canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Image adjustments are unavailable in this browser.');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const key = JSON.stringify(adjustments);
      if (key !== previous) { apply = pixelAdjustment(adjustments); previous = key; }
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      apply(image.data);
      context.putImageData(image, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      self.postMessage({ id, blob });
    } catch (error) {
      bitmap.close();
      self.postMessage({ id, error: error instanceof Error ? error.message : 'Image adjustments could not be saved.' });
    }
  });
};
