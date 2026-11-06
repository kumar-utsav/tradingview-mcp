import {capturedTicks,ticksNote} from '../src/core/captured-ticks.js';
import {positionRR} from '../src/core/position-rr.js';
// Publish sealed replay evidence and plain notes, without checklist analysis.
import fs from 'node:fs/promises';
import {isDeepStrictEqual as equal} from 'node:util';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {summaryHtml,appendSummary} from './capture-notes.mjs';
import {inspectPack} from './capture-review.mjs';
import {publishReplayCapture} from '../src/core/trading-sync.js';
import {cleanupCompletedPack} from './capture-cleanup.mjs';
import {buildReplayLedger,ledgerByEntry,applyReplayFeeModel} from '../src/core/replay-capture.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
export async function publishNotes(pack,inputFile,{base=process.env.TRADING_API_URL||process.env.TRADING_BACKEND_URL||'http://100.125.89.9:5555',request=fetch}={}){
 const amendment=await read(path.join(pack,'fee-amendment.json')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 const info=await inspectPack(pack),input=await read(inputFile);
 if(info.capture_kind!=='replay_fills')throw Error('Drawing packs use backtest-freeze assemble/publish');
 if(input.date!==info.date||input.user_finished!==true||input.trades?.length!==info.ordered.length)throw Error('Complete notes and finish instruction required');
 const seen=new Set();for(const t of input.trades){if(!info.ordered.some(o=>o.number===t.number&&o.source_id===t.source_id)||seen.has(t.source_id)||(!t.text?.trim()&&!t.no_note))throw Error('Note mapping/coverage mismatch');seen.add(t.source_id);}
 const api=async(route,body)=>{const r=await request(base.replace(/\/$/,'')+route,{method:body?'PUT':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('API '+route+': '+r.status);return r.json();};
 const registry=await api('/backtest/capture-notes/registry');if(!registry.ready||!registry.capabilities?.replay_fills)throw Error('Fill-aware backend unavailable');
 const frozen=await read(path.join(pack,'frozen.json'));
 const sourceSnapshot=await read(path.join(pack,'replay-raw.json'));
 if(amendment && (amendment.user_authorized!==true || amendment.original_snapshot_sha256!==hash(await fs.readFile(path.join(pack,'replay-raw.json'))) || !amendment.fee_model))throw Error('Explicit fee amendment must match the sealed original snapshot');
 const feeModel=amendment?.fee_model || frozen.fee_model;
 if(feeModel && registry.capabilities?.modeled_replay_fees!==true)throw Error('App-side modeled replay fees are not supported by this backend; retain the pack');
 let expectedLedger=feeModel?applyReplayFeeModel(buildReplayLedger(sourceSnapshot,info.date),feeModel):frozen.ledger;
 if(frozen.ledger.grouping==='per_entry')expectedLedger=ledgerByEntry(expectedLedger);
 expectedLedger=JSON.parse(JSON.stringify(expectedLedger));
 if(frozen.ledger.grouping==='per_entry'&&registry.capabilities?.replay_entries!==true)throw Error('Entry-aware replay backend unavailable');
 for(const trade of info.trades){if(trade.rr!==positionRR({position_entity_id:trade.drawing?.id,position_rr:trade.position_rr}))throw Error('Missing matched position-tool RR');}
 const payload={capture_kind:'replay_fills',grouping:frozen.ledger.grouping,capture_date:info.date,source_snapshot:sourceSnapshot,...(feeModel?{fee_model:feeModel}:{}),trade_screenshots:await Promise.all(frozen.screenshot_mapping.map(async s=>({source_id:s.source_id,screenshot:{mime_type:'image/png',base64:(await fs.readFile(path.join(pack,s.file))).toString('base64')}})))};
 for(const row of input.trades){if(row.text?.trim()&&row.no_note===true)throw Error('Conflicting supplied notes and no_note');summaryHtml(row.text);}summaryHtml(input.daily);
 const sealedPath=path.join(pack,'notes-only-input.json'),raw=JSON.stringify(input,null,2);
 try{await fs.writeFile(sealedPath,raw,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||await fs.readFile(sealedPath,'utf8')!==raw)throw Error('Sealed notes differ; use an amendment');}
 const result=await publishReplayCapture(payload,frozen.idempotency_key,{_deps:{fetch:(url,options)=>request(base.replace(/\/$/,'')+new URL(url).pathname,options)}});
 if(result.records?.length!==info.ordered.length)throw Error('Incomplete source mapping');
 const baselinePath=path.join(pack,'notes-only-baseline.json');let baseline;
 try{baseline=await read(baselinePath);}catch(e){if(e.code!=='ENOENT')throw e;baseline={trades:await api('/backtest/'),daily:await api('/backtest/daily-notes')};await fs.writeFile(baselinePath,JSON.stringify(baseline,null,2),{flag:'wx'});}
 const append=appendSummary;
 const progress=[];
 for(const t of input.trades){const saved=result.records.find(r=>r.tradingview_source_id===t.source_id),original=info.trades.find(r=>r.source_id===t.source_id),before=baseline.trades.find(r=>r.id===saved?.id);if(!saved?.id||!before)throw Error('Missing mapped baseline');
  const expectedExecution=expectedLedger.trades.find(r=>r.source_id===t.source_id);
  const metric=capturedTicks(original.matched_lots,original.instrument?.tick_size||frozen.ledger.instrument.tick_size);
  if(original.tick_capture&&!equal(original.tick_capture,metric))throw Error('Captured tick evidence mismatch');
  const expected=append(append(before.notes,t.text),ticksNote(metric)),current=(await api('/backtest/')).find(r=>r.id===saved.id);
  if(current.notes!==before.notes&&current.notes!==expected)throw Error('Concurrent note edit');
  if(current.notes!==expected)await api('/backtest/'+saved.id,{propName:'notes',value:expected});
  if(current.rr!==before.rr&&current.rr!==original.rr)throw Error('Concurrent RR edit');
  if(current.rr!==original.rr)await api('/backtest/'+saved.id,{propName:'rr',value:original.rr});
  const verify=(await api('/backtest/')).find(r=>r.id===saved.id);
  if(verify.rr!==original.rr||verify.notes!==expected||!equal(verify.tags,before.tags)||!equal(verify.replay_execution?.transactions,expectedExecution.transactions)||!equal(verify.replay_execution?.matched_lots,expectedExecution.matched_lots)||verify.replay_execution?.net_pnl!==expectedExecution.net_pnl)throw Error('Notes/tags/execution verification failed');
  if(feeModel && (!equal(verify.replay_execution?.fee_model,expectedLedger.fee_model)||!equal(verify.replay_execution?.source_report,sourceSnapshot.report)||!equal(verify.replay_execution?.commission_adjustment,expectedExecution.commission_adjustment)||verify.replay_execution?.commission!==expectedExecution.commission||verify.replay_execution?.gross_pnl!==expectedExecution.gross_pnl||!equal(verify.replay_execution?.position_summary,expectedExecution.position_summary)||verify.setup_outcome!==(expectedExecution.outcome==='Breakeven'?'BE':expectedExecution.outcome)))throw Error('App-side fees/original report/outcome verification failed');
  const image=await request(base.replace(/\/$/,'')+'/backtest/'+saved.id+'/image');if(!image.ok||hash(Buffer.from((await image.json()).chart,'base64'))!==hash(await fs.readFile(path.join(pack,frozen.screenshot_mapping.find(s=>s.source_id===t.source_id).file))))throw Error('Screenshot read-back failed');
  progress.push({number:t.number,trade_id:saved.id,verified:true});
 }
 const dated=rows=>rows.find(r=>(String(r.date).slice(0,10)===info.date||new Date(r.date).toISOString().slice(0,10)===info.date));
 const dailyBefore=dated(baseline.daily),expectedDaily=append(dailyBefore?.notes,input.daily),currentDaily=dated(await api('/backtest/daily-notes'));
 if(currentDaily?.notes!==dailyBefore?.notes&&currentDaily?.notes!==expectedDaily)throw Error('Concurrent daily note edit');
 if(input.daily&&currentDaily?.notes!==expectedDaily)await api('/backtest/daily-notes/'+info.date,{notes:expectedDaily});
 const daily=dated(await api('/backtest/daily-notes'));
 if(input.daily&&daily?.notes!==expectedDaily)throw Error('Daily note verification failed');
 if(JSON.stringify(daily?.external_resources||[])!==JSON.stringify(dailyBefore?.external_resources||[]))throw Error('Daily resources changed');
 const complete={status:'complete',date:info.date,trades:progress,ticks_verified:true,rr_verified:true,notes_verified:true,screenshots_verified:true,executions_verified:true,...(feeModel?{modeled_fees_verified:true,net_pnl:expectedLedger.net_pnl}:{}),checklist_analysis:false,existing_tags_preserved:true,tradingview_used:false};
 await fs.writeFile(path.join(pack,'notes-only-complete.json'),JSON.stringify(complete,null,2));
 await cleanupCompletedPack(pack);
 return complete;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)publishNotes(...process.argv.slice(2)).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
