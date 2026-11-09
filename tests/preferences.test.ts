// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { cacheSettings, cachedSettings, normalizeSettings } from '../src/core/preferences';
import { defaults } from '../src/core/types';
beforeEach(()=>localStorage.clear());
describe('browser-cached camera preferences',()=>{
  it('restores the selected camera, zoom, resolution, flashlight and focus before async storage loads',()=>{
    const saved={...defaults,cameraId:'rear-wide',resolution:3840,zoom:1.8,torch:true,focusLocked:true,stackCards:true,stabilityMs:180};
    cacheSettings(saved);expect(cachedSettings()).toEqual(saved);
    expect(cachedSettings({...defaults,resolution:1920})).toEqual(saved);
  });
  it('migrates the old slow-capture setting once and preserves new explicit delay choices',()=>{
    expect(normalizeSettings({stabilityMs:1200,zoom:2}).stabilityMs).toBe(100);
    expect(normalizeSettings({captureVersion:2,stabilityMs:220}).stabilityMs).toBe(100);
    expect(normalizeSettings({captureVersion:2,stabilityMs:800}).stabilityMs).toBe(800);
    expect(normalizeSettings({...defaults,stabilityMs:1400}).stabilityMs).toBe(1000);
    expect(normalizeSettings({...defaults,stabilityMs:1}).stabilityMs).toBe(10);
    expect(normalizeSettings({...defaults,stabilityMs:10}).stabilityMs).toBe(10);
  });
  it('uses persisted IndexedDB preferences if the synchronous cache is absent or damaged',()=>{
    expect(cachedSettings({...defaults,cameraId:'rear',zoom:2}).zoom).toBe(2);
    localStorage.setItem('cardslinger-settings','invalid');expect(cachedSettings({...defaults,torch:true}).torch).toBe(true);
  });
  it('keeps legacy focus and rounds older quality settings to the nearest preset',()=>{
    const settings = normalizeSettings({ lockCamera: true, debug: true, quality: 0.86 });
    expect(settings).toMatchObject({ focusLocked: true, quality: 0.9 });
    expect(settings).not.toHaveProperty('lockCamera');
    expect(settings).not.toHaveProperty('debug');
  });
  it('reset replaces all camera and capture choices with defaults',()=>{
    cacheSettings({...defaults,cameraId:'other',torch:true,focusLocked:true,stackCards:true,zoom:3,stabilityMs:1100});
    cacheSettings({...defaults});expect(cachedSettings()).toEqual(defaults);
  });
});
