import { useEffect, useRef, useState, type ComponentProps, type PointerEvent } from 'react';

export function BlobImage({ blob, ...props }: { blob: Blob; alt: string } & ComponentProps<'img'>) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return <img src={url || undefined} {...props} />;
}

type Point = { x: number; y: number };
type View = Point & { scale: number };
const initialView: View = { x: 0, y: 0, scale: 1 };
const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));
const pointOf = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });

export function PhotoViewer({ blob, onSwipe }: { blob: Blob; onSwipe(direction: -1 | 1): void }) {
  const image = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const swipeStart = useRef<Point | undefined>(undefined);
  const currentView = useRef(initialView);
  const [view, setView] = useState(initialView);

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
      const oldCenterX = (previous.x + other.x - bounds.width) / 2 - bounds.left;
      const oldCenterY = (previous.y + other.y - bounds.height) / 2 - bounds.top;
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
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (Math.abs(dx) >= 45 && Math.abs(dx) > 1.5 * Math.abs(dy)) onSwipe(dx < 0 ? 1 : -1);
  };

  return <div className="review-image" onPointerDown={start} onPointerMove={move}
    onPointerUp={event => finish(event, true)} onPointerCancel={event => finish(event, false)} onLostPointerCapture={event => finish(event, false)}>
    <BlobImage ref={image} blob={blob} alt="Full-resolution scanned card" draggable={false}
      style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
  </div>;
}
