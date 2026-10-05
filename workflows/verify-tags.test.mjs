import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateReview, validateSnapshot, reviewContext, runReview, planDay, reviewTemplate, snapshotDay, prepareDay } from './verify-tags.mjs';
const tags = [{ key: 'a', group_id: 1 }, { key: 'b', group_id: 1 }];
const groups = [{ id: 1, name: 'Setup', selection_mode: 'single', is_active_checklist: true }];
const trade = { id: 1, tags: ['a'], notes: 'original' };
const review = { id: 1, expected_tags: ['a'], expected_notes: 'original', tags: ['b'], chart_reviewed: true, evidence: { b: 'Observed retest' }, group_review: { 1: 'b supported' } };
test('rejects stale edits, missing chart review, missing groups and conflicting keys', () => {
  assert.throws(() => validateReview(review, { ...trade, notes: 'edited' }, tags, groups), /changed/);
  assert.throws(() => validateReview({ ...review, chart_reviewed: false }, trade, tags, groups), /Chart/);
  assert.throws(() => validateReview({ ...review, group_review: {} }, trade, tags, groups), /Group/);
  assert.throws(() => validateReview({ ...review, tags: ['a', 'b'], evidence: { a: 'x', b: 'y' } }, trade, tags, groups), /Conflicting/);
});
test('writes only tags and independently reads back, detects unsaved writes', async () => {
  let state = structuredClone(trade); let writes = 0; let dropWrite = false;
  const request = async (url, options) => {
    if (options?.method === 'PUT') {
      const body = JSON.parse(options.body); assert.deepEqual(Object.keys(body).sort(), ['propName','value']); assert.equal(body.propName, 'tags');
      writes++; if (!dropWrite) state.tags = body.value;
      return { ok: true };
    }
    return { ok: true, json: async () => url.includes('groups') ? groups : url.includes('/tags/') ? tags : [structuredClone(state)] };
  };
  await runReview({ trades: [review] }, { base: 'http://test', request }); assert.equal(writes, 0);
  await runReview({ trades: [review] }, { base: 'http://test', request, apply: true }); assert.equal(writes, 1); assert.deepEqual(state.tags, ['b']);
  state = structuredClone(trade); dropWrite = true;
  await assert.rejects(runReview({ trades: [review] }, { base: 'http://test', request, apply: true }), /Read-back mismatch/);
});
test('plans one date and prefills review state without inventing evidence',()=>{
 const records=[{...trade,date:'9/23/2026',entry_candle:'07:11'},{...trade,id:2,date:'2026-09-22'}],planned=planDay(records,'2026-09-23');
 assert.deepEqual(planned.map(item=>item.id),[1]);
 assert.deepEqual(reviewTemplate(planned,groups),{trades:[{id:1,expected_tags:['a'],expected_notes:'original',tags:['a'],chart_reviewed:false,evidence:{},group_review:{1:''}}]});
});
test('snapshot and prepare batch state, images, and a prefilled manifest',async()=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'backtest-test-')),dir=path.join(parent,'run');
 const dated={...trade,date:'9/23/2026',entry_candle:'07:11'},chart=Buffer.from('chart').toString('base64');
 const request=async url=>{const route=new URL(url).pathname;let data;
  if(route==='/backtest/')data=[dated];else if(route==='/tags/')data=tags;else if(route==='/tags/groups')data=groups;
  else if(route==='/backtest/daily-notes')data=[{date:'9/23/2026',notes:'Daily',external_resources:[]}];else if(route.endsWith('/image'))data={chart};else throw Error(route);
  return {ok:true,json:async()=>structuredClone(data)};
 };
 try{const options={base:'http://test',request};const before=await snapshotDay('2026-09-23',dir,options),current=await prepareDay('2026-09-23',dir,options);
  assert.equal(before.trade_count,1);assert.equal(current.trade_count,1);assert.deepEqual(before.image_failures,[]);
  assert.equal(await fs.readFile(path.join(dir,'before-1.png'),'utf8'),'chart');assert.equal(await fs.readFile(path.join(dir,'trade-1.png'),'utf8'),'chart');
  const template=JSON.parse(await fs.readFile(current.review_template,'utf8'));assert.equal(template.trades[0].chart_reviewed,false);
  const packet=JSON.parse(await fs.readFile(path.join(dir,'review-context.json'),'utf8'));
  assert.equal(packet.daily_note.notes,'Daily');assert.equal(packet.checklist.length,1);
 }finally{await fs.rm(parent,{recursive:true,force:true});}
});
test('validation CLI runs offline and saves its truthful audit result',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'backtest-validate-cli-'));
 try{
  const manifest=path.join(dir,'review.json'),snapshot=path.join(dir,'current.json');
  await fs.writeFile(manifest,JSON.stringify({trades:[review]}));
  await fs.writeFile(snapshot,JSON.stringify({trades:[trade],tags,groups}));
  const {stdout}=await promisify(execFile)(process.execPath,[new URL('./verify-tags.mjs',import.meta.url).pathname,'validate',manifest,snapshot],{env:{...process.env,TRADING_API_URL:'http://127.0.0.1:1'}});
  const output=JSON.parse(stdout);
  assert.equal(output.validated,true);assert.equal(output.live_verified,false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'validate-result.json'),'utf8')),output);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('uses real chart_date ahead of legacy date and retains chronological ordering',()=>{
 const rows=[{id:2,chart_date:'8/5/2026',date:'8/6/2026',entry_candle:'08:00'},{id:1,chart_date:'2026-08-05',entry_candle:'07:34'},{id:3,date:'8/6/2026'}];
 assert.deepEqual(planDay(rows,'2026-08-05').map(r=>r.id),[1,2]);
});
test('compact packet preserves all active definitions and saved legacy tags',()=>{
 const snapshot={date:'2026-08-05',trades:[{...trade,tags:['a','legacy']}],tags:[...tags,{key:'legacy',group_id:2,description:'Retain meaning'},{key:'unused',group_id:2}],groups:[...groups,{id:2,is_active_checklist:false}],daily_note:{notes:'DAY',external_resources:[{url:'video'}]},image_failures:[]};
 const compact=reviewContext(snapshot);
 assert.deepEqual(compact.checklist[0].tags.map(t=>t.key),['a','b']);
 assert.equal(compact.checklist[0].selection_mode,'single');
 assert.deepEqual(compact.other_saved_tags.map(t=>t.key),['legacy']);
 assert.deepEqual(compact.trades,snapshot.trades);
 assert.deepEqual(compact.daily_note,snapshot.daily_note);
});
test('local validation covers every dated trade without claiming live verification',()=>{
 const snapshot={trades:[trade],tags,groups};
 const result=validateSnapshot({trades:[review]},snapshot);
 assert.equal(result.live_verified,false);assert.equal(result.validated,true);
 assert.equal(result.results[0].action,'would_save');
 assert.throws(()=>validateSnapshot({trades:[review]},{...snapshot,trades:[trade,{...trade,id:2}]}),/every dated trade/);
 assert.throws(()=>validateSnapshot({trades:[review,review]},snapshot),/Duplicate/);
 assert.throws(()=>validateSnapshot({trades:[{...review,chart_reviewed:false}]},snapshot),/Chart/);
 assert.throws(()=>validateSnapshot({trades:[review]},{...snapshot,trades:[{...trade,notes:'new'}]}),/changed/);
});
test('live apply still reloads catalog and rejects changes after local validation',async()=>{
 validateSnapshot({trades:[review]},{trades:[trade],tags,groups});
 let writes=0;
 const request=async(url,options)=>{
  if(options?.method==='PUT'){writes++;return {ok:true};}
  return {ok:true,json:async()=>url.includes('groups')?groups:url.includes('/tags/')?[tags[0]]:[trade]};
 };
 await assert.rejects(runReview({trades:[review]},{base:'http://test',request,apply:true}),/Unknown tag b/);
 assert.equal(writes,0);
});
test('live apply rechecks each trade before writing and stops on concurrent edits',async()=>{
 let reads=0,writes=0;
 const request=async(url,options)=>{
  if(options?.method==='PUT'){writes++;return {ok:true};}
  return {ok:true,json:async()=>url.includes('groups')?groups:url.includes('/tags/')?tags:[++reads===1?trade:{...trade,notes:'concurrent edit'}]};
 };
 await assert.rejects(runReview({trades:[review]},{base:'http://test',request,apply:true}),/changed since review/);
 assert.equal(writes,0);assert.equal(reads,2);
});
test('daily-note collection absence is normal, duplicate or failed reads are not',async()=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'backtest-notes-'));
 let daily=[],fail=false;
 const request=async url=>{
  const route=new URL(url).pathname;
  if(route==='/backtest/daily-notes')return {ok:!fail,status:500,json:async()=>daily};
  return {ok:true,json:async()=>route==='/backtest/'?[]:route==='/tags/'?tags:groups};
 };
 try{
  await snapshotDay('2026-08-05',path.join(parent,'empty'),{base:'http://test',request});
  assert.equal(JSON.parse(await fs.readFile(path.join(parent,'empty','before.json'))).daily_note,null);
  daily=[{date:'8/5/2026'},{date:'2026-08-05'}];
  await assert.rejects(snapshotDay('2026-08-05',path.join(parent,'duplicate'),{base:'http://test',request}),/Duplicate daily/);
  fail=true;
  await assert.rejects(snapshotDay('2026-08-05',path.join(parent,'failed'),{base:'http://test',request}),/HTTP 500/);
 }finally{await fs.rm(parent,{recursive:true,force:true});}
});
test('image downloads are bounded, all failures remain reported, and failed flags do not hide images',async()=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'backtest-images-'));
 const rows=Array.from({length:9},(_,i)=>({...trade,id:i+1,chart_date:'8/5/2026',has_chart:false}));
 let active=0,peak=0,imageReads=0;
 const request=async url=>{
  const route=new URL(url).pathname;
  if(route.endsWith('/image')){
   imageReads++;active++;peak=Math.max(peak,active);
   await new Promise(resolve=>setImmediate(resolve));active--;
   return {ok:!route.includes('/5/'),status:404,json:async()=>({chart:Buffer.from('image').toString('base64')})};
  }
  return {ok:true,json:async()=>route==='/backtest/'?rows:route==='/backtest/daily-notes'?[]:route==='/tags/'?tags:groups};
 };
 try{
  const result=await snapshotDay('2026-08-05',path.join(parent,'run'),{base:'http://test',request,imageConcurrency:3});
  assert.equal(peak,3);assert.equal(imageReads,9);assert.deepEqual(result.image_failures.map(f=>f.id),[5]);
  assert.equal(await fs.readFile(path.join(parent,'run','before-9.png'),'utf8'),'image');
 }finally{await fs.rm(parent,{recursive:true,force:true});}
});
