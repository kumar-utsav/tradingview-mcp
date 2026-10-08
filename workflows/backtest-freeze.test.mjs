import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {freezeDay,publishDay,assembleNotes} from './backtest-freeze.mjs';
import {createHash} from 'node:crypto';
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
async function chatRun(t) {
  const dir=await temp(t);
  await freezeDay(date,dir,{notesMode:'chat',capture:async args=>fakeCapture({...args,persist:async(phase,bundle)=>{
    bundle.notes_mode='chat';bundle.payload.trades[0].notes='';bundle.payload.daily_note=null;
    await args.persist(phase,bundle);
  }})});
  const notesFile=path.join(path.dirname(dir),'notes.json');
  return {dir,notesFile,notes:{date,trades:[{number:1,source_id:'one',text:'Waited for retest'}],daily:'Patient today'}};
}
test('chat capture waits for complete mapped notes, then retries offline assembly with unchanged evidence',async t=>{
  const {dir,notesFile,notes}=await chatRun(t);
  const original=await fs.readFile(path.join(dir,'frozen.json'),'utf8');
  const pending=JSON.parse(await fs.readFile(path.join(dir,'pending-notes.json'),'utf8'));
  assert.equal(pending.trades[0].number,1);assert.equal(pending.trades[0].source_id,'one');
  await snapshotDay(date,dir,{base:'http://test',request});
  await assert.rejects(publishDay(dir,{publish:async()=>assert.fail('Must wait for notes')}),/ENOENT/);
  await fs.writeFile(notesFile,JSON.stringify(notes));await assembleNotes(dir,notesFile);
  const published=[];
  const publish=async b=>{published.push(b);return {saved:1};};
  await publishDay(dir,{publish});await publishDay(dir,{publish});
  assert.deepEqual(published[0],published[1]);assert.equal(published[0].idempotency_key,'stable-key');
  assert.equal(published[0].payload.trades[0].notes,notes.trades[0].text);
  assert.equal(published[0].payload.daily_note,notes.daily);
  assert.equal(await fs.readFile(path.join(dir,'frozen.json'),'utf8'),original);
  await assert.rejects(assembleNotes(dir,notesFile),/EEXIST/);
});
test('chat assembly rejects missing, duplicate, wrong-day and wrong-source notes',async t=>{
  const {dir,notesFile,notes}=await chatRun(t);
  for(const invalid of [{...notes,trades:[]},{...notes,date:'2026-09-03'},
    {...notes,trades:[{...notes.trades[0],source_id:'wrong'}]},
    {...notes,trades:[notes.trades[0],notes.trades[0]]},
    {...notes,trades:[{number:1,source_id:'one',text:''}]}]){
    await fs.writeFile(notesFile,JSON.stringify(invalid));await assert.rejects(assembleNotes(dir,notesFile));
    await assert.rejects(fs.access(path.join(dir,'notes-ready.json')),/ENOENT/);
  }
  await fs.writeFile(notesFile,JSON.stringify({date,trades:[{number:1,source_id:'one',no_note:true}]}));
  await assembleNotes(dir,notesFile);
  const b=JSON.parse(await fs.readFile(path.join(dir,'assembled.json'),'utf8'));
  assert.equal(b.payload.trades[0].notes,'');assert.equal(b.payload.daily_note,null);
});
test('chat notes stay matched to fixed trade numbers even when supplied in reverse order',async t=>{
  const dir=await temp(t),notesFile=path.join(path.dirname(dir),'notes.json');
  await freezeDay(date,dir,{notesMode:'chat',capture:async({persist})=>{
    const b={version:1,notes_mode:'chat',idempotency_key:'two-trades',evidence:{},note_audit:[],annotated_screenshot:image,
      payload:{capture_date:date,trades:[{source_id:'first',notes:''},{source_id:'second',notes:''}],daily_note:null}};
    await persist('recovery',b);b.payload.screenshot=image;
    b.payload.trade_screenshots=b.payload.trades.map(t=>({source_id:t.source_id,screenshot:image}));
    await persist('frozen',b);return b;
  }});
  const trades=[{number:2,source_id:'second',text:'Second trade note'},{number:1,source_id:'first',text:'First trade note'}];
  await fs.writeFile(notesFile,JSON.stringify({date,trades:[trades[0],trades[0]]}));
  await assert.rejects(assembleNotes(dir,notesFile),/unique mapped/);
  await fs.writeFile(notesFile,JSON.stringify({date,trades}));await assembleNotes(dir,notesFile);
  const b=JSON.parse(await fs.readFile(path.join(dir,'assembled.json'),'utf8'));
  assert.deepEqual(b.payload.trades.map(t=>t.notes),['First trade note','Second trade note']);
});
test('chat publication rejects changed frozen financial evidence even with a recomputed checksum',async t=>{
  const {dir,notesFile,notes}=await chatRun(t);
  await fs.writeFile(notesFile,JSON.stringify(notes));await assembleNotes(dir,notesFile);
  await snapshotDay(date,dir,{base:'http://test',request});
  const file=path.join(dir,'assembled.json'),b=JSON.parse(await fs.readFile(file,'utf8'));
  b.payload.trades[0].entry_price=999;const raw=JSON.stringify(b,null,2);await fs.writeFile(file,raw);
  const marker=path.join(dir,'notes-ready.json'),state=JSON.parse(await fs.readFile(marker,'utf8'));
  state.assembled_sha256=createHash('sha256').update(raw).digest('hex');await fs.writeFile(marker,JSON.stringify(state));
  await assert.rejects(publishDay(dir,{publish:async()=>assert.fail('Must not publish changed prices')}),/Only chat notes/);
});
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
