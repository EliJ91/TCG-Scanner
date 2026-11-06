/** One source crop shared by preview framing, motion analysis, and saved snapshots. */
export function zoomRect(width: number, height: number, zoom: number) {
  const factor = Math.max(1, Math.min(3, Number.isFinite(zoom) ? zoom : 1));
  const w = Math.max(1, Math.floor(width / factor)), h = Math.max(1, Math.floor(height / factor));
  return { x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), width: w, height: h };
}
