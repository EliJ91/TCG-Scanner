import { CameraAccessError, cameraErrorName, requestCameraStream } from './camera-access';

export interface CameraCapabilities {
  torch?: boolean; zoom?: { min: number; max: number; step: number };
  focusMode?: string[]; exposureMode?: string[]; whiteBalanceMode?: string[];
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
  constructor(public video: HTMLVideoElement, private lost: (reason: string) => void) {}
  async start(width: number, deviceId?: string) {
    this.stop();
    const generation = this.generation;
    let acquired: MediaStream | undefined;
    try {
      if (import.meta.env.DEV && new URLSearchParams(location.search).get('test-camera') === '1') {
        const fixture = (await import('../dev/synthetic-camera')).syntheticCamera();
        acquired = fixture.stream; this.disposeSynthetic = fixture.dispose;
      } else acquired = await requestCameraStream(width, deviceId);
      if (generation !== this.generation) {
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
      track.addEventListener('ended', () => this.lost('Camera disconnected. Reconnect it and resume scanning.'));
      track.addEventListener('mute', () => this.lost('Camera feed interrupted. Check the camera and resume when ready.'));
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
  async capture(useImageCapture = false): Promise<Blob> {
    if (!this.stream?.active || this.video.readyState < 2) throw new Error('Camera is not delivering frames. Reconnect and resume.');
    let bitmap: ImageBitmap | undefined;
    if (useImageCapture && this.grabber) { try { bitmap = await this.grabber.grabFrame(); } catch { /* Compatible fallback below. */ } }
    const source = bitmap ?? this.video;
    this.canvas.width = bitmap?.width ?? this.video.videoWidth; this.canvas.height = bitmap?.height ?? this.video.videoHeight;
    this.canvas.getContext('2d')!.drawImage(source, 0, 0); bitmap?.close();
    return new Promise((resolve, reject) => this.canvas.toBlob(b => b ? resolve(b) : reject(new Error('Camera frame encoding failed. Try again.')), 'image/jpeg', 1));
  }
  async control(values: Record<string, unknown>) {
    const track = this.stream?.getVideoTracks()[0]; if (!track) throw new Error('Start the camera first.');
    await track.applyConstraints({ advanced: [values as MediaTrackConstraintSet] });
  }
  async lock(locked: boolean) {
    const values: Record<string, unknown> = {};
    for (const key of ['focusMode', 'exposureMode', 'whiteBalanceMode'] as const) {
      const modes = this.capabilities[key];
      if (locked && modes?.includes('manual')) values[key] = 'manual';
      else if (!locked && modes?.includes('continuous')) values[key] = 'continuous';
    }
    if (!Object.keys(values).length) throw new Error('This camera does not expose focus, exposure, or white balance locks.');
    await this.control(values);
  }
  stop() { this.generation++; this.cancelPreview?.(); this.cancelPreview = undefined; this.disposeSynthetic?.(); this.disposeSynthetic = undefined; this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined; this.capabilities = {}; this.video.srcObject = null; this.grabber = undefined; }
}
