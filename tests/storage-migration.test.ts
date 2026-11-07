import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { expect, it } from 'vitest';
import { storage } from '../src/core/storage';
import { defaults } from '../src/core/types';
it('upgrades the existing browser database without losing queued originals, names or settings',async()=>{
  const legacy=await openDB('cardslinger',1,{upgrade(db){
    db.createObjectStore('batches',{keyPath:'id'});
    db.createObjectStore('scans',{keyPath:'id'}).createIndex('by-batch','batchId');
    db.createObjectStore('attempts',{keyPath:'id'}).createIndex('by-batch','batchId');
    db.createObjectStore('preferences');
  }});
  const batch={id:'existing',name:'Keep original batch',number:7,target:5,status:'paused',createdAt:1,nextOrdinal:2};
  const original={id:'queued',batchId:batch.id,ordinal:1,capturedAt:2,raw:new Blob(['original JPEG']),reason:'',settings:defaults};
  await legacy.put('batches',batch);await legacy.put('attempts',original);await legacy.put('attempts',{...original,id:'retained',ordinal:0,reason:'Old crop failure'});await legacy.put('preferences',batch.id,'active');await legacy.put('preferences',defaults,'settings');legacy.close();
  const recovered=await storage.load();expect(recovered.batch?.name).toBe(batch.name);expect(recovered.settings).toEqual(defaults);
  expect(recovered.attempts).toHaveLength(1);expect(recovered.attempts[0]).not.toHaveProperty('raw');
  expect(recovered.scans.map(scan=>scan.id)).toEqual(['queued']);
  expect(await recovered.scans[0].blob.text()).toBe('original JPEG');
  expect(await storage.getAttempt('queued')).toBeUndefined();
  expect(await (await storage.getAttempt('retained'))?.raw.text()).toBe('original JPEG');
  await storage.clear(batch.id);expect((await storage.load()).attempts).toHaveLength(0);
});
