import { useCallback, useEffect, useRef, useState } from 'react';
import { BatchController, type Ticket } from './core/batch';
import { Camera, type CameraCapabilities } from './core/camera';
import { CameraAccessError } from './core/camera-access';
import { MotionDetector, toLuma, type MotionReading } from './core/motion';
import { Processor } from './core/processor';
import { ScannerAudio } from './core/audio';
import { storage } from './core/storage';
import { zoomRect } from './core/zoom';
import { defaultBatchName, defaults, message, ordered, type Attempt, type Batch, type Corners, type Processed, type Scan, type Settings } from './core/types';

interface Job { attempt: Attempt; result: Processed }
class ScanStorageError extends Error {}
export type Session = 'idle' | 'starting' | 'scanning' | 'paused' | 'complete';
function waitForPermissionDialogToClose() {
  if (!document.hidden) return Promise.resolve();
  return new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visible); resolve(); };
    const visible = () => { if (!document.hidden) finish(); };
    const timer = setTimeout(finish, 2000);
    document.addEventListener('visibilitychange', visible);
  });
}
export function useScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [batch, setBatch] = useState<Batch>(); const batchRef = useRef<Batch | undefined>(undefined);
  const [batchName, setBatchName] = useState(defaultBatchName(1)); const nameRef = useRef(defaultBatchName(1)); const customName = useRef(false); const nextBatchNumber = useRef(1);
  const [scans, setScans] = useState<Scan[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]); const attemptsRef = useRef<Attempt[]>([]);
  const [settings, setSettings] = useState<Settings>(defaults); const settingsRef = useRef(settings);
  const [session, setSession] = useState<Session>('idle'); const sessionRef = useRef<Session>('idle');
  const [error, updateError] = useState(''); const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false); const [pending, setPending] = useState(0);
  const [storageIssue, setStorageIssue] = useState(''); const storageIssueRef = useRef('');
  const [cameraPhase, setCameraPhase] = useState<'off' | 'requesting' | 'ready'>('off');
  const cameraPhaseRef = useRef<'off' | 'requesting' | 'ready'>('off');
  const [openBrowserSuggested, setOpenBrowserSuggested] = useState(false);
  const cameraRequest = useRef<Promise<void> | undefined>(undefined); const cameraEpoch = useRef(0);
  const previewWanted = useRef(true); const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editedPreferences = useRef(new Set<keyof Settings>()); const zoomAdjusting = useRef(false);
  const storageFailures = useRef(new Map<string, Attempt>());
  const [measuredScans, setMeasuredScans] = useState(0); const liveIds = useRef(new Set<string>());
  const [reading, setReading] = useState<MotionReading>();
  const [timing, setTiming] = useState(0); const [corners, setCorners] = useState<Corners>();
  const [cameraSize, setCameraSize] = useState({ width: 0, height: 0 });
  const [capabilities, setCapabilities] = useState<CameraCapabilities>({});
  const [fallback, setFallback] = useState(false); const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const controller = useRef<BatchController<Job> | undefined>(undefined);
  const camera = useRef<Camera | undefined>(undefined); const processor = useRef<Processor | undefined>(undefined); const audio = useRef<ScannerAudio | undefined>(undefined);
  const setError = useCallback((value: string) => { updateError(value); if (value) audio.current?.error(); }, []);
  const detector = useRef(new MotionDetector()); const jobs = useRef(new Map<number, Attempt>());
  const captureBusy = useRef(false); const requestedReady = useRef<number | null>(null);
  const lastComplete = useRef<string | undefined>(undefined); const wakeLock = useRef<{ release(): Promise<void> } | undefined>(undefined);
  const startTime = useRef<number | null>(null); const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedRef = useRef(0); const mounted = useRef(true);
  const startToken = useRef(0);
  const changeSession = (value: Session) => { sessionRef.current = value; if (mounted.current) setSession(value); };
  const changeCameraPhase = (value: 'off' | 'requesting' | 'ready') => { cameraPhaseRef.current = value; if (mounted.current) setCameraPhase(value); };
  const updateAttempts = (items: Attempt[]) => { attemptsRef.current = items; if (mounted.current) setAttempts(items); };
  const releaseWake = () => { void wakeLock.current?.release().catch(() => {}); wakeLock.current = undefined; };
  const endTiming = () => {
    if (startTime.current !== null) { elapsedRef.current += performance.now() - startTime.current; startTime.current = null; }
    setElapsedMs(elapsedRef.current);
  };
  const pause = useCallback((reason?: string) => {
    startToken.current++;
    controller.current?.pause(); requestedReady.current = null; detector.current.reset();
    if (sessionRef.current !== 'idle' && sessionRef.current !== 'complete') changeSession('paused');
    endTiming(); releaseWake(); if (reason) setError(reason);
  }, []);

  const makeController = (b: Batch, count: number, config: Settings) => {
    controller.current = new BatchController<Job>(b.target, count, b.nextOrdinal, fallback ? 1 : config.queueLimit,
      async ({ attempt, result }) => {
        const scan: Scan = { ...result, id: attempt.id, batchId: b.id, ordinal: attempt.ordinal, capturedAt: attempt.capturedAt, rotated: false };
        try { await storage.accept(scan); } catch (err) { throw new ScanStorageError(`Storage unavailable: ${message(err)}. Retained images will retry automatically.`); }
        if (!mounted.current) return;
        setScans(items => ordered([...items.filter(s => s.id !== scan.id), scan]));
        if (liveIds.current.delete(scan.id)) setMeasuredScans(n => n + 1);
        updateAttempts(attemptsRef.current.filter(a => a.id !== attempt.id));
        storageFailures.current.delete(attempt.id);
        if (!storageFailures.current.size) { storageIssueRef.current = ''; setStorageIssue(''); }
        setError(storageIssueRef.current);
        setCorners(result.corners); audio.current?.success();
      },
      (err, ticket) => {
        const a = jobs.current.get(ticket.id);
        const reason = message(err);
        if (a) {
          const failed = { ...a, reason };
          updateAttempts([...attemptsRef.current.filter(x => x.id !== a.id), failed]);
          void storage.saveAttempt(failed).catch(() => setError('Storage is full or unavailable. Raw image is still in this session. Download it before closing.'));
        }
        if (err instanceof ScanStorageError && a) {
          storageFailures.current.set(a.id, { ...a, reason }); storageIssueRef.current = reason; setStorageIssue(reason);
        }
        // Keep the operator's active/paused choice. The next placed card can still be scanned.
        setError(reason);
      },
      () => {
        if (!mounted.current) return;
        const c = controller.current; if (!c) return;
        setPending(c.pending);
        if (c.complete) {
          changeSession('complete'); endTiming(); releaseWake();
          setNotice('Your batch is saved. Review the images and download your ZIP.');
          if (lastComplete.current !== b.id) { audio.current?.complete(); lastComplete.current = b.id; }
        }
        const updated = { ...batchRef.current!, nextOrdinal: c.nextOrdinal, status: c.complete ? 'complete' as const : c.running ? 'scanning' as const : 'paused' as const };
        batchRef.current = updated; setBatch(updated);
        void storage.saveBatch(updated).catch(() => setError('Batch metadata could not be saved. Keep this page open and export your images.'));
      });
  };

  useEffect(() => {
    mounted.current = true;
    processor.current = new Processor(); audio.current = new ScannerAudio();
    let cancelled = false;
    const storageDeadline = setTimeout(() => {
      if (cancelled) return;
      storageIssueRef.current = 'Browser storage is not responding. You can enable the camera, but scanning needs storage. Reload or open this page directly in Safari or Chrome.';
      setStorageIssue(storageIssueRef.current); setError(storageIssueRef.current);
    }, 8000);
    storage.load().then(data => {
      clearTimeout(storageDeadline);
      if (cancelled) return;
      if (storageIssueRef.current) { setError(''); setStorageIssue(''); storageIssueRef.current = ''; }
      const config = { ...defaults, ...data.settings };
      if (!data.settings?.captureMode) { config.stabilityMs = Math.max(1200, config.stabilityMs); config.sensitivity = Math.min(.025, config.sensitivity); }
      for (const key of editedPreferences.current) Object.assign(config, { [key]: settingsRef.current[key] });
      settingsRef.current = config; setSettings(config);
      if (data.batch) {
        const maxOrdinal = Math.max(-1, ...data.scans.map(s => s.ordinal), ...data.attempts.map(a => a.ordinal));
        const b = { ...data.batch, name: data.batch.name || defaultBatchName(data.batch.number), nextOrdinal: Math.max(data.batch.nextOrdinal, maxOrdinal + 1) };
        batchRef.current = b; setBatch(b); setScans(ordered(data.scans));
        nameRef.current = b.name; setBatchName(b.name);
        updateAttempts(data.attempts.map(a => ({ ...a, reason: a.reason || 'Interrupted before processing finished. Retry this retained image.' })));
        lastComplete.current = data.scans.length >= b.target ? b.id : undefined;
        changeSession(data.scans.length >= b.target ? 'complete' : 'paused');
        makeController(b, data.scans.length, config);
        setNotice(data.scans.length >= b.target ? 'Completed batch recovered from this device. Your images are ready to review and download.' : 'Batch recovered from this device. Resume waits for new card movement.');
      } else { nextBatchNumber.current = data.nextBatchNumber ?? 1; nameRef.current = defaultBatchName(nextBatchNumber.current); setBatchName(nameRef.current); }
      setLoaded(true);
    }).catch(err => {
      clearTimeout(storageDeadline); if (cancelled) return;
      storageIssueRef.current = `Storage unavailable: ${message(err)}. Camera preview can still open. Enable browser storage or open this page in Safari or Chrome before scanning.`;
      setStorageIssue(storageIssueRef.current); setError(storageIssueRef.current);
    });
    const onHidden = () => {
      // A native permission prompt may temporarily hide an iOS WebView. Do not cancel it.
      if (document.hidden && cameraPhaseRef.current !== 'requesting' && (camera.current?.stream?.active || sessionRef.current === 'scanning' || sessionRef.current === 'starting')) {
        // Browsers suspend background cameras. Keep scan intent and reconnect on return.
        requestedReady.current = null; detector.current.reset(); endTiming(); releaseWake();
        cameraEpoch.current++; camera.current?.stop(); changeCameraPhase('off'); setCameraSize({ width: 0, height: 0 });
      }
      if (!document.hidden && previewWanted.current && cameraPhaseRef.current === 'off') void connectCamera(false);
    };
    const onRotation = () => { detector.current.reset(); requestedReady.current = null; };
    const preview = videoRef.current;
    const resized = () => { if (camera.current?.stream?.active && preview?.videoWidth) setCameraSize({ width: preview.videoWidth, height: preview.videoHeight }); };
    preview?.addEventListener('resize', resized);
    document.addEventListener('visibilitychange', onHidden); window.addEventListener('orientationchange', onRotation);
    return () => {
      cancelled = true; clearTimeout(storageDeadline); clearTimeout(reconnectTimer.current); mounted.current = false; cameraEpoch.current++; camera.current?.stop(); processor.current?.destroy(); releaseWake();
      preview?.removeEventListener('resize', resized);
      document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('orientationchange', onRotation);
    };
    // The lifetime owns the camera and processor. Mutable settings are kept in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    detector.current.stabilityMs = settings.stabilityMs; detector.current.sensitivity = settings.sensitivity;
    camera.current?.setZoom(settings.zoom);
    if (audio.current) { audio.current.volume = settings.volume; audio.current.muted = settings.muted; }
    if (loaded) void storage.settings(settings).catch(err => setError(`Settings could not be saved: ${message(err)}`));
  }, [settings, loaded]);

  const runAttempt = async (attempt: Attempt, ticket: Ticket) => {
    const c = controller.current!; jobs.current.set(ticket.id, attempt);
    updateAttempts([...attemptsRef.current.filter(a => a.id !== attempt.id), attempt]);
    try {
      try { await storage.stage(attempt, { ...batchRef.current!, nextOrdinal: c.nextOrdinal }); }
      catch (err) { throw new ScanStorageError(`Storage unavailable: ${message(err)}. Retained images will retry automatically.`); }
      const result = await processor.current!.process(attempt.raw, attempt.settings);
      if (processor.current!.fallback) { c.queueLimit = 1; setFallback(true); }
      c.settle(ticket, { value: { attempt, result } });
    } catch (err) { c.settle(ticket, { error: err }); }
    void c.idle().then(() => jobs.current.delete(ticket.id));
  };
  const capture = async () => {
    const c = controller.current;
    if (!c || captureBusy.current || !c.hasCapacity || !camera.current || cameraPhaseRef.current !== 'ready' || storageIssueRef.current) return;
    const ticket = c.reserve(); if (!ticket) return;
    captureBusy.current = true; requestedReady.current = null; detector.current.consume();
    try {
      const capturedAt = Date.now();
      const raw = await camera.current.capture(settingsRef.current.useImageCapture);
      const attempt: Attempt = { id: crypto.randomUUID(), batchId: batchRef.current!.id, ordinal: ticket.ordinal, capturedAt, raw, reason: '', settings: { ...settingsRef.current } };
      liveIds.current.add(attempt.id);
      void runAttempt(attempt, ticket);
    } catch (err) { c.settle(ticket, { error: err }); }
    finally { captureBusy.current = false; }
  };

  useEffect(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!; const gray = new Uint8Array(160 * 120);
    let frame = 0, lastAnalysis = 0, lastVideoTime = -1, lastUI = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const video = videoRef.current, c = controller.current;
      if (!video || document.hidden || sessionRef.current !== 'scanning' || !c?.running || cameraPhaseRef.current !== 'ready' || now - lastAnalysis < 60) return;
      if (video.readyState < 2 || video.currentTime === lastVideoTime) {
        if (now - lastAnalysis > 1800) { lastAnalysis = now; recoverCamera('Camera frames stopped. Reconnecting automatically.'); }
        return;
      }
      if (now - lastAnalysis > 650 && lastAnalysis > 0) {
        detector.current.reset(); requestedReady.current = null;
        setError('Preview lagged. Scanning is still active; reposition the current card before continuing.');
      }
      lastAnalysis = now; lastVideoTime = video.currentTime;
      const begin = performance.now();
      const crop = zoomRect(video.videoWidth, video.videoHeight, settingsRef.current.zoom);
      ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, 160, 120);
      toLuma(ctx.getImageData(0, 0, 160, 120).data, gray);
      const next = detector.current.update(gray, now);
      if (settingsRef.current.captureMode === 'auto' && !zoomAdjusting.current) {
        if (requestedReady.current !== null && next.cycle !== requestedReady.current) {
          requestedReady.current = null;
          setError('A card moved before the queue cleared. Scanning continues; check recent cards and retake the missed card.');
        }
        if (next.capture && !c.atBatchLimit) requestedReady.current = next.cycle;
        if (requestedReady.current !== null && next.state === 'ready' && c.hasCapacity && !captureBusy.current) void capture();
      }
      if (now - lastUI > 100) {
        setReading(next); setTiming(performance.now() - begin); lastUI = now;
        setElapsedMs(elapsedRef.current + (startTime.current !== null ? now - startTime.current : 0));
      }
    };
    // Reset analysis timing after every explicit resume.
    if (session === 'scanning') frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const enableCamera = (deviceId?: string): Promise<void> => {
    if (!videoRef.current) return Promise.reject(new Error('Camera preview is unavailable.'));
    if (camera.current?.stream?.active && cameraPhaseRef.current === 'ready' && !deviceId) return Promise.resolve();
    if (cameraRequest.current) return cameraRequest.current;
    if (!camera.current) camera.current = new Camera(videoRef.current, recoverCamera);
    const epoch = ++cameraEpoch.current;
    changeCameraPhase('requesting'); setOpenBrowserSuggested(false);
    const reminder = setTimeout(() => {
      if (mounted.current && cameraEpoch.current === epoch && cameraPhaseRef.current === 'requesting') {
        setError('Still waiting for camera access. Choose Allow in the browser prompt. If no prompt appears, open this scanner directly in Safari or Chrome.');
        setOpenBrowserSuggested(true);
      }
    }, 15000);
    // start() reaches getUserMedia synchronously, inside the button's user gesture.
    const opening = camera.current.start(settingsRef.current.resolution, deviceId).then(async info => {
      // Safari may report hidden for one more turn while dismissing its native permission sheet.
      await waitForPermissionDialogToClose();
      if (!mounted.current || cameraEpoch.current !== epoch || document.hidden) {
        if (cameraEpoch.current === epoch) camera.current?.stop();
        throw new CameraAccessError('cancelled', 'Camera startup interrupted.');
      }
      setCameraSize({ width: info.width ?? videoRef.current!.videoWidth, height: info.height ?? videoRef.current!.videoHeight });
      camera.current!.setZoom(settingsRef.current.zoom); clearTimeout(reconnectTimer.current);
      detector.current.reset(sessionRef.current === 'scanning' && settingsRef.current.captureMode === 'auto' && !controller.current?.count && !controller.current?.pending && !captureBusy.current && !attemptsRef.current.length);
      setCapabilities(camera.current!.capabilities); changeCameraPhase('ready');
      if (sessionRef.current === 'scanning' && startTime.current === null) startTime.current = performance.now();
      setError(storageIssueRef.current); setOpenBrowserSuggested(false);
      // Enumeration is optional; unsupported or rejected enumeration must not close a working camera.
      const enumerate = navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices);
      if (enumerate) {
        void Promise.resolve().then(enumerate).then(items => {
          if (mounted.current && cameraEpoch.current === epoch) setDevices(items.filter(d => d.kind === 'videoinput'));
        }).catch(() => { if (mounted.current && cameraEpoch.current === epoch) setDevices([]); });
      }
    }).catch(err => {
      if (cameraEpoch.current === epoch) { changeCameraPhase('off'); setCameraSize({ width: 0, height: 0 }); }
      throw err;
    }).finally(() => { clearTimeout(reminder); if (cameraRequest.current === opening) cameraRequest.current = undefined; });
    cameraRequest.current = opening;
    return opening;
  };
  const connectCamera = async (userGesture = true): Promise<boolean> => {
    if (!previewWanted.current && !userGesture) return false;
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
      if (sessionRef.current === 'scanning' && !(err instanceof CameraAccessError && ['denied', 'blocked', 'unsupported', 'insecure'].includes(err.reason))) scheduleReconnect();
      return false;
    }
  };
  function scheduleReconnect() {
    clearTimeout(reconnectTimer.current);
    if (!mounted.current || !previewWanted.current || document.hidden) return;
    reconnectTimer.current = setTimeout(() => { if (mounted.current && previewWanted.current && !document.hidden) void connectCamera(false); }, 2000);
  }
  function recoverCamera(reason: string) {
    if (!mounted.current) return;
    setError(reason); requestedReady.current = null; detector.current.reset();
    cameraEpoch.current++; camera.current?.stop(); changeCameraPhase('off'); setCameraSize({ width: 0, height: 0 });
    scheduleReconnect();
  }
  useEffect(() => {
    let cancelled = false;
    // Request the preview on entry; a browser that requires a tap keeps the Enable camera fallback.
    void Promise.resolve().then(() => { if (!cancelled && !document.hidden) void connectCamera(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const start = async (target: number): Promise<boolean> => {
    if (!loaded || sessionRef.current === 'starting' || controller.current?.complete) return false;
    if (controller.current?.running) return true;
    const audioReady = audio.current!.unlock(); // Called synchronously within the user's gesture.
    const token = ++startToken.current;
    previewWanted.current = true;
    changeSession('starting'); setError('');
    try {
      await enableCamera();
      if (startToken.current !== token || document.hidden) throw new Error('Scanner startup was interrupted. Keep the app open and resume when ready.');
      if (!batchRef.current) {
        const b = await storage.create(target, customName.current ? nameRef.current : undefined);
        batchRef.current = b; setBatch(b); nameRef.current = b.name; setBatchName(b.name); makeController(b, 0, settingsRef.current);
      }
      if (processor.current!.fallback && controller.current) controller.current.queueLimit = 1;
      detector.current.reset(settingsRef.current.captureMode === 'auto' && !controller.current!.count && !controller.current!.pending && !captureBusy.current && !attemptsRef.current.length); requestedReady.current = null;
      controller.current!.start(); changeSession('scanning'); startTime.current = performance.now();
      // Warm processing in the background. Manual snapshots are copied immediately, before encoding/processing.
      void processor.current!.init().then(() => {
        if (!mounted.current) return;
        setFallback(processor.current!.fallback);
        if (processor.current!.fallback && controller.current) controller.current.queueLimit = 1;
      }).catch(err => { if (mounted.current) setError(message(err)); });
      const awake = navigator as Navigator & { wakeLock?: { request(type: string): Promise<{ release(): Promise<void> }> } };
      void awake.wakeLock?.request('screen').then(lock => { if (controller.current?.running && mounted.current) wakeLock.current = lock; else void lock.release(); }).catch(() => {});
      void audioReady.then(soundOk => { if (mounted.current) setNotice(soundOk ? 'Scanning is active. Errors are reported without pausing.' : 'Tap a sound test in Settings to enable audio.'); });
      void navigator.storage?.persist?.().catch(() => {});
      return true;
    } catch (err) {
      changeSession(controller.current?.running ? 'scanning' : 'idle'); setError(message(err)); setNotice('');
      setOpenBrowserSuggested(err instanceof CameraAccessError && err.openBrowser);
      return false;
    }
  };
  const stop = () => { previewWanted.current = false; clearTimeout(reconnectTimer.current); pause(); cameraEpoch.current++; camera.current?.stop(); changeCameraPhase('off'); setCameraSize({ width: 0, height: 0 }); setNotice('Camera stopped. Saved scans and queued captures are retained.'); };
  const takePhoto = async (target: number) => {
    void audio.current?.unlock();
    if (!controller.current?.running && !await start(target)) return;
    if (!controller.current?.hasCapacity || storageIssueRef.current) { setError(storageIssueRef.current || 'The previous photos are still processing. Try again when a slot is free.'); return; }
    await capture();
  };
  const retry = async (attempt: Attempt) => {
    if (pending || sessionRef.current === 'scanning' || !controller.current || controller.current.complete) return;
    const c = controller.current;
    c.start(); const ticket = c.reserve(attempt.ordinal); c.pause();
    if (!ticket) return;
    setError(''); void audio.current?.unlock();
    await runAttempt({ ...attempt, reason: '', settings: settingsRef.current }, ticket);
  };
  const remove = async (scan: Scan) => {
    if (pending || sessionRef.current === 'scanning') return;
    await storage.deleteScan(scan.id); setScans(items => items.filter(s => s.id !== scan.id));
    controller.current?.removeStored(); lastComplete.current = undefined; changeSession('paused');
    setNotice('Image deleted. Resume explicitly to fill the open batch slot.');
  };
  const discard = async (attempt: Attempt) => { await storage.deleteAttempt(attempt.id); updateAttempts(attemptsRef.current.filter(a => a.id !== attempt.id)); };
  const clear = async () => {
    if (pending || captureBusy.current || sessionRef.current === 'starting') return;
    const nextNumber = (batchRef.current?.number ?? 0) + 1;
    pause(); if (batchRef.current) await storage.clear(batchRef.current.id);
    batchRef.current = undefined; setBatch(undefined); setScans([]); updateAttempts([]);
    controller.current = undefined; storageFailures.current.clear(); storageIssueRef.current = ''; setStorageIssue('');
    nextBatchNumber.current = nextNumber; nameRef.current = defaultBatchName(nextNumber); setBatchName(nameRef.current); customName.current = false;
    detector.current.reset(); setReading(undefined); setCorners(undefined);
    elapsedRef.current = 0; setElapsedMs(0); setMeasuredScans(0); liveIds.current.clear(); lastComplete.current = undefined; changeSession('idle'); setError(''); setNotice('Ready for a new batch.');
  };
  const switchCamera = async (id: string) => {
    detector.current.reset(); requestedReady.current = null;
    try { await enableCamera(id); setNotice('Camera changed. Scanning stays active.'); } catch (err) { setError(message(err)); setOpenBrowserSuggested(err instanceof CameraAccessError && err.openBrowser); }
  };
  const control = async (values: Record<string, unknown>) => { try { await camera.current?.control(values); } catch (err) { setError(`Camera setting unavailable: ${message(err)}`); } };
  const lock = async (value: boolean) => { try { await camera.current?.lock(value); setNotice(value ? 'Supported camera adjustments locked.' : 'Automatic camera adjustments restored.'); } catch (err) { setError(message(err)); } };
  const explicitCapture = () => { if (controller.current?.hasCapacity) { void audio.current?.unlock(); void capture(); } };
  const renameBatch = async (name: string) => {
    const nextName = name.trim() || defaultBatchName(batchRef.current?.number ?? nextBatchNumber.current);
    if (batchRef.current) {
      await storage.renameBatch(batchRef.current.id, nextName);
      batchRef.current = { ...batchRef.current, name: nextName }; setBatch(batchRef.current);
    }
    customName.current = true; nameRef.current = nextName; setBatchName(nextName);
  };
  const setCaptureMode = (captureMode: Settings['captureMode']) => {
    editedPreferences.current.add('captureMode');
    settingsRef.current = { ...settingsRef.current, captureMode }; setSettings(settingsRef.current);
    requestedReady.current = null; detector.current.reset(captureMode === 'auto' && !!controller.current?.running && !controller.current.count && !controller.current.pending && !captureBusy.current && !attemptsRef.current.length);
    void audio.current?.unlock();
  };
  const setZoom = (zoom: number) => {
    editedPreferences.current.add('zoom'); zoom = Math.max(1, Math.min(3, zoom));
    settingsRef.current = { ...settingsRef.current, zoom }; camera.current?.setZoom(zoom); setSettings(settingsRef.current);
    requestedReady.current = null; detector.current.reset(); setCorners(undefined);
  };
  const zoomGesture = (active: boolean) => {
    zoomAdjusting.current = active; requestedReady.current = null;
    detector.current.reset(!active && settingsRef.current.captureMode === 'auto' && !!controller.current?.running && !controller.current.count && !controller.current.pending && !captureBusy.current && !attemptsRef.current.length);
  };
  useEffect(() => {
    if (!storageIssue || session !== 'scanning') return;
    const recover = () => {
      const c = controller.current;
      if (!c?.running || c.pending || captureBusy.current) return;
      const attempt = [...storageFailures.current.values()].sort((a, b) => a.ordinal - b.ordinal)[0];
      if (!attempt) return;
      const ticket = c.reserve(attempt.ordinal);
      if (ticket) void runAttempt({ ...attempt, reason: '' }, ticket);
    };
    const timer = setInterval(recover, 3000); return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageIssue, session]);
  return { videoRef, batch, batchName, scans, attempts, settings, setSettings, setCaptureMode, setZoom, zoomGesture, session, error, setError, notice, loaded, pending, storageIssue,
    cameraPhase, connectCamera, openBrowserSuggested,
    reading, timing, corners, cameraSize, capabilities, fallback, devices, elapsedMs, measuredScans, start, takePhoto, pause: () => pause(), stop,
    retry, remove, discard, clear, switchCamera, control, lock, explicitCapture, renameBatch,
    updateScan: async (scan: Scan) => { await storage.accept(scan); setScans(items => ordered(items.map(s => s.id === scan.id ? scan : s))); },
    testSound: async () => { await audio.current?.unlock(); audio.current?.success(); },
    testErrorSound: async () => { await audio.current?.unlock(); audio.current?.error(); },
  };
}
