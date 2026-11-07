// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { CameraAccessError } from '../src/core/camera-access';
import { defaults } from '../src/core/types';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), settings: vi.fn(), saveBatch: vi.fn(), create: vi.fn(), rename: vi.fn(),
  accept: vi.fn(), getAttempt: vi.fn(),
  start: vi.fn(), stop: vi.fn(), zoom: vi.fn(), capture: vi.fn(),
  control: vi.fn(), lock: vi.fn(), focus: vi.fn(), capabilities: {} as {torch?:boolean;focusMode?:string[];focusDistance?:{min:number;max:number;step:number}},
  unlock: vi.fn(), error: vi.fn(), success: vi.fn(), complete: vi.fn(),
  lost: undefined as ((reason: string) => void) | undefined,
}));
vi.mock('../src/core/storage', () => ({ storage: {
  load: mocks.load, settings: mocks.settings, saveBatch: mocks.saveBatch, create: mocks.create,
  renameBatch: mocks.rename, accept: mocks.accept, getAttempt: mocks.getAttempt,
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
  mocks.capabilities={}; mocks.control.mockResolvedValue(undefined); mocks.lock.mockResolvedValue(undefined); mocks.focus.mockResolvedValue(2);
  mocks.load.mockResolvedValue(loaded); mocks.settings.mockResolvedValue(undefined); mocks.saveBatch.mockResolvedValue(undefined);
  mocks.start.mockResolvedValue({ width: 1280, height: 720 }); mocks.unlock.mockResolvedValue(true);
  mocks.capture.mockResolvedValue({ blob: new Blob(['source'], { type: 'image/jpeg' }), width: 1280, height: 720 });
  mocks.getAttempt.mockResolvedValue(undefined);
  mocks.accept.mockResolvedValue(undefined); mocks.rename.mockResolvedValue(undefined);
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

describe('automatic camera preview independent from scanner initialization', () => {
  it('opens the camera on entry while IndexedDB is pending, without audio', async () => {
    mocks.load.mockReturnValue(new Promise(() => {})); await renderApp();
    expect(mocks.start).toHaveBeenCalledTimes(1); expect(button('Loading saved scans…').disabled).toBe(true);
    expect(mocks.unlock).not.toHaveBeenCalled();
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
  it('does not cancel a grant while the native permission dialog dismisses', async () => {
    let hidden=false, allow!:(info:{width:number;height:number})=>void;
    vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
    mocks.start.mockImplementationOnce(()=>new Promise(resolve=>{allow=resolve;}));
    await renderApp();
    await act(async()=>{hidden=true;document.dispatchEvent(new Event('visibilitychange'));allow({width:720,height:1280});});
    expect(mocks.stop).not.toHaveBeenCalled(); expect(button('Requesting camera…').disabled).toBe(true);
    await act(async()=>{hidden=false;document.dispatchEvent(new Event('visibilitychange'));});
    expect(button('Start scanning').disabled).toBe(false); expect(mocks.stop).not.toHaveBeenCalled();
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    let frame!: FrameRequestCallback;
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frame = callback; return 1; }));
    const pixels = new Uint8ClampedArray(160 * 120 * 4).fill(100);
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: pixels }) } as unknown as CanvasRenderingContext2D);
    localStorage.setItem('cardslinger-settings', JSON.stringify({ ...defaults, stabilityMs: 10 }));
    await renderApp();
    const video = container.querySelector('video')!;
    Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 }, readyState: { value: 4 } });
    await click('Start scanning');
    await act(async () => frame(performance.now()));
    expect(container.querySelector('.auto-countdown')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(33);
      video.currentTime = .033;
      frame(performance.now());
    });
    expect(container.querySelector('.auto-countdown')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(9); });
    expect(mocks.capture).not.toHaveBeenCalled();
    for (let i = 0; i < pixels.length; i += 4) pixels[i] = pixels[i + 1] = pixels[i + 2] = i % 8 ? 40 : 200;
    video.currentTime = .043;
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(container.querySelector('.auto-countdown')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(23);
      video.currentTime = .066;
      frame(performance.now());
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.auto-countdown.is-snapped')).not.toBeNull();
  });
  it('saves each manual photo immediately with its original bytes and dimensions', async () => {
    await renderApp();
    await click('Manual');
    for (let i = 0; i < 5; i++) await click('Take photo');
    expect(mocks.capture).toHaveBeenCalledTimes(5);
    expect(mocks.accept).toHaveBeenCalledTimes(5);
    const original = await mocks.capture.mock.results[0].value;
    expect(mocks.accept.mock.calls[0][0].blob).toBe(original.blob);
    expect(mocks.accept.mock.calls[0][0]).toMatchObject({ width: 1280, height: 720 });
    expect(mocks.success).toHaveBeenCalledTimes(5);
    expect(container.querySelector('.scan-count')?.textContent).toBe('5 / 50');
  });
  it('restores cached camera controls and resets settings without deleting the saved batch', async () => {
    mocks.capabilities={torch:true,focusMode:['manual','continuous']};
    localStorage.setItem('cardslinger-settings',JSON.stringify({...defaults,cameraId:'rear-wide',resolution:3840,zoom:2,torch:true,focusLocked:true,focusDistance:2}));
    const b={id:'saved-batch',number:3,name:'Keep these photos',target:5,createdAt:1,status:'paused',nextOrdinal:1};
    mocks.load.mockResolvedValueOnce({...loaded,batch:b,scans:[{id:'saved',batchId:b.id,ordinal:0,blob:new Blob(),thumbnail:new Blob(),processingMs:1,corners:[],width:900,height:1257}]});
    await renderApp();expect(mocks.start).toHaveBeenCalledWith(3840,'rear-wide');
    expect(mocks.control).toHaveBeenCalledWith({torch:true});expect(mocks.focus).toHaveBeenCalledWith(true, 2);
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click());
    await click('Settings');await click('Reset settings');
    expect(JSON.parse(localStorage.getItem('cardslinger-settings')!)).toEqual(defaults);
    expect(mocks.settings.mock.calls.at(-1)?.[0]).toEqual(defaults);expect(mocks.start).toHaveBeenLastCalledWith(2560,undefined);
    expect(container.querySelector('.scan-count')?.textContent).toBe('1 / 5');
    expect(container.querySelector('.batch-name-trigger')?.textContent).toContain('Keep these photos');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('manual mode captures only on tap and keeps working after a camera encoding error', async () => {
    await renderApp(); await click('Manual'); expect(mocks.capture).not.toHaveBeenCalled();
    mocks.capture.mockRejectedValueOnce(new Error('Camera encoding failed')); await click('Take photo');
    expect(mocks.capture).toHaveBeenCalledTimes(1); expect(mocks.accept).not.toHaveBeenCalled();
    expect(button('Take photo').disabled).toBe(false); expect(container.textContent).not.toContain('Scanning paused');
    expect(mocks.error).toHaveBeenCalled(); await click('Take photo');
    expect(mocks.accept).toHaveBeenCalledTimes(1); expect(container.querySelector('.scan-count')?.textContent).toBe('1 / 50');
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.stop).not.toHaveBeenCalled();
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
    mocks.load.mockResolvedValueOnce({ ...loaded, nextBatchNumber: 8 }); await renderApp();
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Edit batch name"]')!.click());
    await input('#batch-name',' '); await click('Save name');
    expect(container.querySelector('.batch-name-trigger')?.textContent).toContain('Batch#008');
  });
  it('reconnects stalled frames without changing active scan intent', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout','setInterval','clearInterval','Date'] }); let tick!: FrameRequestCallback;
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { tick = callback; return 0; }));
    await renderApp(); await click('Start scanning');
    await act(async()=>tick(2000));
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
});
