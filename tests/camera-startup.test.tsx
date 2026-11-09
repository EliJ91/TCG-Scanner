// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { CameraAccessError } from '../src/core/camera-access';
import * as exportTools from '../src/core/export';
import { cacheBatchName, cachedBatchName } from '../src/core/preferences';
import { defaults } from '../src/core/types';
import { emptyFrame, printedCard, shadowedSurface } from './card-frame';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), settings: vi.fn(), saveBatch: vi.fn(), create: vi.fn(), rename: vi.fn(),
  resize: vi.fn(), clear: vi.fn(),
  accept: vi.fn(), getAttempt: vi.fn(),
  start: vi.fn(), stop: vi.fn(), zoom: vi.fn(), capture: vi.fn(),
  control: vi.fn(), lock: vi.fn(), focus: vi.fn(), capabilities: {} as {torch?:boolean;exposureMode?:string[];focusMode?:string[];focusDistance?:{min:number;max:number;step:number}},
  unlock: vi.fn(), error: vi.fn(), success: vi.fn(), complete: vi.fn(),
  lost: undefined as ((reason: string) => void) | undefined,
}));
vi.mock('../src/core/storage', () => ({ storage: {
  load: mocks.load, settings: mocks.settings, saveBatch: mocks.saveBatch, create: mocks.create,
  renameBatch: mocks.rename, accept: mocks.accept, getAttempt: mocks.getAttempt,
  resizeBatch: mocks.resize, clear: mocks.clear,
} }));
vi.mock('../src/core/camera', () => ({ Camera: class {
  stream?: { active: boolean }; get capabilities() { return mocks.capabilities; }
  constructor(_video: HTMLVideoElement, lost: (reason: string) => void) { mocks.lost = lost; }
  start = async (...args: unknown[]) => { const info = await mocks.start(...args); this.stream = { active: true }; return info; };
  stop = () => { mocks.stop(); this.stream = undefined; };
  setZoom = mocks.zoom; capture = mocks.capture;
  control = mocks.control; lock = mocks.lock; focus = mocks.focus; focusDistance = 2;
} }));
vi.mock('../src/core/audio', () => ({ ScannerAudio: class { unlock = mocks.unlock; error = mocks.error; success = mocks.success; complete = mocks.complete; } }));

let root: Root, container: HTMLDivElement;
const loaded = { batch: undefined, scans: [], attempts: [], settings: undefined, nextBatchNumber: 1 };
function button(label: string) {
  const element = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
  expect(element, 'Button ' + label).toBeDefined(); return element!;
}
async function renderApp() { await act(async () => root.render(<App />)); }
async function click(label: string) { await act(async () => button(label).click()); }
async function startAutoPreview(stabilityMs: number, initial: Uint8Array, flipInterface = false) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  let frame!: FrameRequestCallback;
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frame = callback; return 1; }));
  const pixels = new Uint8ClampedArray(initial.length * 4);
  function scene(values: Uint8Array) {
    for (let i = 0; i < values.length; i++) pixels[i * 4] = pixels[i * 4 + 1] = pixels[i * 4 + 2] = values[i];
  }
  scene(initial);
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: pixels }) } as unknown as CanvasRenderingContext2D);
  localStorage.setItem('cardslinger-settings', JSON.stringify({ ...defaults, stabilityMs, flipInterface }));
  await renderApp();
  const video = container.querySelector('video')!;
  Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 }, readyState: { value: 4 } });
  await click('Start scanning');
  const tick = (ms = 0, values?: Uint8Array) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    if (values) { scene(values); video.currentTime += 0.033; }
    frame(performance.now());
  });
  return { tick, scene, video };
}
async function input(selector: string, value: string) {
  await act(async () => {
    const element = container.querySelector(selector) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  mocks.capabilities={}; mocks.control.mockResolvedValue(undefined); mocks.lock.mockResolvedValue(undefined); mocks.focus.mockResolvedValue(2);
  mocks.load.mockResolvedValue(loaded); mocks.settings.mockResolvedValue(undefined); mocks.saveBatch.mockResolvedValue(undefined);
  mocks.start.mockResolvedValue({ width: 1280, height: 720 }); mocks.unlock.mockResolvedValue(true);
  mocks.capture.mockImplementation(async (_alternate, _quality, frameCopied) => {
    frameCopied();
    return { blob: new Blob(['source'], { type: 'image/jpeg' }), width: 1280, height: 720 };
  });
  mocks.getAttempt.mockResolvedValue(undefined);
  mocks.accept.mockResolvedValue(undefined); mocks.rename.mockResolvedValue(undefined);
  mocks.resize.mockResolvedValue(undefined); mocks.clear.mockResolvedValue(undefined);
  mocks.create.mockImplementation(async (target, name) => ({id:'test-batch',number:1,name:name || 'Batch#001',target,createdAt:Date.now(),status:'paused',nextOrdinal:0}));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // Lifecycle tests drive frame callbacks explicitly; motion timing has its own suite.
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0)); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: vi.fn().mockResolvedValue([]) } });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('batch ZIP downloads', () => {
  const zip = new Blob(['batch ZIP'], { type: 'application/zip' });

  async function openExport(count = 1) {
    const batch = { id: 'exported', number: 7, name: 'Batch#007', target: count + 1, createdAt: 1, status: 'paused', nextOrdinal: count };
    const scans = Array.from({ length: count }, (_, ordinal) => ({ id: `photo-${ordinal}`, batchId: batch.id, ordinal, blob: new Blob(['x'.repeat(ordinal + 1)]), width: 900, height: 1257 }));
    mocks.load.mockResolvedValueOnce({ ...loaded, batch, scans });
    await renderApp();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Export ZIP, ${count} saved photos"]`)!.click());
  }

  it('downloads the prepared batch as one named ZIP and can keep the batch', async () => {
    let finishZip!: (blob: Blob) => void;
    const build = vi.spyOn(exportTools, 'createZip').mockImplementationOnce(() => new Promise(resolve => { finishZip = resolve; }));
    const download = vi.spyOn(exportTools, 'downloadArchive').mockImplementation(() => {});
    localStorage.setItem('cardslinger-settings', JSON.stringify({ ...defaults, galleryNewestFirst: true }));
    await openExport(12);
    expect(build.mock.calls[0][0]).toHaveLength(12);
    expect(build.mock.calls[0][2]).toBe(true);
    expect(button('Download ZIP').disabled).toBe(true);
    await input('#export-batch-name', 'Trade night');
    await act(async () => finishZip(zip));
    await act(async () => {
      button('Download ZIP').click();
      expect(download).toHaveBeenCalledOnce();
    });
    expect(download.mock.calls[0][0]).toMatchObject({ name: 'Trade night.zip', type: 'application/zip', size: zip.size });
    expect(build).toHaveBeenCalledOnce();
    expect(mocks.rename).toHaveBeenCalledWith('exported', 'Trade night');
    expect(container.textContent).toContain('Check that your ZIP finished downloading');
    expect(mocks.clear).not.toHaveBeenCalled();
    await click('Keep batch');
    expect(container.querySelector('.scan-count')?.textContent).toBe('12 / 13');
  });

  it('allows retry after a download error and clears only after confirmation', async () => {
    vi.spyOn(exportTools, 'createZip').mockResolvedValueOnce(zip);
    const download = vi.spyOn(exportTools, 'downloadArchive')
      .mockImplementationOnce(() => { throw new Error('Download unavailable'); })
      .mockImplementation(() => {});
    await openExport();
    await click('Download ZIP');
    expect(container.textContent).toContain('Could not download the ZIP. Download unavailable');
    expect(container.textContent).not.toContain('Start a fresh batch?');
    expect(mocks.rename).not.toHaveBeenCalled();
    await click('Download ZIP');
    expect(download.mock.calls[1][0]).toMatchObject({ name: 'Batch#007.zip', type: 'application/zip', size: zip.size });
    expect(mocks.rename).toHaveBeenCalledWith('exported', 'Batch#007');
    expect(container.textContent).toContain('Check that your ZIP finished downloading');
    expect(mocks.clear).not.toHaveBeenCalled();
    await click('Delete & start new');
    expect(mocks.clear).toHaveBeenCalledWith('exported');
  });

});

describe('automatic camera preview independent from scanner initialization', () => {
  it('opens the camera on entry while IndexedDB is pending, without audio', async () => {
    mocks.load.mockReturnValue(new Promise(() => {})); await renderApp();
    expect(mocks.start).toHaveBeenCalledTimes(1); expect(button('Loading saved scans…').disabled).toBe(true);
    expect(mocks.unlock).not.toHaveBeenCalled();
  });
  it('merges a setting changed during startup with the saved preferences and restores camera controls', async () => {
    let finish!: (data: Omit<typeof loaded, 'settings'> & { settings: typeof defaults }) => void;
    mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mocks.capabilities = { torch: true, focusMode: ['manual', 'continuous'] };
    await renderApp();
    expect(mocks.control).toHaveBeenLastCalledWith({ torch: false });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click());
    await click('Settings');
    const stacking = [...container.querySelectorAll('label')].find(label => label.textContent?.startsWith('Using Card Slinger'))!;
    await act(async () => stacking.querySelector('input')!.click());
    expect(JSON.parse(localStorage.getItem('cardslinger-settings')!)).toEqual({ stackCards: true });
    const saved = { ...defaults, torch: true, focusLocked: true, focusDistance: 2, zoom: 2, batchTarget: 25 };
    await act(async () => finish({ ...loaded, settings: saved }));
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.control).toHaveBeenLastCalledWith({ torch: true });
    expect(mocks.focus).toHaveBeenCalledWith(true, 2);
    expect(mocks.zoom).toHaveBeenLastCalledWith(2);
    expect(JSON.parse(localStorage.getItem('cardslinger-settings')!)).toEqual({ ...saved, stackCards: true });
  });
  it('still requests the camera after storage initialization fails', async () => {
    mocks.load.mockRejectedValue(new Error('Storage blocked')); await renderApp();
    expect(mocks.start).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('Storage unavailable');
    expect(mocks.stop).not.toHaveBeenCalled();
  });
  it.each(['rejects','throws'])('keeps the preview when optional enumeration %s', async kind => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: kind==='throws' ? () => {throw new Error('Unsupported');} : vi.fn().mockRejectedValue(new Error('Unsupported')) } });
    await renderApp(); expect(button('Start scanning').disabled).toBe(false); expect(mocks.stop).not.toHaveBeenCalled();
  });
  it('offers a tap/direct-browser fallback when automatic permission is blocked', async () => {
    mocks.start.mockRejectedValueOnce(new CameraAccessError('blocked','This embedded browser blocks camera access.',true));
    await renderApp();
    const link = container.querySelector('.camera-browser-link') as HTMLAnchorElement;
    expect(link.textContent).toContain('Safari or Chrome'); expect(button('Enable camera').disabled).toBe(false);
    await click('Enable camera');
    expect(button('Start scanning').disabled).toBe(false); expect(container.querySelector('.camera-browser-link')).toBeNull();
  });
  it('lets a pending permission prompt finish after the page returns to focus', async () => {
    let hidden=false, allow!:(info:{width:number;height:number})=>void;
    vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
    mocks.start.mockImplementationOnce(()=>new Promise(resolve=>{allow=resolve;}));
    await renderApp();
    await act(async()=>{hidden=true;document.dispatchEvent(new Event('visibilitychange'));});
    expect(mocks.stop).not.toHaveBeenCalled(); expect(button('Requesting camera…').disabled).toBe(true);
    await act(async()=>{hidden=false;document.dispatchEvent(new Event('visibilitychange'));allow({width:720,height:1280});});
    expect(button('Start scanning').disabled).toBe(false); expect(mocks.stop).not.toHaveBeenCalled();
  });
  it('stops a late camera grant in the background and retries only after focus returns', async () => {
    let allow!: (info: { width: number; height: number }) => void;
    mocks.start.mockImplementationOnce(() => new Promise(resolve => { allow = resolve; }));
    await renderApp();
    await act(async () => {
      vi.mocked(document.hasFocus).mockReturnValue(false);
      window.dispatchEvent(new Event('blur'));
      allow({ width: 720, height: 1280 });
    });
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(button('Enable camera').disabled).toBe(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(mocks.start).toHaveBeenCalledOnce();
    await act(async () => {
      vi.mocked(document.hasFocus).mockReturnValue(true);
      window.dispatchEvent(new Event('focus'));
    });
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(button('Start scanning').disabled).toBe(false);
  });
});

describe('manual capture, continuous errors, and batch naming', () => {
  it('applies the side focus slider and saves the focus lock across reloads', async () => {
    mocks.capabilities = { focusMode: ['manual', 'continuous'], focusDistance: { min: 0, max: 10, step: 1 } };
    mocks.focus.mockImplementation(async (_locked, position) => position ?? 2);
    await renderApp();
    await input('input[aria-label="Manual focus"]', '3');
    expect(mocks.focus).toHaveBeenCalledWith(true, 3);
    expect(container.querySelector('[aria-label="Unlock focus"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(localStorage.getItem('cardslinger-settings')!)).toMatchObject({ focusLocked: true, focusDistance: 3 });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Unlock focus"]')!.click());
    expect(mocks.focus).toHaveBeenLastCalledWith(false, undefined);
  });
  it('starts a 10 ms countdown on confirmed stillness and cancels it when a fresh frame shows movement', async () => {
    const { tick, scene, video } = await startAutoPreview(10, printedCard(), true);
    await tick();
    expect(container.querySelector('.auto-countdown:not([hidden])')).toBeNull();
    await tick(33, printedCard());
    expect(container.querySelector('.auto-countdown:not([hidden])')).not.toBeNull();
    await tick(9);
    expect(mocks.capture).not.toHaveBeenCalled();
    scene(printedCard(1));
    video.currentTime = .043;
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(container.querySelector('.auto-countdown:not([hidden])')).toBeNull();
    await tick(23, printedCard(1));
    await tick(10);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith(false, 1, expect.any(Function), true);
    expect(container.querySelector('.auto-countdown.is-snapped')).not.toBeNull();
  });
  it.each([false, true])('rearms after card removal during a slow encode and save (flipped %s)', async flipped => {
    const jpeg = { blob: new Blob(['first JPEG'], { type: 'image/jpeg' }), width: 1280, height: 720 };
    let finishEncoding!: (image: typeof jpeg) => void, finishSaving!: () => void;
    mocks.capture.mockImplementationOnce((_alternate, _quality, frameCopied) => {
      frameCopied();
      return new Promise(resolve => { finishEncoding = resolve; });
    });
    mocks.accept.mockImplementationOnce(() => new Promise<void>(resolve => { finishSaving = resolve; }));
    const empty = flipped ? shadowedSurface() : emptyFrame();
    const card = printedCard();
    const { tick } = await startAutoPreview(200, empty, flipped);
    await tick();
    await tick(400, empty);
    expect(mocks.capture).not.toHaveBeenCalled();
    await tick(33, card);
    await tick(33, card);
    const fill = container.querySelector<HTMLDivElement>('.auto-countdown > div')!;
    expect(fill.style.animation).toBe('shutter-fill 200ms linear both');
    await tick(100);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    await tick(100);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.auto-countdown.is-snapped')).not.toBeNull();
    expect(mocks.success).toHaveBeenCalledOnce();
    expect(mocks.accept).not.toHaveBeenCalled();
    await tick(33, printedCard(1));
    await tick(250, printedCard(1));
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    await tick(33, empty);
    await tick(33, empty);
    await tick(250, empty);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    await tick(33, card);
    await tick(33, card);
    await tick(200);
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(mocks.accept).not.toHaveBeenCalled();
    await act(async () => finishEncoding(jpeg));
    expect(mocks.accept).toHaveBeenCalledTimes(1);
    await tick(33, empty);
    await tick(33, empty);
    await tick(33, card);
    await tick(33, card);
    await tick(200);
    expect(mocks.capture).toHaveBeenCalledTimes(3);
    expect(mocks.accept).toHaveBeenCalledTimes(1);
    expect(mocks.success).toHaveBeenCalledTimes(3);
    await act(async () => finishSaving());
    expect(mocks.accept.mock.calls.map(([scan]) => scan.ordinal)).toEqual([0, 1, 2]);
    expect(mocks.success).toHaveBeenCalledTimes(3);
    expect(container.querySelector('.scan-count')?.textContent).toBe('3 / 50');
  });
  it('uses the Card Slinger setting to capture successive cards placed on top during a slow save', async () => {
    let finishSaving!: () => void;
    mocks.accept.mockImplementationOnce(() => new Promise<void>(resolve => { finishSaving = resolve; }));
    const first = printedCard(), second = printedCard(1), third = printedCard(2);
    const { tick } = await startAutoPreview(100, first);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click());
    await click('Settings');
    const setting = [...container.querySelectorAll('label')].find(label => label.textContent?.startsWith('Using Card Slinger'))!;
    expect(setting.querySelector('input')?.checked).toBe(false);
    await act(async () => setting.querySelector('input')!.click());
    expect(JSON.parse(localStorage.getItem('cardslinger-settings')!).stackCards).toBe(true);
    await click('Done');
    await tick();
    await tick(33, first);
    await tick(100);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Place the next card on top');
    await tick(250, first);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    await tick(33, second);
    await tick(33, second);
    expect(container.querySelector<HTMLDivElement>('.auto-countdown > div')?.style.animation).toBe('shutter-fill 100ms linear both');
    await tick(100);
    await tick(33, third);
    await tick(33, third);
    await tick(100);
    expect(mocks.capture).toHaveBeenCalledTimes(3);
    expect(mocks.accept).toHaveBeenCalledTimes(1);
    await act(async () => finishSaving());
    expect(mocks.accept.mock.calls.map(([scan]) => scan.ordinal)).toEqual([0, 1, 2]);
  });
  it('saves each manual photo and opens those photos from the scan count', async () => {
    let urlNumber = 0;
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => `blob:scan-${++urlNumber}`);
      static revokeObjectURL = vi.fn();
    });
    const decode = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal('Image', class { decode = decode; });
    await renderApp();
    await click('Manual');
    for (let i = 0; i < 5; i++) await click('Take photo');
    expect(mocks.capture).toHaveBeenCalledTimes(5);
    expect(mocks.accept).toHaveBeenCalledTimes(5);
    const original = await mocks.capture.mock.results[0].value;
    expect(mocks.accept.mock.calls[0][0].blob).toBe(original.blob);
    expect(mocks.accept.mock.calls[0][0]).toMatchObject({ width: 1280, height: 720 });
    expect(mocks.success).toHaveBeenCalledTimes(5);
    await click('5 / 50');
    const gallery = container.querySelector('dialog[open]');
    expect(gallery?.querySelector('h2')?.textContent).toBe('Gallery');
    expect(gallery?.querySelectorAll('img')).toHaveLength(5);
    expect(gallery?.querySelector('.scan-name')?.textContent).toBe('0001');
    await act(async () => gallery?.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click());
    await click('Settings');
    const order = [...container.querySelectorAll('label')].find(label => label.textContent?.startsWith('Newest first in gallery'));
    await act(async () => order!.querySelector('input')!.click());
    expect(JSON.parse(localStorage.getItem('cardslinger-settings')!).galleryNewestFirst).toBe(true);
    await click('Done');
    await click('5 / 50');
    expect(container.querySelector('.scan-name')?.textContent).toBe('0005');
    await act(async () => container.querySelector<HTMLButtonElement>('.scan-tile')!.click());
    expect(container.querySelector('dialog[open] img[alt="Full-resolution scanned card"]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Next card"]')!.click());
    const viewer = () => container.querySelector<HTMLDivElement>('.review-image')!;
    const title = () => viewer().closest('dialog')?.querySelector('h2')?.textContent;
    expect(title()).toBe('0004');

    const touch = (type: string, id: number, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
      viewer().dispatchEvent(event);
    };
    const swipe = (from: number, to: number) => act(async () => {
      touch('pointerdown', 1, from, 160);
      touch('pointermove', 1, to, 160);
      touch('pointerup', 1, to, 160);
    });
    const frame = viewer();
    const dialog = frame.closest('dialog');
    const image = frame.querySelector('img')!;
    const currentUrl = image.src;
    let finishDecode!: () => void;
    decode.mockImplementationOnce(() => new Promise(resolve => { finishDecode = resolve; }));
    await swipe(220, 120);
    expect(title()).toBe('0004');
    expect(image.src).toBe(currentUrl);
    expect(dialog?.open).toBe(true);
    await act(async () => finishDecode());
    expect(title()).toBe('0003');
    expect(viewer()).toBe(frame);
    expect(viewer().closest('dialog')).toBe(dialog);
    expect(viewer().querySelector('img')).toBe(image);
    expect(image.src).not.toBe(currentUrl);
    await swipe(120, 220);
    expect(title()).toBe('0004');

    vi.spyOn(viewer(), 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 300));
    Object.defineProperties(image, { offsetWidth: { value: 240 }, offsetHeight: { value: 260 } });
    await act(async () => {
      touch('pointerdown', 1, 100, 150);
      touch('pointerdown', 2, 175, 150);
      touch('pointermove', 2, 250, 150);
      touch('pointerup', 1, 100, 150);
      touch('pointerup', 2, 250, 150);
    });
    const zoomed = image.style.transform;
    expect(zoomed).toContain('scale(2)');
    await swipe(220, 120);
    expect(title()).toBe('0004');
    expect(image.style.transform).toContain('scale(2)');
    expect(image.style.transform).not.toBe(zoomed);

    await act(async () => {
      touch('pointerdown', 1, 100, 150);
      touch('pointerdown', 2, 250, 150);
      touch('pointermove', 2, 175, 150);
      touch('pointerup', 1, 100, 150);
      touch('pointerup', 2, 175, 150);
    });
    expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');
    expect(title()).toBe('0004');
    await swipe(220, 120);
    expect(title()).toBe('0003');

    for (const selector of ['dialog:has(.review-image)', 'dialog:has(.gallery-grid)']) {
      await act(async () => container.querySelector<HTMLButtonElement>(`${selector} [aria-label="Close dialog"]`)!.click());
    }
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click());
    await click('Settings');
    const flip = [...container.querySelectorAll('label')].find(label => label.textContent?.startsWith('Flip Interface'))!;
    await act(async () => flip.querySelector('input')!.click());
    await click('Done');
    await click('5 / 50');
    await act(async () => container.querySelector<HTMLButtonElement>('.scan-tile')!.click());
    expect(title()).toBe('0005');
    await swipe(120, 220);
    expect(title()).toBe('0004');
    expect(viewer().querySelector('img')?.style.transform).toBe('translate(0px, 0px) scale(1)');
  });
  it('restores cached camera controls and resets settings without deleting the saved batch', async () => {
    mocks.capabilities={torch:true,exposureMode:['manual','continuous'],focusMode:['manual','continuous']};
    localStorage.setItem('cardslinger-settings',JSON.stringify({...defaults,cameraId:'rear-wide',resolution:3840,zoom:2,torch:true,focusLocked:true,focusDistance:2,lockCamera:true,debug:true,quality:0.86}));
    const b={id:'saved-batch',number:3,name:'Keep these photos',target:5,createdAt:1,status:'paused',nextOrdinal:1};
    mocks.load.mockResolvedValueOnce({...loaded,batch:b,scans:[{id:'saved',batchId:b.id,ordinal:0,blob:new Blob(),thumbnail:new Blob(),processingMs:1,corners:[],width:900,height:1257}]});
    await renderApp();expect(mocks.start).toHaveBeenCalledWith(3840,'rear-wide');
    expect(mocks.control).toHaveBeenCalledWith({torch:true});expect(mocks.focus).toHaveBeenCalledWith(true, 2);
    expect(mocks.lock).not.toHaveBeenCalled();
    const flashlight = container.querySelector<HTMLButtonElement>('main .viewfinder button[aria-label="Flashlight"]')!;
    expect(flashlight.getAttribute('aria-pressed')).toBe('true');
    await act(async () => flashlight.click());
    expect(mocks.control).toHaveBeenLastCalledWith({ torch: false });
    expect(flashlight.getAttribute('aria-pressed')).toBe('false');
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click());
    expect(container.querySelector('nav')?.textContent).not.toContain('Scan details');
    await click('Settings');
    expect(container.querySelector('.advanced-settings')?.textContent).not.toMatch(/Troubleshooting|Lock brightness and color|Flashlight/);
    const quality = container.querySelector<HTMLSelectElement>('select[aria-label="Photo quality"]')!;
    expect(Array.from(quality.options, option => option.text)).toEqual(['Lowest', 'Balanced', 'Best']);
    expect(quality.value).toBe('0.9');
    await act(async () => { quality.value = '0.8'; quality.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(mocks.settings.mock.calls.at(-1)?.[0].quality).toBe(0.8);
    await click('Reset settings');
    expect(JSON.parse(localStorage.getItem('cardslinger-settings')!)).toEqual(defaults);
    expect(mocks.settings.mock.calls.at(-1)?.[0]).toEqual(defaults);expect(mocks.start).toHaveBeenLastCalledWith(2560,undefined);
    expect(container.querySelector('.scan-count')?.textContent).toBe('1 / 5');
    expect(container.querySelector('.batch-name-trigger')?.textContent).toContain('Keep these photos');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('remembers the batch size, photo delay, manual photo method, theme and interface flip after reopening', async () => {
    await renderApp();
    const openMenu = () => act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click());
    await openMenu();
    await click('Batch Settings0 / 50 cards scanned');
    expect(container.querySelector('dialog h2')?.textContent).toBe('Batch Settings');
    await input('#batch-quantity', '73');
    await click('Save size');
    await act(async () => container.querySelector<HTMLButtonElement>('dialog [aria-label="Close dialog"]')!.click());
    await openMenu();
    await click('Settings');
    const toggle = (name: string) => [...container.querySelectorAll('label')].find(label => label.textContent?.startsWith(name))!.querySelector('input')!;
    await act(async () => toggle('Dark mode').click());
    await act(async () => toggle('Flip Interface').click());
    expect(container.querySelector('.interface-flipped main')).not.toBeNull();
    expect(container.querySelector('.interface-flipped dialog[open]')).not.toBeNull();
    expect(container.querySelector('video')?.style.transform).toBe('scale(1) rotate(180deg)');
    await act(async () => toggle('Alternate manual photo method').click());
    const waitSlider = '[aria-label="Wait before each photo"]';
    await input(waitSlider, '4');
    expect(container.querySelector(waitSlider)?.getAttribute('aria-valuetext')).toBe('400 ms');
    expect(mocks.settings).toHaveBeenLastCalledWith(expect.objectContaining({ batchTarget: 73, useImageCapture: true, stabilityMs: 400, flipInterface: true }));
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderApp();
    expect(container.querySelector('.scan-count')?.textContent).toBe('0 / 73');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(container.querySelector('.interface-flipped main')).not.toBeNull();
    await openMenu();
    await click('Settings');
    expect(container.querySelector(waitSlider)?.getAttribute('aria-valuetext')).toBe('400 ms');
    expect(toggle('Dark mode').checked).toBe(true);
    expect(toggle('Flip Interface').checked).toBe(true);
    expect(toggle('Alternate manual photo method').checked).toBe(true);
    await act(async () => toggle('Flip Interface').click());
    expect(container.querySelector('.interface-flipped')).toBeNull();
    expect(container.querySelector('video')?.style.transform).toBe('scale(1)');
  });
  it('manual mode captures only on tap and keeps working after a camera encoding error', async () => {
    await renderApp(); await click('Manual'); expect(mocks.capture).not.toHaveBeenCalled();
    mocks.capture.mockRejectedValueOnce(new Error('Camera encoding failed')); await click('Take photo');
    expect(mocks.capture).toHaveBeenCalledTimes(1); expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(button('Take photo').disabled).toBe(false); expect(container.textContent).not.toContain('Scanning paused');
    expect(mocks.error).toHaveBeenCalled(); await click('Take photo');
    expect(mocks.accept).toHaveBeenCalledTimes(1); expect(container.querySelector('.scan-count')?.textContent).toBe('1 / 50');
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.stop).not.toHaveBeenCalled();
  });
  it('uses the flipped orientation for an alternate manual photo', async () => {
    localStorage.setItem('cardslinger-settings', JSON.stringify({ ...defaults, flipInterface: true, useImageCapture: true }));
    await renderApp(); await click('Manual'); await click('Take photo');
    expect(mocks.capture).toHaveBeenCalledWith(true, 1, expect.any(Function), true);
    expect(mocks.accept).toHaveBeenCalledOnce();
  });
  it('switches mode without restarting the camera and persists the selection', async () => {
    await renderApp(); await click('Manual'); await click('Take photo'); await click('Auto');
    expect(button('Auto').getAttribute('aria-pressed')).toBe('true'); expect(button('Pause scanning').disabled).toBe(false);
    expect(mocks.start).toHaveBeenCalledTimes(1); expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.settings.mock.calls.at(-1)?.[0].captureMode).toBe('auto');
  });
  it('keeps a mode selected before saved preferences finish loading', async () => {
    let finish!:(value:typeof loaded)=>void;
    mocks.load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    await renderApp(); await click('Manual'); await act(async()=>finish(loaded));
    expect(button('Manual').getAttribute('aria-pressed')).toBe('true'); expect(button('Take photo').disabled).toBe(false);
  });
  it('edits the visible name before creating a batch, and renames an existing batch', async () => {
    await renderApp();
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Edit batch name"]')!.click());
    await input('#batch-name','Binder Friday'); await click('Save name');
    expect(container.querySelector('.batch-name-trigger')?.textContent).toContain('Binder Friday');
    await click('Manual'); await click('Take photo'); expect(mocks.create).toHaveBeenCalledWith(50,'Binder Friday');
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Edit batch name"]')!.click());
    await input('#batch-name','Binder Saturday'); await click('Save name');
    expect(mocks.rename).toHaveBeenCalledWith('test-batch','Binder Saturday'); expect(mocks.create).toHaveBeenCalledTimes(1);
    await click('Auto'); await click('Pause scanning');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click());
    await click('Batch Settings1 / 50 cards scanned');
    await click('New batch'); await click('Delete & start new');
    expect(mocks.clear).toHaveBeenCalledWith('test-batch');
    expect(container.querySelector('.batch-name-trigger')?.textContent).toBe('Binder Saturday');
    expect(cachedBatchName()).toBe('Binder Saturday');
    await act(async () => root.unmount()); root = createRoot(container);
    mocks.load.mockResolvedValueOnce({ ...loaded, nextBatchNumber: 2 });
    await renderApp(); await click('Manual'); await click('Take photo');
    expect(mocks.create).toHaveBeenLastCalledWith(50, 'Binder Saturday');
  });
  it('resizes a saved batch through the batch dialog and lets capture resume', async () => {
    const batch = { id: 'full', number: 1, name: 'Batch#001', target: 2, createdAt: 1, status: 'complete', nextOrdinal: 2 };
    const scans = [0, 1].map(ordinal => ({ id: `scan-${ordinal}`, batchId: batch.id, ordinal, blob: new Blob(['JPEG']) }));
    mocks.load.mockResolvedValueOnce({ ...loaded, batch, scans });
    await renderApp();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click());
    await click('Batch Settings2 / 2 cards scanned');
    await input('#batch-quantity', '1'); await click('Save size');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('from 2 to');
    expect(mocks.resize).not.toHaveBeenCalled();
    await input('#batch-quantity', '3'); await click('Save size');
    expect(mocks.resize).toHaveBeenCalledWith('full', 3);
    expect(container.querySelector('.scan-count')?.textContent).toBe('2 / 3');
    expect(mocks.settings).toHaveBeenLastCalledWith(expect.objectContaining({ batchTarget: 3 }));
    expect(button('Resume scanning').disabled).toBe(false);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!.click());
    await click('Manual'); await click('Take photo');
    expect(mocks.accept).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'full', ordinal: 2 }));
    expect(container.querySelector('.scan-count')?.textContent).toBe('3 / 3');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('recovers storage failures automatically without another snapshot or pausing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout','setInterval','clearInterval','Date'] }); mocks.accept.mockRejectedValueOnce(new Error('Quota exceeded'));
    await renderApp(); await click('Manual'); await click('Take photo');
    expect(container.textContent).toContain('Storage unavailable'); expect(container.textContent).not.toContain('Scanning paused');
    expect(mocks.capture).toHaveBeenCalledTimes(1); expect(mocks.accept).toHaveBeenCalledTimes(1);
    await act(async()=>{await vi.advanceTimersByTimeAsync(3001);});
    expect(mocks.accept).toHaveBeenCalledTimes(2); expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(button('Take photo').disabled).toBe(false);
  });
  it('keeps the next sequential default when an empty draft name is saved', async () => {
    cacheBatchName('Remembered name');
    mocks.load.mockResolvedValueOnce({ ...loaded, nextBatchNumber: 8 }); await renderApp();
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Edit batch name"]')!.click());
    await input('#batch-name',' '); await click('Save name');
    expect(container.querySelector('.batch-name-trigger')?.textContent).toContain('Batch#008');
    expect(cachedBatchName()).toBeUndefined();
  });
  it('reconnects stalled frames without changing active scan intent', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout','setInterval','clearInterval','performance'] });
    await renderApp(); await click('Start scanning');
    await act(async()=>{await vi.advanceTimersByTimeAsync(1800);});
    expect(container.textContent).toContain('Camera frames stopped'); expect(container.textContent).not.toContain('Scanning paused');
    await act(async()=>{await vi.advanceTimersByTimeAsync(2001);});
    expect(mocks.start).toHaveBeenCalledTimes(2); expect(button('Pause scanning').disabled).toBe(false);
  });
  it('reconnects a lost camera without pausing an active scan', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout','setInterval','clearInterval','Date'] }); await renderApp(); await click('Start scanning');
    await act(async()=>mocks.lost?.('Camera disconnected'));
    expect(container.textContent).not.toContain('Scanning paused'); expect(mocks.error).toHaveBeenCalled();
    await act(async()=>{await vi.advanceTimersByTimeAsync(2001);});
    expect(button('Pause scanning').disabled).toBe(false); expect(mocks.start).toHaveBeenCalledTimes(2);
  });
  it('returns from the background without a Resume tap', async () => {
    let hidden=false; vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
    await renderApp(); await click('Start scanning');
    await act(async()=>{hidden=true;document.dispatchEvent(new Event('visibilitychange'));});
    await act(async()=>{hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
    expect(button('Pause scanning').disabled).toBe(false); expect(mocks.start).toHaveBeenCalledTimes(2);
  });
  it('releases the camera on window blur even when visible and resumes active scanning on focus', async () => {
    await renderApp(); await click('Start scanning');
    await act(async () => window.dispatchEvent(new Event('blur')));
    expect(document.hidden).toBe(false);
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(button('Enable camera').disabled).toBe(false);
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(button('Pause scanning').disabled).toBe(false);
  });
  it('releases the camera on pagehide and waits for pageshow before reconnecting', async () => {
    await renderApp();
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(mocks.stop).toHaveBeenCalledOnce();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(mocks.start).toHaveBeenCalledOnce();
    await act(async () => window.dispatchEvent(new Event('pageshow')));
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });
});
