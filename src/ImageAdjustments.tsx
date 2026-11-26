import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Camera, RotateCcw } from 'lucide-react';
import { imageAdjustmentControls, imageAdjustmentDefaults, normalizeImageAdjustments, type ImageAdjustments as Values } from './core/image-adjustments';
import { useImageAdjustmentFilter } from './ImageAdjustmentFilter';

type Fields = Record<keyof Values, string>;
const fieldsFor = (values: Values): Fields => ({ brightness: String(values.brightness), contrast: String(values.contrast), saturation: String(values.saturation), gamma: values.gamma.toFixed(2) });
export function validAdjustment(key: keyof Values, text: string) {
  const control = imageAdjustmentControls.find(c => c.key === key)!;
  const value = text.trim() === '' ? NaN : Number(text);
  const steps = (value - control.min) / control.step;
  return Number.isFinite(value) && value >= control.min && value <= control.max && Math.abs(steps - Math.round(steps)) < 0.000001;
}

export function ImageAdjustments({ values, source, cameraReady, requesting, zoom, flipped, loaded, cameraError, enable, save, cancel }: {
  values: Values; source: HTMLVideoElement | null; cameraReady: boolean; requesting: boolean;
  zoom: number; flipped: boolean; loaded: boolean; cameraError: string;
  enable(): void; save(values: Values): void; cancel(): void;
}) {
  const [draft, setDraft] = useState(() => normalizeImageAdjustments(values));
  const [fields, setFields] = useState(() => fieldsFor(normalizeImageAdjustments(values)));
  const [playbackError, setPlaybackError] = useState('');
  const preview = useRef<HTMLVideoElement>(null);
  const stream = cameraReady ? source?.srcObject : null;
  const effect = useImageAdjustmentFilter(draft);
  const ratio = source?.videoWidth && source.videoHeight ? source.videoWidth / source.videoHeight : 0.75;
  useEffect(() => {
    const video = preview.current;
    if (!video) return;
    let active = true;
    video.srcObject = stream ?? null;
    setPlaybackError('');
    if (stream) void video.play().catch(() => { if (active) setPlaybackError('Tap Enable camera to try the preview again.'); });
    // Borrow the scanner's stream; never stop its tracks on dialog close.
    return () => { active = false; video.pause(); video.srcObject = null; };
  }, [stream]);
  const change = (key: keyof Values, text: string) => {
    setFields(previous => ({ ...previous, [key]: text }));
    if (validAdjustment(key, text)) setDraft(previous => ({ ...previous, [key]: Number(text) }));
  };
  const valid = imageAdjustmentControls.every(control => validAdjustment(control.key, fields[control.key]));
  return <>
    {effect.definitions}
    <form className="image-adjustment-form" noValidate onSubmit={event => { event.preventDefault(); if (valid && loaded) save(normalizeImageAdjustments(draft)); }}>
      <div className="image-adjustment-layout">
        <div className="image-adjustment-preview" style={{ '--video-ratio': ratio } as CSSProperties}>
          <div className="image-adjustment-feed"><video ref={preview} autoPlay muted playsInline aria-label="Image adjustments live preview" style={{ filter: effect.filter, transform: `scale(${zoom})${flipped ? ' rotate(180deg)' : ''}` }} /></div>
          {!cameraReady && <div className="image-adjustment-camera-off"><Camera size={30} aria-hidden="true" /><p>{requesting ? 'Requesting camera…' : 'Enable the camera to preview your changes.'}</p><button type="button" className="button outline" disabled={requesting} onClick={enable}>Enable camera</button></div>}
          {playbackError && <div className="image-adjustment-camera-off"><p role="alert">{playbackError}</p><button type="button" className="button outline" onClick={() => { setPlaybackError(''); void preview.current?.play().catch(() => setPlaybackError('The preview is unavailable. Reopen Image Adjustments to try again.')); }}>Enable camera</button></div>}
        </div>
        <div className="image-adjustment-controls">
          <p className="setting-hint">Preview changes here, then tap Save to use them for new photos. Saved photos stay as they are.</p>
          {!cameraReady && cameraError && <p className="name-error" role="alert">{cameraError}</p>}
          {imageAdjustmentControls.map(control => {
            const invalid = !validAdjustment(control.key, fields[control.key]);
            return <div className="image-adjustment-control" key={control.key}>
              <div className="image-adjustment-label"><label htmlFor={`adjust-${control.key}`}>{control.label}</label><div className="image-adjustment-number"><input type="number" aria-label={`${control.label} value`} aria-invalid={invalid} aria-describedby={`adjust-${control.key}-hint`} min={control.min} max={control.max} step={control.step} inputMode={control.key === 'gamma' ? 'decimal' : 'numeric'} value={fields[control.key]} onChange={event => change(control.key, event.currentTarget.value)} /><span>{control.unit}</span></div></div>
              <input id={`adjust-${control.key}`} type="range" min={control.min} max={control.max} step={control.step} value={draft[control.key]} aria-label={control.label} aria-valuetext={`${draft[control.key]}${control.unit}`} onChange={event => change(control.key, event.currentTarget.value)} />
              <p id={`adjust-${control.key}-hint`} className={invalid ? 'name-error' : 'setting-hint'}>{invalid ? `Enter ${control.min}–${control.max}${control.unit}${control.key === 'gamma' ? ' in steps of 0.01.' : ' as a whole number.'}` : control.hint}</p>
            </div>;
          })}
        </div>
      </div>
      <div className="dialog-footer image-adjustment-footer">
        <button type="button" className="button outline" onClick={() => { setDraft({ ...imageAdjustmentDefaults }); setFields(fieldsFor(imageAdjustmentDefaults)); }}><RotateCcw size={15} aria-hidden="true" />Reset to Defaults</button>
        <div><button type="button" className="button outline" onClick={cancel}>Cancel</button><button type="submit" className="button dark" disabled={!valid || !loaded}>Save</button></div>
      </div>
    </form>
  </>;
}
