export type CameraFailure = 'unsupported' | 'insecure' | 'blocked' | 'denied' | 'unavailable' | 'busy' | 'preview' | 'cancelled';
export class CameraAccessError extends Error {
  constructor(public readonly reason: CameraFailure, message: string, public readonly openBrowser = false) {
    super(message); this.name = 'CameraAccessError';
  }
}
export const cameraErrorName = (error: unknown) => typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
const embedded = () => { try { return window.self !== window.top; } catch { return true; } };

/** Called directly by the Enable camera gesture, before storage, audio, or OpenCV. */
export async function requestCameraStream(width: number, deviceId?: string, canRequest = () => true): Promise<MediaStream> {
  if (!window.isSecureContext) throw new CameraAccessError('insecure', 'Camera access needs HTTPS. Open this scanner’s HTTPS link directly in Safari or Chrome.', true);
  const devices = navigator.mediaDevices;
  if (typeof devices?.getUserMedia !== 'function') throw new CameraAccessError('unsupported', 'This browser cannot request camera access. Open this scanner directly in Safari or Chrome.', true);
  const policy = document as Document & { permissionsPolicy?: { allowsFeature(feature: string): boolean }; featurePolicy?: { allowsFeature(feature: string): boolean } };
  const permissions = policy.permissionsPolicy ?? policy.featurePolicy;
  let blocked = false;
  try { blocked = permissions?.allowsFeature('camera') === false; } catch { /* Optional policy inspection must not block getUserMedia itself. */ }
  if (blocked) throw new CameraAccessError('blocked', 'This embedded browser blocks the camera. Open the scanner in Safari or Chrome to allow camera access.', true);

  const preference: MediaTrackConstraints = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } };
  const requests: MediaStreamConstraints[] = [
    { audio: false, video: { ...preference, width: { ideal: width }, height: { ideal: Math.round(width * 3 / 4) }, frameRate: { ideal: 30 } } },
    { audio: false, video: preference },
    deviceId ? { audio: false, video: { facingMode: { ideal: 'environment' } } } : { audio: false, video: true },
  ];
  for (let i = 0; i < requests.length; i++) {
    if (!canRequest()) throw new CameraAccessError('cancelled', 'Camera startup interrupted.');
    try { return await devices.getUserMedia(requests[i]); }
    catch (error) {
      const name = cameraErrorName(error);
      // A resolution/facing-mode incompatibility must not prevent the permission request.
      if (i < requests.length - 1 && (['OverconstrainedError', 'ConstraintNotSatisfiedError', 'TypeError'].includes(name) || !!deviceId && ['NotFoundError','DevicesNotFoundError'].includes(name))) continue;
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') throw new CameraAccessError('denied', embedded()
        ? 'Camera access is blocked in this in-app view. Open the scanner in Safari or Chrome, then tap Enable camera and choose Allow.'
        : 'Camera permission is blocked. Allow Camera for this site in your browser’s site settings, then tap Enable camera again.', embedded());
      if (name === 'SecurityError') throw new CameraAccessError('blocked', 'This browser blocks camera access. Open the scanner directly in Safari or Chrome.', true);
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') throw new CameraAccessError('unavailable', 'No camera was found. Check that your device has an available camera and try again.');
      if (name === 'NotReadableError' || name === 'TrackStartError') throw new CameraAccessError('busy', 'The camera is busy or unavailable. Close other camera apps, then tap Enable camera again.');
      throw error;
    }
  }
  throw new CameraAccessError('unavailable', 'No compatible camera could be started.');
}
