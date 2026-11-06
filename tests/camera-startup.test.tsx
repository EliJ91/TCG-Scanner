// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { CameraAccessError } from '../src/core/camera-access';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), settings: vi.fn(), saveBatch: vi.fn(),
  start: vi.fn(), stop: vi.fn(), init: vi.fn(), destroy: vi.fn(), unlock: vi.fn(),
}));
vi.mock('../src/core/storage', () => ({ storage: { load: mocks.load, settings: mocks.settings, saveBatch: mocks.saveBatch } }));
vi.mock('../src/core/camera', () => ({ Camera: class {
  stream?: { active: boolean }; capabilities = {};
  start = async (...args: unknown[]) => { const info = await mocks.start(...args); this.stream = { active: true }; return info; };
  stop = () => { mocks.stop(); this.stream = undefined; };
} }));
vi.mock('../src/core/processor', () => ({ Processor: class { fallback = false; init = mocks.init; destroy = mocks.destroy; } }));
vi.mock('../src/core/audio', () => ({ ScannerAudio: class { unlock = mocks.unlock; } }));

let root: Root, container: HTMLDivElement;
const loaded = { batch: undefined, scans: [], attempts: [], settings: undefined };
function button(label: string) {
  const element = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
  expect(element, `Button ${label}`).toBeDefined(); return element!;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(loaded); mocks.settings.mockResolvedValue(undefined); mocks.saveBatch.mockResolvedValue(undefined);
  mocks.start.mockResolvedValue({ width: 1280, height: 720 }); mocks.init.mockResolvedValue(undefined); mocks.unlock.mockResolvedValue(true);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: vi.fn().mockResolvedValue([]) } });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('camera permission is independent from scanner initialization', () => {
  it('keeps Enable camera clickable while IndexedDB is still pending', async () => {
    mocks.load.mockReturnValue(new Promise(() => {}));
    await act(async () => root.render(<App />));
    expect(button('Enable camera').disabled).toBe(false);
    await act(async () => { button('Enable camera').click(); expect(mocks.start).toHaveBeenCalledTimes(1); });
    expect(button('Loading saved scans…').disabled).toBe(true);
    expect(mocks.init).not.toHaveBeenCalled(); expect(mocks.unlock).not.toHaveBeenCalled();
  });
  it('still requests the camera after storage initialization fails', async () => {
    mocks.load.mockRejectedValue(new Error('Storage blocked'));
    await act(async () => root.render(<App />));
    await act(async () => button('Enable camera').click());
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Storage unavailable');
    expect(mocks.stop).not.toHaveBeenCalled(); expect(mocks.init).not.toHaveBeenCalled();
  });
  it('keeps the granted preview when optional device enumeration fails', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: vi.fn().mockRejectedValue(new Error('Unsupported')) } });
    await act(async () => root.render(<App />)); await act(async () => button('Enable camera').click());
    expect(button('Start scanning').disabled).toBe(false);
    expect(mocks.stop).not.toHaveBeenCalled(); expect(container.textContent).toContain('Camera ready');
  });
  it('keeps the granted preview when optional device enumeration throws synchronously', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices: () => { throw new Error('Unsupported'); } } });
    await act(async () => root.render(<App />)); await act(async () => button('Enable camera').click());
    expect(button('Start scanning').disabled).toBe(false); expect(mocks.stop).not.toHaveBeenCalled();
  });
  it('does not tear down the camera if OpenCV initialization fails', async () => {
    mocks.init.mockRejectedValue(new Error('Processing engine unavailable'));
    await act(async () => root.render(<App />)); await act(async () => button('Enable camera').click());
    expect(mocks.init).not.toHaveBeenCalled();
    await act(async () => button('Start scanning').click());
    expect(mocks.init).toHaveBeenCalledTimes(1); expect(mocks.stop).not.toHaveBeenCalled();
    expect(button('Start scanning').disabled).toBe(false); expect(container.textContent).toContain('Processing engine unavailable');
  });
  it('shows a direct-browser recovery link when an embedded view blocks camera access, and supports retry', async () => {
    mocks.start.mockRejectedValueOnce(new CameraAccessError('blocked', 'This embedded browser blocks camera access.', true));
    await act(async () => root.render(<App />)); await act(async () => button('Enable camera').click());
    const link = container.querySelector('.camera-browser-link') as HTMLAnchorElement;
    expect(link.textContent).toContain('Safari or Chrome'); expect(link.target).toBe('_blank');
    expect(button('Enable camera').disabled).toBe(false);
    await act(async () => button('Enable camera').click());
    expect(button('Start scanning').disabled).toBe(false); expect(container.querySelector('.camera-browser-link')).toBeNull();
  });
});
