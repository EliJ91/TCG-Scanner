export interface Point { x: number; y: number }
export type Corners = [Point, Point, Point, Point];
export interface Settings {
  captureMode: 'auto' | 'manual'; zoom: number;
  stabilityMs: number; sensitivity: number; quality: number; outputWidth: number;
  minSharpness: number; volume: number; muted: boolean; debug: boolean;
  resolution: number; queueLimit: number; useImageCapture: boolean;
}
export const defaults: Settings = {
  captureMode: 'auto', zoom: 1, stabilityMs: 1200, sensitivity: 0.025, quality: 0.95, outputWidth: 1260,
  minSharpness: 45, volume: 0.6, muted: false, debug: false,
  resolution: 2560, queueLimit: 2, useImageCapture: false,
};
export interface Batch {
  id: string; number: number; name: string; target: number; createdAt: number;
  status: 'paused' | 'scanning' | 'complete'; nextOrdinal: number;
}
export interface Scan {
  id: string; batchId: string; ordinal: number; capturedAt: number;
  blob: Blob; thumbnail: Blob; width: number; height: number;
  processingMs: number; sharpness: number; confidence: number; corners: Corners;
  rotated: boolean;
}
export interface Attempt {
  id: string; batchId: string; ordinal: number; capturedAt: number;
  raw: Blob; reason: string; settings: Settings;
}
export interface Processed {
  blob: Blob; thumbnail: Blob; width: number; height: number;
  processingMs: number; sharpness: number; confidence: number; corners: Corners;
}
export const filename = (index: number) => `Pokemon_${String(index + 1).padStart(4, '0')}.jpg`;
export const defaultBatchName = (number: number) => `Batch#${String(number).padStart(3, '0')}`;
export const archiveFilename = (name: string | undefined, number: number) => {
  const safe = (name || defaultBatchName(number)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.zip$/i, '').trim().replace(/[. ]+$/, '').slice(0, 100);
  const base = safe || defaultBatchName(number);
  return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? '_' : ''}${base}.zip`;
};
export const ordered = <T extends { ordinal: number }>(items: T[]) => [...items].sort((a, b) => a.ordinal - b.ordinal);
export const message = (e: unknown) => e instanceof Error ? e.message : String(e);
