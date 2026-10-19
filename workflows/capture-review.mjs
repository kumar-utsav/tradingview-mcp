// Stage-two structured capture processing. Deliberately no TradingView/CDP imports.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tradingRoot=process.env.TRADING_PROJECT_ROOT||path.resolve(root,'../trading');
const require=createRequire(import.meta.url);
export const shared=require(path.join(tradingRoot,'frontend/src/utils/captureReview.js'));
const {hash}=require(path.join(tradingRoot,'backend/utils/captureReview.js'));
const load=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const exists=p=>fs.stat(p).then(()=>true,()=>false);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const write=(p,value)=>fs.writeFile(p,JSON.stringify(value,null,2),{flag:'wx'});
export const capturePrompts=page=>shared.PROMPTS.filter(prompt=>page!=='backtest'||!prompt.startsWith('Emotions:'));
export function captureAnswers(page){
 const answers=shared.blankAnswers();
 if(page==='backtest')for(const [key,field] of Object.entries(shared.FIELDS))if(field.section==='Emotions')answers[key]={status:'skipped',source:'reported',reason:'User requested skipping emotions for backtesting; journal questions remain applicable'};
 return answers;
}
async function seal(p,bytes){try{await fs.writeFile(p,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(!Buffer.from(await fs.readFile(p)).equals(Buffer.from(bytes)))throw Error('Different content already sealed: '+p);}}
export async function preflight(page,{base=process.env.TRADING_API_URL||process.env.TRADING_BACKEND_URL||'http://100.125.89.9:5555',request=fetch}={}){
 if(!['journal','backtest'].includes(page))throw Error('Choose journal or backtest');
 const response=await request(base.replace(/\/$/,'')+'/'+page+'/capture-review/registry',{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('Structured capture backend is unavailable; keep the chart free until rollout is complete');
 const registry=await response.json();
 if(registry.version!==shared.VERSION||registry.policy?.version!==shared.POLICY.version||registry.ready!==true)throw Error(registry.reason||'Structured capture backend readiness is unverified');
 return {ready:true,page_type:page,questionnaire_version:shared.VERSION,tradingview_used:false};
}
export function normalizeEvidence(source,date,ticker,timeframe,tickSize){
 const evidence={date,ticker,time_frame:Number(timeframe),tick_size:source.tick_size??source.instrument?.tick_size??tickSize??null,
  bars:shared.normalizeBars({bars:source.bars||[]}),drawings:source.drawings||[],indicators:source.indicators||source.graphics||{},
  coverage:source.coverage||{history_note:source.history_note||'Loaded candles only; absent history remains missing',truncated:source.bars_truncated===true},
  session:source.session||{verified:false,open:shared.pacificTime(date,'06:30'),close:shared.pacificTime(date,'13:00'),calendar_source:'standard_SPY_session; short-session override required when applicable'}};
 return evidence;
}
export async function inspectPack(pack){
 pack=path.resolve(pack);
 if(await exists(path.join(pack,'stage.json'))){
  const state=await load(path.join(pack,'stage.json'));
  if(!state.tradingview_released)throw Error('Chart release must be verified first');
  for(const [name,digest] of Object.entries(state.sealed_file_hashes||{}))if(sha(await fs.readFile(path.join(pack,name)))!==digest)throw Error('Sealed pack changed: '+name);
  for(const [id,digest] of Object.entries(state.image_hashes||{}))if(sha(await fs.readFile(path.join(pack,`trade-${id}.png`)))!==digest)throw Error('Sealed screenshot changed: '+id);
  const before=await load(path.join(pack,'before.json')),captured=await load(path.join(pack,'captured-review.json')),cache=await load(path.join(pack,'evidence.json'));
  return {page_type:'journal',date:state.date,structured:state.questionnaire_version===1,ordered:state.ordered.map(t=>({...t,source_id:String(t.trade_id)})),trades:before.trades,evidenceFor:t=>{const s=cache.sources.find(s=>String(s.ticker).split(':').pop()===String(t.ticker).split(':').pop()&&Number(s.time_frame)===Number(t.time_frame));if(!s)throw Error('Matching cached source missing');return normalizeEvidence(s,state.date,t.ticker,t.time_frame,captured.trades.find(r=>r.id===t.id)?.chart_annotations?.position_tick_size);}};
 }
 const ready=await load(path.join(pack,'chart-ready.json')),raw=await fs.readFile(path.join(pack,'frozen.json'),'utf8');
 if(ready.capture_kind==='replay_fills'){
  if(!ready.chart_released)throw Error('Chart release must be verified first');
  for(const [file,digest] of Object.entries(ready.sealed_file_hashes||{}))if(sha(await fs.readFile(path.join(pack,file)))!==digest)throw Error('Sealed replay pack changed: '+file);
  const frozen=JSON.parse(raw),ledger=frozen.ledger;
  if(frozen.capture_kind!=='replay_fills'||ledger.date!==ready.date||!ledger.reconciliation.verified)throw Error('Replay ledger identity/reconciliation mismatch');
  return {page_type:'backtest',capture_kind:'replay_fills',date:ready.date,structured:true,
    ordered:ledger.trades.map((t,i)=>({number:i+1,source_id:t.source_id,ticker:t.ticker,direction:t.direction,entry_candle:t.entry_candle})),
    trades:ledger.trades,evidenceFor:t=>({...normalizeEvidence(frozen.evidence,ready.date,t.ticker,ledger.time_frame,ledger.instrument.tick_size),
      session:{verified:false,calendar_source:'futures_session_boundaries_not_verified',exchange_timezone:ledger.instrument.timezone,exchange_session:ledger.instrument.session},
      instrument:ledger.instrument,execution_ledger:t})};
 }
 if(!ready.chart_released||sha(raw)!==ready.frozen_sha256)throw Error('Frozen capture integrity/release check failed');
 const frozen=JSON.parse(raw),cache=frozen.evidence;
 if(!cache)throw Error('Frozen research evidence missing');
 return {page_type:'backtest',date:ready.date,structured:ready.questionnaire_version===1,ordered:frozen.payload.trades.map((t,i)=>({number:i+1,source_id:t.source_id,ticker:t.ticker,type:t.type,entry_candle:t.entry_candle})),trades:frozen.payload.trades,evidenceFor:t=>normalizeEvidence(cache,ready.date,t.ticker,t.time_frame,cache.instrument?.tick_size)};
}
export async function prepare(pack){
 const info=await inspectPack(pack);if(!info.structured)throw Error('Existing legacy captures retain their original notes mode');
 const result={version:1,date:info.date,page_type:info.page_type,pack_id:path.basename(pack),user_finished:false,note_summary_required:true,prompts:capturePrompts(info.page_type),raw_dictation:'',trades:info.ordered.map(t=>({number:t.number,source_id:t.source_id,...(t.trade_id?{trade_id:t.trade_id}:{}),document:{version:1,pack_id:path.basename(pack),source_id:t.source_id,note_summary:'',answers:captureAnswers(info.page_type),references:{direction:t.direction||(t.type.toLowerCase()==='call'?'long':'short')},observations:{obstacles:[],stop_changes:[],management_events:[]},exceptions:[]}}))};
 await write(path.join(pack,'review-input.json'),result);return {date:info.date,trades:info.ordered,prompts:capturePrompts(info.page_type),questionnaire_version:1,tradingview_used:false};
}
export async function assemble(pack,inputPath){
 const info=await inspectPack(pack),raw=await fs.readFile(inputPath,'utf8'),input=JSON.parse(raw);
 if(!info.structured||input.version!==1||input.date!==info.date||input.page_type!==info.page_type||input.user_finished!==true||!Array.isArray(input.trades)||input.trades.length!==info.ordered.length)throw Error('Complete mapped answers and explicit instruction to finish required');
 const seen=new Set();const rows=[];
 for(const n of input.trades){const t=info.ordered.find(t=>t.number===n.number&&t.source_id===n.source_id);if(!t||seen.has(n.source_id))throw Error('Frozen question mapping changed or duplicated');seen.add(n.source_id);
  const doc=shared.validateReview(n.document);
  if(input.note_summary_required===true&&!doc.note_summary?.trim()&&n.no_note!==true)throw Error('Trade '+n.number+': provide a summary of the user notes or explicit no_note before finishing');
  if(Object.values(doc.answers).some(a=>a.status==='missing'&&a.reason==='Not supplied'))throw Error('Unanswered topics remain: mark explicitly unknown, skipped or not applicable before finishing');
  if(doc.pack_id!==path.basename(pack)||doc.source_id!==t.source_id)throw Error('Document source mapping mismatch');
  const trade=info.trades.find(x=>String(x.id)===t.source_id||x.source_id===t.source_id),evidence=info.evidenceFor(trade);
  rows.push({...t,document:doc,evidence,evidence_hash:hash(evidence),research:info.capture_kind==='replay_fills'
    ? {status:'unavailable',reason:'SPY fixed-stop research policy is not validated for futures'} : shared.compareResearch(doc,evidence)});
 }
 const sealed={version:1,status:'answers_ready',date:info.date,page_type:info.page_type,pack_id:path.basename(pack),input_sha256:sha(raw),raw_dictation:input.raw_dictation||'',tradingview_used:false,trades:rows};
 await seal(path.join(pack,'structured-input.json'),raw);
 await seal(path.join(pack,'structured-answers.json'),JSON.stringify(sealed,null,2));
 await seal(path.join(pack,'structured-ready.json'),JSON.stringify({version:1,sha256:sha(await fs.readFile(path.join(pack,'structured-answers.json'))),input_sha256:sealed.input_sha256,status:'answers_ready'},null,2));
 return {date:info.date,count:rows.length,status:'answers_ready',tradingview_used:false};
}
export async function publish(pack,{base=process.env.TRADING_API_URL||process.env.TRADING_BACKEND_URL||'http://100.125.89.9:5555',request=fetch,services={}}={}){
 const info=await inspectPack(pack);
 if(info.capture_kind==='replay_fills'){
  const res=await request(base.replace(/\/$/,'')+'/backtest/capture-review/registry');
  const registry=await res.json();
  if(!res.ok||!registry.ready||registry.capabilities?.replay_fills!==true)throw Error('A fill-aware backtest backend is required before publishing; local replay evidence is retained');
 }
 const ready=await load(path.join(pack,'structured-ready.json')),raw=await fs.readFile(path.join(pack,'structured-answers.json'));
 if(!info.structured||sha(raw)!==ready.sha256||sha(await fs.readFile(path.join(pack,'structured-input.json')))!==ready.input_sha256)throw Error('Structured answer seal changed');
 const answers=JSON.parse(raw);
 const api=async(route,body)=>{const res=await request(base.replace(/\/$/,'')+route,{method:body?'PUT':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const json=await res.json();if(!res.ok)throw Error(json.error||`Capture save failed (${res.status})`);return json;};
 const attempt=await fs.mkdtemp(path.join(os.tmpdir(),'capture-review-save-'));
 const progress=[];let mapped=answers.trades,completed=false;
 try{
  mapped=answers.trades;
  if(info.page_type==='journal'){
   const defaults=await import('./journal-capture.mjs');const {snapshotDay=defaults.snapshotDay,applyReview=defaults.applyReview}=services;const {resumePack}=await import('./journal-pack.mjs');
   await snapshotDay(info.date,path.join(attempt,'server'),{base,request});
   const notes={date:info.date,trades:mapped.map(t=>({number:t.number,trade_id:t.trade_id,text:'',no_note:true})),daily:''};
   await write(path.join(attempt,'notes.json'),notes);
   await resumePack(pack,path.join(attempt,'server/before.json'),path.join(attempt,'review.json'),path.join(attempt,'notes.json'));
   const review=await load(path.join(attempt,'review.json')),snapshot=await load(path.join(attempt,'server/before.json'));
   await applyReview(review,snapshot,{base,request,apply:false,preserveLegacyTags:true});await applyReview(review,snapshot,{base,request,apply:true,preserveLegacyTags:true});
  }else if(info.capture_kind==='replay_fills'){
   const {snapshotDay}=await import('./verify-tags.mjs');
   if(!await exists(path.join(pack,'before.json')))await snapshotDay(info.date,pack,{base,request});
   const baseline=await load(path.join(pack,'before.json'));if(baseline.image_failures?.length)throw Error('Complete app recovery images required before replay publication');
   const frozen=await load(path.join(pack,'frozen.json')),snapshot=await load(path.join(pack,'replay-raw.json'));
   const payload={capture_kind:'replay_fills',capture_date:info.date,source_snapshot:snapshot,trade_screenshots:await Promise.all(frozen.screenshot_mapping.map(async s=>({source_id:s.source_id,screenshot:{mime_type:'image/png',base64:(await fs.readFile(path.join(pack,s.file))).toString('base64')}})))};
   await seal(path.join(pack,'replay-save-request.json'),JSON.stringify(payload,null,2));
   const send=services.publishReplay|| (async()=>{const {publishReplayCapture}=await import('../src/core/trading-sync.js');return publishReplayCapture(payload,frozen.idempotency_key,{_deps:{fetch:(url,options)=>request(base.replace(/\/$/,'')+new URL(url).pathname,options)}});});
   const result=await send(payload,frozen.idempotency_key);
   if(!Array.isArray(result.records)||result.records.length!==mapped.length)throw Error('Replay source-to-record mapping incomplete; retain the pack');
   mapped=mapped.map(t=>{const r=result.records.find(r=>r.tradingview_source_id===t.source_id),original=info.trades.find(x=>x.source_id===t.source_id);
    if(!r?.id||!r.replay_execution||r.replay_execution.net_pnl!==original.net_pnl||hash(r.replay_execution.transactions)!==hash(original.transactions)||hash(r.replay_execution.matched_lots)!==hash(original.matched_lots))throw Error('Saved replay execution did not reconcile');
    return {...t,trade_id:r.id};});
   const persisted=await api('/backtest/');
   for(const t of mapped){const r=persisted.find(r=>r.id===t.trade_id),original=info.trades.find(x=>x.source_id===t.source_id);if(!r||r.replay_execution?.net_pnl!==original.net_pnl||hash(r.replay_execution?.transactions)!==hash(original.transactions)||hash(r.replay_execution?.matched_lots)!==hash(original.matched_lots))throw Error('Independent replay execution read-back failed');}
   await fs.writeFile(path.join(pack,'replay-save-result.json'),JSON.stringify(result,null,2));
  }else{
   const {assembleNotes,publishDay}=await import('./backtest-freeze.mjs');const defaults=await import('./verify-tags.mjs');const {snapshotDay=defaults.snapshotDay}=services;
   if(!await exists(path.join(pack,'notes-ready.json'))){const notes={date:info.date,trades:mapped.map(t=>({number:t.number,source_id:t.source_id,no_note:true})),daily:''};await write(path.join(attempt,'notes.json'),notes);await assembleNotes(pack,path.join(attempt,'notes.json'));}
   if(!await exists(path.join(pack,'before.json')))await snapshotDay(info.date,pack,{base,request});
   const result=await publishDay(pack,{publish:services.publishBacktest|| (async bundle=>{const {publishFrozenBacktestDay}=await import('../src/core/trading-sync.js');return publishFrozenBacktestDay(bundle,{_deps:{fetch:(url,options)=>request(base.replace(/\/$/,'')+new URL(url).pathname,options)}});})});const records=result.records||result.result?.records;
   if(!Array.isArray(records))throw Error('Publish result lacks exact source-to-imported-ID mapping; retain pack');
   mapped=mapped.map(t=>{const record=records.find(r=>r.tradingview_source_id===t.source_id);if(!record)throw Error('Rejected or duplicate source needs review: '+t.source_id);return {...t,trade_id:record.id};});
  }
  const dailyBefore=await api('/'+info.page_type+'/daily-notes');
  const requestsPath=path.join(pack,'structured-save-requests.json');
  const savedRequests=await exists(requestsPath)?await load(requestsPath):{};
  for(const t of mapped){const current=await api(`/${info.page_type}/${t.trade_id}/capture-review`);
   const document={...t.document,evidence_hash:t.evidence_hash};
   const candidate={expected_revision:current.revision,evidence_fingerprint:current.evidence_fingerprint,trade_fingerprint:current.trade_fingerprint,request_id:answers.pack_id+'/'+t.source_id+'/'+hash({document,evidence:t.evidence}),document,evidence:t.evidence};
   if(savedRequests[t.source_id]?.trade_id&&savedRequests[t.source_id].trade_id!==t.trade_id)throw Error('Imported source identity changed before retry');
   if(!savedRequests[t.source_id]){savedRequests[t.source_id]={trade_id:t.trade_id,payload:candidate};await fs.writeFile(requestsPath,JSON.stringify(savedRequests,null,2));}
   const payload=savedRequests[t.source_id].payload;
   if(payload.request_id!==candidate.request_id||hash({document:payload.document,evidence:payload.evidence})!==hash({document:candidate.document,evidence:candidate.evidence}))throw Error('Saved request differs from sealed answers/evidence');
   const result=await api(`/${info.page_type}/${t.trade_id}/capture-review`,payload),verify=await api(`/${info.page_type}/${t.trade_id}/capture-review`);
   if(result.document?.stale||verify.document?.stale||verify.revision!==result.revision||hash(verify.document)!==hash(result.document))throw Error('Structured review read-back mismatch: '+t.source_id);
   const savedRows=await api('/'+info.page_type+'/'),savedTrade=savedRows.find(row=>row.id===t.trade_id);
   if(!savedTrade)throw Error('Saved trade missing: '+t.source_id);
   const savedTags=typeof savedTrade.tags==='string'?JSON.parse(savedTrade.tags):savedTrade.tags||[];
   if(hash(savedTags.filter(k=>k.startsWith('capture_v1__')).sort())!==hash(shared.projectedTags(verify.document)))throw Error('Checklist tag read-back mismatch: '+t.source_id);
   if(typeof document.note_summary==='string'&&document.note_summary.trim()&&!String(savedTrade.notes||'').includes(shared.summaryNotes('',document.note_summary)))throw Error('Trade note summary read-back mismatch: '+t.source_id);
   progress.push({number:t.number,trade_id:t.trade_id,revision:verify.revision,verified:true});
   await fs.writeFile(path.join(pack,'structured-save-progress.json'),JSON.stringify(progress,null,2));
  }
  if(hash(dailyBefore)!==hash(await api('/'+info.page_type+'/daily-notes')))throw Error('Daily notes/resources changed during save; inspect before retrying');
  const completion={date:info.date,status:'complete',tradingview_used:false,trades:progress,verification:{method:'api',notes_verified:true,checklist_tags_verified:true,review_readback_verified:true,backup_restore_required:false,screen_checks_required:false}};
  await fs.writeFile(path.join(pack,'structured-save-result.json'),JSON.stringify(completion,null,2));
  await fs.writeFile(path.join(pack,'structured-complete.json'),JSON.stringify(completion,null,2));
  completed=true;
  return completion;
 }catch(error){await fs.writeFile(path.join(pack,'structured-save-failure.json'),JSON.stringify({error:error.message,attempt,progress},null,2));throw error;}
 finally{if(completed)await fs.rm(attempt,{recursive:true,force:true});}
}
export async function verifyVisible(pack,verificationPath){
 const result=await load(path.join(pack,'structured-save-result.json')),proof=await load(verificationPath);
 if(result.status!=='api_verified_ui_pending'||proof.date!==result.date||proof.tradingview_used!==false||proof.backup_verified!==true||!proof.filter_statistics_verified||!Array.isArray(proof.trades))throw Error('API result, visible filter/statistic and backup verification required');
 for(const t of result.trades){const p=proof.trades.find(p=>p.trade_id===t.trade_id);if(!p||p.revision!==t.revision||p.checklist_verified!==true||p.tags_verified!==true||!p.evidence)throw Error('Visible selection verification missing: '+t.trade_id);}
 await write(path.join(pack,'structured-complete.json'),{...result,status:'complete',verification:proof});
 return {status:'complete',trades:result.trades,tradingview_used:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [command,pack,input]=process.argv.slice(2);try{console.log(JSON.stringify(await (command==='preflight'?preflight(pack):command==='prepare'?prepare(pack):command==='assemble'?assemble(pack,input):command==='publish'?publish(pack):command==='verify-visible'?verifyVisible(pack,input):Promise.reject(Error('Usage: capture-review.mjs preflight journal|backtest | prepare PACK | assemble PACK ANSWERS_JSON | publish PACK | verify-visible PACK PROOF_JSON'))),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
