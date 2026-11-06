import { defaults, type Settings } from './types';
const key = 'cardslinger-settings';
/** Migrate the earlier slow-capture defaults once, preserving all other choices. */
export function normalizeSettings(saved?: Partial<Settings>): Settings {
  const next = { ...defaults, ...saved };
  if (saved?.captureVersion !== defaults.captureVersion) next.stabilityMs = defaults.stabilityMs;
  next.captureVersion = defaults.captureVersion;
  next.zoom = Number.isFinite(next.zoom) ? Math.max(1, Math.min(3, next.zoom)) : defaults.zoom;
  next.stabilityMs = Number.isFinite(next.stabilityMs) ? Math.max(100, Math.min(3000, next.stabilityMs)) : defaults.stabilityMs;
  next.cameraId = typeof next.cameraId === 'string' ? next.cameraId : '';
  return next;
}
export function cachedSettings(fallback?: Partial<Settings>): Settings {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(key) || 'null') || fallback); }
  catch { return normalizeSettings(fallback); }
}
export function cacheSettings(settings: Settings) {
  try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* IndexedDB remains the persistent fallback. */ }
}
