import { useCallback, useEffect, useRef, useState } from 'react';
import { CapturePipeline } from './core/pipeline';
import { cacheBatchName, cacheSettings, cachedBatchName, normalizeSettings, readCachedSettings } from './core/preferences';
import { Camera, type CameraCapabilities } from './core/camera';
import { CameraAccessError } from './core/camera-access';
import { CardPresenceDetector, previewHeight, previewWidth } from './core/card-presence';
import { MotionDetector, toLuma, type MotionReading } from './core/motion';
import { ScannerAudio } from './core/audio';
import { storage } from './core/storage';
import { zoomRect } from './core/zoom';
import { defaultBatchName, defaults, message, ordered, validBatchTarget, type AttemptInfo, type Batch, type Scan, type Settings } from './core/types';

export type Session = 'idle' | 'starting' | 'scanning' | 'paused' | 'complete';
export function useScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [batch, setBatch] = useState<Batch>(); const batchRef = useRef<Batch | undefined>(undefined);
  const [batchName, setBatchName] = useState(() => cachedBatchName() ?? defaultBatchName(1));
  const nameRef = useRef(batchName); const nextBatchNumber = useRef(1);
  const [scans, setScans] = useState<Scan[]>([]);
  const [attempts, setAttempts] = useState<AttemptInfo[]>([]); const attemptsRef = useRef<AttemptInfo[]>([]);
  const [retained, setRetained] = useState<AttemptInfo[]>([]);
  const [initialPreferences] = useState(readCachedSettings);
  const [settings, setSettings] = useState(() => normalizeSettings(initialPreferences)); const settingsRef = useRef(settings);
  const cameraConfig = useRef<{ resolution: number; id: string } | undefined>(undefined);
  const [session, setSession] = useState<Session>('idle'); const sessionRef = useRef<Session>('idle');
  const [error, updateError] = useState(''); const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false); const [pending, setPending] = useState(0); const [capturing, setCapturing] = useState(false);
  const [storageIssue, setStorageIssue] = useState(''); const storageIssueRef = useRef('');
  const [cameraPhase, setCameraPhase] = useState<'off' | 'requesting' | 'ready'>('off');
  const cameraPhaseRef = useRef<'off' | 'requesting' | 'ready'>('off');
  const [openBrowserSuggested, setOpenBrowserSuggested] = useState(false);
  const cameraRequest = useRef<Promise<void> | undefined>(undefined); const cameraEpoch = useRef(0);
  const previewWanted = useRef(true); const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const windowBlurred = useRef(false); const pageExited = useRef(false);
  const editedPreferences = useRef(new Set<keyof Settings>()); const zoomAdjusting = useRef(false);
  const [reading, setReading] = useState<MotionReading>();
  const [countdown, setCountdown] = useState<number | 'snapped' | null>(null);
  const [focusPosition, setFocusPosition] = useState<number>();
  const [focusLocked, setFocusLocked] = useState(false);
  const [focusBusy, setFocusBusy] = useState(false);
  const focusApplying = useRef(false);
  const focusRequest = useRef<{ locked: boolean; distance?: number; epoch: number } | undefined>(undefined);
  const [cameraSize, setCameraSize] = useState({ width: 0, height: 0 });
  const [capabilities, setCapabilities] = useState<CameraCapabilities>({});
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const controller = useRef<CapturePipeline | undefined>(undefined);
  const camera = useRef<Camera | undefined>(undefined); const audio = useRef<ScannerAudio | undefined>(undefined);
  const setError = useCallback((value: string) => { updateError(value); if (value) audio.current?.error(); }, []);
  const detector = useRef(new MotionDetector());
  const captureBusy = useRef(false);
  const lastComplete = useRef<string | undefined>(undefined); const wakeLock = useRef<{ release(): Promise<void> } | undefined>(undefined);
  const mounted = useRef(true);
  const startToken = useRef(0);
  const editingBatch = useRef(false);
  const canUseCamera = () => mounted.current && !pageExited.current && !windowBlurred.current && !document.hidden && document.hasFocus();
  const changeSession = (value: Session) => { sessionRef.current = value; if (mounted.current) setSession(value); };
  const changeCameraPhase = (value: 'off' | 'requesting' | 'ready') => { cameraPhaseRef.current = value; if (mounted.current) setCameraPhase(value); };
  const updateAttempts = (items: AttemptInfo[]) => { attemptsRef.current = items; if (mounted.current) setAttempts(items); };
  const setCurrentBatchName = (name: string, number: number) => {
    nameRef.current = name;
    setBatchName(name);
    cacheBatchName(name === defaultBatchName(number) ? undefined : name);
  };
  const releaseWake = () => { void wakeLock.current?.release().catch(() => {}); wakeLock.current = undefined; };
  function resetMotion(requireRemoval?: boolean) {
    detector.current.reset(requireRemoval);
    setCountdown(null);
  }
  function closeCamera() {
    cameraEpoch.current++;
    camera.current?.stop();
    changeCameraPhase('off');
    setCameraSize({ width: 0, height: 0 });
  }
  function suspendCamera() {
    clearTimeout(reconnectTimer.current);
    releaseWake();
    // A pending permission prompt can finish. Camera.start checks focus before attaching its stream.
    if (cameraPhaseRef.current !== 'ready' && !camera.current?.stream) return;
    resetMotion();
    closeCamera();
  }
  const pause = useCallback((reason?: string) => {
    startToken.current++;
    controller.current?.pause(); resetMotion();
    if (sessionRef.current !== 'idle' && sessionRef.current !== 'complete') changeSession('paused');
    releaseWake(); if (reason) setError(reason);
  }, []);

  const makeController = (b: Batch, count: number) => {
    const pipeline = new CapturePipeline(b, count, {
      saved: scan => {
        if (!mounted.current) return;
        setScans(items => ordered([...items.filter(item => item.id !== scan.id), scan]));
        updateAttempts(attemptsRef.current.filter(item => item.id !== scan.id));
      },
      storageIssue: reason => {
        if (!mounted.current) return;
        storageIssueRef.current = reason;
        setStorageIssue(reason);
        setError(reason);
      },
      changed: () => {
        if (!mounted.current) return;
        setPending(pipeline.pending);
        setRetained(pipeline.retained);
        if (pipeline.complete) {
          changeSession('complete');
          releaseWake();
          setNotice('Your photos are ready to download.');
          if (lastComplete.current !== b.id) {
            audio.current?.complete();
            lastComplete.current = b.id;
          }
        }
        const current = batchRef.current!;
        const status = pipeline.complete ? 'complete' : pipeline.running ? 'scanning' : 'paused';
        if (current.nextOrdinal === pipeline.nextOrdinal && current.status === status) return;
        const updated: Batch = { ...current, nextOrdinal: pipeline.nextOrdinal, status };
        batchRef.current = updated;
        setBatch(updated);
        void storage.saveBatch(updated).catch(() => setError('Batch details could not be saved.'));
      },
    });
    controller.current = pipeline;
  };

  useEffect(() => {
    mounted.current = true;
    audio.current = new ScannerAudio();
    let cancelled = false;
    const storageDeadline = setTimeout(() => {
      if (cancelled) return;
      storageIssueRef.current = 'Browser storage is not responding. Close other scanner tabs if an update is waiting, then reload. The camera can still open.';
      setStorageIssue(storageIssueRef.current); setError(storageIssueRef.current);
    }, 8000);
    storage.load().then(data => {
      clearTimeout(storageDeadline);
      if (cancelled) return;
      if (storageIssueRef.current) { setError(''); setStorageIssue(''); storageIssueRef.current = ''; }
      const config = normalizeSettings({ ...data.settings, ...initialPreferences });
      const previous = settingsRef.current;
      for (const key of editedPreferences.current) Object.assign(config, { [key]: previous[key] });
      settingsRef.current = config; cacheSettings(config); setSettings(config);
      if (cameraConfig.current) {
        const cameraChanged = cameraConfig.current.resolution !== config.resolution || cameraConfig.current.id !== config.cameraId;
        const torchChanged = previous.torch !== config.torch;
        const focusChanged = previous.focusLocked !== config.focusLocked || previous.focusDistance !== config.focusDistance;
        if (cameraChanged || torchChanged || focusChanged) {
          void (cameraRequest.current ?? Promise.resolve()).then(async () => {
            if (!mounted.current || !previewWanted.current) return;
            if (cameraChanged) { await enableCamera(settingsRef.current.cameraId); return; }
            if (cameraPhaseRef.current !== 'ready') return;
            const caps = camera.current?.capabilities;
            const prefs = settingsRef.current;
            if (torchChanged && caps?.torch) void control({ torch: prefs.torch });
            if (focusChanged && (caps?.focusMode?.includes('manual') || caps?.focusDistance)) {
              void setFocus(prefs.focusLocked, prefs.focusDistance ?? undefined);
            }
          }).catch(() => {});
        }
      }
      if (data.batch) {
        const maxOrdinal = Math.max(-1, ...data.scans.map(s => s.ordinal), ...data.attempts.map(a => a.ordinal));
        const b = { ...data.batch, name: data.batch.name || defaultBatchName(data.batch.number), nextOrdinal: Math.max(data.batch.nextOrdinal, maxOrdinal + 1) };
        batchRef.current = b; setBatch(b); setScans(ordered(data.scans));
        setCurrentBatchName(b.name, b.number);
        updateAttempts(data.attempts);
        resetMotion(data.scans.length > 0 || data.attempts.length > 0);
        lastComplete.current = data.scans.length >= b.target ? b.id : undefined;
        changeSession(data.scans.length >= b.target ? 'complete' : 'paused');
        makeController(b, data.scans.length);
        setNotice(data.scans.length >= b.target ? 'Completed batch recovered from this device. Your images are ready to review and download.' : 'Batch recovered. Resume scanning to add more photos.');
      } else {
        const number = data.nextBatchNumber ?? 1;
        nextBatchNumber.current = number;
        setCurrentBatchName(cachedBatchName() ?? defaultBatchName(number), number);
      }
      setLoaded(true);
    }).catch(err => {
      clearTimeout(storageDeadline); if (cancelled) return;
      storageIssueRef.current = `Storage unavailable: ${message(err)}. Camera preview can still open. Enable browser storage or open this page in Safari or Chrome before scanning.`;
      setStorageIssue(storageIssueRef.current); setError(storageIssueRef.current);
    });
    const onBlur = () => { windowBlurred.current = true; suspendCamera(); };
    const onFocus = () => { windowBlurred.current = false; resumeCamera(); };
    const onVisibility = () => {
      if (document.hidden) suspendCamera();
      else if (document.hasFocus()) onFocus();
    };
    const onPageHide = () => { pageExited.current = true; suspendCamera(); };
    const onPageShow = () => { pageExited.current = false; onVisibility(); };
    const onRotation = () => resetMotion();
    const preview = videoRef.current;
    const resized = () => { if (camera.current?.stream?.active && preview?.videoWidth) setCameraSize({ width: preview.videoWidth, height: preview.videoHeight }); };
    preview?.addEventListener('resize', resized);
    document.addEventListener('visibilitychange', onVisibility); window.addEventListener('orientationchange', onRotation);
    window.addEventListener('blur', onBlur); window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide); window.addEventListener('pageshow', onPageShow);
    return () => {
      cancelled = true; clearTimeout(storageDeadline); clearTimeout(reconnectTimer.current); mounted.current = false; cameraEpoch.current++; camera.current?.stop(); controller.current?.dispose(); releaseWake();
      preview?.removeEventListener('resize', resized);
      document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('orientationchange', onRotation);
      window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onPageHide); window.removeEventListener('pageshow', onPageShow);
    };
    // The lifetime owns the camera. Mutable settings are kept in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    detector.current.stabilityMs = settings.stabilityMs; detector.current.sensitivity = settings.sensitivity;
    detector.current.setStackCards(settings.stackCards);
    camera.current?.setZoom(settings.zoom);
    if (audio.current) { audio.current.volume = settings.volume; audio.current.muted = settings.muted; }
    if (loaded) void storage.settings(settings).catch(err => setError(`Settings could not be saved: ${message(err)}`));
  }, [settings, loaded]);

  const updateSettings = (next: Settings) => {
    for (const key of Object.keys(next) as (keyof Settings)[]) if (next[key] !== settingsRef.current[key]) editedPreferences.current.add(key);
    if (next.stackCards !== settingsRef.current.stackCards) {
      detector.current.setStackCards(next.stackCards);
      setReading(detector.current.advance(performance.now()));
      setCountdown(null);
    }
    if (loaded) cacheSettings(next);
    else {
      // Preserve settings we have yet to read from IndexedDB, even on a quick reload.
      const cached = readCachedSettings() ?? {};
      for (const key of editedPreferences.current) Object.assign(cached, { [key]: next[key] });
      if (editedPreferences.current.has('stabilityMs')) cached.captureVersion = next.captureVersion;
      cacheSettings(cached);
    }
    settingsRef.current = next; setSettings(next);
  };

  const capture = async (automatic = false) => {
    const c = controller.current;
    if (!c?.hasCapacity || editingBatch.current || captureBusy.current || cameraPhaseRef.current !== 'ready' || storageIssueRef.current || !canUseCamera()) return;
    const { useImageCapture, quality, flipInterface } = settingsRef.current;
    const alternateCapture = !automatic && useImageCapture;
    if (alternateCapture) {
      captureBusy.current = true;
      setCapturing(true);
    }
    let waitingForFrame = alternateCapture;
    function finishWaitingForFrame() {
      if (!waitingForFrame) return;
      waitingForFrame = false;
      captureBusy.current = false;
      if (mounted.current) setCapturing(false);
    }
    detector.current.consume();
    setReading(detector.current.advance(performance.now()));
    if (!automatic) setCountdown(null);
    // Canvas capture copies the preview immediately. Encoding and saving can finish later.
    try {
      await c.capture(() => camera.current!.capture(alternateCapture, quality, () => {
        finishWaitingForFrame();
        if (!mounted.current) return;
        if (automatic) setCountdown('snapped');
        audio.current?.success();
      }, flipInterface));
    }
    catch (err) { setError(`Photo could not be taken: ${message(err)}. Try again.`); }
    finally { finishWaitingForFrame(); }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (session !== 'scanning' || cameraPhase !== 'ready' || !video) return;
    const canvas = document.createElement('canvas');
    canvas.width = previewWidth;
    canvas.height = previewHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const gray = new Uint8Array(canvas.width * canvas.height);
    const card = new CardPresenceDetector();
    const useVideoFrames = typeof video.requestVideoFrameCallback === 'function';
    let frame = 0, lastFrameAt = performance.now(), lastVideoTime = -1, lastUI = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let scheduledDeadline: number | null = null;

    function schedule(deadline: number | null) {
      if (deadline === scheduledDeadline && (deadline === null || timer !== undefined)) return;
      clearTimeout(timer);
      scheduledDeadline = deadline;
      setCountdown(deadline);
      if (deadline !== null) {
        timer = setTimeout(() => {
          timer = undefined;
          inspect(false);
        }, Math.max(1, Math.ceil(deadline - performance.now())));
      }
    }

    function inspect(freshFrame: boolean) {
      const now = performance.now();
      const c = controller.current, motion = detector.current;
      if (!video || !canUseCamera() || sessionRef.current !== 'scanning' || !c?.running || cameraPhaseRef.current !== 'ready') {
        schedule(null);
        return;
      }
      if (freshFrame) lastFrameAt = now;
      if (settingsRef.current.captureMode !== 'auto' || zoomAdjusting.current || focusApplying.current || video.readyState < 2) {
        schedule(null);
        return;
      }
      if (!freshFrame && now - lastFrameAt > 650) {
        resetMotion();
        schedule(null);
        return;
      }
      // Check the current pixels at the deadline too, in case movement just resumed.
      const crop = zoomRect(video.videoWidth, video.videoHeight, settingsRef.current.zoom);
      ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
      toLuma(ctx.getImageData(0, 0, canvas.width, canvas.height).data, gray);
      const next = motion.update(gray, now, card.detect(gray));
      const canCapture = c.hasCapacity && !editingBatch.current && !captureBusy.current && !storageIssueRef.current;
      schedule(canCapture ? motion.deadline : null);
      if (now - lastUI > 100) {
        setReading(next);
        lastUI = now;
      }
      if (next.state === 'ready' && canCapture) void capture(true);
    }

    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        inspect(true);
      }
    };
    const presented = () => {
      frame = video.requestVideoFrameCallback(presented);
      inspect(true);
    };
    frame = useVideoFrames ? video.requestVideoFrameCallback(presented) : requestAnimationFrame(tick);
    const watchdog = setInterval(() => {
      if (canUseCamera() && cameraPhaseRef.current === 'ready' && performance.now() - lastFrameAt >= 1800) {
        schedule(null);
        recoverCamera('Camera frames stopped. Reconnecting automatically.');
      }
    }, 300);
    return () => {
      if (useVideoFrames) video.cancelVideoFrameCallback(frame);
      else cancelAnimationFrame(frame);
      clearTimeout(timer);
      clearInterval(watchdog);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, cameraPhase]);

  const enableCamera = (deviceId?: string): Promise<void> => {
    if (!canUseCamera()) return Promise.reject(new CameraAccessError('cancelled', 'Camera startup interrupted.'));
    if (!videoRef.current) return Promise.reject(new Error('Camera preview is unavailable.'));
    const selectedId = deviceId ?? settingsRef.current.cameraId;
    if (camera.current?.stream?.active && cameraPhaseRef.current === 'ready' && !deviceId && cameraConfig.current?.resolution === settingsRef.current.resolution && cameraConfig.current.id === selectedId) return Promise.resolve();
    if (cameraRequest.current) return cameraRequest.current;
    if (!camera.current) camera.current = new Camera(videoRef.current, recoverCamera, canUseCamera);
    const epoch = ++cameraEpoch.current;
    changeCameraPhase('requesting'); setOpenBrowserSuggested(false);
    const reminder = setTimeout(() => {
      if (canUseCamera() && cameraEpoch.current === epoch && cameraPhaseRef.current === 'requesting') {
        setError('Still waiting for camera access. Choose Allow in the browser prompt. If no prompt appears, open this scanner directly in Safari or Chrome.');
        setOpenBrowserSuggested(true);
      }
    }, 15000);
    // start() reaches getUserMedia synchronously, inside the button's user gesture.
    cameraConfig.current = { resolution: settingsRef.current.resolution, id: selectedId };
    let interrupted = false;
    const opening = camera.current.start(settingsRef.current.resolution, selectedId || undefined).then(async info => {
      if (!canUseCamera() || cameraEpoch.current !== epoch) {
        if (cameraEpoch.current === epoch) camera.current?.stop();
        throw new CameraAccessError('cancelled', 'Camera startup interrupted.');
      }
      setCameraSize({ width: info.width ?? videoRef.current!.videoWidth, height: info.height ?? videoRef.current!.videoHeight });
      if (selectedId && info.deviceId && info.deviceId !== selectedId) {
        updateSettings({ ...settingsRef.current, cameraId: '' }); cameraConfig.current!.id = '';
      }
      camera.current!.setZoom(settingsRef.current.zoom); clearTimeout(reconnectTimer.current);
      const activeCamera = camera.current!;
      const caps = activeCamera.capabilities;
      const prefs = settingsRef.current;
      setCapabilities(caps);
      setFocusLocked(false);
      setFocusPosition(activeCamera.focusDistance);
      try {
        if (caps.torch) await activeCamera.control({ torch: prefs.torch });
        if (prefs.focusLocked && (caps.focusMode?.includes('manual') || caps.focusDistance)) {
          setFocusPosition(await activeCamera.focus(true, prefs.focusDistance ?? undefined));
          setFocusLocked(true);
        }
      } catch { setNotice('Some saved camera adjustments are unavailable.'); }
      if (!canUseCamera() || cameraEpoch.current !== epoch) {
        if (cameraEpoch.current === epoch) camera.current?.stop();
        throw new CameraAccessError('cancelled', 'Camera startup interrupted.');
      }
      resetMotion();
      changeCameraPhase('ready');
      setError(storageIssueRef.current); setOpenBrowserSuggested(false);
      // Enumeration is optional; unsupported or rejected enumeration must not close a working camera.
      const enumerate = navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices);
      if (enumerate) {
        void Promise.resolve().then(enumerate).then(items => {
          if (mounted.current && cameraEpoch.current === epoch) setDevices(items.filter(d => d.kind === 'videoinput'));
        }).catch(() => { if (mounted.current && cameraEpoch.current === epoch) setDevices([]); });
      }
    }).catch(err => {
      interrupted = err instanceof CameraAccessError && err.reason === 'cancelled';
      if (cameraEpoch.current === epoch) { changeCameraPhase('off'); setCameraSize({ width: 0, height: 0 }); }
      throw err;
    }).finally(() => {
      clearTimeout(reminder);
      if (cameraRequest.current !== opening) return;
      cameraRequest.current = undefined;
      if (interrupted) resumeCamera();
    });
    cameraRequest.current = opening;
    return opening;
  };
  const connectCamera = async (userGesture = true): Promise<boolean> => {
    if (!canUseCamera() || (!previewWanted.current && !userGesture)) return false;
    previewWanted.current = true;
    setError(storageIssueRef.current);
    try {
      const opening = enableCamera();
      if (userGesture) void audio.current?.unlock();
      await opening; return true;
    }
    catch (err) {
      if (!mounted.current || err instanceof CameraAccessError && err.reason === 'cancelled') return false;
      setError(message(err)); setOpenBrowserSuggested(err instanceof CameraAccessError && err.openBrowser);
      if (err instanceof CameraAccessError && ['denied', 'blocked', 'unsupported', 'insecure'].includes(err.reason)) previewWanted.current = false;
      else if (sessionRef.current === 'scanning') scheduleReconnect();
      return false;
    }
  };
  function resumeCamera() {
    if (canUseCamera() && previewWanted.current && cameraPhaseRef.current === 'off' && !cameraRequest.current) void connectCamera(false);
  }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer.current);
    if (!canUseCamera() || !previewWanted.current) return;
    reconnectTimer.current = setTimeout(resumeCamera, 2000);
  }
  function recoverCamera(reason: string) {
    if (!mounted.current) return;
    if (!canUseCamera()) { suspendCamera(); return; }
    setError(reason); resetMotion();
    closeCamera();
    scheduleReconnect();
  }
  useEffect(() => {
    let cancelled = false;
    // Request the preview on entry; a browser that requires a tap keeps the Enable camera fallback.
    void Promise.resolve().then(() => { if (!cancelled) resumeCamera(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const start = async (target: number): Promise<boolean> => {
    if (!canUseCamera() || !loaded || editingBatch.current || sessionRef.current === 'starting' || controller.current?.complete) return false;
    if (controller.current?.running) return true;
    const audioReady = audio.current!.unlock(); // Called synchronously within the user's gesture.
    const token = ++startToken.current;
    previewWanted.current = true;
    changeSession('starting'); setError('');
    try {
      await enableCamera();
      if (startToken.current !== token || !canUseCamera()) throw new CameraAccessError('cancelled', 'Camera startup interrupted.');
      if (!batchRef.current) {
        const name = nameRef.current === defaultBatchName(nextBatchNumber.current) ? undefined : nameRef.current;
        const b = await storage.create(target, name);
        batchRef.current = b; setBatch(b); setCurrentBatchName(b.name, b.number); makeController(b, 0);
      }
      if (startToken.current !== token || !canUseCamera()) throw new CameraAccessError('cancelled', 'Camera startup interrupted.');
      resetMotion();
      controller.current!.start(); changeSession('scanning');
      const awake = navigator as Navigator & { wakeLock?: { request(type: string): Promise<{ release(): Promise<void> }> } };
      void awake.wakeLock?.request('screen').then(lock => { if (controller.current?.running && canUseCamera()) wakeLock.current = lock; else void lock.release(); }).catch(() => {});
      void audioReady.then(soundOk => { if (mounted.current) setNotice(soundOk ? 'Scanning is active. Errors are reported without pausing.' : 'Tap a sound test in Settings to enable audio.'); });
      void navigator.storage?.persist?.().catch(() => {});
      return true;
    } catch (err) {
      if (startToken.current !== token) return false;
      changeSession(controller.current?.running ? 'scanning' : batchRef.current ? 'paused' : 'idle');
      if (err instanceof CameraAccessError && err.reason === 'cancelled') return false;
      setError(message(err)); setNotice('');
      setOpenBrowserSuggested(err instanceof CameraAccessError && err.openBrowser);
      return false;
    }
  };
  const stop = () => { previewWanted.current = false; clearTimeout(reconnectTimer.current); pause(); closeCamera(); setNotice('Camera stopped. Your photos are available in the Gallery.'); };
  const takePhoto = async (target: number) => {
    void audio.current?.unlock();
    if (!controller.current?.running && !await start(target)) return;
    if (!controller.current?.hasCapacity || storageIssueRef.current) return;
    await capture();
  };
  const keepOriginal = async (attempt: AttemptInfo) => {
    if (editingBatch.current) return;
    void audio.current?.unlock();
    await controller.current?.keepOriginal(attempt);
  };
  const resizeBatch = async (target: number) => {
    const pipeline = controller.current, current = batchRef.current;
    if (!pipeline || !current || editingBatch.current || pipeline.pending || sessionRef.current === 'starting') {
      throw new Error('Wait for the current photos to save before changing the batch size.');
    }
    if (!validBatchTarget(target, pipeline.count)) throw new Error('The batch needs room for its saved photos.');
    if (target === current.target) {
      if (target !== settingsRef.current.batchTarget) updateSettings({ ...settingsRef.current, batchTarget: target });
      return;
    }
    editingBatch.current = true;
    try {
      await storage.resizeBatch(current.id, target);
      if (!mounted.current) return;
      const wasComplete = pipeline.complete;
      batchRef.current = { ...batchRef.current!, target };
      setBatch(batchRef.current);
      pipeline.resize(target);
      updateSettings({ ...settingsRef.current, batchTarget: target });
      if (wasComplete && !pipeline.complete) {
        lastComplete.current = undefined;
        resetMotion();
        changeSession('paused');
        setNotice('Batch size updated. Resume scanning to add more photos.');
      } else if (!pipeline.complete) setNotice('Batch size updated.');
    } finally { editingBatch.current = false; }
  };
  const remove = async (scan: Scan) => {
    if (editingBatch.current || controller.current?.pending || sessionRef.current === 'scanning') return;
    await storage.deleteScan(scan.id); setScans(items => items.filter(s => s.id !== scan.id));
    controller.current?.removeStored(); lastComplete.current = undefined; changeSession('paused');
    setNotice('Image deleted. Resume explicitly to fill the open batch slot.');
  };
  const discard = async (attempt: AttemptInfo) => {
    const pipeline = controller.current;
    if (!pipeline || editingBatch.current || pipeline.pending || pipeline.running) return;
    editingBatch.current = true;
    try {
      await pipeline.discard(attempt);
      updateAttempts(attemptsRef.current.filter(item => item.id !== attempt.id));
    } finally { editingBatch.current = false; }
  };
  const clear = async () => {
    if (editingBatch.current || controller.current?.pending || captureBusy.current || sessionRef.current === 'starting') return;
    editingBatch.current = true;
    try {
      pause();
      if (batchRef.current) await storage.clear(batchRef.current.id);
    } finally { editingBatch.current = false; }
    const number = batchRef.current?.number ?? nextBatchNumber.current;
    const nextNumber = batchRef.current ? number + 1 : number;
    const nextName = nameRef.current === defaultBatchName(number) ? defaultBatchName(nextNumber) : nameRef.current;
    batchRef.current = undefined; setBatch(undefined); setScans([]); updateAttempts([]); setRetained([]);
    controller.current?.dispose(); controller.current = undefined; storageIssueRef.current = ''; setStorageIssue('');
    nextBatchNumber.current = nextNumber; setCurrentBatchName(nextName, nextNumber);
    resetMotion(false); setReading(undefined);
    lastComplete.current = undefined; changeSession('idle'); setError(''); setNotice('Ready for a new batch.');
  };
  const switchCamera = async (id: string) => {
    resetMotion();
    try { await enableCamera(id); updateSettings({ ...settingsRef.current, cameraId: id }); setNotice('Camera changed and remembered.'); } catch (err) { setError(message(err)); setOpenBrowserSuggested(err instanceof CameraAccessError && err.openBrowser); }
  };
  const control = async (values: Record<string, unknown>) => { try { await camera.current?.control(values); if (typeof values.torch === 'boolean') updateSettings({ ...settingsRef.current, torch: values.torch }); } catch (err) { setError(`Camera setting unavailable: ${message(err)}`); } };
  const setFocus = async (locked: boolean, distance?: number) => {
    if (cameraPhaseRef.current !== 'ready' || !camera.current) return;
    if (distance !== undefined) setFocusPosition(distance);
    focusRequest.current = { locked, distance, epoch: cameraEpoch.current };
    if (focusApplying.current) return;
    focusApplying.current = true;
    setFocusBusy(true);
    resetMotion();
    let applied: { locked: boolean; distance?: number; epoch: number } | undefined;
    try {
      while (focusRequest.current) {
        const request = focusRequest.current;
        focusRequest.current = undefined;
        if (request.epoch !== cameraEpoch.current) continue;
        try {
          const position = await camera.current.focus(request.locked, request.distance);
          applied = { ...request, distance: position };
        } catch (err) {
          if (request.epoch === cameraEpoch.current) setError(`Focus could not be changed: ${message(err)}`);
        }
      }
      if (applied?.epoch === cameraEpoch.current) {
        setFocusLocked(applied.locked);
        setFocusPosition(applied.distance);
        updateSettings({ ...settingsRef.current, focusLocked: applied.locked, focusDistance: applied.locked ? applied.distance ?? null : null });
      } else {
        setFocusPosition(camera.current?.focusDistance);
      }
    } finally {
      focusApplying.current = false;
      setFocusBusy(false);
      resetMotion();
    }
  };
  const resetSettings = async () => {
    if (controller.current?.running || captureBusy.current || cameraPhaseRef.current === 'requesting') return;
    const open = cameraPhaseRef.current === 'ready';
    for (const key of Object.keys(defaults) as (keyof Settings)[]) editedPreferences.current.add(key);
    updateSettings({ ...defaults }); detector.current.reset(); setReading(undefined); setCountdown(null);
    await storage.settings({ ...defaults });
    if (open && canUseCamera()) {
      closeCamera();
      await enableCamera('');
    }
    setNotice('Settings reset. Your photos and batch are unchanged.');
  };
  const renameBatch = async (name: string) => {
    const current = batchRef.current;
    const number = current?.number ?? nextBatchNumber.current;
    const nextName = name.trim() || defaultBatchName(number);
    if (current) {
      await storage.renameBatch(current.id, nextName);
      if (batchRef.current?.id !== current.id) return;
      batchRef.current = { ...batchRef.current, name: nextName }; setBatch(batchRef.current);
    }
    setCurrentBatchName(nextName, number);
  };
  const setCaptureMode = (captureMode: Settings['captureMode']) => {
    editedPreferences.current.add('captureMode');
    updateSettings({ ...settingsRef.current, captureMode });
    resetMotion();
    void audio.current?.unlock();
  };
  const setZoom = (zoom: number) => {
    editedPreferences.current.add('zoom'); zoom = Math.max(1, Math.min(3, zoom));
    camera.current?.setZoom(zoom); updateSettings({ ...settingsRef.current, zoom });
    resetMotion();
  };
  const zoomGesture = (active: boolean) => {
    zoomAdjusting.current = active;
    resetMotion();
  };
  useEffect(() => {
    if (!storageIssue) return;
    const timer = setInterval(() => { if (!editingBatch.current) void controller.current?.retryStorage(); }, 3000);
    return () => clearInterval(timer);
  }, [storageIssue]);
  const original = useCallback(async (id: string) => (await controller.current?.original(id)), []);
  return { videoRef, batch, batchName, scans, attempts: [...attempts.filter(item => !retained.some(photo => photo.id === item.id)), ...retained], settings, setSettings: updateSettings, resetSettings, setCaptureMode, setZoom, zoomGesture, session, error, setError, notice, loaded, pending, capturing, queueFull: controller.current?.queueFull ?? false, storageIssue,
    cameraPhase, connectCamera, openBrowserSuggested,
    reading, countdown, cameraSize, capabilities, focusPosition, focusLocked, focusBusy, setFocus, devices, start, takePhoto, pause: () => pause(), stop,
    keepOriginal, resizeBatch, remove, discard, clear, switchCamera, control, renameBatch,
    original,
    updateScan: async (scan: Scan) => { await storage.accept(scan); setScans(items => ordered(items.map(s => s.id === scan.id ? scan : s))); },
    testSound: async () => { await audio.current?.unlock(); audio.current?.success(); },
    testErrorSound: async () => { await audio.current?.unlock(); audio.current?.error(); },
  };
}
