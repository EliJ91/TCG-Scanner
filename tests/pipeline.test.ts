import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapturePipeline } from '../src/core/pipeline';
import { storage } from '../src/core/storage';
import { MotionDetector } from '../src/core/motion';
import { ProcessingDeferred, defaults, type AttemptInfo, type Batch, type Processed, type Scan } from '../src/core/types';
const result = (): Processed => ({blob:new Blob(['cropped']),thumbnail:new Blob(['thumb']),width:900,height:1257,confidence:.9,sharpness:100,processingMs:1000,corners:[{x:0,y:0},{x:900,y:0},{x:900,y:1257},{x:0,y:1257}]});
let pipeline: CapturePipeline, batch: Batch;
const raw = () => Promise.resolve(new Blob(['original'],{type:'image/jpeg'}));
async function setup(target=10, engine={fallback:false,init:vi.fn(async()=>{}),process:vi.fn(async()=>result())}, infos:AttemptInfo[]=[]) {
  batch=await storage.create(target);
  const events={changed:vi.fn(),attempts:vi.fn(),photographed:vi.fn(),processed:vi.fn<(scan:Scan)=>void>(),failed:vi.fn(),storageIssue:vi.fn()};
  pipeline=new CapturePipeline(batch,0,infos,engine,events);pipeline.start();return {engine,events};
}
afterEach(async()=>{pipeline?.dispose();if(batch)await storage.clear(batch.id);vi.restoreAllMocks();});
describe('durable capture separated from post-processing',()=>{
  it('takes one card every simulated second while the first crop remains unfinished',async()=>{
    let finish!:(p:Processed)=>void;
    const engine={fallback:false,init:vi.fn(async()=>{}),process:vi.fn(async()=>result())};
    engine.process.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const {events}=await setup(10,engine);
    const motion=new MotionDetector(defaults.stabilityMs,defaults.sensitivity);motion.reset(true);
    const frame=(seed:number)=>Uint8Array.from({length:1200},(_,i)=>30+(i*37+seed*57)%180);
    let last=frame(0), captures=0;
    for(let card=0;card<10;card++) {
      const base=card*1000;
      if(card) {motion.update(frame(card*2),base);last=frame(card*2+1);motion.update(last,base+60);}
      for(let t=card?120:0;t<900;t+=60)if(motion.update(last,base+t).capture) {
        motion.consume();await pipeline.capture(raw,defaults);captures++;
      }
    }
    await vi.waitFor(()=>expect(engine.process).toHaveBeenCalledTimes(1));
    expect(captures).toBe(10);expect(events.photographed).toHaveBeenCalledTimes(10);
    expect(pipeline.pending).toBe(10);expect(pipeline.count).toBe(0);expect(pipeline.hasCapacity).toBe(false);
    const saved=await storage.load();expect(saved.attempts).toHaveLength(10);expect(saved.attempts.every(a=>!('raw' in a))).toBe(true);
    expect((await storage.getAttempt(saved.attempts[0].id))?.raw.size).toBeGreaterThan(0);
    finish(result());await vi.waitFor(()=>expect(pipeline.complete).toBe(true));
    expect(events.processed).toHaveBeenCalledTimes(10);expect(pipeline.pending).toBe(0);
    expect((await storage.load()).scans.map(s=>s.ordinal).sort((a,b)=>a-b)).toEqual([0,1,2,3,4,5,6,7,8,9]);
  });
  it('retains a failed crop without blocking the next saved photo or counting it as ready',async()=>{
    const {engine,events}=await setup(2);engine.process.mockRejectedValueOnce(new Error('No card boundaries'));
    await pipeline.capture(raw,defaults);await vi.waitFor(()=>expect(events.failed).toHaveBeenCalledTimes(1));
    expect(pipeline.count).toBe(0);expect(pipeline.running).toBe(true);expect(pipeline.hasCapacity).toBe(true);
    const failed=(await storage.load()).attempts[0];expect(failed.reason).toContain('boundaries');expect(await pipeline.original(failed.id)).toBeDefined();
    await pipeline.capture(raw,defaults);await vi.waitFor(()=>expect(pipeline.count).toBe(1));
    await pipeline.capture(raw,defaults);await vi.waitFor(()=>expect(pipeline.complete).toBe(true));
    expect(events.photographed).toHaveBeenCalledTimes(3);expect((await storage.load()).attempts).toHaveLength(1);
  });
  it('reopens queued originals and finishes processing without opening the camera or resuming capture',async()=>{
    await setup(3);
    pipeline.dispose();
    const attempt={id:crypto.randomUUID(),batchId:batch.id,ordinal:0,capturedAt:Date.now(),raw:await raw(),reason:'',settings:defaults};
    await storage.stage(attempt,{...batch,nextOrdinal:1});
    const restored=await storage.load();
    const processed=vi.fn();pipeline=new CapturePipeline(restored.batch!,0,restored.attempts,{fallback:false,init:async()=>{},process:async()=>result()},{changed:()=>{},attempts:()=>{},photographed:()=>{},processed,failed:()=>{},storageIssue:()=>{}});
    pipeline.kick();await vi.waitFor(()=>expect(processed).toHaveBeenCalledTimes(1));
    expect(pipeline.running).toBe(false);expect(pipeline.count).toBe(1);expect((await storage.load()).attempts).toHaveLength(0);
  });
  it('defers the main-thread compatibility path until capture is paused or reaches its limit',async()=>{
    const engine={fallback:true,init:vi.fn(async()=>{}),process:vi.fn(async()=>result())};
    await setup(3,engine);await pipeline.capture(raw,defaults);await pipeline.capture(raw,defaults);
    expect(engine.process).not.toHaveBeenCalled();expect(pipeline.pending).toBe(2);
    pipeline.pause();await vi.waitFor(()=>expect(pipeline.count).toBe(2));expect(pipeline.running).toBe(false);
    pipeline.start();await pipeline.capture(raw,defaults);await vi.waitFor(()=>expect(pipeline.complete).toBe(true));
  });
  it('retries a storage failure using the original reservation and snapshot',async()=>{
    const {events}=await setup(2);const stage=vi.spyOn(storage,'stage');stage.mockRejectedValueOnce(new Error('Quota exceeded'));
    const snapshot=vi.fn(raw);await pipeline.capture(snapshot,defaults);
    expect(pipeline.pending).toBe(1);expect(pipeline.hasCapacity).toBe(false);expect(events.photographed).not.toHaveBeenCalled();
    await pipeline.retryStorage();await vi.waitFor(()=>expect(pipeline.count).toBe(1));
    expect(snapshot).toHaveBeenCalledTimes(1);expect(events.photographed).toHaveBeenCalledTimes(1);expect(pipeline.nextOrdinal).toBe(1);
  });
  it('retries a failed processed-image commit even when other photos are already queued',async()=>{
    let finish!:(p:Processed)=>void;
    const engine={fallback:false,init:vi.fn(async()=>{}),process:vi.fn(async()=>result())};
    engine.process.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const {events}=await setup(3,engine);vi.spyOn(storage,'accept').mockRejectedValueOnce(new Error('Storage unavailable'));
    await pipeline.capture(raw,defaults);await pipeline.capture(raw,defaults);await pipeline.capture(raw,defaults);
    await vi.waitFor(()=>expect(engine.process).toHaveBeenCalledTimes(1));finish(result());await vi.waitFor(()=>expect(events.storageIssue).toHaveBeenCalled());
    expect(pipeline.hasCapacity).toBe(false);await pipeline.retryStorage();await vi.waitFor(()=>expect(pipeline.count).toBeGreaterThanOrEqual(1));
    await vi.waitFor(()=>expect(pipeline.complete).toBe(true));
    expect((await storage.load()).scans).toHaveLength(3);
  });
  it('does not fall back to heavy main-thread work during an active feed when a worker disappears',async()=>{
    const {engine,events}=await setup(3);
    engine.process.mockImplementationOnce(async()=>{engine.fallback=true;throw new ProcessingDeferred('Wait for pause');});
    await pipeline.capture(raw,defaults);await vi.waitFor(()=>expect(pipeline.fallback).toBe(true));
    expect(pipeline.pending).toBe(1);expect(events.failed).not.toHaveBeenCalled();expect(pipeline.hasCapacity).toBe(true);
    await pipeline.capture(raw,defaults);await pipeline.capture(raw,defaults);await vi.waitFor(()=>expect(pipeline.complete).toBe(true));
  });
  it('releases the shutter immediately after an encoding error, without waiting for older crops',async()=>{
    let finish!:(p:Processed)=>void;const {engine}=await setup(3);
    engine.process.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    await pipeline.capture(raw,defaults);await vi.waitFor(()=>expect(engine.process).toHaveBeenCalledTimes(1));
    await expect(pipeline.capture(async()=>{throw new Error('Encoding failed');},defaults)).rejects.toThrow('Encoding failed');
    expect(pipeline.staging).toBe(false);expect(pipeline.hasCapacity).toBe(true);
    await pipeline.capture(raw,defaults);finish(result());await vi.waitFor(()=>expect(pipeline.count).toBe(2));
    expect(pipeline.pending).toBe(0);expect(pipeline.hasCapacity).toBe(true);
  });
  it('keeps saving photos when processing startup fails and retries the retained backlog later',async()=>{
    const {engine,events}=await setup(3);engine.init.mockRejectedValueOnce(new Error('Engine loading failed'));
    await pipeline.capture(raw,defaults);await vi.waitFor(()=>expect(engine.init).toHaveBeenCalled());
    expect(pipeline.hasCapacity).toBe(true);expect(events.storageIssue).not.toHaveBeenCalled();
    await pipeline.capture(raw,defaults);await pipeline.capture(raw,defaults);await vi.waitFor(()=>expect(pipeline.complete).toBe(true));
    expect(events.photographed).toHaveBeenCalledTimes(3);
  });
});
