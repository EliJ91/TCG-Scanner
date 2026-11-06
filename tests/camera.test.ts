import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Camera } from '../src/core/camera';
import { CameraAccessError, requestCameraStream } from '../src/core/camera-access';

function streamFixture() {
  let active = true;
  const track = Object.assign(new EventTarget(), {
    stop: vi.fn(() => { active = false; }),
    getCapabilities: vi.fn(() => ({})),
    getSettings: vi.fn(() => ({ width: 1920, height: 1080 })),
  });
  const stream = { get active() { return active; }, getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}
class Preview extends EventTarget {
  videoWidth = 1280; videoHeight = 720; readyState = 4;
  srcObject: unknown = null;
  muted = false; defaultMuted = false; playsInline = false; autoplay = false;
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
}
const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>();
beforeEach(() => {
  getUserMedia.mockReset();
  const top = {};
  vi.stubGlobal('window', { isSecureContext: true, self: top, top });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('document', { createElement: () => ({}) });
  vi.stubGlobal('location', { search: '' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('direct mobile camera permission requests', () => {
  it('calls getUserMedia immediately, before any asynchronous initialization', async () => {
    const { stream } = streamFixture(); getUserMedia.mockResolvedValue(stream);
    const pending = requestCameraStream(2560);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 }, frameRate: { ideal: 30 } } });
    expect(await pending).toBe(stream);
  });
  it('falls back when a mobile browser rejects preferred resolution constraints', async () => {
    const { stream } = streamFixture();
    getUserMedia.mockRejectedValueOnce(new DOMException('resolution', 'OverconstrainedError')).mockResolvedValueOnce(stream);
    expect(await requestCameraStream(3840)).toBe(stream);
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: false, video: { facingMode: { ideal: 'environment' } } });
  });
  it('can use the generic camera request when facing-mode constraints are unsupported', async () => {
    const { stream } = streamFixture();
    getUserMedia.mockRejectedValueOnce(new TypeError('constraints')).mockRejectedValueOnce(new TypeError('facingMode')).mockResolvedValueOnce(stream);
    expect(await requestCameraStream(2560)).toBe(stream);
    expect(getUserMedia).toHaveBeenNthCalledWith(3, { audio: false, video: true });
  });
  it('preserves explicit camera selection during resolution fallback', async () => {
    const { stream } = streamFixture();
    getUserMedia.mockRejectedValueOnce(new DOMException('resolution', 'OverconstrainedError')).mockResolvedValueOnce(stream);
    await requestCameraStream(2560, 'rear-telephoto');
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: false, video: { deviceId: { exact: 'rear-telephoto' } } });
  });
  it('opens the rear camera if a remembered camera is no longer available', async () => {
    const {stream}=streamFixture();
    getUserMedia.mockRejectedValueOnce(new DOMException('missing','NotFoundError')).mockRejectedValueOnce(new DOMException('missing','NotFoundError')).mockResolvedValueOnce(stream);
    expect(await requestCameraStream(2560,'old-camera-id')).toBe(stream);
    expect(getUserMedia).toHaveBeenLastCalledWith({audio:false,video:{facingMode:{ideal:'environment'}}});
  });
  it('does not retry a denied permission as though it were a resolution failure', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    await expect(requestCameraStream(2560)).rejects.toMatchObject({ reason: 'denied', message: expect.stringContaining('site settings') });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
  it('explains an embedded permission-policy block before attempting a futile prompt', async () => {
    vi.stubGlobal('document', { permissionsPolicy: { allowsFeature: () => false } });
    await expect(requestCameraStream(2560)).rejects.toMatchObject({ reason: 'blocked', openBrowser: true });
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it('offers an external-browser recovery when an in-app browser omits the camera API', async () => {
    vi.stubGlobal('navigator', {});
    await expect(requestCameraStream(2560)).rejects.toMatchObject({ reason: 'unsupported', openBrowser: true });
  });
  it('does not let an optional permission-policy API failure suppress the actual camera request', async () => {
    const { stream } = streamFixture(); getUserMedia.mockResolvedValue(stream);
    vi.stubGlobal('document', { permissionsPolicy: { allowsFeature: () => { throw new Error('Unsupported'); } } });
    expect(await requestCameraStream(2560)).toBe(stream); expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
  it('offers external-browser recovery for denied embedded camera access', async () => {
    vi.stubGlobal('window', { isSecureContext: true, self: {}, top: {} });
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    await expect(requestCameraStream(2560)).rejects.toMatchObject({ reason: 'denied', openBrowser: true, message: expect.stringContaining('Safari or Chrome') });
  });
  it('rejects an insecure origin before requesting permission', async () => {
    vi.stubGlobal('window', { isSecureContext: false });
    await expect(requestCameraStream(2560)).rejects.toMatchObject({ reason: 'insecure' });
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it.each([['NotReadableError', 'busy'], ['NotFoundError', 'unavailable'], ['SecurityError', 'blocked']])('reports %s with an actionable camera failure', async (name, reason) => {
    getUserMedia.mockRejectedValue(new DOMException('camera', name));
    await expect(requestCameraStream(2560)).rejects.toMatchObject({ reason });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe('mobile video preview startup', () => {
  it('uses the same centered zoom crop for the saved full-resolution snapshot', async () => {
    const fixture=streamFixture();getUserMedia.mockResolvedValue(fixture.stream);
    const drawImage=vi.fn();const canvas={width:0,height:0,getContext:()=>({drawImage}),toBlob:(done:(blob:Blob)=>void)=>done(new Blob(['jpeg']))};
    vi.stubGlobal('document',{createElement:()=>canvas});
    const preview=new Preview(), camera=new Camera(preview as unknown as HTMLVideoElement,vi.fn());
    await camera.start(2560);camera.setZoom(2);await camera.capture();
    expect(drawImage).toHaveBeenCalledWith(preview,320,180,640,360,0,0,640,360);
    expect([canvas.width,canvas.height]).toEqual([640,360]);camera.stop();
  });
  it('sets Safari inline/muted properties before play and uses actual portrait frame dimensions', async () => {
    const fixture = streamFixture(); getUserMedia.mockResolvedValue(fixture.stream);
    const preview = new Preview(); preview.videoWidth = 720; preview.videoHeight = 1280;
    preview.play.mockImplementation(async () => {
      expect(preview.srcObject).toBe(fixture.stream);
      expect(preview.muted && preview.defaultMuted && preview.playsInline && preview.autoplay).toBe(true);
      expect(preview.attributes.has('webkit-playsinline')).toBe(true);
    });
    const camera = new Camera(preview as unknown as HTMLVideoElement, vi.fn());
    expect(await camera.start(2560)).toMatchObject({ width: 720, height: 1280 });
    expect(camera.stream?.active).toBe(true); camera.stop();
  });
  it('does not discard a granted camera when optional mobile capability APIs throw', async () => {
    const fixture = streamFixture(); getUserMedia.mockResolvedValue(fixture.stream);
    fixture.track.getCapabilities.mockImplementation(() => { throw new Error('Unsupported'); });
    fixture.track.getSettings.mockImplementation(() => { throw new Error('Unsupported'); });
    const camera = new Camera(new Preview() as unknown as HTMLVideoElement, vi.fn());
    expect(await camera.start(2560)).toMatchObject({ width: 1280, height: 720 });
    expect(camera.capabilities).toEqual({}); expect(fixture.track.stop).not.toHaveBeenCalled(); camera.stop();
  });
  it('registers frame listeners before play, including synchronous metadata delivery', async () => {
    const fixture = streamFixture(); getUserMedia.mockResolvedValue(fixture.stream);
    const preview = new Preview(); preview.videoWidth = 0; preview.readyState = 0;
    preview.play.mockImplementation(async () => { preview.videoWidth = 1280; preview.readyState = 2; preview.dispatchEvent(new Event('loadedmetadata')); });
    const camera = new Camera(preview as unknown as HTMLVideoElement, vi.fn());
    await expect(camera.start(2560)).resolves.toMatchObject({ width: 1280 }); camera.stop();
  });
  it('times out a hanging play promise even after metadata is available', async () => {
    vi.useFakeTimers(); const fixture = streamFixture(); getUserMedia.mockResolvedValue(fixture.stream);
    const preview = new Preview(); preview.play.mockImplementation(() => new Promise(() => {}));
    const camera = new Camera(preview as unknown as HTMLVideoElement, vi.fn());
    const result = camera.start(2560).catch(error => error);
    await vi.advanceTimersByTimeAsync(10001);
    expect(await result).toMatchObject({ reason: 'preview', openBrowser: true });
    expect(fixture.track.stop).toHaveBeenCalled(); expect(preview.srcObject).toBeNull();
  });
  it('stops a late permission grant after the request was cancelled', async () => {
    const fixture = streamFixture(); let allow!: (stream: MediaStream) => void;
    getUserMedia.mockImplementation(() => new Promise(resolve => { allow = resolve; }));
    const preview = new Preview(); const camera = new Camera(preview as unknown as HTMLVideoElement, vi.fn());
    const result = camera.start(2560).catch(error => error); camera.stop(); allow(fixture.stream);
    expect(await result).toBeInstanceOf(CameraAccessError); expect((await result).reason).toBe('cancelled');
    expect(fixture.track.stop).toHaveBeenCalled(); expect(preview.play).not.toHaveBeenCalled(); expect(camera.stream).toBeUndefined();
  });
  it('cancels a hanging preview promptly on stop', async () => {
    const fixture = streamFixture(); getUserMedia.mockResolvedValue(fixture.stream);
    const preview = new Preview(); preview.play.mockImplementation(() => new Promise(() => {}));
    const camera = new Camera(preview as unknown as HTMLVideoElement, vi.fn()); const result = camera.start(2560).catch(error => error);
    await vi.waitFor(() => expect(preview.play).toHaveBeenCalled()); camera.stop();
    expect(await result).toMatchObject({ reason: 'cancelled' }); expect(fixture.track.stop).toHaveBeenCalled();
  });
  it('distinguishes preview autoplay rejection from a denied camera permission', async () => {
    const fixture = streamFixture(); getUserMedia.mockResolvedValue(fixture.stream);
    const preview = new Preview(); preview.play.mockRejectedValue(new DOMException('playback', 'NotAllowedError'));
    const camera = new Camera(preview as unknown as HTMLVideoElement, vi.fn());
    await expect(camera.start(2560)).rejects.toMatchObject({ reason: 'preview', message: expect.stringContaining('access was granted') });
    expect(fixture.track.stop).toHaveBeenCalled();
  });
});
