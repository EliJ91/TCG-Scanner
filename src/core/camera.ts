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
  private canvas = document.createElement('canvas');
  constructor(public video: HTMLVideoElement, private lost: (reason: string) => void) {}
  async start(width: number, deviceId?: string) {
    this.stop();
    if (!window.isSecureContext) throw new Error('Camera access needs HTTPS or localhost. Open the HTTPS address on your phone.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera API. Use current Safari or Chrome over HTTPS.');
    try {
      if (import.meta.env.DEV && new URLSearchParams(location.search).get('test-camera') === '1') {
        const fixture = (await import('../dev/synthetic-camera')).syntheticCamera();
        this.stream = fixture.stream; this.disposeSynthetic = fixture.dispose;
      } else this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
        width: { ideal: width }, height: { ideal: Math.round(width * 3 / 4) }, frameRate: { ideal: 30 },
      } });
      this.video.srcObject = this.stream;
      await this.video.play();
      if (!this.video.videoWidth) await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Camera did not deliver a video frame.')), 10000);
        this.video.addEventListener('loadeddata', () => { clearTimeout(timeout); resolve(); }, { once: true });
      });
      const track = this.stream.getVideoTracks()[0];
      this.capabilities = (track.getCapabilities?.() ?? {}) as CameraCapabilities;
      track.addEventListener('ended', () => this.lost('Camera disconnected. Reconnect it and resume scanning.'));
      track.addEventListener('mute', () => this.lost('Camera feed interrupted. Check the camera and resume when ready.'));
      const IC = (window as unknown as { ImageCapture?: new (track: MediaStreamTrack) => FrameGrabber }).ImageCapture;
      if (IC) { try { this.grabber = new IC(track); } catch { /* Video canvas remains available. */ } }
      return track.getSettings();
    } catch (error) {
      this.stop();
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('Camera permission was denied. Allow camera access in this site’s browser settings, then try Start Scanning again.');
      if (error instanceof DOMException && error.name === 'NotFoundError') throw new Error('No camera found. Connect a camera and try again.');
      if (error instanceof DOMException && error.name === 'NotReadableError') throw new Error('The camera is busy. Close other camera apps and try again.');
      throw error;
    }
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
  stop() { this.disposeSynthetic?.(); this.disposeSynthetic = undefined; this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined; this.video.srcObject = null; this.grabber = undefined; }
}
