import { defaults, photoWaitTimes, validBatchTarget, type Settings } from './types';
const key = 'cardslinger-settings';
const batchNameKey = 'cardslinger-custom-batch-name';
type SavedSettings = Partial<Settings> & { lockCamera?: boolean; debug?: boolean };
/** Migrate saved settings to the current controls. */
export function normalizeSettings(saved?: SavedSettings): Settings {
  const { lockCamera, debug: _debug, ...current } = saved ?? {};
  const next = { ...defaults, ...current };
  const version = current.captureVersion ?? 0;
  if (version < 2 || (version === 2 && next.stabilityMs === 220)) next.stabilityMs = defaults.stabilityMs;
  next.captureVersion = defaults.captureVersion;
  next.stackCards = current.stackCards === true;
  next.flipInterface = current.flipInterface === true;
  if (!validBatchTarget(next.batchTarget)) next.batchTarget = defaults.batchTarget;
  next.zoom = Number.isFinite(next.zoom) ? Math.max(1, Math.min(3, next.zoom)) : defaults.zoom;
  const savedWait = next.stabilityMs;
  next.stabilityMs = Number.isFinite(savedWait)
    ? photoWaitTimes.reduce((closest, wait) => Math.abs(wait - savedWait) < Math.abs(closest - savedWait) ? wait : closest)
    : defaults.stabilityMs;
  next.quality = Number.isFinite(next.quality)
    ? Math.max(8, Math.min(10, Math.round(next.quality * 10))) / 10
    : defaults.quality;
  next.focusLocked = current.focusLocked ?? lockCamera ?? defaults.focusLocked;
  next.focusDistance = typeof next.focusDistance === 'number' && Number.isFinite(next.focusDistance) ? next.focusDistance : null;
  next.cameraId = typeof next.cameraId === 'string' ? next.cameraId : '';
  return next;
}
export function readCachedSettings(): SavedSettings | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : undefined;
  } catch { return undefined; }
}
export function cacheSettings(settings: SavedSettings) {
  try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* IndexedDB remains the persistent fallback. */ }
}
export function cachedBatchName() {
  try { return localStorage.getItem(batchNameKey)?.trim() || undefined; }
  catch { return undefined; }
}
export function cacheBatchName(name?: string) {
  try {
    if (name) localStorage.setItem(batchNameKey, name);
    else localStorage.removeItem(batchNameKey);
  } catch { /* The current batch name remains available in memory. */ }
}
