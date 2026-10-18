import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {evaluate,evaluateAsync,getClient,disconnect} from '../src/connection.js';
import {captureChartScreenshot,captureIsolatedTradeScreenshots,frozenChartEvidenceExpression} from '../src/core/trading-sync.js';
import {replaySnapshotExpression,buildReplayLedger,mapReplayDrawings} from '../src/core/replay-capture.js';
import {getPineLabels,getPineLines,getPineBoxes} from '../src/core/data.js';
import {preflight,capturePrompts,captureAnswers} from './capture-review.mjs';
import {isoDate} from './verify-tags.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
async function write(file,value){const h=await fs.open(file,'wx');try{await h.writeFile(value);await h.sync();}finally{await h.close();}}
const json=x=>JSON.stringify(x,null,2);
const dollars=x=>(x<0?'−$':'$')+Math.abs(x).toFixed(2);
export function replayReport(ledger){
  const lines=[`# ${ledger.date} ${ledger.symbol} replay capture`,'',
    `${ledger.trade_count} flat-to-flat trades · ${ledger.fill_count} fills · ${ledger.matched_row_count} matched rows · ${dollars(ledger.net_pnl)} net replay P/L`,
    '',`Point value: ${ledger.instrument.point_value} ${ledger.instrument.currency}/point/contract. Tick size: ${ledger.instrument.tick_size}. Times: Pacific.`,
    '', 'Costs are the replay report’s recorded costs. Drawing geometry is current planning evidence; it does not prove initial stops, stop changes or realized R.',
    '', 'Status: local capture; not saved in the trading app. The legacy backtest endpoint cannot preserve this ledger.',''];
  ledger.trades.forEach((t,i)=>{
    lines.push(`## ${i+1}. ${t.direction} ${t.entry_candle}–${t.exit_candle||'open'} · ${dollars(t.net_pnl)}`,'',
      `Entered ${t.entered_quantity} contracts in total; peak open size ${t.peak_quantity}. Gross ${dollars(t.gross_pnl)}; recorded commission ${dollars(t.commission)}.`,
      '', '| Pacific time | Action | Side | Contracts | Price | Position after |', '|---|---|---|---:|---:|---:|');
    for(const f of t.transactions)lines.push(`| ${f.date} ${f.time} | ${f.action} | ${f.side} | ${f.quantity} | ${f.price.toFixed(2)} | ${f.position_after} |`);
    lines.push('', '| Entry time | Entry | Exit time | Exit | Contracts | Net P/L |','|---|---:|---|---:|---:|---:|');
    for(const m of t.matched_lots)lines.push(`| ${new Date(m.entry_time).toLocaleTimeString('en-GB',{timeZone:'America/Los_Angeles'})} | ${m.entry_price.toFixed(2)} | ${new Date(m.exit_time).toLocaleTimeString('en-GB',{timeZone:'America/Los_Angeles'})} | ${m.exit_price.toFixed(2)} | ${m.quantity} | ${dollars(m.net_pnl)} |`);
    lines.push('',`Screenshot: [position-${i+1}.png](position-${i+1}.png)`,'');
  });
  return lines.join('\n');
}

export async function freezeReplayDay(date,directory,{deps={}}={}){
  date=isoDate(date);
  await (deps.preflight||preflight)('backtest');
  const read=deps.evaluate||evaluate,readAsync=deps.evaluateAsync||evaluateAsync,capture=deps.captureScreenshot||captureChartScreenshot;
  directory=path.resolve(directory);await fs.mkdir(path.dirname(directory),{recursive:true});await fs.mkdir(directory);
  const snapshot=await read(replaySnapshotExpression);
  await write(path.join(directory,'replay-raw.json'),json(snapshot));
  const original=await (deps.captureFull|| (async()=>{const c=await getClient();return (await c.Page.captureScreenshot({format:'png'})).data;}))();
  if(!original)throw Error('Original replay screenshot was empty');
  await write(path.join(directory,'annotated-start.png'),Buffer.from(original,'base64'));
  const evidence=await read(frozenChartEvidenceExpression(date,false,false));
  await write(path.join(directory,'recovery.json'),json({snapshot,evidence}));
  const ledger=buildReplayLedger(snapshot,date);
  if(!ledger.trades.length)throw Error('No replay trades entered on requested Pacific date');
  if(ledger.trades.some(t=>t.status!=='closed'))throw Error('Open replay position retained in recovery; completed-trade capture requires a flat position');
  ledger.trades=mapReplayDrawings(ledger,evidence);
  for(const t of ledger.trades){
    const from=evidence.identity.visible_range.from*1000,to=evidence.identity.visible_range.to*1000;
    if(t.entry_time<from||t.exit_time>to)throw Error('Full trade is outside the visible chart; recovery retained, no successful capture sealed');
    if(!evidence.bars.some(b=>b[0]===Math.floor(t.entry_time/60000)*60))throw Error('Entry candle not loaded');
  }
  const identity=json(evidence.identity),reportIdentity=json(snapshot);
  async function unchanged(){
    if(json(await read(frozenChartEvidenceExpression(date,true,false)))!==identity||json(await read(replaySnapshotExpression))!==reportIdentity)throw Error('Chart or replay fills changed during capture; retain recovery and coordinate a retry');
  }
  await unchanged();
  const graphics={};
  for(const [kind,reader] of Object.entries(deps.graphics||{labels:getPineLabels,lines:getPineLines,boxes:getPineBoxes})){
    graphics[kind]=[];
    for(const study of evidence.studies){
      try{graphics[kind].push(await reader({study_filter:study.name,max_labels:50}));}
      catch(e){graphics[kind].push({study:study.name,success:false,error:e.message});}
    }
  }
  const day=await capture(read);if(!day)throw Error('Day screenshot was empty');
  await write(path.join(directory,'day.png'),Buffer.from(day,'base64'));
  const images=await (deps.isolate||captureIsolatedTradeScreenshots)(ledger.trades,ledger.trades.map(t=>({source_id:t.source_id,drawing_id:t.drawing.id})),{
    evaluate:read,evaluateAsync:readAsync,captureScreenshot:async()=>{await unchanged();const image=await capture(read);await unchanged();return image;}
  },day);
  await unchanged(); // Includes restored geometry/range, replay clock and full report.
  if(images.length!==ledger.trades.length||images.some((im,i)=>im.source_id!==ledger.trades[i].source_id||!im.screenshot?.base64))throw Error('Incomplete or mismatched isolated replay screenshots');
  for(let i=0;i<images.length;i++)await write(path.join(directory,`position-${i+1}.png`),Buffer.from(images[i].screenshot.base64,'base64'));
  const frozen={version:1,capture_kind:'replay_fills',questionnaire_version:1,idempotency_key:randomUUID(),frozen_at:new Date().toISOString(),
    ledger,evidence:{...evidence,graphics},screenshot_mapping:images.map((im,i)=>({source_id:im.source_id,file:`position-${i+1}.png`}))};
  await write(path.join(directory,'frozen.json'),json(frozen));
  await write(path.join(directory,'ledger.json'),json(ledger));
  await write(path.join(directory,'report.md'),replayReport(ledger));
  await write(path.join(directory,'review-input.json'),json({version:1,capture_kind:'replay_fills',date,page_type:'backtest',pack_id:path.basename(directory),user_finished:false,note_summary_required:true,
    prompts:capturePrompts('backtest'),raw_dictation:'',trades:ledger.trades.map((t,i)=>({number:i+1,source_id:t.source_id,
      document:{version:1,pack_id:path.basename(directory),source_id:t.source_id,note_summary:'',answers:captureAnswers('backtest'),references:{direction:t.direction},
        observations:{obstacles:[],stop_changes:[],management_events:[]},exceptions:[]}}))}));
  const files=['replay-raw.json','annotated-start.png','recovery.json','day.png','frozen.json','ledger.json','report.md',...images.map((_,i)=>`position-${i+1}.png`)];
  const hashes=Object.fromEntries(await Promise.all(files.map(async name=>[name,sha(await fs.readFile(path.join(directory,name)))])));
  const ready={date,capture_kind:'replay_fills',questionnaire_version:1,chart_released:true,visual_review_required:true,
    trade_count:ledger.trade_count,fill_count:ledger.fill_count,matched_row_count:ledger.matched_row_count,net_pnl:ledger.net_pnl,
    ingestion_complete:false,publication_status:'awaiting_review_and_backend_readiness',sealed_file_hashes:hashes,directory};
  await write(path.join(directory,'chart-ready.json'),json(ready));return ready;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const [date,directory]=process.argv.slice(2);if(!date||!directory)throw Error('Usage: replay-backtest-freeze.mjs DATE NEW_PACK');console.log(json(await freezeReplayDay(date,directory)));}
  finally{await disconnect();}
}
