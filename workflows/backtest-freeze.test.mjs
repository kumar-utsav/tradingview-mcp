import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {freezeDay,publishDay} from './backtest-freeze.mjs';
import {snapshotDay} from './verify-tags.mjs';

const date='2026-09-02';
async function temp(t) {
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'backtest-freeze-test-'));
  t.after(()=>fs.rm(parent,{recursive:true,force:true}));
  return path.join(parent,'run');
}
const image={mime_type:'image/png',base64:Buffer.from('image').toString('base64')};
async function fakeCapture({date,persist}) {
  const bundle={version:1,idempotency_key:'stable-key',evidence:{drawings:[{properties:{text:'1: original'}}]},
    note_audit:[],annotated_screenshot:image,payload:{capture_date:date,
      trades:[{source_id:'one',notes:'original'}],daily_note:'Daily'}};
  await persist('recovery',bundle);
  bundle.payload.screenshot=image;
  bundle.payload.trade_screenshots=[{source_id:'one',screenshot:image}];
  await persist('frozen',bundle);
  return bundle;
}
const request=async()=>({ok:true,json:async()=>[]});
test('writes original and clean evidence before release, then snapshots and publishes without chart access',async t=>{
  const dir=await temp(t);const ready=await freezeDay(date,dir,{capture:fakeCapture});
  assert.equal(ready.chart_released,true);assert.equal(ready.ingestion_complete,false);
  assert.equal(await fs.readFile(path.join(dir,'annotated-start.png'),'utf8'),'image');
  assert.equal(await fs.readFile(path.join(dir,'position-1.png'),'utf8'),'image');
  const recovery=JSON.parse(await fs.readFile(path.join(dir,'recovery.json'),'utf8'));
  assert.equal(recovery.payload.screenshot,undefined);
  assert.equal(recovery.evidence.drawings[0].properties.text,'1: original');
  await snapshotDay(date,dir,{base:'http://test',request});
  const published=[];const publish=async bundle=>{published.push(bundle);return {saved:1};};
  await publishDay(dir,{publish});await publishDay(dir,{publish});
  assert.equal(published.length,2);assert.deepEqual(published[0],published[1]);
  await assert.rejects(snapshotDay(date,dir,{base:'http://test',request}),/already exists/);
});
test('does not release when capture fails and preserves recovery material',async t=>{
  const dir=await temp(t);
  await assert.rejects(freezeDay(date,dir,{capture:async args=>{
    await fakeCapture(args);throw Error('visibility restoration failed');
  }}),/visibility restoration/);
  await assert.rejects(fs.access(path.join(dir,'chart-ready.json')),/ENOENT/);
  assert.ok(await fs.readFile(path.join(dir,'recovery.json'),'utf8'));
  await assert.rejects(publishDay(dir,{publish:async()=>assert.fail('must not publish')}),/ENOENT/);
});
test('rejects incomplete app recovery or altered frozen evidence before publishing',async t=>{
  const dir=await temp(t);await freezeDay(date,dir,{capture:fakeCapture});
  const publish=async()=>assert.fail('must not publish');
  await assert.rejects(publishDay(dir,{publish}),/ENOENT/);
  await snapshotDay(date,dir,{base:'http://test',request});
  await fs.appendFile(path.join(dir,'frozen.json'),' ');
  await assert.rejects(publishDay(dir,{publish}),/mismatch/);
});
test('rejects wrong-day snapshots and arbitrary existing directories',async t=>{
  const dir=await temp(t);await freezeDay(date,dir,{capture:fakeCapture});
  await assert.rejects(snapshotDay('2026-09-03',dir,{base:'http://test',request}),/matching released capture/);
  await assert.rejects(freezeDay(date,dir,{capture:fakeCapture}),/EEXIST/);
  const other=path.join(path.dirname(dir),'unrelated');await fs.mkdir(other);
  await assert.rejects(snapshotDay(date,other,{base:'http://test',request}),/ENOENT/);
});
test('retains release and recovery files when publication fails; retries the same key',async t=>{
  const dir=await temp(t);await freezeDay(date,dir,{capture:fakeCapture});
  await snapshotDay(date,dir,{base:'http://test',request});
  let key;
  await assert.rejects(publishDay(dir,{publish:async bundle=>{key=bundle.idempotency_key;throw Error('offline');}}),/offline/);
  assert.ok(await fs.readFile(path.join(dir,'recovery.json'),'utf8'));
  const result=await publishDay(dir,{publish:async bundle=>{
    assert.equal(bundle.idempotency_key,key);return {saved:1};
  }});
  assert.equal(result.saved,1);
});
