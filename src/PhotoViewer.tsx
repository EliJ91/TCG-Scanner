import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type PointerEvent } from 'react';
import type { Scan } from './core/types';

export function BlobImage({ blob, ...props }: { blob: Blob; alt: string } & ComponentProps<'img'>) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return <img src={url || undefined} {...props} />;
}

export function useReviewPhoto(requested: Scan | undefined) {
  const urls = useRef(new Map<Blob, string>());
  const [ready, setReady] = useState<{ scan: Scan; url: string }>();

  useEffect(() => {
    if (!requested) { setReady(undefined); return; }
    let url = urls.current.get(requested.blob);
    if (!url) {
      url = URL.createObjectURL(requested.blob);
      urls.current.set(requested.blob, url);
    }
    const next = { scan: requested, url };
    const image = new Image();
    image.src = url;
    let current = true;
    // Keep displaying the previous photo until the replacement can be painted.
    void image.decode().catch(() => {}).then(() => { if (current) setReady(next); });
    return () => { current = false; };
  }, [requested]);

  useEffect(() => {
    for (const [blob, url] of urls.current) {
      if (blob === requested?.blob || blob === ready?.scan.blob) continue;
      URL.revokeObjectURL(url);
      urls.current.delete(blob);
    }
  }, [requested, ready]);

  useEffect(() => () => {
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
  }, []);

  return requested ? ready : undefined;
}

type Point = { x: number; y: number };
type View = Point & { scale: number };
const initialView: View = { x: 0, y: 0, scale: 1 };
const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));

export function PhotoViewer({ photoId, src, flipped, onSwipe }: { photoId: string; src?: string; flipped: boolean; onSwipe(direction: -1 | 1): void }) {
  const image = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const swipeStart = useRef<Point | undefined>(undefined);
  const currentView = useRef(initialView);
  const [view, setView] = useState(initialView);
  const axisSign = flipped ? -1 : 1;
  const pointOf = (event: PointerEvent): Point => ({ x: event.clientX * axisSign, y: event.clientY * axisSign });

  useLayoutEffect(() => {
    pointers.current.clear();
    swipeStart.current = undefined;
    currentView.current = initialView;
    setView(initialView);
  }, [photoId, flipped]);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    const contacts = pointers.current;
    if (event.button !== 0 || contacts.size >= 2) return;
    const point = pointOf(event);
    swipeStart.current = contacts.size === 0 && currentView.current.scale === 1 && event.pointerType !== 'mouse' ? point : undefined;
    contacts.set(event.pointerId, point);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const contacts = pointers.current;
    const previous = contacts.get(event.pointerId);
    if (!previous) return;
    const point = pointOf(event);
    contacts.set(event.pointerId, point);
    if (!image.current) return;

    const current = currentView.current;
    const other = [...contacts].find(([id]) => id !== event.pointerId)?.[1];
    if (!other && current.scale === 1) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    let { scale, x, y } = current;
    if (other) {
      const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y);
      if (!oldDistance) return;
      const distance = Math.hypot(point.x - other.x, point.y - other.y);
      scale = Math.min(5, Math.max(1, current.scale * distance / oldDistance));
      const ratio = scale / current.scale;
      const oldCenterX = (previous.x + other.x) / 2 - (bounds.left + bounds.width / 2) * axisSign;
      const oldCenterY = (previous.y + other.y) / 2 - (bounds.top + bounds.height / 2) * axisSign;
      // Keep the same part of the photo under the midpoint of the pinch.
      x = oldCenterX + (point.x - previous.x) / 2 - (oldCenterX - x) * ratio;
      y = oldCenterY + (point.y - previous.y) / 2 - (oldCenterY - y) * ratio;
    } else {
      x += point.x - previous.x;
      y += point.y - previous.y;
    }
    const next = scale === 1 ? initialView : {
      scale,
      x: clamp(x, Math.max(0, (image.current.offsetWidth * scale - bounds.width) / 2)),
      y: clamp(y, Math.max(0, (image.current.offsetHeight * scale - bounds.height) / 2)),
    };
    currentView.current = next;
    setView(next);
  };

  const finish = (event: PointerEvent<HTMLDivElement>, released: boolean) => {
    if (!pointers.current.delete(event.pointerId)) return;
    const from = swipeStart.current;
    swipeStart.current = undefined;
    if (!released || !from || currentView.current.scale !== 1) return;
    const point = pointOf(event);
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    if (Math.abs(dx) >= 45 && Math.abs(dx) > 1.5 * Math.abs(dy)) onSwipe(dx < 0 ? 1 : -1);
  };

  return <div className="review-image" onPointerDown={start} onPointerMove={move}
    onPointerUp={event => finish(event, true)} onPointerCancel={event => finish(event, false)} onLostPointerCapture={event => finish(event, false)}>
    <img ref={image} src={src} alt="Full-resolution scanned card" draggable={false}
      style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})${flipped ? ' rotate(180deg)' : ''}` }} />
  </div>;
}
