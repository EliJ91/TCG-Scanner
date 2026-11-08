import { defaults, type Settings } from './types';
const key = 'cardslinger-settings';
/** Migrate the earlier slow-capture defaults once, preserving all other choices. */
export function normalizeSettings(saved?: Partial<Settings>): Settings {
  const next = { ...defaults, ...saved };
  const version = saved?.captureVersion ?? 0;
  if (version < 2 || (version === 2 && next.stabilityMs === 220)) next.stabilityMs = defaults.stabilityMs;
  next.captureVersion = defaults.captureVersion;
  next.zoom = Number.isFinite(next.zoom) ? Math.max(1, Math.min(3, next.zoom)) : defaults.zoom;
  next.stabilityMs = Number.isFinite(next.stabilityMs) ? Math.max(10, Math.min(1000, Math.round(next.stabilityMs))) : defaults.stabilityMs;
  next.focusLocked = saved?.focusLocked ?? saved?.lockCamera ?? defaults.focusLocked;
  next.focusDistance = typeof next.focusDistance === 'number' && Number.isFinite(next.focusDistance) ? next.focusDistance : null;
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
