// @vitest-environment jsdom
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ImageAdjustments,validAdjustment} from '../src/ImageAdjustments';
import {imageAdjustmentDefaults} from '../src/core/image-adjustments';

let container:HTMLDivElement,root:Root,source:HTMLVideoElement;
const save=vi.fn(),cancel=vi.fn(),enable=vi.fn(),stop=vi.fn(),getUserMedia=vi.fn();
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia}});
  source=document.createElement('video');source.srcObject={getTracks:()=>[{stop}]} as unknown as MediaStream;
  Object.defineProperties(source,{videoWidth:{value:1200},videoHeight:{value:1600}});
  document.body.appendChild(source);
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  save.mockClear();cancel.mockClear();enable.mockClear();stop.mockClear();getUserMedia.mockClear();
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();source.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const props=()=>({values:{...imageAdjustmentDefaults},source,cameraReady:true,requesting:false,zoom:1,flipped:false,loaded:true,cameraError:'',enable,save,cancel});
async function render(overrides:Partial<ReturnType<typeof props>>={}){await act(async()=>root.render(<ImageAdjustments {...props()} {...overrides}/>));}
function button(text:string){return [...container.querySelectorAll('button')].find(b=>b.textContent?.trim()===text)!;}
async function input(selector:string,value:string){await act(async()=>{const element=container.querySelector<HTMLInputElement>(selector)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));});}

it('synchronizes sliders, numbers and native gamma transfers as the user edits',async()=>{
  await render();
  await input('[aria-label="Brightness value"]','125');
  expect(container.querySelector<HTMLInputElement>('#adjust-brightness')!.value).toBe('125');
  expect(container.querySelector('feFuncR')!.getAttribute('slope')).toBe('1.25');
  await input('#adjust-contrast','80');expect(container.querySelector<HTMLInputElement>('[aria-label="Contrast value"]')!.value).toBe('80');
  await input('[aria-label="Gamma value"]','2');
  expect(container.querySelector<SVGElement>('feFuncR[type="gamma"]')!.getAttribute('exponent')).toBe('0.5');
  expect(container.querySelector<HTMLInputElement>('#adjust-gamma')!.value).toBe('2');
  expect(save).not.toHaveBeenCalled();
});
it('rejects empty, out-of-range and off-step manual values without changing the preview',async()=>{
  await render();
  for(const invalid of ['151','49','100.5','']){
    await input('[aria-label="Brightness value"]',invalid);
    expect(button('Save').disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('#adjust-brightness')!.value).toBe('100');
    expect(container.querySelector('[aria-label="Brightness value"]')!.getAttribute('aria-invalid')).toBe('true');
  }
  await input('[aria-label="Brightness value"]','100');expect(button('Save').disabled).toBe(false);
  expect(validAdjustment('gamma','0.49')).toBe(false);expect(validAdjustment('gamma','2.01')).toBe(false);expect(validAdjustment('gamma','1.005')).toBe(false);expect(validAdjustment('gamma','1.25')).toBe(true);
});
it('reset stays a draft until Save commits the four neutral settings',async()=>{
  await render({values:{brightness:120,contrast:130,saturation:90,gamma:1.5}});
  await act(async()=>button('Reset to Defaults').click());expect(save).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLVideoElement>('video')!.style.filter).toBe('none');
  await act(async()=>button('Save').click());expect(save).toHaveBeenCalledExactlyOnceWith(imageAdjustmentDefaults);
});
it('Cancel leaves saved values and the original video unchanged',async()=>{
  const saved={brightness:110,contrast:90,saturation:80,gamma:.8};source.style.filter='none';
  await render({values:saved});await input('[aria-label="Gamma value"]','1.8');
  await act(async()=>button('Cancel').click());expect(cancel).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled();
  expect(saved.gamma).toBe(.8);expect(source.style.filter).toBe('none');
});
it('borrows one stream and releases only its video subscription when closed',async()=>{
  await render();const mirror=container.querySelector('video')!;
  expect(mirror.srcObject).toBe(source.srcObject);expect(getUserMedia).not.toHaveBeenCalled();
  await act(async()=>root.render(null));expect(mirror.srcObject).toBeNull();expect(stop).not.toHaveBeenCalled();expect(source.srcObject).not.toBeNull();
});
it('enables an inactive camera using the existing scanner action',async()=>{
  await render({cameraReady:false});await act(async()=>button('Enable camera').click());
  expect(enable).toHaveBeenCalledOnce();expect(getUserMedia).not.toHaveBeenCalled();
});
