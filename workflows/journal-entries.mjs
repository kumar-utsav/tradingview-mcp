import {isFuturesJournal} from './journal-instrument.mjs';
// Build temporary annotation views; broker journal rows and their financial fields are never split.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {entryCandleTime} from './journal-capture.mjs';
const require=createRequire(import.meta.url);
export const {journalEntries,journalSourceFingerprint}=require(path.join(process.env.TRADING_PROJECT_ROOT||path.resolve(import.meta.dirname,'../../trading'),'backend/utils/journalEntries.js'));
const clock=time=>new Intl.DateTimeFormat('en-GB',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(time*1000));
export function entryAnnotationSnapshot(snapshot){
 const trades=[],mapping=[];let id=0;
 for(const parent of snapshot.trades){
  const ledger=journalEntries(parent),step=Number(parent.time_frame)*60;
  if(!isFuturesJournal(parent)&&!['call','put'].includes(String(parent.type).toLowerCase()))throw Error('Journal position-tool policy currently requires Call or Put; do not apply a stock/option stop policy to futures.');
  const first=Math.min(...ledger.entries.map(e=>Date.parse(e.entry_time)/1000));
  const offset=isFuturesJournal(parent)?0:Math.floor(first/step)*step-entryCandleTime(parent);
  if(offset<0||offset%step!==0)throw Error('Invalid parent entry anchor offset');
  for(const entry of ledger.entries){const virtualId=++id,start=entry.entry_index===1&&!isFuturesJournal(parent)?parent.entry_candle:clock(Math.floor(Date.parse(entry.entry_time)/1000/step)*step-offset);
   trades.push({...parent,id:virtualId,journal_trade_id:parent.id,entry_key:entry.entry_key,entry_candle:start,transactions:entry.transactions,quantity:entry.quantity,profit_loss:null,notes:'',tags:[],has_chart:false,rr:null});
   mapping.push({virtual_id:virtualId,journal_id:parent.id,entry_key:entry.entry_key,entry_index:entry.entry_index,entry_count:entry.entry_count,source_fingerprint:ledger.source_fingerprint,anchor_rule:isFuturesJournal(parent)?'actual_first_fill_candle':entry.entry_index===1?'stored_parent_entry_candle':'preserve_parent_entry_to_first_fill_offset',entry_candle:start,entry_time:entry.entry_time,gross_pnl:entry.gross_pnl});
  }
 }
 return {snapshot:{...snapshot,trades,tags:[],groups:[],chart_hashes:Object.fromEntries(trades.map(t=>[t.id,null]))},mapping};
}
export async function prepareEntryAnnotations(snapshotPath,output){
 const source=JSON.parse(await fs.readFile(snapshotPath,'utf8')),views=entryAnnotationSnapshot(source);
 const captureViews={...views.snapshot,trades:views.snapshot.trades.filter(t=>views.mapping.find(e=>e.virtual_id===t.id).entry_count>1)};
 await fs.mkdir(output);await fs.writeFile(path.join(output,'entry-snapshot.json'),JSON.stringify(captureViews,null,2),{flag:'wx'});await fs.writeFile(path.join(output,'entry-mapping.json'),JSON.stringify({date:source.date,source_snapshot:path.resolve(snapshotPath),entries:views.mapping},null,2),{flag:'wx'});
 return {entry_snapshot:path.resolve(output,'entry-snapshot.json'),mapping:path.resolve(output,'entry-mapping.json'),entry_count:views.mapping.length,additional_screenshots:captureViews.trades.length,reused_single_entry_screenshots:views.mapping.length-captureViews.trades.length,tradingview_used:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)prepareEntryAnnotations(...process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
