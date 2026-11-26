import { describe, expect, it } from 'vitest';
import { imageAdjustmentDefaults, normalizeImageAdjustments, pixelAdjustment, type ImageAdjustments } from '../src/core/image-adjustments';
import { normalizeSettings } from '../src/core/preferences';

const clip = (v: number) => Math.max(0, Math.min(1, v));
function reference(rgb: number[], a: ImageAdjustments) {
  const color = rgb.map(v => clip((clip(v / 255 * a.brightness / 100) - 0.5) * a.contrast / 100 + 0.5));
  const gray = color[0] * .2126 + color[1] * .7152 + color[2] * .0722;
  return color.map(v => Math.round(Math.pow(clip(gray + (v - gray) * a.saturation / 100), 1 / a.gamma) * 255));
}
describe('software image adjustment math', () => {
  it('preserves every byte at neutral defaults, including alpha', () => {
    const pixels = new Uint8ClampedArray(Array.from({length:1024},(_,i)=>i%256)), original=pixels.slice();
    pixelAdjustment(imageAdjustmentDefaults)(pixels);expect(pixels).toEqual(original);
  });
  it('uses gamma on image channels, preserves black/white and brightens midtones above 1', () => {
    const pixels=new Uint8ClampedArray([0,0,0,255,64,64,64,255,255,255,255,255]);
    pixelAdjustment({...imageAdjustmentDefaults,gamma:2})(pixels);
    expect([...pixels]).toEqual([0,0,0,255,128,128,128,255,255,255,255,255]);
  });
  it.each([
    {brightness:50,contrast:150,saturation:50,gamma:.5},
    {brightness:150,contrast:50,saturation:150,gamma:2},
    {brightness:113,contrast:121,saturation:87,gamma:1.37},
    {brightness:120,contrast:80,saturation:100,gamma:1.2},
    {brightness:100,contrast:100,saturation:150,gamma:1},
  ])('matches the shared sRGB preview formula to within one channel level: %j', a => {
    const colors=[];for(let r=0;r<=255;r+=17)for(let g=0;g<=255;g+=17)for(let b=0;b<=255;b+=17)colors.push([r,g,b]);
    const pixels=new Uint8ClampedArray(colors.flatMap(rgb=>[...rgb,123]));pixelAdjustment(a)(pixels);
    colors.forEach((rgb,i)=>{reference(rgb,a).forEach((v,c)=>expect(Math.abs(pixels[i*4+c]-v)).toBeLessThanOrEqual(1));expect(pixels[i*4+3]).toBe(123);});
  });
  it('migrates existing settings neutrally and validates persisted values',()=>{
    expect(normalizeSettings({zoom:2})).toMatchObject({...imageAdjustmentDefaults,zoom:2});
    expect(normalizeImageAdjustments({brightness:200,contrast:1,saturation:NaN,gamma:Infinity})).toEqual({brightness:150,contrast:50,saturation:100,gamma:1});
    expect(normalizeImageAdjustments({gamma:.777})).toMatchObject({gamma:.78});
  });
});
