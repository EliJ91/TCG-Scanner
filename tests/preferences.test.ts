// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cacheSettings, normalizeSettings, readCachedSettings } from '../src/core/preferences';
import { defaults } from '../src/core/types';
beforeEach(()=>localStorage.clear());
describe('browser-cached camera preferences',()=>{
  it('restores the selected camera, zoom, resolution and flashlight before async storage loads',()=>{
    const saved={...defaults,cameraId:'rear-wide',resolution:3840,zoom:1.8,torch:true,stabilityMs:200,batchTarget:123};
    cacheSettings(saved);expect(normalizeSettings(readCachedSettings())).toEqual(saved);
  });
  it.each([false,true])('discards the retired card-slinger preference (%s) without changing other settings',stackCards=>{
    cacheSettings({...defaults,stackCards,zoom:1.8,stabilityMs:200});
    const restored=normalizeSettings(readCachedSettings());
    expect(restored).toEqual({...defaults,zoom:1.8,stabilityMs:200});
    expect(restored).not.toHaveProperty('stackCards');
    cacheSettings(restored);
    expect(readCachedSettings()).not.toHaveProperty('stackCards');
  });
  it('migrates the old slow-capture setting and rounds saved delays to the nearest stop',()=>{
    expect(normalizeSettings({stabilityMs:1200,zoom:2}).stabilityMs).toBe(100);
    expect(normalizeSettings({captureVersion:2,stabilityMs:220}).stabilityMs).toBe(100);
    expect(normalizeSettings({captureVersion:2,stabilityMs:800}).stabilityMs).toBe(800);
    expect(normalizeSettings({...defaults,stabilityMs:1400}).stabilityMs).toBe(1000);
    expect(normalizeSettings({...defaults,stabilityMs:1}).stabilityMs).toBe(10);
    expect(normalizeSettings({...defaults,stabilityMs:10}).stabilityMs).toBe(10);
    expect(normalizeSettings({...defaults,stabilityMs:180}).stabilityMs).toBe(200);
  });
  it('migrates old movement thresholds and preserves hundredths of a percent when restoring settings', () => {
    expect(normalizeSettings({ sensitivity: 0.25 }).sensitivity).toBe(0.99);
    expect(normalizeSettings({ sensitivity: 0 }).sensitivity).toBe(0.99);
    expect(normalizeSettings({ sensitivity: 0.99 }).sensitivity).toBe(0.99);
    expect(normalizeSettings({ sensitivity: 0.9901 }).sensitivity).toBe(0.9901);
    expect(normalizeSettings({ sensitivity: 0.99375 }).sensitivity).toBe(0.9938);
    expect(normalizeSettings({ sensitivity: 0.9999 }).sensitivity).toBe(0.9999);
    expect(normalizeSettings({ sensitivity: 1 }).sensitivity).toBe(1);
    expect(normalizeSettings({ sensitivity: 1.1 }).sensitivity).toBe(1);
  });
  it('leaves room for the IndexedDB fallback if the synchronous cache is absent or damaged',()=>{
    expect(readCachedSettings()).toBeUndefined();
    localStorage.setItem('cardslinger-settings','invalid');expect(readCachedSettings()).toBeUndefined();
    localStorage.setItem('cardslinger-settings','[]');expect(readCachedSettings()).toBeUndefined();
  });
  it('drops saved manual focus and rounds older quality settings to the nearest preset',()=>{
    const settings = normalizeSettings({ lockCamera: true, focusLocked: true, focusDistance: 3, debug: true, quality: 0.86 });
    expect(settings).toMatchObject({ quality: 0.9 });
    expect(settings).not.toHaveProperty('lockCamera');
    expect(settings).not.toHaveProperty('focusLocked');
    expect(settings).not.toHaveProperty('focusDistance');
    expect(settings).not.toHaveProperty('debug');
    expect(normalizeSettings({ batchTarget: 0 }).batchTarget).toBe(50);
  });
  it('reset replaces all camera and capture choices with defaults',()=>{
    cacheSettings({...defaults,cameraId:'other',torch:true,focusLocked:true,stackCards:true,zoom:3,stabilityMs:1100});
    cacheSettings({...defaults});expect(normalizeSettings(readCachedSettings())).toEqual(defaults);
  });
});
