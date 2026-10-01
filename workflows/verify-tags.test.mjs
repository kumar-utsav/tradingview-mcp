import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateReview, runReview, planDay, reviewTemplate, snapshotDay, prepareDay } from './verify-tags.mjs';
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
  else if(route.includes('/daily-notes/'))data={notes:'Daily',external_resources:[]};else if(route.endsWith('/image'))data={chart};else throw Error(route);
  return {ok:true,json:async()=>structuredClone(data)};
 };
 try{const options={base:'http://test',request};const before=await snapshotDay('2026-09-23',dir,options),current=await prepareDay('2026-09-23',dir,options);
  assert.equal(before.trade_count,1);assert.equal(current.trade_count,1);assert.deepEqual(before.image_failures,[]);
  assert.equal(await fs.readFile(path.join(dir,'before-1.png'),'utf8'),'chart');assert.equal(await fs.readFile(path.join(dir,'trade-1.png'),'utf8'),'chart');
  const template=JSON.parse(await fs.readFile(current.review_template,'utf8'));assert.equal(template.trades[0].chart_reviewed,false);
 }finally{await fs.rm(parent,{recursive:true,force:true});}
});
