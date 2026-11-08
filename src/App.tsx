import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Aperture, ArrowDownToLine, ArrowLeft, ArrowRight, Camera, Check, CheckCheck, ChevronRight, CircleHelp, Focus, Gauge, Images, Layers3, Lock, LockOpen, Menu, Pause, Pencil, Play, RotateCw, ScanLine, Settings2, ShieldCheck, Square, Trash2, TriangleAlert, Volume2, X } from 'lucide-react';
import { useScanner } from './useScanner';
import { useTheme } from './useTheme';
import { downloadZip, rotateScan } from './core/export';
import { archiveFilename, defaultBatchName, filename, message } from './core/types';

function BlobImage({ blob, alt, ...props }: { blob: Blob; alt: string } & React.ImgHTMLAttributes<HTMLImageElement>) {
  const [url, setUrl] = useState('');
  useEffect(() => { const u = URL.createObjectURL(blob); setUrl(u); return () => URL.revokeObjectURL(u); }, [blob]);
  return <img src={url || undefined} alt={alt} {...props} />;
}
function Dialog({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={wide ? 'dialog wide' : 'dialog'} onCancel={event => { event.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="dialog-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog"><X size={20} /></button></div>
    {children}
  </dialog>;
}
function OriginalPhoto({ id, load }: { id: string; load(id: string): Promise<Blob | undefined> }) {
  const [blob, setBlob] = useState<Blob>();
  useEffect(() => {
    let active = true; void load(id).then(value => { if (active) setBlob(value); }).catch(() => {});
    return () => { active = false; };
  }, [id, load]);
  return blob ? <BlobImage blob={blob} alt="Retained original photo" /> : <div className="original-placeholder" aria-label="Original photo saved"><Camera size={20} /></div>;
}
export default function App() {
  const s = useScanner();
  const theme = useTheme();
  const [showMenu, setShowMenu] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [target, setTarget] = useState(50); const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false); const [selected, setSelected] = useState<string>();
  const [confirmClear, setConfirmClear] = useState(false); const [deleteId, setDeleteId] = useState<string>();
  const [exporting, setExporting] = useState<number | null>(null); const [working, setWorking] = useState(false);
  const [lastExport, setLastExport] = useState<string>();
  const [exportOpen, setExportOpen] = useState(false); const [exportName, setExportName] = useState('');
  const [showName, setShowName] = useState(false); const [nameDraft, setNameDraft] = useState(''); const [nameError, setNameError] = useState('');
  const [installPrompt, setInstallPrompt] = useState<Event & { prompt(): Promise<void> }>();
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e as Event & { prompt(): Promise<void> }); };
    window.addEventListener('beforeinstallprompt', handler); return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  const busy = s.session === 'starting' || s.session === 'scanning';
  const editingDisabled = busy || s.pending > 0 || working;
  const count = s.scans.length, quantity = s.batch?.target ?? target;
  const batchReserved = count + s.pending >= quantity;
  const progress = Math.min(100, count / quantity * 100);
  const rate = s.measuredScans > 1 && s.elapsedMs > 0 ? (s.measuredScans / (s.elapsedMs / 60000)).toFixed(1) : '—';
  const latest = s.scans.at(-1), active = s.scans.find(scan => scan.id === selected);
  const safe = async (action: () => Promise<unknown>) => { setWorking(true); try { await action(); } catch (err) { s.setError(message(err)); } finally { setWorking(false); } };
  const exportBatch = async () => {
    if (!s.batch || !count || exporting !== null) return;
    setExporting(0); s.setError('');
    try {
      const name = exportName.trim() || defaultBatchName(s.batch.number);
      await s.renameBatch(name);
      setLastExport((await downloadZip(s.scans, { ...s.batch, name }, setExporting)).name);
    }
    catch (err) { s.setError(`ZIP export failed: ${message(err)}. Your saved images are still on this device.`); }
    finally { setExporting(null); }
  };
  const exportButton = (className = 'button dark') => <button className={className} disabled={!count || exporting !== null || s.pending > 0 || busy} onClick={() => { setLastExport(undefined); setExportName(s.batch?.name || defaultBatchName(s.batch?.number ?? 1)); setExportOpen(true); }}><ArrowDownToLine size={17} />{exporting !== null ? `Creating ZIP · ${exporting}%` : 'Download ZIP'}{exporting === null && <span className="button-count">{count}</span>}</button>;
  const gallery = () => <>
    {count ? <div className="gallery-grid">{s.scans.map((scan, index) => {
      return <button className="scan-tile" key={scan.id} onClick={() => setSelected(scan.id)}>
        <div className="scan-image"><BlobImage blob={scan.thumbnail ?? scan.blob} alt={`Scanned card ${index + 1}`} loading="lazy" /><span><Check size={12} /></span></div>
        <span className="scan-name">{filename(index)}</span><span className="scan-meta">{scan.width && scan.height ? `${scan.width} × ${scan.height}` : 'JPEG'}</span>
      </button>;
    })}</div> : <div className="gallery-empty"><div className="empty-icon"><Images size={26} strokeWidth={1.5} /></div><strong>Your collection starts here</strong><p>Photos appear here in capture order.</p></div>}
    {s.attempts.length > 0 && <div className="attempts">
      <h3>Retained photos</h3>
      {s.attempts.map(photo => <div className="attempt" key={photo.id}>
        <OriginalPhoto id={photo.id} load={s.original} />
        <div>
          <strong>Original photo</strong>
          <p>{s.storageIssue ? 'Browser storage is unavailable. Keep this page open to retry saving.' : 'Available to add to your batch or download.'}</p>
          <div className="attempt-buttons">
            <button disabled={editingDisabled || !!s.storageIssue || count >= quantity} onClick={() => void safe(() => s.keepOriginal(photo))}>Add to batch</button>
            <button onClick={() => void safe(async () => {
              const raw = await s.original(photo.id);
              if (!raw) throw new Error('Original photo is unavailable.');
              const url = URL.createObjectURL(raw);
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = `Original_${photo.ordinal + 1}.jpg`;
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 60000);
            })}>Save original</button>
            <button disabled={editingDisabled} onClick={() => void safe(() => s.discard(photo))}>Discard</button>
          </div>
        </div>
      </div>)}
    </div>}

  </>;
  const openFromMenu = (open: () => void) => { setShowMenu(false); open(); };
  const failedCount = s.attempts.length;
  const autoMode = s.settings.captureMode === 'auto';
  const focusRange = s.capabilities.focusDistance;
  const focusModes = s.capabilities.focusMode ?? [];
  const canToggleFocus = focusModes.includes('manual') && (focusModes.includes('continuous') || focusModes.includes('single-shot'));
  const focusPosition = focusRange ? Math.min(focusRange.max, Math.max(focusRange.min, s.focusPosition ?? focusRange.min)) : undefined;
  const snapped = s.countdown === 'snapped';
  const showCountdown = autoMode && s.cameraPhase === 'ready' && s.countdown !== null && !s.storageIssue
    && (s.session === 'scanning' || (s.session === 'complete' && snapped));
  const countdownDeadline = showCountdown && typeof s.countdown === 'number' ? s.countdown : null;
  const countdownFill = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fill = countdownFill.current;
    if (countdownDeadline === null || !fill) return;
    const start = performance.now();
    const duration = Math.max(0, countdownDeadline - start);
    if (typeof fill.animate !== 'function') {
      fill.style.animation = `shutter-fill ${duration}ms linear both`;
      return () => { fill.style.removeProperty('animation'); };
    }
    const animation = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration, fill: 'both' });
    animation.startTime = start;
    return () => animation.cancel();
  }, [countdownDeadline]);
  const waitLabel = s.settings.stabilityMs === 1000 ? '1 s' : `${s.settings.stabilityMs} ms`;
  let scannerStatus = 'Camera ready';
  if (s.session === 'complete') scannerStatus = 'Batch complete';
  else if (s.cameraPhase === 'requesting') scannerStatus = 'Opening camera';
  else if (s.cameraPhase === 'off') scannerStatus = 'Camera off';
  else if (s.storageIssue) scannerStatus = 'Waiting for storage';
  else if (!s.loaded) scannerStatus = 'Loading saved photos';
  else if (s.capturing) scannerStatus = 'Taking photo';
  else if (s.pending && batchReserved) scannerStatus = 'Saving final photos';
  else if (s.queueFull) scannerStatus = 'Saving queued photos';
  else if (s.session === 'starting') scannerStatus = 'Preparing camera';
  else if (s.session === 'paused') scannerStatus = 'Scanning paused';
  else if (s.session === 'scanning') {
    if (!autoMode) scannerStatus = 'Manual · tap to take a photo';
    else if (showCountdown && !snapped) scannerStatus = 'Hold still';
    else if (s.reading?.needsRemoval) scannerStatus = 'Remove the card';
    else if (s.reading?.state === 'moving') scannerStatus = 'Card moving';
    else scannerStatus = s.reading?.presence === 'uncertain' ? 'Center one card' : 'Place a card';
  }
  const ratio = s.cameraSize.width && s.cameraSize.height ? s.cameraSize.width / s.cameraSize.height : .75;
  const editName = () => { setNameDraft(s.batchName); setNameError(''); setShowName(true); };
  const saveName = () => {
    if (working || !s.loaded) return;
    setWorking(true);
    void s.renameBatch(nameDraft).then(() => setShowName(false)).catch(err => { setNameError(message(err)); s.setError(message(err)); }).finally(() => setWorking(false));
  };
  return <>
    <main className="scanner-screen" aria-label="Card scanner">
      <section className="scanner" aria-label="Scanner">
        <div className="preview-shell">
          <div className={`viewfinder ${s.cameraSize.width ? 'has-camera' : ''}`}>
            <div className="camera-feed" style={{ width: `${Math.min(1, ratio / .75) * 100}%`, height: `${Math.min(1, .75 / ratio) * 100}%` }}>
              <video ref={s.videoRef} style={{ transform: `scale(${s.settings.zoom})` }} playsInline muted autoPlay aria-label="Live camera preview" />
            </div>
            <button className="batch-name-trigger" aria-label="Edit batch name" title="Edit batch name" onClick={editName}><span>{s.batchName}</span><Pencil size={13} /></button>
            <button className="menu-trigger" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={showMenu} onClick={() => setShowMenu(true)}>
              <Menu size={22} />{failedCount > 0 && <span className="menu-attention" aria-label={`${failedCount} scan${failedCount === 1 ? '' : 's'} need review`} />}
            </button>
            {!s.cameraSize.width && <div className="camera-placeholder"><ScanLine size={35} strokeWidth={1.25} /><p>{s.cameraPhase === 'requesting' ? 'Choose Allow to use your camera' : 'Enable your camera to begin'}</p></div>}
            <div className={`auto-countdown${snapped ? ' is-snapped' : ''}`} hidden={!showCountdown} aria-hidden="true">
              <div ref={countdownFill} />
            </div>
            <label className="zoom-control"><span>Zoom</span><input aria-label="Camera zoom" type="range" min="1" max="3" step="0.1" value={s.settings.zoom} disabled={s.cameraPhase !== 'ready'} onPointerDown={() => s.zoomGesture(true)} onPointerUp={() => s.zoomGesture(false)} onPointerCancel={() => s.zoomGesture(false)} onBlur={() => s.zoomGesture(false)} onChange={event => s.setZoom(+event.target.value)} /><output>{s.settings.zoom.toFixed(1)}×</output></label>
          </div>
          {s.cameraPhase === 'ready' && (focusRange || canToggleFocus) && (
            <div className="focus-control" role="group" aria-label="Camera focus controls">
              {canToggleFocus && <button
                className="focus-lock"
                aria-label={s.focusLocked ? 'Unlock focus' : 'Lock focus'}
                title={s.focusLocked ? 'Unlock focus' : 'Lock focus'}
                aria-pressed={s.focusLocked}
                disabled={s.focusBusy}
                onClick={() => void s.setFocus(!s.focusLocked)}
              >{s.focusLocked ? <Lock size={16} /> : <LockOpen size={16} />}</button>}
              {focusRange && <input
                aria-label="Manual focus"
                type="range"
                min={focusRange.min}
                max={focusRange.max}
                step={focusRange.step && focusRange.step > 0 ? focusRange.step : 'any'}
                value={focusPosition}
                onPointerDown={() => s.zoomGesture(true)}
                onPointerUp={() => s.zoomGesture(false)}
                onPointerCancel={() => s.zoomGesture(false)}
                onBlur={() => s.zoomGesture(false)}
                onChange={event => void s.setFocus(true, +event.target.value)}
              />}
            </div>
          )}
        </div>
        <div className="scanner-status">
          <span className={`session-state ${s.session === 'scanning' ? 'is-live' : ''} ${failedCount ? 'needs-attention' : ''}`} role="status"><i /><span>{scannerStatus}</span></span>
          <button type="button" className="scan-count" aria-haspopup="dialog" aria-expanded={showGallery} aria-label={`View recent cards, ${count} saved photos out of ${quantity}`} onClick={() => setShowGallery(true)}>
            <Images size={14} aria-hidden="true" /><span>{count}<span> / {quantity}</span></span>
          </button>
        </div>
        <div className="capture-mode-row"><div className="capture-modes" role="group" aria-label="Capture mode"><button aria-pressed={autoMode} onClick={() => s.setCaptureMode('auto')}>Auto</button><button aria-pressed={!autoMode} onClick={() => s.setCaptureMode('manual')}>Manual</button></div></div>
        {s.cameraPhase !== 'ready' ? <button className="button primary scan-action" disabled={s.cameraPhase === 'requesting'} onClick={() => void s.connectCamera()}><Camera size={19} />{s.cameraPhase === 'requesting' ? 'Requesting camera…' : 'Enable camera'}</button> : !autoMode && s.session !== 'complete' ? <button className="button primary scan-action" disabled={!s.loaded || s.session === 'starting' || !!s.storageIssue || s.capturing || s.queueFull || batchReserved} onClick={() => void s.takePhoto(target)}><Camera size={19} />{s.session === 'starting' ? 'Preparing…' : 'Take photo'}</button> : s.session === 'scanning' ? <button className="button primary scan-action" onClick={s.pause}><Pause size={18} fill="currentColor" />Pause scanning</button> : <button className="button primary scan-action" disabled={!s.loaded || s.session === 'starting' || s.session === 'complete' || batchReserved} onClick={() => void s.start(target)}>
          {s.session === 'complete' ? <CheckCheck size={19} /> : <Play size={18} fill="currentColor" />}
          {s.session === 'complete' ? 'Batch complete' : !s.loaded ? (s.storageIssue ? 'Storage unavailable' : 'Loading saved scans…') : s.session === 'starting' ? 'Preparing…' : s.batch ? 'Resume scanning' : 'Start scanning'}
        </button>}
        {s.error && <div role="alert" className="scanner-error"><TriangleAlert size={16} /><p>{s.error}{s.session === 'scanning' && ' Scanning has not been paused.'}{failedCount > 0 && ' Retained originals are in Recent cards.'}</p><button className="icon-button" onClick={() => s.setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}
        {s.openBrowserSuggested && <a className="camera-browser-link" href={new URL(import.meta.env.BASE_URL, location.origin).href} target="_blank" rel="noopener noreferrer">Open scanner in Safari or Chrome <ArrowRight size={14} /></a>}
        {import.meta.env.DEV && new URLSearchParams(location.search).get('test-camera') === '1' && <div className="test-camera-controls"><small>Synthetic test camera · development only</small><button className="button outline" disabled={s.session !== 'scanning'} onClick={() => window.dispatchEvent(new Event('test-card-slide'))}>Slide test card</button><button className="button outline" disabled={s.cameraPhase !== 'ready'} onClick={() => window.dispatchEvent(new Event('test-card-invalid'))}>Blank test frame</button><button className="button outline" disabled={s.cameraPhase !== 'ready'} onClick={() => window.dispatchEvent(new Event('test-card-silver'))}>Use silver border</button><button className="button outline" disabled={s.session !== 'scanning'} onClick={() => window.dispatchEvent(new Event('test-card-feed'))}>Feed 9 cards · one per second</button></div>}
      </section>
    </main>

    {showName && <Dialog title="Edit batch name" close={() => setShowName(false)}><div className="confirm-content"><label className="select-setting batch-name-field" htmlFor="batch-name">Batch name<input id="batch-name" autoFocus maxLength={100} enterKeyHint="done" value={nameDraft} onChange={event => setNameDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); saveName(); } }} /></label><p className="setting-hint">This name appears on your scanner and downloaded ZIP.</p>{nameError && <p className="name-error" role="alert">{nameError}</p>}</div><div className="dialog-footer"><button className="button outline" onClick={() => setShowName(false)}>Cancel</button><button className="button dark" disabled={working || !s.loaded} onClick={saveName}>Save name</button></div></Dialog>}

    {showMenu && <Dialog title="Menu" close={() => setShowMenu(false)}>
      <nav className="menu-list" aria-label="Scanner menu">
        <button onClick={() => openFromMenu(() => setShowBatch(true))}><Layers3 size={20} /><span>Batch<small>{count} / {quantity} cards scanned</small></span><ChevronRight size={17} /></button>
        <button onClick={() => openFromMenu(() => setShowGallery(true))}><Images size={20} /><span>Recent cards<small>{failedCount ? `${failedCount} need review` : `${count} saved`}</small></span><ChevronRight size={17} /></button>
        <button onClick={() => openFromMenu(() => setShowSettings(true))}><Settings2 size={20} /><span>Settings</span><ChevronRight size={17} /></button>
        <button onClick={() => openFromMenu(() => setShowHelp(true))}><CircleHelp size={20} /><span>Scanning guide</span><ChevronRight size={17} /></button>
        {s.settings.debug && <button onClick={() => openFromMenu(() => setShowDiagnostics(true))}><Gauge size={20} /><span>Scan details</span><ChevronRight size={17} /></button>}
        {s.cameraSize.width > 0 && <>
          <div className="menu-divider" />
          {!autoMode && s.session === 'scanning' && <button onClick={() => openFromMenu(s.pause)}><Pause size={18} /><span>Pause scanning</span><ChevronRight size={17} /></button>}
          <button disabled={s.session !== 'scanning' || !!s.storageIssue || batchReserved || s.queueFull || s.capturing} onClick={() => openFromMenu(s.explicitCapture)}><Aperture size={20} /><span>Capture current card</span><ChevronRight size={17} /></button>
          <button onClick={() => openFromMenu(s.stop)}><Square size={18} /><span>Stop camera</span><ChevronRight size={17} /></button>
        </>}
      </nav>
      <div className="menu-footer">{exportButton()}{busy && <p className="setting-hint">Pause scanning to download or edit images.</p>}</div>
    </Dialog>}

    {showBatch && <Dialog title={s.batch?.name || 'Batch'} close={() => setShowBatch(false)}>
      <div className="batch-content">
        <button className="edit-name-link" onClick={editName}><Pencil size={14} />Edit batch name<span>{s.batchName}</span></button>
        <label className="field-label" htmlFor="batch-quantity">Cards per batch</label>
        <div className="quantity-options">{[10,25,50,100].map(q => <button key={q} disabled={!!s.batch || busy} aria-pressed={quantity === q} className={quantity === q ? 'selected' : ''} onClick={() => setTarget(q)}>{q}</button>)}</div>
        <div className="custom-quantity"><label htmlFor="batch-quantity">Custom quantity</label><input id="batch-quantity" type="number" inputMode="numeric" min="1" max="10000" value={quantity} disabled={!!s.batch || busy} onChange={e => setTarget(Math.min(10000, Math.max(1, Number(e.target.value) || 1)))} /></div>
        <div className="progress-heading"><span>{count} / {quantity} cards scanned</span><span>{Math.round(progress)}%</span></div>
        <div className="progress-track" role="progressbar" aria-label="Batch progress" aria-valuemin={0} aria-valuemax={quantity} aria-valuenow={count}><div style={{ width: `${progress}%` }} /></div>
        {s.batch && <p className="setting-hint batch-hint">Quantity is fixed for this batch. Start a new batch to change it.</p>}
        {s.notice && <p className="setting-hint batch-hint">{s.notice}</p>}
      </div>
      <div className="dialog-footer batch-actions">{s.batch && <button className="button danger-outline" disabled={busy || s.pending > 0} onClick={() => setConfirmClear(true)}>New batch</button>}{exportButton()}</div>
    </Dialog>}

    {showGallery && <Dialog title="Recent cards" close={() => setShowGallery(false)} wide>
      <div className="gallery-heading"><p>{count} saved{busy ? ' · pause to edit' : ''}</p>{exportButton()}</div>
      {gallery()}
    </Dialog>}

    {showDiagnostics && <Dialog title="Scan details" close={() => setShowDiagnostics(false)}><div className="diagnostics-grid">
      <span>Motion<b>{((s.reading?.score ?? 0) * 100).toFixed(2)}%</b></span>
      <span>Stability<b>{((s.reading?.stability ?? 0) * 100).toFixed(0)}%</b></span>
      <span>Noise<b>{s.reading?.noise.toFixed(2) ?? '—'}</b></span>
      <span>Capture state<b>{s.reading?.state ?? 'waiting'}</b></span>
      <span>Analysis<b>{timingLabel(s.timing)}</b></span>
      <span>Measured pace<b>{rate} cards/min</b></span>
      <span>Failures<b>{failedCount}</b></span>
      <span>Cycle<b>{s.reading?.cycle ?? 0}</b></span>
      <span>Camera<b>{s.cameraSize.width ? `${s.cameraSize.width} × ${s.cameraSize.height}` : 'Off'}</b></span>
    </div></Dialog>}

    {showSettings && <Dialog title="Settings" close={() => setShowSettings(false)}><div className="settings-content simple-settings">
      <p className="dialog-intro">Your choices are saved automatically on this device.</p>
      <Toggle label="Dark mode" checked={theme.dark} onChange={theme.setDark} />
      <Setting label="Wait before each photo" value={waitLabel} hint="Auto takes a photo once movement stops and the green bar fills.">
        <input aria-label="Wait before each photo" type="range" min="10" max="1000" step="10" value={s.settings.stabilityMs} onChange={event => s.setSettings({ ...s.settings, stabilityMs: +event.target.value })} />
      </Setting>
      <Toggle label="Sounds" hint="A ding means the camera took a photo. A low buzz means there’s a problem." checked={!s.settings.muted} onChange={v => s.setSettings({ ...s.settings, muted: !v })} />
      {!s.settings.muted && <>
        <Setting label="Volume" value={`${Math.round(s.settings.volume * 100)}%`}><input aria-label="Sound volume" type="range" min="0" max="1" step="0.05" value={s.settings.volume} onChange={e => s.setSettings({ ...s.settings, volume: +e.target.value })} /></Setting>
        <div className="sound-previews" role="group" aria-label="Preview sounds"><button className="button outline" onClick={() => void s.testSound()}><Volume2 size={16} />Play ding</button><button className="button outline" onClick={() => void s.testErrorSound()}><Volume2 size={16} />Play buzz</button></div>
      </>}
      <details className="advanced-settings"><summary><span>Advanced settings<small>Extra camera and photo controls</small></span><ChevronRight size={18} /></summary><div>
        <p className="setting-hint">You can leave these as they are unless you’re having trouble.</p>
        {busy && <div className="settings-pause-note"><p>Pause scanning to change the greyed-out controls.</p><button className="button outline" onClick={s.pause}><Pause size={16} />Pause scanning</button></div>}
        <h3><Focus size={16} /> Photos</h3>
        <Setting label="Ignore small movements" value={s.settings.sensitivity < .05 ? 'A little' : s.settings.sensitivity < .12 ? 'Some' : 'More'} hint="Turn this up if small vibrations keep restarting the countdown."><input aria-label="Ignore small movements" disabled={busy} type="range" min="0.02" max="0.2" step="0.005" value={s.settings.sensitivity} onChange={e => s.setSettings({ ...s.settings, sensitivity: +e.target.value })} /></Setting>
        <Setting label="Photo quality" value={`${Math.round(s.settings.quality * 100)}%`} hint="Higher quality makes larger download files."><input aria-label="Photo quality" disabled={busy} type="range" min="0.8" max="1" step="0.01" value={s.settings.quality} onChange={e => s.setSettings({ ...s.settings, quality: +e.target.value })} /></Setting>
        <h3><Camera size={16} /> Camera</h3>
        {s.devices.length > 1 && <label className="select-setting">Choose a camera<select disabled={busy || s.pending > 0} value={s.settings.cameraId} onChange={e => void s.switchCamera(e.target.value)}><option value="">Automatic rear camera</option>{s.devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label>}
        {s.capabilities.torch && <Toggle label="Flashlight" hint="Add light from your phone while scanning." checked={s.settings.torch} onChange={v => void s.control({ torch: v })} />}
        <p className="setting-hint">Use the zoom slider below the preview to frame your photo. On supported cameras, use the side slider to focus and the lock to hold focus.</p>
        <label className="select-setting">Camera detail<select disabled={busy || s.cameraSize.width > 0} value={s.settings.resolution} onChange={e => s.setSettings({ ...s.settings, resolution: +e.target.value })}>{[[1920,'Standard'],[2560,'High'],[3840,'Highest']].map(([n,label]) => <option key={n} value={n}>{label}</option>)}</select><small>Use Menu → Stop camera before changing this. Your phone chooses the closest size it supports.</small></label>
        {(s.capabilities.exposureMode?.includes('manual') || s.capabilities.whiteBalanceMode?.includes('manual')) && <Toggle label="Lock brightness and color" checked={s.settings.lockCamera} disabled={busy} hint="Turn on once the picture is clear to hold the brightness or color settings your phone supports." onChange={v => void s.lock(v)} />}
        <Toggle label="Alternate manual photo method" hint="Try this if the Take photo button fails on your phone." checked={s.settings.useImageCapture} disabled={busy} onChange={v => s.setSettings({ ...s.settings, useImageCapture: v })} />
        <h3><Gauge size={16} /> Troubleshooting</h3>

        <Toggle label="Show scan details" checked={s.settings.debug} hint="Adds Scan details to the menu to help check problems with scanning." onChange={v => s.setSettings({ ...s.settings, debug: v })} />
        <h3><ArrowDownToLine size={16} /> Add to your home screen</h3><p className="setting-hint">On iPhone, open Safari → Share → Add to Home Screen. On Android, choose Install app in the browser menu.</p>{installPrompt && <button className="button outline install-scanner" onClick={() => { void installPrompt.prompt(); setInstallPrompt(undefined); }}>Install app</button>}
      </div></details>
    </div><div className="dialog-footer"><button className="button outline" disabled={!s.loaded || busy || s.capturing || working || s.cameraPhase === 'requesting'} title={busy ? 'Pause scanning to reset settings' : 'Restore defaults and keep your photos'} onClick={() => void safe(async () => { await s.resetSettings(); theme.setDark(window.matchMedia('(prefers-color-scheme: dark)').matches); })}>Reset settings</button><button className="button dark" onClick={() => setShowSettings(false)}>Done</button></div></Dialog>}
    {showHelp && <Dialog title="How to scan" close={() => setShowHelp(false)}><div className="guide-content"><p className="dialog-intro">Use Auto for hands-free photos, or Manual to take each photo yourself.</p>{[
      ['Position your phone', 'Keep your phone steady above one card. Allow camera access when asked. Keep all four card edges visible, with a little space around them. Avoid glare from lights.'],
      ['Choose your batch', 'Open Menu → Batch to choose how many cards to scan. Tap the name at the top of the camera view to change it. Use the zoom slider to bring the card closer.'],
      ['Take your photos', 'In Auto, place a card and tap Start scanning. The camera takes the photo and dings when the green bar fills. Remove the card before placing the next one. In Manual, tap Take photo.'],
      ['Check and download', 'Tap the scan count to view your photos. When the batch is full, scanning stops and an alarm plays. Choose Download ZIP to save the photos together in one file.'],
    ].map(([title, text], i) => <div className="guide-step" key={title}><span>{String(i + 1).padStart(2,'0')}</span><div><h3>{title}</h3><p>{text}</p></div></div>)}<div className="guide-callout"><ShieldCheck size={18} /><p>Scans stay in this browser’s local storage. Download your batch before clearing browser data. When reopening a saved batch in Auto, clear the camera view before placing a card.</p></div></div><div className="dialog-footer"><button className="button primary" onClick={() => setShowHelp(false)}>Ready to scan <ArrowRight size={16} /></button></div></Dialog>}
    {confirmClear && <Dialog title="Start a fresh batch?" close={() => setConfirmClear(false)}><div className="confirm-content"><p>This deletes this batch’s {count} saved images and {s.attempts.length} retained captures from this device. Download your ZIP first if you want to keep them.</p>{exportButton()}<p className="setting-hint">A download does not automatically clear your batch.</p></div><div className="dialog-footer"><button className="button outline" onClick={() => setConfirmClear(false)}>Keep batch</button><button className="button danger" disabled={editingDisabled} onClick={() => void safe(async () => { await s.clear(); setLastExport(undefined); setConfirmClear(false); setShowBatch(false); setShowGallery(false); setShowMenu(false); })}><Trash2 size={15} /> Delete & start new</button></div></Dialog>}
    {exportOpen && <Dialog title="Download your batch" close={() => { if (exporting === null) setExportOpen(false); }}><div className="confirm-content">{lastExport ? <div className="export-success" role="status"><strong>{lastExport} is ready</strong><p>Check your browser’s downloads. Photos stay saved here.</p></div> : <p>Give this batch a name before saving your archive.</p>}<label className="select-setting batch-name-field" htmlFor="export-batch-name">Batch name<input id="export-batch-name" autoFocus type="text" maxLength={100} value={exportName} disabled={exporting !== null} placeholder={defaultBatchName(s.batch?.number ?? 1)} onChange={e => setExportName(e.target.value)} /></label><p className="archive-preview">{archiveFilename(exportName, s.batch?.number ?? 1)}</p><p className="setting-hint">{count} saved photos · sequential Pokémon filenames inside the ZIP. The batch name is remembered for your next download.</p>{exporting !== null && <div className="progress-track" role="progressbar" aria-label="ZIP export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={exporting}><div style={{width:`${exporting}%`}} /></div>}</div><div className="dialog-footer"><button className="button outline" disabled={exporting !== null} onClick={() => setExportOpen(false)}>Cancel</button><button className="button dark" disabled={exporting !== null || s.pending > 0 || busy} onClick={() => void exportBatch()}><ArrowDownToLine size={16}/>{exporting !== null ? `Creating ZIP · ${exporting}%` : `Download ZIP · ${count} images`}</button></div></Dialog>}
    {active && <Dialog title={filename(s.scans.findIndex(a => a.id === active.id))} close={() => setSelected(undefined)} wide><div className="review-image"><BlobImage blob={active.blob} alt="Full-resolution scanned card" /></div><div className="review-meta"><span>{active.width && active.height ? `${active.width} × ${active.height} · JPEG` : 'JPEG'}</span></div><div className="dialog-footer review-actions"><button className="icon-button" aria-label="Previous card" disabled={s.scans[0].id === active.id} onClick={() => setSelected(s.scans[s.scans.findIndex(a => a.id === active.id) - 1]?.id)}><ArrowLeft size={20} /></button><button className="button outline" disabled={editingDisabled} onClick={() => void safe(async () => s.updateScan(await rotateScan(active)))}><RotateCw size={16} /> Rotate 180°</button><button className="button danger-outline" disabled={editingDisabled} onClick={() => setDeleteId(active.id)}><Trash2 size={16} /> Delete</button><button className="icon-button" aria-label="Next card" disabled={latest?.id === active.id} onClick={() => setSelected(s.scans[s.scans.findIndex(a => a.id === active.id) + 1]?.id)}><ArrowRight size={20} /></button></div></Dialog>}
    {deleteId && <Dialog title="Delete this scan?" close={() => setDeleteId(undefined)}><div className="confirm-content"><p>The image will be removed and exported filenames will stay sequential. Scanning stays paused until you explicitly resume.</p></div><div className="dialog-footer"><button className="button outline" onClick={() => setDeleteId(undefined)}>Keep image</button><button className="button danger" disabled={editingDisabled} onClick={() => void safe(async () => { const scan = s.scans.find(a => a.id === deleteId); if (scan) await s.remove(scan); setSelected(undefined); setDeleteId(undefined); })}>Delete image</button></div></Dialog>}
  </>;
}
function timingLabel(ms: number) { return `${ms.toFixed(1)} ms`; }
function Setting({ label, value, hint, children }: { label: string; value?: string; hint?: string; children: ReactNode }) {
  return <div className="setting"><div><label>{label}</label>{value && <span>{value}</span>}</div>{children}{hint && <p className="setting-hint">{hint}</p>}</div>;
}
function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="toggle-setting"><span>{label}{hint && <small>{hint}</small>}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><i /></label>;
}
