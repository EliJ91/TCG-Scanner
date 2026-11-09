export interface Settings {
  captureVersion: number; cameraId: string; torch: boolean;
  focusLocked: boolean; focusDistance: number | null;
  captureMode: 'auto' | 'manual'; stackCards: boolean; zoom: number;
  stabilityMs: number; sensitivity: number; quality: number;
  volume: number; muted: boolean; galleryNewestFirst: boolean;
  resolution: number; useImageCapture: boolean; batchTarget: number;
}
export const defaults: Settings = {
  captureVersion: 3, cameraId: '', torch: false, focusLocked: false, focusDistance: null,
  captureMode: 'auto', stackCards: false, zoom: 1, stabilityMs: 100, sensitivity: 0.025, quality: 1,
  volume: 0.6, muted: false, galleryNewestFirst: false,
  resolution: 2560, useImageCapture: false, batchTarget: 50,
};
export const photoWaitTimes: readonly number[] = [10, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
export interface Batch {
  id: string; number: number; name: string; target: number; createdAt: number;
  status: 'paused' | 'scanning' | 'complete'; nextOrdinal: number;
}
export interface Snapshot { blob: Blob; width?: number; height?: number }
export interface Scan extends Snapshot {
  id: string; batchId: string; ordinal: number; capturedAt: number;
  thumbnail?: Blob;
  rotated: boolean;
}
export interface AttemptInfo {
  id: string; batchId: string; ordinal: number; capturedAt: number;
  reason: string;
}
export interface Attempt extends AttemptInfo { raw: Blob; settings?: unknown }
export const attemptInfo = ({ id, batchId, ordinal, capturedAt, reason }: Attempt): AttemptInfo => ({ id, batchId, ordinal, capturedAt, reason });
export function originalScan(attempt: Attempt): Scan {
  const { id, batchId, ordinal, capturedAt, raw } = attempt;
  return { id, batchId, ordinal, capturedAt, blob: raw, rotated: false };
}
export const photoNumber = (index: number) => String(index + 1).padStart(4, '0');
export const filename = (index: number) => `${photoNumber(index)}.jpg`;
export const defaultBatchName = (number: number) => `Batch#${String(number).padStart(3, '0')}`;
export const maxBatchTarget = 10000;
export const validBatchTarget = (target: number, count = 0) => Number.isInteger(target) && target >= Math.max(1, count) && target <= maxBatchTarget;
export const archiveFilename = (name: string | undefined, number: number) => {
  const safe = (name || defaultBatchName(number)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.zip$/i, '').trim().replace(/[. ]+$/, '').slice(0, 100);
  const base = safe || defaultBatchName(number);
  return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? '_' : ''}${base}.zip`;
};
export const ordered = <T extends { ordinal: number }>(items: T[]) => [...items].sort((a, b) => a.ordinal - b.ordinal);
export const message = (e: unknown) => e instanceof Error ? e.message : String(e);
