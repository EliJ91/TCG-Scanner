export interface Settings {
  captureVersion: number; cameraId: string; torch: boolean;
  captureMode: 'auto' | 'manual'; stackCards: boolean; zoom: number;
  autoZoom: boolean; autoZoomInterval: number; autoZoomOutPercent: number;
  stabilityMs: number; sensitivity: number; quality: number;
  volume: number; muted: boolean; galleryNewestFirst: boolean; flipInterface: boolean;
  resolution: number; useImageCapture: boolean; batchTarget: number;
}
export const motionSensitivityRange = { min: 0.99, max: 1, step: 0.0001 } as const;

export const defaults: Settings = {
  captureVersion: 3, cameraId: '', torch: false,
  captureMode: 'auto', stackCards: false, zoom: 1, stabilityMs: 100, sensitivity: motionSensitivityRange.min, quality: 1,
  autoZoom: false, autoZoomInterval: 10, autoZoomOutPercent: 20,
  volume: 0.6, muted: false, galleryNewestFirst: false, flipInterface: false,
  resolution: 2560, useImageCapture: false, batchTarget: 50,
};
export const photoWaitTimes: readonly number[] = [10, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
export const autoZoomOutLevels: readonly number[] = [
  1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
];
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
export function photoTimestamp(capturedAt: number) {
  const timestamp = new Date(capturedAt).getTime();
  const date = new Date(Number.isFinite(timestamp) ? timestamp : 0);
  const parts = [date.getMonth() + 1, date.getDate(), date.getFullYear() % 100, date.getHours(), date.getMinutes(), date.getSeconds()];
  return `${parts.map(value => String(value).padStart(2, '0')).join('-')}-${String(date.getMilliseconds()).padStart(3, '0')}`;
}
export const filename = (capturedAt: number) => `${photoTimestamp(capturedAt)}.jpg`;
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
