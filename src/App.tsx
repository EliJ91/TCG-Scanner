import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Aperture, ArrowDownToLine, ArrowLeft, ArrowRight, Camera, Check, CheckCheck, ChevronRight, CircleHelp, Focus, Gauge, Images, Layers3, Menu, Moon, Pause, Play, RotateCw, ScanLine, Settings2, ShieldCheck, Square, Trash2, TriangleAlert, Volume2, X } from 'lucide-react';
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
  const [lastExport, setLastExport] = useState<{ blob: Blob; name: string }>();
  const [shareBusy, setShareBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false); const [exportName, setExportName] = useState('');
  const [torch, setTorch] = useState(false); const [locked, setLocked] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event & { prompt(): Promise<void> }>();
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e as Event & { prompt(): Promise<void> }); };
    window.addEventListener('beforeinstallprompt', handler); return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  const busy = s.session === 'starting' || s.session === 'scanning';
  const editingDisabled = busy || s.pending > 0 || working;
  const count = s.scans.length, quantity = s.batch?.target ?? target;
  const progress = Math.min(100, count / quantity * 100);
  const avg = count ? Math.round(s.scans.reduce((sum, a) => sum + a.processingMs, 0) / count) : 0;
  const rate = s.measuredScans > 1 && s.elapsedMs > 0 ? (s.measuredScans / (s.elapsedMs / 60000)).toFixed(1) : '—';
  const latest = s.scans.at(-1), active = s.scans.find(scan => scan.id === selected);
  const status = s.session === 'complete' ? 'Batch complete' : s.session === 'starting' ? 'Preparing scanner' : s.session === 'paused' ? 'Scanning paused' : s.session === 'scanning' ? (s.pending + count >= quantity ? 'Saving final scans' : s.pending >= s.settings.queueLimit ? 'Queue full · slow card feed' : s.reading?.state === 'moving' ? 'Card moving' : s.reading?.state === 'stabilizing' ? 'Stabilizing card' : s.reading?.state === 'ready' ? 'Card ready · waiting for capacity' : 'Waiting for card movement') : 'Ready when you are';
  const safe = async (action: () => Promise<unknown>) => { setWorking(true); try { await action(); } catch (err) { s.setError(message(err)); } finally { setWorking(false); } };
  const exportBatch = async () => {
    if (!s.batch || !count || exporting !== null) return;
    setExporting(0); s.setError('');
    try {
      const name = exportName.trim() || defaultBatchName(s.batch.number);
      await s.renameBatch(name);
      setLastExport(await downloadZip(s.scans, { ...s.batch, name }, setExporting));
    }
    catch (err) { s.setError(`ZIP export failed: ${message(err)}. Your saved images are still on this device.`); }
    finally { setExporting(null); }
  };
  const shareZip = async () => {
    if (!lastExport) return; setShareBusy(true);
    try { const file = new File([lastExport.blob], lastExport.name, { type: 'application/zip' }); await navigator.share({ files: [file], title: lastExport.name }); }
    catch (err) { if (!(err instanceof DOMException && err.name === 'AbortError')) s.setError(`Sharing unavailable: ${message(err)}. Use the browser’s Downloads folder.`); }
    finally { setShareBusy(false); }
  };
  const exportButton = (className = 'button dark') => <button className={className} disabled={!count || exporting !== null || s.pending > 0 || busy} onClick={() => { setLastExport(undefined); setExportName(s.batch?.name || defaultBatchName(s.batch?.number ?? 1)); setExportOpen(true); }}><ArrowDownToLine size={17} />{exporting !== null ? `Creating ZIP · ${exporting}%` : 'Download ZIP'}{exporting === null && <span className="button-count">{count}</span>}</button>;
  const gallery = () => <>
    {count ? <div className="gallery-grid">{s.scans.map(scan => {
      const index = s.scans.findIndex(a => a.id === scan.id);
      return <button className="scan-tile" key={scan.id} onClick={() => setSelected(scan.id)}>
        <div className="scan-image"><BlobImage blob={scan.thumbnail} alt={`Scanned card ${index + 1}`} loading="lazy" /><span><Check size={12} /></span></div>
        <span className="scan-name">{filename(index)}</span><span className="scan-meta">{scan.width} × {scan.height}</span>
      </button>;
    })}</div> : <div className="gallery-empty"><div className="empty-icon"><Images size={26} strokeWidth={1.5} /></div><strong>Your collection starts here</strong><p>Accepted cards appear here in scan order.</p></div>}
    {s.attempts.length > 0 && <div className="attempts"><h3>{s.attempts.filter(a => a.reason).length ? 'Needs your attention' : 'Processing captures'}</h3>{s.attempts.map(a => <div className="attempt" key={a.id}>
      <BlobImage blob={a.raw} alt="Retained original capture" /><div><strong>{a.reason ? 'Scan not accepted' : 'Processing…'}</strong><p>{a.reason || 'Finding edges, checking focus, and saving.'}</p><small>Original capture retained · not counted</small>
      {a.reason && <div className="attempt-buttons"><button disabled={editingDisabled || count >= quantity} onClick={() => void s.retry(a)}><RotateCw size={13} /> Retry image</button><button onClick={() => { const url = URL.createObjectURL(a.raw), anchor = document.createElement('a'); anchor.href = url; anchor.download = `Unprocessed_${a.ordinal + 1}.jpg`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }}>Save original</button><button disabled={editingDisabled} onClick={() => void safe(() => s.discard(a))}>Discard</button></div>}</div>
    </div>)}</div>}
  </>;
  const openFromMenu = (open: () => void) => { setShowMenu(false); open(); };
  const failedCount = s.attempts.filter(attempt => attempt.reason).length;
  const scannerStatus = failedCount ? 'Scan needs review' : status;
  const guideHeight = 70 * (s.cameraSize.width && s.cameraSize.height ? Math.min(1, .75 / (s.cameraSize.width / s.cameraSize.height)) : 1);
  return <>
    <main className="scanner-screen" aria-label="Card scanner">
      <section className="scanner" aria-label="Scanner">
        <div className={`viewfinder ${s.cameraSize.width ? 'has-camera' : ''}`}>
          <video ref={s.videoRef} playsInline muted autoPlay aria-label="Live camera preview" />
          <button className="menu-trigger" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={showMenu} onClick={() => setShowMenu(true)}>
            <Menu size={22} />{failedCount > 0 && <span className="menu-attention" aria-label={`${failedCount} scan${failedCount === 1 ? '' : 's'} need review`} />}
          </button>
          <div className="alignment-guide" style={{ height: `${guideHeight}%` }} aria-hidden="true"><i /><i /><i /><i /></div>
          {!s.cameraSize.width && <div className="camera-placeholder"><ScanLine size={35} strokeWidth={1.25} /><p>Position a card</p></div>}
          {s.settings.debug && s.corners && s.cameraSize.width > 0 && <svg className="boundary-svg" viewBox={`0 0 ${s.cameraSize.width} ${s.cameraSize.height}`} preserveAspectRatio="xMidYMid meet" aria-label="Last accepted card boundaries"><polygon points={s.corners.map(p => `${p.x},${p.y}`).join(' ')} /></svg>}
        </div>
        <div className="scanner-status" role="status" aria-live="polite">
          <span className={`session-state ${s.session === 'scanning' ? 'is-live' : ''} ${failedCount ? 'needs-attention' : ''}`}><i /><span>{scannerStatus}</span></span>
          <span className="scan-count" aria-label={`${count} of ${quantity} cards scanned`}>{count}<span> / {quantity}</span></span>
        </div>
        {s.session === 'scanning' ? <button className="button primary scan-action" onClick={s.pause}><Pause size={18} fill="currentColor" />Pause scanning</button> : <button className="button primary scan-action" disabled={!s.loaded || s.session === 'starting' || s.session === 'complete' || s.pending > 0 || failedCount > 0} onClick={() => void s.start(target)}>
          {s.session === 'complete' ? <CheckCheck size={19} /> : <Play size={18} fill="currentColor" />}
          {s.session === 'complete' ? 'Batch complete' : s.session === 'starting' ? 'Preparing…' : s.batch ? 'Resume scanning' : 'Start scanning'}
        </button>}
        {s.error && <div role="alert" className="scanner-error"><TriangleAlert size={16} /><p>{s.error}{failedCount > 0 && ' Open Menu → Recent cards to retry or discard the failed capture.'}</p><button className="icon-button" onClick={() => s.setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}
        {import.meta.env.DEV && new URLSearchParams(location.search).get('test-camera') === '1' && <div className="test-camera-controls"><small>Synthetic test camera · development only</small><button className="button outline" disabled={s.session !== 'scanning'} onClick={() => window.dispatchEvent(new Event('test-card-slide'))}>Slide test card</button></div>}
      </section>
    </main>

    {showMenu && <Dialog title="Menu" close={() => setShowMenu(false)}>
      <nav className="menu-list" aria-label="Scanner menu">
        <button onClick={() => openFromMenu(() => setShowBatch(true))}><Layers3 size={20} /><span>Batch<small>{count} / {quantity} cards scanned</small></span><ChevronRight size={17} /></button>
        <button onClick={() => openFromMenu(() => setShowGallery(true))}><Images size={20} /><span>Recent cards<small>{failedCount ? `${failedCount} need review` : `${count} saved`}</small></span><ChevronRight size={17} /></button>
        <button onClick={() => openFromMenu(() => setShowSettings(true))}><Settings2 size={20} /><span>Settings</span><ChevronRight size={17} /></button>
        <button onClick={() => openFromMenu(() => setShowHelp(true))}><CircleHelp size={20} /><span>Scanning guide</span><ChevronRight size={17} /></button>
        {s.settings.debug && <button onClick={() => openFromMenu(() => setShowDiagnostics(true))}><Gauge size={20} /><span>Diagnostics</span><ChevronRight size={17} /></button>}
        {s.cameraSize.width > 0 && <>
          <div className="menu-divider" />
          <button disabled={s.session !== 'scanning' || s.pending + count >= quantity || s.pending >= s.settings.queueLimit} onClick={() => openFromMenu(s.explicitCapture)}><Aperture size={20} /><span>Capture current card</span><ChevronRight size={17} /></button>
          <button onClick={() => openFromMenu(s.stop)}><Square size={18} /><span>Stop camera</span><ChevronRight size={17} /></button>
        </>}
      </nav>
      <div className="menu-footer">{exportButton()}{busy && <p className="setting-hint">Pause scanning to download or edit images.</p>}</div>
    </Dialog>}

    {showBatch && <Dialog title={s.batch?.name || 'Batch'} close={() => setShowBatch(false)}>
      <div className="batch-content">
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

    {showDiagnostics && <Dialog title="Diagnostics" close={() => setShowDiagnostics(false)}><div className="diagnostics-grid">
      <span>Motion<b>{((s.reading?.score ?? 0) * 100).toFixed(2)}%</b></span>
      <span>Stability<b>{((s.reading?.stability ?? 0) * 100).toFixed(0)}%</b></span>
      <span>Noise<b>{s.reading?.noise.toFixed(2) ?? '—'}</b></span>
      <span>Capture state<b>{s.reading?.state ?? 'waiting'}</b></span>
      <span>Queue<b>{s.pending} / {s.fallback ? 1 : s.settings.queueLimit}</b></span>
      <span>Analysis<b>{timingLabel(s.timing)}</b></span>
      <span>Avg. processing<b>{avg ? `${avg} ms` : '—'}</b></span>
      <span>Measured pace<b>{rate} cards/min</b></span>
      <span>Failures<b>{failedCount}</b></span>
      <span>Cycle<b>{s.reading?.cycle ?? 0}</b></span>
      <span>Sharpness<b>{latest?.sharpness.toFixed(1) ?? '—'}</b></span>
      <span>Confidence<b>{latest ? `${Math.round(latest.confidence * 100)}%` : '—'}</b></span>
      <span>Engine<b>{s.fallback ? 'Main thread' : 'Web Worker'}</b></span>
      <span>Camera<b>{s.cameraSize.width ? `${s.cameraSize.width} × ${s.cameraSize.height}` : 'Off'}</b></span>
    </div></Dialog>}

    {showSettings && <Dialog title="Scanner settings" close={() => setShowSettings(false)}><div className="settings-content">
      <p className="dialog-intro">Fine-tune for your lighting, phone, and card feed. Pause before changing detection or camera settings.</p>
      <h3><Moon size={16} /> Appearance</h3>
      <Toggle label="Dark mode" checked={theme.dark} hint="Your theme preference is remembered on this device." onChange={theme.setDark} />
      <h3><Focus size={16} /> Detection & quality</h3>
      <Setting label="Stability delay" value={`${s.settings.stabilityMs} ms`} hint="Keep a card still for this long before capture."><input aria-label="Stability delay" disabled={busy} type="range" min="150" max="800" step="10" value={s.settings.stabilityMs} onChange={e => s.setSettings({ ...s.settings, stabilityMs: +e.target.value })} /></Setting>
      <Setting label="Motion threshold" value={`${(s.settings.sensitivity * 100).toFixed(1)}%`} hint="Lower detects smaller movements; higher rejects more vibration."><input aria-label="Motion threshold" disabled={busy} type="range" min="0.02" max="0.2" step="0.005" value={s.settings.sensitivity} onChange={e => s.setSettings({ ...s.settings, sensitivity: +e.target.value })} /></Setting>
      <Setting label="JPEG quality" value={`${Math.round(s.settings.quality * 100)}%`}><input aria-label="JPEG quality" disabled={busy} type="range" min="0.8" max="1" step="0.01" value={s.settings.quality} onChange={e => s.setSettings({ ...s.settings, quality: +e.target.value })} /></Setting>
      <Setting label="Minimum sharpness" value={String(s.settings.minSharpness)} hint="Blurry images are rejected. Tune using real cards and diagnostics."><input aria-label="Minimum sharpness" disabled={busy} type="range" min="10" max="250" step="5" value={s.settings.minSharpness} onChange={e => s.setSettings({ ...s.settings, minSharpness: +e.target.value })} /></Setting>
      <label className="select-setting">Maximum output width<select disabled={busy} value={s.settings.outputWidth} onChange={e => s.setSettings({ ...s.settings, outputWidth: +e.target.value })}>{[900,1260,1800,2520].map(n => <option key={n} value={n}>{n} px · native resolution if smaller</option>)}</select></label>
      <label className="select-setting">Camera resolution preference<select disabled={busy || s.cameraSize.width > 0} value={s.settings.resolution} onChange={e => s.setSettings({ ...s.settings, resolution: +e.target.value })}>{[1920,2560,3840].map(n => <option key={n} value={n}>{n} px wide</option>)}</select><small>Stop the camera to change. Your device chooses the closest supported resolution.</small></label>
      <label className="select-setting">Processing capacity<select disabled={busy || s.pending > 0 || !!s.batch} value={s.settings.queueLimit} onChange={e => s.setSettings({ ...s.settings, queueLimit: +e.target.value })}>{[1,2,3].map(n => <option key={n} value={n}>{n} capture{n > 1 ? 's' : ''} in flight</option>)}</select><small>Set before a new batch. Smaller queues use less memory.</small></label>
      <Toggle label="Use ImageCapture when available" hint="Optional grabFrame capture. Canvas is the low-latency default; unsupported browsers fall back automatically." checked={s.settings.useImageCapture} disabled={busy} onChange={v => s.setSettings({ ...s.settings, useImageCapture: v })} />
      <h3><Camera size={16} /> Camera controls</h3>
      {s.devices.length > 1 && <label className="select-setting">Camera<select disabled={busy || s.pending > 0} defaultValue="" onChange={e => void s.switchCamera(e.target.value)}><option value="" disabled>Select a camera</option>{s.devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label>}
      {s.capabilities.torch && <Toggle label="Torch" checked={torch} onChange={v => { setTorch(v); void s.control({ torch: v }); }} />}
      {s.capabilities.zoom && <Setting label="Zoom" hint="Keep all four card corners visible."><input type="range" aria-label="Camera zoom" disabled={busy} min={s.capabilities.zoom.min} max={s.capabilities.zoom.max} step={s.capabilities.zoom.step || 0.1} defaultValue={s.capabilities.zoom.min} onChange={e => void s.control({ zoom: +e.target.value })} /></Setting>}
      {(s.capabilities.focusMode?.includes('manual') || s.capabilities.exposureMode?.includes('manual') || s.capabilities.whiteBalanceMode?.includes('manual')) ? <Toggle label="Lock supported camera adjustments" checked={locked} disabled={busy} hint="Let focus, exposure, and white balance settle before locking." onChange={v => { setLocked(v); void s.lock(v); }} /> : <p className="setting-hint">Start the camera to see supported controls. Focus, exposure, white balance, torch, and zoom depend on your browser and camera.</p>}
      <h3><Volume2 size={16} /> Sound & diagnostics</h3>
      <Toggle label="Scan confirmation sounds" checked={!s.settings.muted} onChange={v => s.setSettings({ ...s.settings, muted: !v })} />
      <Setting label="Volume" value={`${Math.round(s.settings.volume * 100)}%`}><input aria-label="Sound volume" type="range" min="0" max="1" step="0.05" value={s.settings.volume} onChange={e => s.setSettings({ ...s.settings, volume: +e.target.value })} /></Setting><button className="button outline" onClick={() => void s.testSound()}><Volume2 size={16} /> Test scan sound</button>
      <Toggle label="Show live diagnostics" checked={s.settings.debug} hint="Adds Diagnostics to the menu and shows the last accepted corners on the preview." onChange={v => s.setSettings({ ...s.settings, debug: v })} />
      <h3><ArrowDownToLine size={16} /> Install for your workbench</h3><p className="setting-hint">After the first online load finishes caching, the scanner works offline. On iPhone, use Safari → Share → Add to Home Screen.</p>{installPrompt && <button className="button dark" onClick={() => { void installPrompt.prompt(); setInstallPrompt(undefined); }}>Install CardSlinger</button>}
    </div><div className="dialog-footer"><button className="button dark" onClick={() => setShowSettings(false)}>Done</button></div></Dialog>}
    {showHelp && <Dialog title="A smooth scan, every time." close={() => setShowHelp(false)}><div className="guide-content"><p className="dialog-intro">Set up once. Then let your card-slinger do its thing.</p>{[
      ['Mount & light', 'Mount your phone firmly above the white enclosure. Keep all four card edges visible and leave a little space around them. Use even side lighting to reduce holo glare.'],
      ['Set your batch', 'Open Menu → Batch to choose a quantity. Tap Start scanning and allow camera access. Your first scan needs movement; Menu → Capture current card intentionally scans a card already in place.'],
      ['Slide, settle, listen', 'Slide each card fully into position. A ding means its corrected image has been saved. Identical cards work because the scanner tracks movement. Slow down if the queue fills.'],
      ['Review & download', 'The final card gets a ding and a distinct three-note alarm. Capture stops automatically. Open Menu → Recent cards to review and rotate images, then download your ZIP from the menu.'],
    ].map(([title, text], i) => <div className="guide-step" key={title}><span>{String(i + 1).padStart(2,'0')}</span><div><h3>{title}</h3><p>{text}</p></div></div>)}<div className="guide-callout"><ShieldCheck size={18} /><p>Scans stay in this browser’s local storage. Download your batch before clearing browser data. Pausing, reloading, or resuming always waits for new movement.</p></div></div><div className="dialog-footer"><button className="button primary" onClick={() => setShowHelp(false)}>Ready to scan <ArrowRight size={16} /></button></div></Dialog>}
    {confirmClear && <Dialog title="Start a fresh batch?" close={() => setConfirmClear(false)}><div className="confirm-content"><p>This deletes this batch’s {count} saved images and {s.attempts.length} retained captures from this device. Download your ZIP first if you want to keep them.</p>{exportButton()}<p className="setting-hint">A download does not automatically clear your batch.</p></div><div className="dialog-footer"><button className="button outline" onClick={() => setConfirmClear(false)}>Keep batch</button><button className="button danger" disabled={editingDisabled} onClick={() => void safe(async () => { await s.clear(); setLastExport(undefined); setConfirmClear(false); setShowBatch(false); setShowGallery(false); setShowMenu(false); })}><Trash2 size={15} /> Delete & start new</button></div></Dialog>}
    {exportOpen && <Dialog title="Download your batch" close={() => { if (exporting === null) setExportOpen(false); }}><div className="confirm-content">{lastExport ? <div className="export-success" role="status"><strong>{lastExport.name} is ready</strong><p>Saved scans stay on this device.</p>{typeof navigator.share === 'function' && <button className="button outline" disabled={shareBusy} onClick={() => void shareZip()}>Share / Save</button>}</div> : <p>Give this batch a name before saving your archive.</p>}<label className="select-setting batch-name-field" htmlFor="export-batch-name">Batch name<input id="export-batch-name" autoFocus type="text" maxLength={100} value={exportName} disabled={exporting !== null} placeholder={defaultBatchName(s.batch?.number ?? 1)} onChange={e => setExportName(e.target.value)} /></label><p className="archive-preview">{archiveFilename(exportName, s.batch?.number ?? 1)}</p><p className="setting-hint">{count} accepted images · sequential Pokémon filenames inside the ZIP. The batch name is remembered for your next download.</p>{exporting !== null && <div className="progress-track" role="progressbar" aria-label="ZIP export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={exporting}><div style={{width:`${exporting}%`}} /></div>}</div><div className="dialog-footer"><button className="button outline" disabled={exporting !== null} onClick={() => setExportOpen(false)}>Cancel</button><button className="button dark" disabled={exporting !== null || s.pending > 0 || busy} onClick={() => void exportBatch()}><ArrowDownToLine size={16}/>{exporting !== null ? `Creating ZIP · ${exporting}%` : `Download ZIP · ${count} images`}</button></div></Dialog>}
    {active && <Dialog title={filename(s.scans.findIndex(a => a.id === active.id))} close={() => setSelected(undefined)} wide><div className="review-image"><BlobImage blob={active.blob} alt="Full-resolution scanned card" /></div><div className="review-meta"><span>{active.width} × {active.height} · JPEG</span><span>{Math.round(active.processingMs)} ms · {Math.round(active.confidence * 100)}% edge confidence</span></div><div className="dialog-footer review-actions"><button className="icon-button" aria-label="Previous card" disabled={s.scans[0].id === active.id} onClick={() => setSelected(s.scans[s.scans.findIndex(a => a.id === active.id) - 1]?.id)}><ArrowLeft size={20} /></button><button className="button outline" disabled={editingDisabled} onClick={() => void safe(async () => s.updateScan(await rotateScan(active)))}><RotateCw size={16} /> Rotate 180°</button><button className="button danger-outline" disabled={editingDisabled} onClick={() => setDeleteId(active.id)}><Trash2 size={16} /> Delete</button><button className="icon-button" aria-label="Next card" disabled={latest?.id === active.id} onClick={() => setSelected(s.scans[s.scans.findIndex(a => a.id === active.id) + 1]?.id)}><ArrowRight size={20} /></button></div></Dialog>}
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
