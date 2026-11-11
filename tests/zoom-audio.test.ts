import { afterEach, describe, expect, it, vi } from 'vitest';
import { zoomRect } from '../src/core/zoom';
import { ScannerAudio } from '../src/core/audio';
afterEach(() => vi.unstubAllGlobals());
describe('shared zoom framing', () => {
  it('keeps the complete frame at 1x and center-crops at 2x', () => {
    expect(zoomRect(1920,1080,1)).toEqual({x:0,y:0,width:1920,height:1080});
    expect(zoomRect(1920,1080,2)).toEqual({x:480,y:270,width:960,height:540});
  });
  it('bounds zoom and keeps odd-sized frames centered without upscaling', () => {
    expect(zoomRect(1920,1080,99)).toEqual(zoomRect(1920,1080,3));
    expect(zoomRect(1920,1080,NaN)).toEqual(zoomRect(1920,1080,1));
    const r=zoomRect(1279,719,1.7);
    expect(Math.abs(r.x+r.width/2-1279/2)).toBeLessThanOrEqual(.5);
    expect(Math.abs(r.y+r.height/2-719/2)).toBeLessThanOrEqual(.5);
    expect(r.width).toBeLessThan(1279);
  });
});
function audioFixture() {
  const voices: {frequency:number;type:string;time:number}[]=[];
  const context={currentTime:1,state:'running',destination:{},resume:async()=>{},createBuffer:()=>({}),createBufferSource:()=>({buffer:null,connect:()=>{},start:()=>{}}),
    createGain:()=>({gain:{setValueAtTime:()=>{},linearRampToValueAtTime:()=>{},exponentialRampToValueAtTime:()=>{}},connect:(destination:unknown)=>destination}),
    createOscillator:()=>({type:'sine',frequency:{value:0},connect:(node:unknown)=>node,start(time:number){voices.push({frequency:this.frequency.value,type:this.type,time});},stop:()=>{}})};
  vi.stubGlobal('window',{AudioContext:class{constructor(){return context;}}});
  return {context,voices};
}
describe('distinct error audio', () => {
  it('uses a low buzzing waveform distinct from success and completion', async () => {
    const {voices,context}=audioFixture();const sound=new ScannerAudio();await sound.unlock();sound.error();
    expect(voices.map(v=>[v.frequency,v.type])).toEqual([[220,'sawtooth'],[110,'sawtooth']]);
    voices.length=0;context.currentTime=2;sound.success();expect(voices.every(v=>v.type==='sine'&&v.frequency>1000)).toBe(true);
    voices.length=0;context.currentTime=3;sound.complete();expect(voices.map(v=>v.type)).toEqual(['triangle','triangle','triangle']);
    expect(voices[0].time).toBe(3);
    voices.length=0;context.currentTime=4;sound.queueFull();
    expect(voices.map(v=>[v.frequency,v.type])).toEqual([[660,'square'],[660,'square']]);
  });
  it('respects mute and avoids overlapping alarms for the same rapid failure', async () => {
    const {voices,context}=audioFixture();const sound=new ScannerAudio();sound.error();expect(voices).toHaveLength(0);
    await sound.unlock();sound.muted=true;sound.error();expect(voices).toHaveLength(0);
    sound.muted=false;sound.error();sound.error();expect(voices).toHaveLength(2);
    context.currentTime=2;sound.error();expect(voices).toHaveLength(4);
  });
  it('keeps all notification sounds silent at zero volume', async () => {
    const {voices}=audioFixture();const sound=new ScannerAudio();await sound.unlock();sound.volume=0;
    sound.error();sound.success();sound.complete();sound.queueFull();expect(voices).toHaveLength(0);
  });
});
