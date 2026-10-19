import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {freezeDay} from './backtest-freeze.mjs';
import {preflight,prepare,assemble,publish,inspectPack,normalizeEvidence,shared,verifyVisible} from './capture-review.mjs';
const date='2026-09-24',time=shared.pacificTime(date,'07:00');
const evidence={session:{open:time-1800,close:time+21600,verified:true,source:'Synthetic test session'},tick_size:0.01,time_frame:1,bars:[{time:time-60,open:99.9,high:99.99,low:99.8,close:99.9},...Array.from({length:30},(_,i)=>({time:time+i*60,open:100,high:i?100.6:100.1,low:99.9,close:100.1}))]};
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'structured-pack-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const pack=path.join(dir,'pack'),image={base64:'aW1hZ2U='};
 await freezeDay(date,pack,{notesMode:'chat',questionnaireVersion:1,capture:async({persist})=>{
  const bundle={version:1,notes_mode:'chat',idempotency_key:'stable',evidence,note_audit:[],annotated_screenshot:image,payload:{capture_review_version:1,capture_date:date,trades:[{source_id:'source-1',ticker:'SPY',type:'Call',time_frame:1,notes:''}],daily_note:null,screenshot:image,trade_screenshots:[{source_id:'source-1',screenshot:image}]}};
  await persist('recovery',bundle);await persist('frozen',bundle);return bundle;
 }});
 return {dir,pack,input:path.join(pack,'review-input.json')};
}
const load=async p=>JSON.parse(await fs.readFile(p,'utf8'));
async function answer(f){const v=await load(f.input);v.user_finished=true;v.raw_dictation='Original speech retained exactly.';Object.assign(v.trades[0].document,{note_summary:'Entered on a break and retest.',answers:{...Object.fromEntries(Object.keys(shared.FIELDS).map(k=>[k,{status:'skipped',source:'reported',reason:'User explicitly skipped remaining questions'}])),setup:{status:'known',source:'reported',value:'bnr'}},references:{direction:'long',retest:{approved:true,time:time-60,available_at:time,high:99.99,low:99.8},target_zone:{approved:true,available_at:time-120,low:100.5,high:100.6}}});await fs.writeFile(f.input,JSON.stringify(v));return v;}
test('partial dictation is resumable; finish seals raw input, mapping and cached evidence',async t=>{
 const f=await fixture(t);await assert.rejects(assemble(f.pack,f.input),/instruction to finish/);await assert.rejects(fs.stat(path.join(f.pack,'structured-ready.json')),/ENOENT/);
 const v=await answer(f);await assemble(f.pack,f.input);assert.deepEqual(await load(path.join(f.pack,'structured-input.json')),v);const ready=await load(path.join(f.pack,'structured-answers.json'));assert.equal(ready.trades[0].research.scenarios[0].status,'target_first');assert.equal(ready.tradingview_used,false);
 assert.equal((await assemble(f.pack,f.input)).status,'answers_ready');
 await fs.writeFile(f.input,JSON.stringify({...v,raw_dictation:'Changed source'}));await assert.rejects(assemble(f.pack,f.input),/Different content already sealed/);
});
test('frozen source IDs and workflow mode cannot be changed during continuation',async t=>{
 const f=await fixture(t);const v=await answer(f);v.trades[0].source_id='wrong';await fs.writeFile(f.input,JSON.stringify(v));await assert.rejects(assemble(f.pack,f.input),/mapping changed/);
 const p=path.join(f.pack,'chart-ready.json'),state=await load(p);delete state.questionnaire_version;await fs.writeFile(p,JSON.stringify(state));await assert.rejects(prepare(f.pack),/legacy/);
});
test('partial server failure retains recovery; retry is chart-free with stable requests and verified IDs',async t=>{
 const f=await fixture(t);await answer(f);await assemble(f.pack,f.input);let fail=true,saved,requests=[];
 const services={snapshotDay:async(_,pack)=>fs.writeFile(path.join(pack,'before.json'),JSON.stringify({date})),publishBacktest:async b=>{assert.equal(b.idempotency_key,'stable');assert.equal(b.payload.capture_review_version,1);return {records:[{id:42,tradingview_source_id:'source-1'}]};}};
 const request=async(url,options)=>{const route=new URL(url).pathname;let json;
  if(route==='/backtest/')json=[{id:42,tags:saved?shared.projectedTags(saved):[],notes:shared.summaryNotes('',saved?.note_summary||'')}];else if(route==='/backtest/daily-notes')json=[];else if(options.method==='PUT'){requests.push(JSON.parse(options.body));if(fail){fail=false;return {ok:false,status:503,json:async()=>({error:'Temporary failure'})};}saved=JSON.parse(options.body).document;json={revision:1,document:saved};}else json={revision:saved?1:0,trade_fingerprint:'frozen',document:saved};return {ok:true,json:async()=>json};};
 await assert.rejects(publish(f.pack,{base:'http://offline',request,services}),/Temporary failure/);const failure=await load(path.join(f.pack,'structured-save-failure.json'));await fs.stat(failure.attempt);
 const result=await publish(f.pack,{base:'http://offline',request,services});assert.equal(result.status,'complete');assert.equal((await load(path.join(f.pack,'structured-complete.json'))).verification.backup_restore_required,false);assert.equal(result.tradingview_used,false);assert.equal(result.trades[0].trade_id,42);assert.deepEqual(requests[0],requests[1]);
 await assert.rejects(verifyVisible(f.pack,f.input),/verification required/);await fs.rm(failure.attempt,{recursive:true,force:true});
});
test('journal and backtest evidence adapters produce identical research from identical candles',()=>{
 const a=normalizeEvidence(evidence,date,'SPY',1),b=normalizeEvidence({...evidence,bars:evidence.bars.map(x=>[x.time,x.open,x.high,x.low,x.close])},date,'SPY',1);
 const review={references:{direction:'long',retest:{approved:true,time:time-60,available_at:time,high:99.99,low:99.8},target_zone:{approved:true,available_at:time-120,low:100.5,high:100.6}}};assert.deepEqual(shared.compareResearch(review,a),shared.compareResearch(review,b));
});

test('research calculations use sealed evidence rather than a modified convenience export',async t=>{const f=await fixture(t);await answer(f);await fs.writeFile(path.join(f.pack,'chart-evidence.json'),JSON.stringify({bars:[]}));await assemble(f.pack,f.input);const ready=await load(path.join(f.pack,'structured-answers.json'));assert.equal(ready.trades[0].research.scenarios[0].status,'target_first');});

test('prospective preflight requires installed schema/catalog without chart access',async()=>{const request=async()=>({ok:true,json:async()=>({version:1,policy:shared.POLICY,ready:false,reason:'Catalog missing'})});await assert.rejects(preflight('journal',{request}),/Catalog missing/);assert.equal((await preflight('backtest',{request:async()=>({ok:true,json:async()=>({version:1,policy:shared.POLICY,ready:true})})})).tradingview_used,false);});

test('new captures cannot discard user dictation without a summary or explicit no-note choice',async t=>{
 const f=await fixture(t);const v=await answer(f);delete v.trades[0].document.note_summary;
 await fs.writeFile(f.input,JSON.stringify(v));await assert.rejects(assemble(f.pack,f.input),/provide a summary/);
 v.trades[0].document.note_summary='Stop at the first higher low; added after further zone retests.';
 await fs.writeFile(f.input,JSON.stringify(v));await assemble(f.pack,f.input);
 assert.equal((await load(path.join(f.pack,'structured-answers.json'))).trades[0].document.note_summary,v.trades[0].document.note_summary);
});
