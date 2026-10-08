import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {freezeBacktestDay,publishFrozenBacktestDay} from '../src/core/trading-sync.js';
import {disconnect} from '../src/connection.js';
import {isoDate} from './verify-tags.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
async function durableWrite(file, value) {
  const handle = await fs.open(file,'wx');
  try { await handle.writeFile(value); await handle.sync(); }
  finally { await handle.close(); }
}

export async function freezeDay(date, directory, {capture=freezeBacktestDay,notesMode='chart'}={}) {
  date=isoDate(date);
  directory=path.resolve(directory);
  await fs.mkdir(path.dirname(directory),{recursive:true});
  await fs.mkdir(directory); // Never reuse/overwrite another run.
  const bundle=await capture({date,notesMode,persist:async (phase,data)=>{
    await durableWrite(path.join(directory,phase+'.json'),JSON.stringify(data,null,2));
    if(phase==='recovery')await durableWrite(path.join(directory,'annotated-start.png'),Buffer.from(data.annotated_screenshot.base64,'base64'));
    if(phase==='frozen'){
      await durableWrite(path.join(directory,'day.png'),Buffer.from(data.payload.screenshot.base64,'base64'));
      for(let i=0;i<data.payload.trade_screenshots.length;i++){
        await durableWrite(path.join(directory,`position-${i+1}.png`),Buffer.from(data.payload.trade_screenshots[i].screenshot.base64,'base64'));
      }
      await durableWrite(path.join(directory,'chart-evidence.json'),JSON.stringify({
        ...data.evidence, note_audit:data.note_audit, trades:data.payload.trades,
        daily_note:data.payload.daily_note,
      },null,2));
    }
  }});
  const frozen=await fs.readFile(path.join(directory,'frozen.json'),'utf8');
  const ready={date,notes_mode:notesMode,chart_released:true,ingestion_complete:false,
    trade_count:bundle.payload.trades.length,idempotency_key:bundle.idempotency_key,
    frozen_sha256:digest(frozen),released_at:new Date().toISOString()};
  if(notesMode==='chat')await durableWrite(path.join(directory,'pending-notes.json'),JSON.stringify({
    date,status:'awaiting_chat_notes',frozen_sha256:ready.frozen_sha256,
    trades:bundle.payload.trades.map((t,i)=>({number:i+1,source_id:t.source_id,
      ticker:t.ticker,type:t.type,entry_candle:t.entry_candle,exit_candle:t.exit_candle,rr:t.rr,
      screenshot:`position-${i+1}.png`}))
  },null,2));
  await durableWrite(path.join(directory,'chart-ready.json'),JSON.stringify(ready,null,2));
  return {...ready,directory,message:notesMode==='chat'
    ? 'TradingView is free to use. Send numbered trade notes in chat; nothing has been saved to the server.'
    : 'Chart evidence secured. You can move on in TradingView now; saving and review continue from this bundle.'};
}

export async function assembleNotes(directory,notesFile) {
  const frozen=await fs.readFile(path.join(directory,'frozen.json'),'utf8');
  const ready=JSON.parse(await fs.readFile(path.join(directory,'chart-ready.json'),'utf8'));
  const pending=JSON.parse(await fs.readFile(path.join(directory,'pending-notes.json'),'utf8'));
  const raw=await fs.readFile(notesFile,'utf8'),notes=JSON.parse(raw),bundle=JSON.parse(frozen);
  if(ready.notes_mode!=='chat'||!ready.chart_released||ready.frozen_sha256!==digest(frozen)
    ||pending.frozen_sha256!==ready.frozen_sha256||pending.date!==ready.date
    ||ready.date!==bundle.payload.capture_date||ready.idempotency_key!==bundle.idempotency_key
    ||!Array.isArray(pending.trades)||pending.trades.length!==bundle.payload.trades.length
    ||pending.trades.some((t,i)=>t.number!==i+1||t.source_id!==bundle.payload.trades[i].source_id)
    ||notes.date!==ready.date||!Array.isArray(notes.trades)
    ||notes.trades.length!==pending.trades.length||!pending.trades.length)throw Error('Notes date/coverage or frozen checksum mismatch');
  const seen=new Set();
  for(const n of notes.trades){
    const mapped=pending.trades.find(t=>t.number===n.number);
    if(!mapped||seen.has(n.number)||n.source_id!==mapped.source_id
      ||(n.no_note===true ? Boolean(n.text) : typeof n.text!=='string'||!n.text.trim()))throw Error('Each trade needs unique mapped notes or explicit no_note');
    seen.add(n.number);
    const trade=bundle.payload.trades[n.number-1];
    if(trade.source_id!==mapped.source_id)throw Error('Frozen trade mapping changed');
    trade.notes=n.no_note===true?'':n.text;
  }
  if(notes.daily!==undefined&&typeof notes.daily!=='string')throw Error('Daily note must be text');
  bundle.payload.daily_note=notes.daily?.trim()?notes.daily:null;
  await durableWrite(path.join(directory,'chat-notes.json'),raw);
  const assembled=JSON.stringify(bundle,null,2);
  await durableWrite(path.join(directory,'assembled.json'),assembled);
  const state={date:ready.date,status:'notes_ready',frozen_sha256:ready.frozen_sha256,
    notes_sha256:digest(raw),assembled_sha256:digest(assembled),idempotency_key:bundle.idempotency_key};
  await durableWrite(path.join(directory,'notes-ready.json'),JSON.stringify(state,null,2));
  return state;
}

export async function publishDay(directory,{publish=publishFrozenBacktestDay}={}) {
  const frozen=await fs.readFile(path.join(directory,'frozen.json'),'utf8');
  const ready=JSON.parse(await fs.readFile(path.join(directory,'chart-ready.json'),'utf8'));
  const before=JSON.parse(await fs.readFile(path.join(directory,'before.json'),'utf8'));
  let bundle=JSON.parse(frozen);
  if(ready.chart_released!==true||ready.frozen_sha256!==digest(frozen)
    ||(bundle.notes_mode&&ready.notes_mode!==bundle.notes_mode)
    ||ready.date!==bundle.payload.capture_date||before.date!==ready.date
    ||ready.idempotency_key!==bundle.idempotency_key)throw Error('Ready marker/snapshot/bundle mismatch; do not publish');
  if(ready.notes_mode==='chat') {
    const notesReady=JSON.parse(await fs.readFile(path.join(directory,'notes-ready.json'),'utf8'));
    const assembled=await fs.readFile(path.join(directory,'assembled.json'),'utf8');
    const notes=await fs.readFile(path.join(directory,'chat-notes.json'),'utf8');
    if(notesReady.date!==ready.date||notesReady.status!=='notes_ready'
      ||notesReady.frozen_sha256!==ready.frozen_sha256||notesReady.assembled_sha256!==digest(assembled)
      ||notesReady.notes_sha256!==digest(notes)||notesReady.idempotency_key!==ready.idempotency_key)throw Error('Chat notes integrity mismatch');
    bundle=JSON.parse(assembled);
    const original=JSON.parse(frozen),withoutNotes=value=>{
      const copy=structuredClone(value);copy.payload.daily_note=null;
      for(const t of copy.payload.trades)t.notes='';return copy;
    };
    if(JSON.stringify(withoutNotes(bundle))!==JSON.stringify(withoutNotes(original)))throw Error('Only chat notes may change frozen capture');
  }
  const result=await publish(bundle);
  // A retry must use the same frozen bundle/key, never recapture the current chart.
  await durableWrite(path.join(directory,`publish-${Date.now()}-${randomUUID()}.json`),JSON.stringify(result,null,2));
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [command,dateOrDirectory,directory]=process.argv.slice(2);
  try {
    const result=command==='freeze' || command==='freeze-chat'
      ? await freezeDay(dateOrDirectory,directory,{notesMode:command==='freeze-chat'?'chat':'chart'})
      : command==='assemble' ? await assembleNotes(dateOrDirectory,directory)
      : command==='publish' ? await publishDay(dateOrDirectory)
      : (()=>{throw Error('Usage: backtest-freeze.mjs freeze-chat|freeze YYYY-MM-DD NEW_DIRECTORY | assemble DIRECTORY NOTES_JSON | publish DIRECTORY');})();
    console.log(JSON.stringify(result,null,2));
  } finally {await disconnect();}
}
