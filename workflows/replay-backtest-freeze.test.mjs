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
  const deps={readPositionRR:async id=>({entity_id:id,source:'tradingview_position_tool_label',label:'3',compact:true,value:3}),preflight:async()=>({ready:true}),evaluate:async expression=>{reads++;return structuredClone(expression.includes('facade')?snapshot:expression.includes('if (true)')?evidence.identity:evidence);},
    captureFull:async()=>Buffer.from('full').toString('base64'),captureScreenshot:async()=>Buffer.from('day').toString('base64'),graphics:{},
    isolate:async trades=>trades.map((t,i)=>({source_id:t.source_id,screenshot:{base64:Buffer.from('image'+i).toString('base64')}}))};
  return {directory:path.join(parent,'pack'),deps,snapshot,evidence,reads:()=>reads};
}
test('seals replay evidence and permits offline review assembly; publishing fails before requests',async t=>{
  const f=await setup(t),ready=await freezeReplayDay('2026-09-01',f.directory,{grouping:'flat_to_flat',automaticPositions:false,deps:f.deps}),reads=f.reads();
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
  await assert.rejects(freezeReplayDay('2026-09-01',f.directory,{grouping:'flat_to_flat',automaticPositions:false,deps:f.deps}),/visibility restoration/);
  await fs.access(path.join(f.directory,'replay-raw.json'));await fs.access(path.join(f.directory,'recovery.json'));
  await assert.rejects(fs.access(path.join(f.directory,'chart-ready.json')),/ENOENT/);
});
test('a changing fill report fails without sealing success',async t=>{
  const f=await setup(t),read=f.deps.evaluate;let snapshots=0;
  f.deps.evaluate=async expression=>{const result=await read(expression);if(expression.includes('facade')&&++snapshots>1)result.report.filledOrders.pop();return result;};
  await assert.rejects(freezeReplayDay('2026-09-01',f.directory,{grouping:'flat_to_flat',automaticPositions:false,deps:f.deps}),/replay fills changed/);
  await assert.rejects(fs.access(path.join(f.directory,'chart-ready.json')),/ENOENT/);
});
test('preflight failure leaves chart untouched and creates no pack',async t=>{
  const f=await setup(t);f.deps.preflight=async()=>{throw Error('not ready');};
  await assert.rejects(freezeReplayDay('2026-09-01',f.directory,{grouping:'flat_to_flat',automaticPositions:false,deps:f.deps}),/not ready/);
  assert.equal(f.reads(),0);await assert.rejects(fs.access(f.directory),/ENOENT/);
});
test('missing per-trade image cannot seal a successful pack',async t=>{
  const f=await setup(t);f.deps.isolate=async()=>[];
  await assert.rejects(freezeReplayDay('2026-09-01',f.directory,{grouping:'flat_to_flat',automaticPositions:false,deps:f.deps}),/mismatched/);
  await assert.rejects(fs.access(path.join(f.directory,'chart-ready.json')),/ENOENT/);
});

test('fill-aware publication verifies transactions and can retry reviews without chart access',async t=>{
  const f=await setup(t);await freezeReplayDay('2026-09-01',f.directory,{grouping:'flat_to_flat',automaticPositions:false,deps:f.deps});
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
  assert.deepEqual(first.trades,retry.trades);assert.equal(first.status,'complete');assert.equal(first.trades.length,2);
  assert.equal(keys[0],keys[1]);assert.equal(f.reads(),reads);assert.equal(documents.size,2);
});

test('new notes-only replay captures create no questionnaire or review input',async t=>{
 const f=await setup(t);const ready=await freezeReplayDay('2026-09-01',f.directory,{grouping:'flat_to_flat',automaticPositions:false,deps:f.deps,notesOnly:true,grouping:'flat_to_flat'});
 assert.equal(ready.notes_only,true);assert.equal(ready.questionnaire_version,undefined);
 await assert.rejects(fs.stat(path.join(f.directory,'review-input.json')),/ENOENT/);
 const frozen=JSON.parse(await fs.readFile(path.join(f.directory,'frozen.json')));assert.equal(frozen.notes_only,true);assert.equal(frozen.questionnaire_version,undefined);
});

test('native displayed RR is sealed exactly and missing or mismatched tool evidence prevents release',async t=>{
 const f=await setup(t);f.deps.readPositionRR=async id=>({entity_id:id,source:'tradingview_position_tool_label',label:'2.91',compact:true,value:2.91});
 await freezeReplayDay('2026-09-01',f.directory,{grouping:'flat_to_flat',automaticPositions:false,deps:f.deps,notesOnly:true});
 const frozen=JSON.parse(await fs.readFile(path.join(f.directory,'frozen.json')));
 assert.equal(frozen.ledger.trades[0].rr,2.91); // Geometry in fixture would give 3.
 assert.equal(frozen.ledger.trades[0].position_rr.entity_id,'long');
 const bad=await setup(t);bad.deps.readPositionRR=async()=>({entity_id:'wrong',source:'tradingview_position_tool_label',label:'3',compact:true,value:3});
 await assert.rejects(freezeReplayDay('2026-09-01',bad.directory,{grouping:'flat_to_flat',automaticPositions:false,deps:bad.deps,notesOnly:true}),/matched position tool/);
 await assert.rejects(fs.access(path.join(bad.directory,'chart-ready.json')),/ENOENT/);
});

test('notes publication saves native RR and fails when backend does not retain it',async t=>{
 const {publishNotes}=await import('./backtest-notes.mjs');
 const oldToken=process.env.TRADINGVIEW_INGESTION_TOKEN,oldBase=process.env.TRADING_BACKEND_URL;
 process.env.TRADINGVIEW_INGESTION_TOKEN='fixture';process.env.TRADING_BACKEND_URL='http://fixture';
 t.after(()=>{for(const [key,value] of [['TRADINGVIEW_INGESTION_TOKEN',oldToken],['TRADING_BACKEND_URL',oldBase]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 for(const discard of [false,true]){
 const f=await setup(t);await freezeReplayDay('2026-09-01',f.directory,{grouping:'flat_to_flat',automaticPositions:false,deps:f.deps,notesOnly:true});
 const info=await inspectPack(f.directory),input=path.join(f.directory,'notes-input.json');
 await fs.writeFile(input,JSON.stringify({date:info.date,user_finished:true,trades:info.trades.map((r,i)=>({number:i+1,source_id:r.source_id,no_note:true}))}));
 const records=info.trades.map((r,i)=>({id:i+1,tradingview_source_id:r.source_id,rr:null,notes:'',tags:[],replay_execution:r}));
 const request=async(url,options={})=>{
 const route=new URL(url).pathname;let value;
 if(route.endsWith('/registry'))value={ready:true,capabilities:{replay_fills:true,replay_entries:true}};
 else if(route==='/ingestion/backtest/replay')value={records};
 else if(route==='/backtest/')value=records;
 else if(route==='/backtest/daily-notes')value=[];
 else if(route.endsWith('/image')){const i=Number(route.split('/')[2])-1;value={chart:(await fs.readFile(path.join(f.directory,`position-${i+1}.png`))).toString('base64')};}
 else if(options.method==='PUT'){const body=JSON.parse(options.body);if(!discard)records.find(r=>r.id===Number(route.split('/')[2]))[body.propName]=body.value;value={};}
 else throw Error('Unexpected route '+route);
 return {ok:true,headers:{get:()=>null},json:async()=>structuredClone(value)};
 };
 if(discard)await assert.rejects(publishNotes(f.directory,input,{base:'http://fixture',request}),/verification failed/);
 else{const result=await publishNotes(f.directory,input,{base:'http://fixture',request});assert.equal(result.rr_verified,true);assert.equal(result.ticks_verified,true);assert(records.every(r=>r.rr===3));assert(records.every(r=>r.notes.includes('Actual entry-to-exit move:')));}
 }
});

test('default replay capture generates one journal-style tool per opening fill without manual drawings',async t=>{
 const {captureReplayAnnotations}=await import('./replay-backtest-freeze.mjs');
 const f=await setup(t);f.evidence.drawings=[];
 const fills=f.snapshot.report.filledOrders,from=Math.floor(fills[0].utm/60000)*60,to=Math.floor(fills.at(-1).utm/60000)*60;
 f.evidence.bars=[];for(let time=from;time<=to;time+=60)f.evidence.bars.push([time,7730,7750,7700,7730,1]);
 const plans=[];
 f.deps.captureAnnotations=(ledger,evidence,directory)=>captureReplayAnnotations(ledger,evidence,directory,{render:async plan=>{
  plans.push(plan);
  const chart_path=path.join(directory,'generated-'+plan.id+'.png');await fs.writeFile(chart_path,'unique-'+plan.id);
  return {chart_path,position_entity_id:'generated-'+plan.id,position_rr:{entity_id:'generated-'+plan.id,source:'tradingview_position_tool_label',label:'1.25',compact:true,value:1.25}};
 }});
 const ready=await freezeReplayDay('2026-09-01',f.directory,{deps:f.deps,notesOnly:true});
 assert.equal(ready.trade_count,4);assert.equal(plans.length,4);
 const frozen=JSON.parse(await fs.readFile(path.join(f.directory,'frozen.json')));
 assert.equal(frozen.ledger.grouping,'per_entry');
 assert.equal(new Set(frozen.ledger.trades.map(t=>t.position_source_id)).size,2);
 assert.equal(frozen.ledger.trades[0].transactions.length,3,'first entry gets only its FIFO exits');
 for(const [i,trade] of frozen.ledger.trades.entries()){
  assert.equal(trade.drawing.match_basis,'generated_from_replay_fills');assert.equal(trade.rr,1.25);
  assert.equal(plans[i].start.price,trade.transactions[0].price);
  assert.equal(plans[i].end.time,Math.floor(trade.exit_time/60000)*60);
  const exits=trade.transactions.filter(f=>f.side!==trade.transactions[0].side);
  if(trade.outcome==='Win')assert.equal(plans[i].end.price,trade.direction==='long'?Math.max(...exits.map(f=>f.price)):Math.min(...exits.map(f=>f.price)));
  else assert.equal(plans[i].stop_price,exits.at(-1).price);
 }
});

test('automatic annotation failure never seals a released replay pack',async t=>{
 const f=await setup(t);f.deps.captureAnnotations=async()=>{throw Error('Generated tool cleanup failed');};
 await assert.rejects(freezeReplayDay('2026-09-01',f.directory,{deps:f.deps,notesOnly:true}),/cleanup failed/);
 await assert.rejects(fs.access(path.join(f.directory,'chart-ready.json')),/ENOENT/);
});
