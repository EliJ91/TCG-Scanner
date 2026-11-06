// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { CameraAccessError } from '../src/core/camera-access';
import { defaults } from '../src/core/types';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), settings: vi.fn(), saveBatch: vi.fn(), create: vi.fn(), rename: vi.fn(),
  stage: vi.fn(), accept: vi.fn(), getAttempt: vi.fn(), markAttempt: vi.fn(),
  start: vi.fn(), stop: vi.fn(), zoom: vi.fn(), capture: vi.fn(),
  control: vi.fn(), lock: vi.fn(), capabilities: {} as {torch?:boolean;focusMode?:string[]},
  init: vi.fn(), process: vi.fn(), destroy: vi.fn(), unlock: vi.fn(), error: vi.fn(), success: vi.fn(), complete: vi.fn(),
  lost: undefined as ((reason: string) => void) | undefined,
}));
vi.mock('../src/core/storage', () => ({ storage: {
  load: mocks.load, settings: mocks.settings, saveBatch: mocks.saveBatch, create: mocks.create,
  renameBatch: mocks.rename, stage: mocks.stage, accept: mocks.accept, getAttempt: mocks.getAttempt, markAttempt: mocks.markAttempt,
} }));
vi.mock('../src/core/camera', () => ({ Camera: class {
  stream?: { active: boolean }; get capabilities() { return mocks.capabilities; }
  constructor(_video: HTMLVideoElement, lost: (reason: string) => void) { mocks.lost = lost; }
  start = async (...args: unknown[]) => { const info = await mocks.start(...args); this.stream = { active: true }; return info; };
  stop = () => { mocks.stop(); this.stream = undefined; };
  setZoom = mocks.zoom; capture = mocks.capture;
  control = mocks.control; lock = mocks.lock;
} }));
vi.mock('../src/core/processor', () => ({ Processor: class { fallback = false; init = mocks.init; process = mocks.process; destroy = mocks.destroy; } }));
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
  mocks.capabilities={}; mocks.control.mockResolvedValue(undefined); mocks.lock.mockResolvedValue(undefined);
  mocks.load.mockResolvedValue(loaded); mocks.settings.mockResolvedValue(undefined); mocks.saveBatch.mockResolvedValue(undefined);
  mocks.start.mockResolvedValue({ width: 1280, height: 720 }); mocks.init.mockResolvedValue(undefined); mocks.unlock.mockResolvedValue(true);
  mocks.capture.mockResolvedValue(new Blob(['source'], { type:'image/jpeg' }));
  mocks.process.mockResolvedValue({blob:new Blob(['jpeg']),thumbnail:new Blob(['thumb']),width:900,height:1257,processingMs:40,confidence:.9,sharpness:120,corners:[{x:0,y:0},{x:900,y:0},{x:900,y:1257},{x:0,y:1257}]});
  const originals = new Map();
  mocks.stage.mockImplementation(async a => { originals.set(a.id,a); }); mocks.getAttempt.mockImplementation(async id => originals.get(id));
  mocks.accept.mockResolvedValue(undefined); mocks.markAttempt.mockResolvedValue(undefined); mocks.rename.mockResolvedValue(undefined);
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
  it('opens the camera on entry while IndexedDB is pending, without audio or processing', async () => {
    mocks.load.mockReturnValue(new Promise(() => {})); await renderApp();
    expect(mocks.start).toHaveBeenCalledTimes(1); expect(button('Loading saved scans…').disabled).toBe(true);
    expect(mocks.init).not.toHaveBeenCalled(); expect(mocks.unlock).not.toHaveBeenCalled();
  });
  it('still requests the camera after storage initialization fails', async () => {
    mocks.load.mockRejectedValue(new Error('Storage blocked')); await renderApp();
    expect(mocks.start).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('Storage unavailable');
    expect(mocks.stop).not.toHaveBeenCalled(); expect(mocks.init).not.toHaveBeenCalled();
  });
  it.each(['rejects','throws'])('keeps the preview when optional enumeration %s', async kind => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: kind==='throws' ? () => {throw new Error('Unsupported');} : vi.fn().mockRejectedValue(new Error('Unsupported')) } });
    await renderApp(); expect(button('Start scanning').disabled).toBe(false); expect(mocks.stop).not.toHaveBeenCalled();
  });
  it('reports a processing initialization error without pausing or closing the camera', async () => {
    mocks.init.mockRejectedValue(new Error('Processing engine unavailable'));
    await renderApp(); expect(mocks.init).not.toHaveBeenCalled(); await click('Start scanning');
    expect(mocks.stop).not.toHaveBeenCalled(); expect(button('Pause scanning').disabled).toBe(false);
    expect(container.textContent).toContain('Processing engine unavailable'); expect(mocks.error).toHaveBeenCalled();
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
  it('keeps taking manual photos while the first boundary result is still pending', async () => {
    let finish!:(result:unknown)=>void;
    mocks.process.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    await renderApp();await click('Manual');
    for(let i=0;i<5;i++)await click('Take photo');
    expect(mocks.capture).toHaveBeenCalledTimes(5);expect(mocks.process).toHaveBeenCalledTimes(1);
    expect(button('Take photo').disabled).toBe(false);expect(mocks.success).toHaveBeenCalledTimes(5);
    expect(container.querySelector('.scan-count')?.textContent).toContain('5 / 50');
    await act(async()=>finish({blob:new Blob(),thumbnail:new Blob(),width:900,height:1257,corners:[],processingMs:20,confidence:1,sharpness:100}));
    expect(mocks.accept).toHaveBeenCalledTimes(5);
  });
  it('restores cached camera controls and resets settings without deleting the saved batch', async () => {
    mocks.capabilities={torch:true,focusMode:['manual','continuous']};
    localStorage.setItem('cardslinger-settings',JSON.stringify({...defaults,cameraId:'rear-wide',resolution:3840,zoom:2,torch:true,lockCamera:true}));
    const b={id:'saved-batch',number:3,name:'Keep these photos',target:5,createdAt:1,status:'paused',nextOrdinal:1};
    mocks.load.mockResolvedValueOnce({...loaded,batch:b,scans:[{id:'saved',batchId:b.id,ordinal:0,blob:new Blob(),thumbnail:new Blob(),processingMs:1,corners:[],width:900,height:1257}]});
    await renderApp();expect(mocks.start).toHaveBeenCalledWith(3840,'rear-wide');
    expect(mocks.control).toHaveBeenCalledWith({torch:true});expect(mocks.lock).toHaveBeenCalledWith(true);
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click());
    await click('Settings');await click('Reset settings');
    expect(JSON.parse(localStorage.getItem('cardslinger-settings')!)).toEqual(defaults);
    expect(mocks.settings.mock.calls.at(-1)?.[0]).toEqual(defaults);expect(mocks.start).toHaveBeenLastCalledWith(2560,undefined);
    expect(container.querySelector('.scan-count')?.textContent).toBe('1 / 5');
    expect(container.querySelector('.batch-name-trigger')?.textContent).toContain('Keep these photos');
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('manual mode captures only on tap and keeps working after a rejected image', async () => {
    await renderApp(); await click('Manual'); expect(mocks.capture).not.toHaveBeenCalled();
    mocks.process.mockRejectedValueOnce(new Error('Card boundaries uncertain')); await click('Take photo');
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
    vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout','setInterval','clearInterval','Date'] }); mocks.stage.mockRejectedValueOnce(new Error('Quota exceeded'));
    await renderApp(); await click('Manual'); await click('Take photo');
    expect(container.textContent).toContain('Storage unavailable'); expect(container.textContent).not.toContain('Scanning paused');
    expect(mocks.capture).toHaveBeenCalledTimes(1); expect(mocks.accept).not.toHaveBeenCalled();
    await act(async()=>{await vi.advanceTimersByTimeAsync(3001);});
    expect(mocks.accept).toHaveBeenCalledTimes(1); expect(mocks.capture).toHaveBeenCalledTimes(1);
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
