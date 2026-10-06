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

export async function freezeDay(date, directory, {capture=freezeBacktestDay}={}) {
  date=isoDate(date);
  directory=path.resolve(directory);
  await fs.mkdir(path.dirname(directory),{recursive:true});
  await fs.mkdir(directory); // Never reuse/overwrite another run.
  const bundle=await capture({date,persist:async (phase,data)=>{
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
  const ready={date,chart_released:true,ingestion_complete:false,
    trade_count:bundle.payload.trades.length,idempotency_key:bundle.idempotency_key,
    frozen_sha256:digest(frozen),released_at:new Date().toISOString()};
  await durableWrite(path.join(directory,'chart-ready.json'),JSON.stringify(ready,null,2));
  return {...ready,directory,message:'Chart evidence secured. You can move on in TradingView now; saving and review continue from this bundle.'};
}

export async function publishDay(directory,{publish=publishFrozenBacktestDay}={}) {
  const frozen=await fs.readFile(path.join(directory,'frozen.json'),'utf8');
  const ready=JSON.parse(await fs.readFile(path.join(directory,'chart-ready.json'),'utf8'));
  const before=JSON.parse(await fs.readFile(path.join(directory,'before.json'),'utf8'));
  const bundle=JSON.parse(frozen);
  if(ready.chart_released!==true||ready.frozen_sha256!==digest(frozen)
    ||ready.date!==bundle.payload.capture_date||before.date!==ready.date
    ||ready.idempotency_key!==bundle.idempotency_key)throw Error('Ready marker/snapshot/bundle mismatch; do not publish');
  const result=await publish(bundle);
  // A retry must use the same frozen bundle/key, never recapture the current chart.
  await durableWrite(path.join(directory,`publish-${Date.now()}-${randomUUID()}.json`),JSON.stringify(result,null,2));
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [command,dateOrDirectory,directory]=process.argv.slice(2);
  try {
    const result=command==='freeze' ? await freezeDay(dateOrDirectory,directory)
      : command==='publish' ? await publishDay(dateOrDirectory)
      : (()=>{throw Error('Usage: backtest-freeze.mjs freeze YYYY-MM-DD NEW_DIRECTORY | publish DIRECTORY');})();
    console.log(JSON.stringify(result,null,2));
  } finally {await disconnect();}
}
