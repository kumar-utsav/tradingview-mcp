import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fingerprint, isoDate, reviewTemplate, positionRR, validateChartAnnotations } from './journal-capture.mjs';

// Deliberately no TradingView connection or API calls: continuation uses files only.
const load = async file => JSON.parse(await fs.readFile(file,'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const png = bytes => bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
const symbol = ticker => String(ticker).split(':').pop().toUpperCase();
const financialFingerprint = trade => fingerprint({...trade,notes:null,tags:null,rr:null,has_chart:null});
const sameIDs = (a,b) => JSON.stringify(a.map(x=>x.id).sort((x,y)=>x-y))===JSON.stringify(b.map(x=>x.id).sort((x,y)=>x-y));
const escape = text => text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');

function checkEvidence(evidence,snapshot,review) {
  if(isoDate(evidence.date)!==isoDate(snapshot.date)||!evidence.captured_at||!Array.isArray(evidence.sources))throw Error('Dated chart evidence required');
  for(const row of review.trades) {
    const trade=snapshot.trades.find(x=>x.id===row.id);
    const source=evidence.sources.find(x=>symbol(x.ticker)===symbol(trade.ticker)&&Number(x.time_frame)===Number(trade.time_frame));
    if(!source?.bars?.length)throw Error(`Cached candles required: ${trade.id}`);
    for(const bar of source.bars)if(![bar.time,bar.open,bar.high,bar.low,bar.close].every(Number.isFinite)||bar.low>bar.high)throw Error('Invalid cached candle');
    const a=row.chart_annotations,step=Number(trade.time_frame)*60;
    const times=[a.position_start_candle_time,...trade.transactions.map(t=>Math.floor(Date.parse(t.filledTime)/1000/step)*step)];
    if(times.some(time=>!source.bars.some(b=>b.time===time)))throw Error(`Cached entry/fill candle missing: ${trade.id}`);
    for(let time=Math.min(...times.slice(1));time<=a.position_end_candle_time;time+=step)if(!source.bars.some(b=>b.time===time))throw Error(`Cached trade-window gap: ${trade.id}`);
    const entry=source.bars.find(b=>b.time===a.position_start_candle_time);
    const short=a.position_tool==='short_position',window=source.bars.filter(b=>b.time>=Math.min(...times.slice(1))&&b.time<=a.position_end_candle_time);
    const extreme=short?Math.min(...window.map(b=>b.low)):Math.max(...window.map(b=>b.high));
    if(a.position_entry_price!==(short?entry.low:entry.high)||a.position_target_price!==extreme)throw Error(`Cached entry/MFE mismatch: ${trade.id}`);
    const mfe=source.bars.find(b=>b.time===a.position_mfe_candle_time);
    if(!mfe||(short?mfe.low:mfe.high)!==extreme)throw Error(`Cached MFE candle mismatch: ${trade.id}`);
    for(const key of ['pm','pd','5m','15m']) {
      const range=source.ranges?.[key];
      if(range?.status==='unknown'&&range.reason?.trim())continue;
      if(range?.status!=='complete'||!range.source?.trim()||![range.from,range.to,range.low,range.high].every(Number.isFinite)||range.from>=range.to||range.low>range.high||!Number.isSafeInteger(range.bar_count)||range.bar_count<=0)throw Error(`Cache complete range or explicit unknown: ${trade.id}/${key}`);
      const date=isoDate(range.date);
      if(key==='pd'?date>=snapshot.date:date!==snapshot.date)throw Error(`Wrong cached range date: ${trade.id}/${key}`);
    }
  }
}

export async function createPack(config,outputDir) {
  const [snapshot,review,evidence,release]=await Promise.all([config.snapshot_path,config.review_path,config.evidence_path,config.release_path].map(load));
  const date=isoDate(snapshot.date);
  if(!snapshot.trades.length||review.skipped?.length||!sameIDs(snapshot.trades,review.trades)||new Set(review.trades.map(x=>x.id)).size!==review.trades.length)throw Error('A complete capture for every frozen trade is required');
  for(const key of ['chart_restored','user_drawings_preserved','temporary_annotations_removed','tradingview_released'])if(release[key]!==true)throw Error(`TradingView release verification required: ${key}`);
  for(const row of review.trades) {
    const trade=snapshot.trades.find(x=>x.id===row.id),c=row.chart_context;
    if(row.chart_reviewed!==true||!c||isoDate(c.date)!==date||symbol(c.ticker)!==symbol(trade.ticker)||Number(c.time_frame)!==Number(trade.time_frame)||c.entry_candle!==trade.entry_candle)throw Error(`Reviewed chart identity required: ${row.id}`);
    validateChartAnnotations(row,trade);
    if(row.chart_annotations.commentary_free!==true)throw Error(`Visually verify commentary-free PNG: ${row.id}`);
    if(row.rr!==positionRR(row.chart_annotations)||!row.rr_evidence?.trim())throw Error(`Native RR evidence required: ${row.id}`);
  }
  checkEvidence(evidence,snapshot,review);
  const images=await Promise.all(review.trades.map(async row=>{const bytes=await fs.readFile(row.chart_path);if(!png(bytes))throw Error(`PNG required: ${row.id}`);return {id:row.id,bytes,sha256:hash(bytes)};}));
  const ordered=[...snapshot.trades].sort((a,b)=>Math.min(...a.transactions.map(t=>Date.parse(t.filledTime)))-Math.min(...b.transactions.map(t=>Date.parse(t.filledTime)))||a.id-b.id).map((t,i)=>({number:i+1,trade_id:t.id,entry_candle:t.entry_candle,ticker:t.ticker,type:t.type}));
  const packDir=path.resolve(outputDir);
  await fs.mkdir(path.dirname(packDir),{recursive:true});
  await fs.mkdir(packDir); // Never overwrite a pending or completed pack.
  const imageHashes={};
  for(const image of images){const file=`trade-${image.id}.png`;await fs.writeFile(path.join(packDir,file),image.bytes,{flag:'wx'});imageHashes[image.id]=image.sha256;review.trades.find(x=>x.id===image.id).chart_path=path.join(packDir,file);}
  review.snapshot_path=path.join(packDir,'before.json');
  const sealedFiles={};
  for(const [file,value] of Object.entries({'before.json':snapshot,'captured-review.json':review,'evidence.json':evidence,'chart-release.json':release})){
    const bytes=JSON.stringify(value,null,2);await fs.writeFile(path.join(packDir,file),bytes,{flag:'wx'});sealedFiles[file]=hash(bytes);
  }
  const notes=`# Journal notes ${date}\n\nWrite under each trade heading, or give numbered notes in chat. Write NO NOTE to explicitly skip commentary for a trade. Keep the headings/IDs. Day notes are optional.\n\n${ordered.map(t=>`## Trade ${t.number} | ID ${t.trade_id}\n\n`).join('')}## Day\n\n`;
  await fs.writeFile(path.join(packDir,'notes.md'),notes,{flag:'wx'});
  const gallery=`# Journal capture ${date}\n\nTradingView is released. Screenshots and native RR are captured; nothing has been saved to the journal yet. Add numbered notes in chat or [notes.md](notes.md), then say continue.\n\n${ordered.map(t=>`## Trade ${t.number} | ID ${t.trade_id}\n\n${t.ticker} ${t.type} - entry ${t.entry_candle} - native RR ${review.trades.find(x=>x.id===t.trade_id).rr}\n\n![Trade ${t.number}](trade-${t.trade_id}.png)\n\n`).join('')}`;
  await fs.writeFile(path.join(packDir,'capture-pack.md'),gallery,{flag:'wx'});
  const state={version:1,mode:'capture_first',phase:'awaiting_notes',date,created_at:new Date().toISOString(),tradingview_released:true,ordered,image_hashes:imageHashes,sealed_file_hashes:sealedFiles};
  // Written last; a partial copy is not a ready pack.
  await fs.writeFile(path.join(packDir,'stage.json'),JSON.stringify(state,null,2),{flag:'wx'});
  return {pack_dir:packDir,date,phase:state.phase,tradingview_released:true,ordered};
}

export function parseNotes(text,state) {
  const header=text.match(/^# Journal notes (\d{4}-\d{2}-\d{2})\s*$/m);
  if(!header||header[1]!==state.date)throw Error('Notes file day must match the frozen pack');
  const sections=[...text.matchAll(/^## (?:Trade (\d+) \| ID (\d+)|(Day))\s*$/gm)];
  const result={date:state.date,trades:[],daily:''};let daySeen=false;
  for(let i=0;i<sections.length;i++) {
    const m=sections[i],body=text.slice(m.index+m[0].length,sections[i+1]?.index??text.length).trim();
    if(/^## /m.test(body))throw Error('Unrecognized notes heading; keep frozen headings');
    if(m[3]){if(daySeen)throw Error('Duplicate Day notes');daySeen=true;result.daily=body;continue;}
    const number=Number(m[1]),trade_id=Number(m[2]);
    if(!state.ordered.some(x=>x.number===number&&x.trade_id===trade_id)||result.trades.some(x=>x.number===number))throw Error('Notes ordinal/ID mismatch or duplicate');
    result.trades.push({number,trade_id,text:body==='NO NOTE'?'':body,no_note:body==='NO NOTE'});
  }
  return result;
}

export async function resumePack(packDir,freshSnapshotPath,outputPath,notesPath=path.join(packDir,'notes.md')) {
  packDir=path.resolve(packDir);
  const [state,old,captured,fresh]=await Promise.all(['stage.json','before.json','captured-review.json'].map(file=>load(path.join(packDir,file))).concat(load(freshSnapshotPath)));
  if(state.version!==1||state.mode!=='capture_first'||state.phase!=='awaiting_notes'||state.tradingview_released!==true)throw Error('A released pending capture pack is required');
  for(const file of ['before.json','captured-review.json','evidence.json','chart-release.json'])if(hash(await fs.readFile(path.join(packDir,file)))!==state.sealed_file_hashes?.[file])throw Error(`Sealed capture evidence changed: ${file}`);
  if(isoDate(fresh.date)!==state.date||!sameIDs(old.trades,fresh.trades))throw Error('Imported day/IDs changed; coordinate a new capture window');
  for(const trade of fresh.trades){
    if(financialFingerprint(trade)!==financialFingerprint(old.trades.find(x=>x.id===trade.id)))throw Error(`Imported trade changed; cached chart must be recaptured: ${trade.id}`);
    if(fresh.chart_hashes[trade.id]!==old.chart_hashes[trade.id]&&fresh.chart_hashes[trade.id]!==state.image_hashes[trade.id])throw Error(`Journal chart changed during handoff: ${trade.id}`);
    const file=path.join(packDir,`trade-${trade.id}.png`);
    if(hash(await fs.readFile(file))!==state.image_hashes[trade.id])throw Error(`Cached PNG changed: ${trade.id}`);
  }
  const raw=await fs.readFile(notesPath,'utf8');
  const notes=path.extname(notesPath)==='.json'?JSON.parse(raw):parseNotes(raw,state);
  if(notes.date!==state.date||!Array.isArray(notes.trades)||notes.trades.length!==state.ordered.length||('daily' in notes&&typeof notes.daily!=='string'))throw Error('Every frozen trade needs notes or explicit no_note; daily text must be a string');
  const seen=new Set();
  for(const n of notes.trades){if(!state.ordered.some(x=>x.number===n.number&&x.trade_id===n.trade_id)||seen.has(n.trade_id))throw Error('Notes ordinal/ID mismatch or duplicate');seen.add(n.trade_id);if(typeof n.text!=='string'||(!n.text.trim()&&n.no_note!==true)||(n.text.trim()&&n.no_note===true))throw Error(`Missing or conflicting notes: ${n.trade_id}`);}
  const review=reviewTemplate(fresh,packDir);
  review.snapshot_path=path.resolve(freshSnapshotPath);
  for(const row of review.trades){
    const chart=captured.trades.find(x=>x.id===row.id),trade=fresh.trades.find(x=>x.id===row.id),note=notes.trades.find(x=>x.trade_id===row.id);
    Object.assign(row,{chart_reviewed:chart.chart_reviewed,chart_context:chart.chart_context,chart_annotations:chart.chart_annotations,chart_path:path.join(packDir,`trade-${row.id}.png`),rr:chart.rr,rr_evidence:chart.rr_evidence});
    if(!note.no_note){const text=note.text.trim();if(!String(trade.notes||'').includes(`<p>${escape(text)}</p>`)&&String(trade.notes||'').trim()!==text){row.notes_append=text;row.notes_source=`User notes ${path.resolve(notesPath)}; frozen trade ${note.number} / imported ID ${row.id}`;}}
    // Catalog/groups/old tags come from the fresh snapshot, not the sealed chart review.
  }
  review.pack_source=packDir;
  review.notes_input={path:path.resolve(notesPath),sha256:hash(raw),daily:notes.daily||'',trades:notes.trades};
  await fs.mkdir(path.dirname(path.resolve(outputPath)),{recursive:true});
  await fs.writeFile(outputPath,JSON.stringify(review,null,2),{flag:'wx'});
  return {date:state.date,trades:review.trades.map(x=>x.id),review_path:path.resolve(outputPath),tradingview_used:false,tag_review_required:true,daily_notes_pending:!!notes.daily};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [command,a,b,c,d]=process.argv.slice(2);
  try {
    if(command==='create'&&a&&b)console.log(JSON.stringify(await createPack(await load(a),b),null,2));
    else if(command==='resume'&&a&&b&&c)console.log(JSON.stringify(await resumePack(a,b,c,d),null,2));
    else throw Error('Usage: journal-pack.mjs create config.json NEW_PACK_DIR | resume PACK_DIR FRESH_BEFORE_JSON NEW_REVIEW_JSON [NOTES_MD_OR_JSON]');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
