import JSZip from 'jszip';
import { filename, ordered, type Scan } from './types';
export async function createZip(scans: Scan[], onProgress: (percent: number) => void) {
  const zip = new JSZip();
  for (const [i, scan] of ordered(scans).entries()) zip.file(filename(i), await scan.blob.arrayBuffer());
  return zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, meta => onProgress(Math.round(meta.percent)));
}
export function downloadArchive(file: File) {
  const url = URL.createObjectURL(file), anchor = document.createElement('a');
  anchor.href = url; anchor.download = file.name; anchor.rel = 'noopener';
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
export async function rotateScan(scan: Scan): Promise<Scan> {
  const url = URL.createObjectURL(scan.blob), image = new Image();
  try {
    image.src = url; await image.decode();
    const c = document.createElement('canvas'); c.width = image.naturalWidth; c.height = image.naturalHeight;
    const ctx = c.getContext('2d')!; ctx.translate(c.width, c.height); ctx.rotate(Math.PI); ctx.drawImage(image, 0, 0);
    const thumb = document.createElement('canvas'); thumb.width = 180; thumb.height = Math.round(180 * c.height / c.width);
    thumb.getContext('2d')!.drawImage(c, 0, 0, thumb.width, thumb.height);
    const encode = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Rotation could not be saved.')), 'image/jpeg', 0.98));
    return { ...scan, width: c.width, height: c.height, blob: await encode(c), thumbnail: await encode(thumb), rotated: !scan.rotated };
  } finally { URL.revokeObjectURL(url); }
}
