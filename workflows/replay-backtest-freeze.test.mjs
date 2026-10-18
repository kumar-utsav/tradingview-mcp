import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {freezeReplayDay} from './replay-backtest-freeze.mjs';
import {inspectPack,publish,assemble,capturePrompts,captureAnswers} from './capture-review.mjs';

test('backtests skip emotions while journal prompts and answer requirements remain',()=>{
  assert.equal(capturePrompts('backtest').length,4);assert.equal(capturePrompts('journal').length,5);
  assert.equal(captureAnswers('backtest').entry_emotions.status,'skipped');assert.equal(captureAnswers('journal').entry_emotions.status,'missing');
});

async function setup(t){
  const parent=await fs.mkdtemp(path.join(os.tmpdir(),'replay-capture-test-'));t.after(()=>fs.rm(parent,{recursive:true,force:true}));
  const snapshot=JSON.parse(await fs.readFile(new URL('../tests/fixtures/replay-mes-scale.json',import.meta.url),'utf8'));
  const fills=snapshot.report.filledOrders;
  const evidence={identity:{source:snapshot.source,symbol:snapshot.symbol,resolution:'1',visible_range:{from:fills[0].utm/1000-600,to:fills.at(-1).utm/1000+600}},
    studies:[],bars:fills.map(f=>[f.utm/1000,f.p,f.p,f.p,f.p,1]),drawings:[
      {id:'long',name:'long_position',points:[{time:fills[0].utm/1000-180,price:7724.75},{time:fills[5].utm/1000+60}],properties:{stopLevel:22,profitLevel:66}},
      {id:'short',name:'short_position',points:[{time:fills[6].utm/1000-120,price:7730.25},{time:fills[9].utm/1000+60}],properties:{stopLevel:12,profitLevel:30}}]};
  let reads=0;
  const deps={preflight:async()=>({ready:true}),evaluate:async expression=>{reads++;return structuredClone(expression.includes('facade')?snapshot:expression.includes('if (true)')?evidence.identity:evidence);},
    captureFull:async()=>Buffer.from('full').toString('base64'),captureScreenshot:async()=>Buffer.from('day').toString('base64'),graphics:{},
    isolate:async trades=>trades.map((t,i)=>({source_id:t.source_id,screenshot:{base64:Buffer.from('image'+i).toString('base64')}}))};
  return {directory:path.join(parent,'pack'),deps,snapshot,evidence,reads:()=>reads};
}
test('seals replay evidence and permits offline review assembly; publishing fails before requests',async t=>{
  const f=await setup(t),ready=await freezeReplayDay('2026-09-01',f.directory,{deps:f.deps}),reads=f.reads();
  assert.equal(ready.chart_released,true);assert.equal(ready.ingestion_complete,false);assert.equal(ready.fill_count,10);
  const info=await inspectPack(f.directory);assert.equal(info.trades.length,2);
  const inputFile=path.join(f.directory,'review-input.json'),input=JSON.parse(await fs.readFile(inputFile));
  input.user_finished=true;input.raw_dictation='Finish; unknown intentions in this test';for(const row of input.trades)row.document.note_summary='No trade intentions supplied in this test.';
  for(const t of input.trades)for(const answer of Object.values(t.document.answers)){answer.status='skipped';answer.reason='Explicitly skipped by user';}
  await fs.writeFile(inputFile,JSON.stringify(input));await assemble(f.directory,inputFile);
  const assembled=JSON.parse(await fs.readFile(path.join(f.directory,'structured-answers.json')));
  assert.equal(assembled.trades[0].evidence.execution_ledger.transactions.length,6);
  assert.equal(assembled.trades[0].evidence.session.verified,false);
  assert.equal(assembled.trades[0].evidence.session.calendar_source,'futures_session_boundaries_not_verified');
  assert.equal(assembled.trades[0].research.status,'unavailable');
  await assert.rejects(publish(f.directory,{request:async(url,options)=>{assert.ok(!options?.method||options.method==='GET');return {ok:true,json:async()=>({ready:true,capabilities:{replay_fills:false}})};}}),/fill-aware/);
  assert.equal(f.reads(),reads,'No chart access during review/assembly/publication guard');
  await fs.appendFile(path.join(f.directory,'position-1.png'),'changed');
  await assert.rejects(inspectPack(f.directory),/Sealed replay pack changed/);
});
test('failed isolation retains raw recovery without a release marker',async t=>{
  const f=await setup(t);f.deps.isolate=async()=>{throw Error('visibility restoration failed');};
  await assert.rejects(freezeReplayDay('2026-09-01',f.directory,{deps:f.deps}),/visibility restoration/);
  await fs.access(path.join(f.directory,'replay-raw.json'));await fs.access(path.join(f.directory,'recovery.json'));
  await assert.rejects(fs.access(path.join(f.directory,'chart-ready.json')),/ENOENT/);
});
test('a changing fill report fails without sealing success',async t=>{
  const f=await setup(t),read=f.deps.evaluate;let snapshots=0;
  f.deps.evaluate=async expression=>{const result=await read(expression);if(expression.includes('facade')&&++snapshots>1)result.report.filledOrders.pop();return result;};
  await assert.rejects(freezeReplayDay('2026-09-01',f.directory,{deps:f.deps}),/replay fills changed/);
  await assert.rejects(fs.access(path.join(f.directory,'chart-ready.json')),/ENOENT/);
});
test('preflight failure leaves chart untouched and creates no pack',async t=>{
  const f=await setup(t);f.deps.preflight=async()=>{throw Error('not ready');};
  await assert.rejects(freezeReplayDay('2026-09-01',f.directory,{deps:f.deps}),/not ready/);
  assert.equal(f.reads(),0);await assert.rejects(fs.access(f.directory),/ENOENT/);
});
test('missing per-trade image cannot seal a successful pack',async t=>{
  const f=await setup(t);f.deps.isolate=async()=>[];
  await assert.rejects(freezeReplayDay('2026-09-01',f.directory,{deps:f.deps}),/mismatched/);
  await assert.rejects(fs.access(path.join(f.directory,'chart-ready.json')),/ENOENT/);
});

test('fill-aware publication verifies transactions and can retry reviews without chart access',async t=>{
  const f=await setup(t);await freezeReplayDay('2026-09-01',f.directory,{deps:f.deps});
  const inputPath=path.join(f.directory,'review-input.json'),input=JSON.parse(await fs.readFile(inputPath));input.user_finished=true;for(const row of input.trades)row.no_note=true;
  for(const row of input.trades)for(const answer of Object.values(row.document.answers)){answer.status='skipped';answer.reason='User skipped in this fixture';}
  await fs.writeFile(inputPath,JSON.stringify(input));await assemble(f.directory,inputPath);
  const info=await inspectPack(f.directory),reads=f.reads(),keys=[],documents=new Map();let records=[];
  const request=async(url,options={})=>{
    const route=new URL(url).pathname;let value;
    if(route.endsWith('/registry'))value={ready:true,capabilities:{replay_fills:true}};
    else if(route==='/backtest/')value=records;
    else if(route.endsWith('/capture-review')){
      const id=Number(route.split('/')[2]);
      if(options.method==='PUT'){
        const body=JSON.parse(options.body);
        if(!documents.has(id))documents.set(id,{revision:1,trade_fingerprint:'trade-'+id,evidence_fingerprint:body.document.evidence_hash,document:body.document});
      }
      value=documents.get(id)||{revision:0,trade_fingerprint:'trade-'+id,evidence_fingerprint:null,document:null};
    }else value=[];
    return {ok:true,json:async()=>structuredClone(value)};
  };
  const services={publishReplay:async(payload,key)=>{keys.push(key);assert.equal(payload.capture_kind,'replay_fills');records=info.trades.map((trade,i)=>({id:i+100,tradingview_source_id:trade.source_id,replay_execution:trade}));return {records};}};
  const first=await publish(f.directory,{base:'http://fixture',request,services}),retry=await publish(f.directory,{base:'http://fixture',request,services});
  assert.deepEqual(first.trades,retry.trades);assert.equal(first.status,'api_verified_ui_pending');assert.equal(first.trades.length,2);
  assert.equal(keys[0],keys[1]);assert.equal(f.reads(),reads);assert.equal(documents.size,2);
});
