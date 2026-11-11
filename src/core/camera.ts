import { CameraAccessError, cameraErrorName, requestCameraStream } from './camera-access';
import { zoomRect } from './zoom';
import type { Snapshot } from './types';

export interface CameraCapabilities {
  torch?: boolean; zoom?: { min: number; max: number; step: number };
  focusMode?: string[];
}
interface FrameGrabber { grabFrame(): Promise<ImageBitmap> }
export class Camera {
  stream?: MediaStream;
  capabilities: CameraCapabilities = {};
  private grabber?: FrameGrabber;
  private disposeSynthetic?: () => void;
  private generation = 0;
  private cancelPreview?: () => void;
  private canvas = document.createElement('canvas');
  private adjustments: Record<string, unknown> = {};
  private controlQueue = Promise.resolve();
  private baseConstraints: MediaTrackConstraints = {};
  private zoom = 1;
  setZoom(value: number) { this.zoom = Math.max(1, Math.min(3, Number.isFinite(value) ? value : 1)); }
  constructor(public video: HTMLVideoElement, private lost: (reason: string) => void, private canUseCamera = () => true) {}
  async start(width: number, deviceId?: string) {
    this.stop();
    const generation = this.generation;
    let acquired: MediaStream | undefined;
    try {
      if (import.meta.env.DEV && new URLSearchParams(location.search).get('test-camera') === '1') {
        const fixture = (await import('../dev/synthetic-camera')).syntheticCamera();
        acquired = fixture.stream; this.disposeSynthetic = fixture.dispose;
      } else acquired = await requestCameraStream(width, deviceId, () => generation === this.generation && this.canUseCamera());
      if (generation !== this.generation || !this.canUseCamera()) {
        acquired.getTracks().forEach(track => track.stop());
        throw new CameraAccessError('cancelled', 'Camera request cancelled.');
      }
      this.stream = acquired;
      // Set DOM properties as well as attributes before attaching the stream for iOS/WebViews.
      this.video.muted = true; this.video.defaultMuted = true; this.video.playsInline = true; this.video.autoplay = true;
      for (const attribute of ['muted', 'playsinline', 'webkit-playsinline', 'autoplay']) this.video.setAttribute(attribute, '');
      const preview = this.waitForPreview();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const interrupted = new Promise<never>((_, reject) => {
        this.cancelPreview = () => reject(new CameraAccessError('cancelled', 'Camera request cancelled.'));
        deadline = setTimeout(() => reject(new CameraAccessError('preview', 'Camera permission was granted but no preview started. Tap Enable camera again, or open the scanner in Safari or Chrome.', true)), 10000);
      });
      try {
        this.video.srcObject = acquired;
        preview.check();
        // Start the deadline BEFORE play(): Safari can leave the play promise pending.
        await Promise.race([Promise.all([Promise.resolve(this.video.play()), preview.ready]), interrupted]);
      } finally { clearTimeout(deadline); preview.cleanup(); if (generation === this.generation) this.cancelPreview = undefined; }
      if (generation !== this.generation) throw new CameraAccessError('cancelled', 'Camera request cancelled.');
      const track = acquired.getVideoTracks()[0];
      if (!track) throw new CameraAccessError('unavailable', 'The browser did not provide a camera video track.');
      try { this.capabilities = (track.getCapabilities?.() ?? {}) as CameraCapabilities; } catch { this.capabilities = {}; }
      try { this.baseConstraints = track.getConstraints?.() ?? {}; } catch { this.baseConstraints = {}; }
      const focusModes = this.capabilities.focusMode ?? [];
      const autofocus = focusModes.includes('continuous') ? 'continuous' : focusModes.find(mode => mode === 'single-shot');
      if (autofocus) {
        try { await this.control({ focusMode: autofocus }); } catch { /* Keep the camera's default autofocus when controls are unavailable. */ }
      }
      if (generation !== this.generation || !this.canUseCamera()) throw new CameraAccessError('cancelled', 'Camera request cancelled.');
      const reportLost = (reason: string) => { if (generation === this.generation) this.lost(reason); };
      track.addEventListener('ended', () => reportLost('Camera disconnected. Reconnecting automatically.'));
      track.addEventListener('mute', () => reportLost('Camera feed interrupted. Reconnecting automatically.'));
      const IC = (window as unknown as { ImageCapture?: new (track: MediaStreamTrack) => FrameGrabber }).ImageCapture;
      if (IC) { try { this.grabber = new IC(track); } catch { /* Video canvas remains available. */ } }
      let settings: MediaTrackSettings = {};
      try { settings = track.getSettings?.() ?? {}; } catch { /* Optional in some mobile WebViews. */ }
      return { ...settings, width: this.video.videoWidth || settings.width, height: this.video.videoHeight || settings.height };
    } catch (error) {
      if (generation === this.generation) this.stop();
      if (error instanceof CameraAccessError) throw error;
      if (acquired && cameraErrorName(error) === 'NotAllowedError') throw new CameraAccessError('preview', 'Camera access was granted, but the browser blocked playback. Tap Enable camera again, or open the scanner in Safari or Chrome.', true);
      throw error;
    }
  }
  private waitForPreview() {
    let check = () => {};
    let cleanup = () => {};
    const ready = new Promise<void>((resolve, reject) => {
      const events = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'resize'];
      check = () => { if (this.video.videoWidth > 0 && this.video.readyState >= 2) resolve(); };
      const failed = () => reject(new CameraAccessError('preview', 'Camera preview failed. Tap Enable camera again or open the scanner in Safari or Chrome.', true));
      cleanup = () => { events.forEach(event => this.video.removeEventListener(event, check)); this.video.removeEventListener('error', failed); };
      events.forEach(event => this.video.addEventListener(event, check)); this.video.addEventListener('error', failed);
    });
    return { ready, check: () => check(), cleanup: () => cleanup() };
  }
  /** Canvas draw is synchronous: copies the exact stabilized frame before async encoding. */
  async capture(useImageCapture = false, quality = 1, frameCopied?: () => void, flipped = false): Promise<Snapshot> {
    if (!this.stream?.active || this.video.readyState < 2) throw new Error('Camera is not delivering frames. Waiting for reconnection.');
    let bitmap: ImageBitmap | undefined;
    if (useImageCapture && this.grabber) { try { bitmap = await this.grabber.grabFrame(); } catch { /* Compatible fallback below. */ } }
    const source = bitmap ?? this.video;
    const crop = zoomRect(bitmap?.width ?? this.video.videoWidth, bitmap?.height ?? this.video.videoHeight, this.zoom);
    if (this.canvas.width !== crop.width) this.canvas.width = crop.width;
    if (this.canvas.height !== crop.height) this.canvas.height = crop.height;
    const ctx = this.canvas.getContext('2d')!;
    try {
      if (flipped) ctx.setTransform(-1, 0, 0, -1, crop.width, crop.height);
      ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    } finally {
      if (flipped) ctx.resetTransform();
      bitmap?.close();
    }
    // toBlob copies the canvas before encoding, so the next shutter can reuse it.
    const encoding = new Promise<Blob>((resolve, reject) => {
      this.canvas.toBlob(value => value ? resolve(value) : reject(new Error('Camera frame encoding failed. Try again.')), 'image/jpeg', quality);
    });
    frameCopied?.();
    return { blob: await encoding, width: crop.width, height: crop.height };
  }
  async control(values: Record<string, unknown>) {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) throw new Error('Start the camera first.');
    const generation = this.generation;
    const operation = this.controlQueue.then(async () => {
      if (generation !== this.generation) throw new Error('The camera changed.');
      const next = { ...this.adjustments, ...values };
      for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
      // Chromium requires stream constraints and ImageCapture controls in separate sets.
      const constraints = {
        ...this.baseConstraints,
        advanced: [...(this.baseConstraints.advanced ?? []), next as MediaTrackConstraintSet],
      };
      await track.applyConstraints(constraints);
      if (generation === this.generation) this.adjustments = next;
    });
    this.controlQueue = operation.catch(() => {});
    await operation;
  }
  stop() { this.generation++; this.cancelPreview?.(); this.cancelPreview = undefined; this.disposeSynthetic?.(); this.disposeSynthetic = undefined; this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined; this.capabilities = {}; this.video.srcObject = null; this.grabber = undefined; this.adjustments = {}; this.controlQueue = Promise.resolve(); this.baseConstraints = {}; }
}
