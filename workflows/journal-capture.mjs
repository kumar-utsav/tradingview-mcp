import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const FIELDS = ['id','ticker','expiration','type','strike','quantity','avg_price','date','time','outcome','entry_candle','time_frame','profit_loss','transactions','notes','tags','rr','has_chart'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
export const fingerprint = trade => hash(canonical(Object.fromEntries(FIELDS.map(k => [k, trade[k] ?? null]))));
export const sameTags = (a,b) => canonical([...a].sort()) === canonical([...b].sort());
export function isoDate(value) {
  const s = String(value || '');
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const date = m ? `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date+'T00:00:00Z').toISOString().slice(0,10) !== date) throw Error('Invalid date');
  return date;
}
export function planDay(trades,date) {
  date=isoDate(date);
  return trades.filter(t=>isoDate(t.date)===date && t.outcome!=='Miss').sort((a,b)=>String(a.entry_candle).localeCompare(String(b.entry_candle)) || a.id-b.id);
}
export function entryCandleTime(trade) {
  const date = isoDate(trade.date);
  const clock = String(trade.entry_candle || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59) throw Error(`Trade ${trade.id}: valid stored entry_candle required`);
  const desired = Date.parse(`${date}T${clock[1].padStart(2,'0')}:${clock[2]}:00Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  let candidate = desired;
  for (let i=0;i<3;i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(p=>[p.type,p.value]));
    const wallTime = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    if (wallTime === desired) return candidate / 1000;
    candidate += desired - wallTime;
  }
  throw Error(`Trade ${trade.id}: stored entry_candle cannot be resolved in Pacific time`);
}
function expectedTransactions(trade) {
  return (trade.transactions||[]).map((transaction,index)=>({
    transaction,index,time:transactionTime(transaction.filledTime),
    side:String(transaction.side||'').toUpperCase(),quantity:Number(transaction.quantity),price:Number(transaction.price)
  })).sort((a,b)=>a.time-b.time||a.index-b.index);
}
function annotationPlan(trade) {
  const transactions=(trade.transactions||[]).map((transaction,index)=>({
    transaction,index,time:Date.parse(String(transaction.filledTime||'')),
    side:String(transaction.side||'').toUpperCase(),quantity:Number(transaction.quantity),price:Number(transaction.price)
  })).sort((a,b)=>(Number.isFinite(a.time)?a.time:Number.MAX_SAFE_INTEGER)-(Number.isFinite(b.time)?b.time:Number.MAX_SAFE_INTEGER)||a.index-b.index);
  let open=0,finalExit=null;const entrySide=transactions[0]?.side;
  for(const item of transactions){open+=item.side===entrySide?item.quantity:-item.quantity;if(open===0)finalExit=item;}
  const firstEntry=transactions[0];
  const positionTool=String(trade.type).toLowerCase()==='call'?'long_position':'short_position';
  return {
    position_tool:positionTool,position_entity_id:'',
    first_entry_time:firstEntry?.transaction.filledTime||'',final_exit_time:finalExit?.transaction.filledTime||'',
    position_start_rule:'stored_entry_candle',
    position_end_rule:'final_exit_candle',
    position_target_rule:positionTool==='short_position'?'mfe_low':'mfe_high',
    position_mfe_candle_time:null,
    position_start_candle_time:null,position_end_candle_time:null,position_entry_price:null,position_target_price:null,position_stop_price:null,
    stop_distance:0.5,view_preserved:false,resolution:String(trade.time_frame),visible_range:null,
    position_created_before_markers:false,markers_brought_to_front:false,
    transaction_markers:transactions.map(item=>({transaction_index:item.index,entity_id:'',side:item.side,quantity:item.quantity,price:item.price,filled_time:item.transaction.filledTime,text:Number.isFinite(item.price)?`${item.side} ${item.quantity} @ $${item.price.toFixed(2)}`:''})),
    overlap_checked:false,screenshot_after_annotations:false
  };
}
export function reviewTemplate(snapshot,dir) {
  const groupReview=Object.fromEntries(snapshot.groups.map(group=>[group.id,'']));
  return {
    snapshot_path:path.resolve(dir,'before.json'),
    trades:snapshot.trades.map(trade=>({
      id:trade.id,chart_reviewed:false,
      chart_context:{date:snapshot.date,ticker:trade.ticker,time_frame:trade.time_frame,entry_candle:trade.entry_candle},
      chart_path:path.resolve(dir,`trade-${trade.id}.png`),chart_annotations:annotationPlan(trade),
      tags:[...(trade.tags||[])],evidence:{},group_review:{...groupReview},removal_evidence:{}
    })),
    skipped:[]
  };
}
function transactionTime(value) {
  const time=Date.parse(String(value||''));
  if(!Number.isFinite(time))throw Error('Transaction needs a valid filledTime');
  return time;
}
function validateChartAnnotations(review,trade) {
  if(typeof review.chart_path!=='string'||!review.chart_path.trim())throw Error(`Annotated chart_path required: ${trade.id}`);
  const annotations=review.chart_annotations;
  if(!annotations||typeof annotations!=='object')throw Error(`Chart annotations required: ${trade.id}`);
  const expectedTool=String(trade.type).toLowerCase()==='call'?'long_position':String(trade.type).toLowerCase()==='put'?'short_position':null;
  if(!expectedTool||annotations.position_tool!==expectedTool)throw Error(`Wrong position tool: ${trade.id}`);
  if(typeof annotations.position_entity_id!=='string'||!annotations.position_entity_id.trim())throw Error(`Position drawing ID required: ${trade.id}`);
  if(annotations.view_preserved!==true)throw Error(`Original chart view must be preserved: ${trade.id}`);
  if(String(annotations.resolution)!==String(trade.time_frame))throw Error(`Annotation resolution mismatch: ${trade.id}`);
  if(!annotations.visible_range||!Number.isFinite(annotations.visible_range.from)||!Number.isFinite(annotations.visible_range.to)||annotations.visible_range.from>=annotations.visible_range.to)throw Error(`Valid preserved visible range required: ${trade.id}`);
  if(annotations.position_created_before_markers!==true)throw Error(`Position tool must be created before transaction markers: ${trade.id}`);
  if(annotations.markers_brought_to_front!==true)throw Error(`Transaction markers must be brought to front: ${trade.id}`);
  if(annotations.overlap_checked!==true)throw Error(`Annotation overlap check required: ${trade.id}`);
  if(annotations.screenshot_after_annotations!==true)throw Error(`Screenshot must follow annotations: ${trade.id}`);
  const transactions=expectedTransactions(trade);
  if(!transactions.length)throw Error(`No imported transactions to annotate: ${trade.id}`);
  let open=0,finalExit=null;const entrySide=transactions[0].side;
  for(const item of transactions){
    if(!['BUY','SELL'].includes(item.side)||!Number.isFinite(item.quantity)||item.quantity<=0||!Number.isFinite(item.price)||item.price<0)throw Error(`Invalid imported transaction: ${trade.id}/${item.index}`);
    open+=item.side===entrySide?item.quantity:-item.quantity;
    if(open<0)throw Error(`Ambiguous transaction sequence: ${trade.id}`);
    if(open===0)finalExit=item;
  }
  if(open!==0||!finalExit)throw Error(`Final flat exit is ambiguous: ${trade.id}`);
  const firstEntry=transactions[0];
  if(transactionTime(annotations.first_entry_time)!==firstEntry.time)throw Error(`First entry mismatch: ${trade.id}`);
  if(transactionTime(annotations.final_exit_time)!==finalExit.time)throw Error(`Final exit mismatch: ${trade.id}`);
  if(annotations.position_start_rule!=='stored_entry_candle')throw Error(`Position tool must start on the stored entry_candle: ${trade.id}`);
  const expectedStart = entryCandleTime(trade);
  if (Number(annotations.position_start_candle_time)!==expectedStart) throw Error(`Position start must match stored entry_candle: ${trade.id}`);
  if (expectedStart > Math.floor(firstEntry.time/60000)*60) throw Error(`Stored entry_candle follows the first fill: ${trade.id}`);
  if(annotations.position_end_rule!=='final_exit_candle')throw Error(`Wrong position endpoint rule: ${trade.id}`);
  const candleSeconds=Number(trade.time_frame)*60;
  if(!Number.isFinite(candleSeconds)||candleSeconds<=0)throw Error(`Invalid minute timeframe: ${trade.id}`);
  const expectedEnd=Math.floor(finalExit.time/1000/candleSeconds)*candleSeconds;
  if(Number(annotations.position_end_candle_time)!==expectedEnd)throw Error(`Position tool must extend to the final exit candle: ${trade.id}`);
  const expectedTargetRule=expectedTool==='short_position'?'mfe_low':'mfe_high';
  if(annotations.position_target_rule!==expectedTargetRule)throw Error(`Wrong position target rule: ${trade.id}`);
  const mfeTime=annotations.position_mfe_candle_time;
  const firstFillCandle=Math.floor(firstEntry.time/1000/candleSeconds)*candleSeconds;
  if(!Number.isFinite(mfeTime)||mfeTime<firstFillCandle||mfeTime>expectedEnd||mfeTime%candleSeconds!==0)throw Error(`MFE candle must be within the actual fill window: ${trade.id}`);
  for(const key of ['position_start_candle_time','position_end_candle_time','position_entry_price','position_target_price','position_stop_price']){
    if(!Number.isFinite(Number(annotations[key])))throw Error(`Position geometry requires ${key}: ${trade.id}`);
  }
  if(Number(annotations.position_end_candle_time)<Number(annotations.position_start_candle_time))throw Error(`Position endpoint precedes entry: ${trade.id}`);
  if(Number(annotations.stop_distance)!==0.5)throw Error(`Position stop distance must be $0.50: ${trade.id}`);
  const entryPrice=Number(annotations.position_entry_price),targetPrice=Number(annotations.position_target_price),stopPrice=Number(annotations.position_stop_price);
  const expectedStop=expectedTool==='short_position'?entryPrice+0.5:entryPrice-0.5;
  if(Math.abs(stopPrice-expectedStop)>1e-9)throw Error(`Position stop is on the wrong price: ${trade.id}`);
  if(expectedTool==='short_position'&&targetPrice>entryPrice)throw Error(`Short endpoint must use the lowest favorable price: ${trade.id}`);
  if(expectedTool==='long_position'&&targetPrice<entryPrice)throw Error(`Long endpoint must use the highest favorable price: ${trade.id}`);
  const markers=annotations.transaction_markers;
  if(!Array.isArray(markers)||markers.length!==transactions.length)throw Error(`Every transaction needs a marker: ${trade.id}`);
  const seen=new Set();
  for(const marker of markers){
    const index=Number(marker.transaction_index),expected=transactions.find(item=>item.index===index);
    if(!Number.isSafeInteger(index)||seen.has(index)||!expected)throw Error(`Invalid transaction marker index: ${trade.id}`);
    seen.add(index);
    if(typeof marker.entity_id!=='string'||!marker.entity_id.trim())throw Error(`Transaction marker drawing ID required: ${trade.id}/${index}`);
    if(String(marker.side||'').toUpperCase()!==expected.side||Number(marker.quantity)!==expected.quantity||Number(marker.price)!==expected.price||transactionTime(marker.filled_time)!==expected.time)throw Error(`Transaction marker mismatch: ${trade.id}/${index}`);
    const text=String(marker.text||'').toUpperCase();
    const requiredText=`${expected.side} ${expected.quantity} @ $${expected.price.toFixed(2)}`;
    if(!text.includes(requiredText))throw Error(`Transaction marker text needs side, quantity and dollar-formatted fill price: ${trade.id}/${index}`);
  }
}
function client(base,request) {
  return async (route, body) => {
    const r=await request(base+route,{method:body?'PUT':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    if (!r.ok) throw Error(`${body?'Save':'Read'} failed: ${route} HTTP ${r.status}`);
    return r.json();
  };
}
const decode = s => Buffer.from(s.replace(/^data:[^,]+,/,''),'base64');
const png = b => b.length>8 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
export async function snapshotDay(date,dir,{base,request=fetch}={}) {
  const api=client(base,request);
  date=isoDate(date);
  // The backend exposes a daily-note collection for reads; the dated route is PUT-only.
  const dailyRead=api('/journal/daily-notes').then(notes=>{
    if(!Array.isArray(notes))throw Error('Daily notes response must be an array');
    const matches=notes.filter(note=>isoDate(note.date)===date);
    if(matches.length>1)throw Error(`Duplicate daily notes for ${date}`);
    return matches[0]||null;
  });
  const [all,tags,groups,daily_note]=await Promise.all([api('/journal/'),api('/tags/?page_type=journal'),api('/tags/groups?page_type=journal'),dailyRead]);
  const trades=planDay(all,date); const chart_hashes={};
  await fs.mkdir(path.dirname(path.resolve(dir)),{recursive:true});
  // An existing directory may contain recovery images: never reuse it.
  await fs.mkdir(dir);
  await Promise.all(trades.map(async t=>{
    if(t.has_chart){const image=decode((await api(`/journal/${t.id}/image`)).chart);chart_hashes[t.id]=hash(image);await fs.writeFile(path.join(dir,`before-${t.id}.png`),image);}
    else chart_hashes[t.id]=null;
  }));
  const snapshot={date,captured_at:new Date().toISOString(),trades,tags,groups,daily_note,chart_hashes};
  // Never replace a prior run's recovery snapshot.
  await fs.writeFile(path.join(dir,'before.json'),JSON.stringify(snapshot,null,2),{flag:'wx'});
  await fs.writeFile(path.join(dir,'review.template.json'),JSON.stringify(reviewTemplate(snapshot,dir),null,2),{flag:'wx'});
  return {date:snapshot.date,review_template:path.resolve(dir,'review.template.json'),trades:trades.map(t=>({id:t.id,ticker:t.ticker,type:t.type,entry_candle:t.entry_candle,time_frame:t.time_frame,has_chart:t.has_chart}))};
}
export function validateReview(review,trade,tags,groups,date) {
  if(!trade || !Number.isSafeInteger(review.id) || review.id!==trade.id)throw Error('Unknown imported trade');
  if(trade.outcome==='Miss' || isoDate(trade.date)!==isoDate(date))throw Error('Wrong journal day/type');
  const context=review.chart_context;
  if(review.chart_reviewed!==true || !context || isoDate(context.date)!==isoDate(date) || String(context.ticker).split(':').pop().toUpperCase()!==String(trade.ticker).split(':').pop().toUpperCase() || Number(context.time_frame)!==Number(trade.time_frame) || context.entry_candle!==trade.entry_candle)throw Error(`Chart identity mismatch: ${trade.id}`);
  validateChartAnnotations(review,trade);
  if(!Array.isArray(review.tags) || new Set(review.tags).size!==review.tags.length)throw Error('Unique tags required');
  const single=new Set();
  for(const key of review.tags){
    const tag=tags.find(t=>t.key===key && ['both','journal'].includes(t.page_type));
    if(!tag)throw Error(`Not a journal tag: ${key}`);
    if(!review.evidence?.[key]?.trim())throw Error(`Missing evidence: ${key}`);
    const g=groups.find(g=>g.id===tag.group_id);
    if(g?.selection_mode==='single'){if(single.has(g.id))throw Error(`Conflicting group ${g.name}`);single.add(g.id);}
  }
  for(const g of groups){if(!review.group_review?.[g.id]?.trim())throw Error(`Unreviewed group ${g.name}`);}
  for(const range of ['pm','pd','5m','15m'])if(review.tags.includes(`pa_inside_${range}`)&&review.tags.includes(`pa_outside_${range}`))throw Error('Contradictory range tags');
  for(const key of trade.tags||[])if(!review.tags.includes(key)&&!review.removal_evidence?.[key]?.trim())throw Error(`Existing tag removal needs evidence: ${key}`);
  if('rr' in review && (!Number.isFinite(review.rr)||review.rr<=0||!review.rr_evidence?.trim()))throw Error('RR needs positive value and matched drawing evidence');
  if('notes_append' in review && (typeof review.notes_append!=='string'||!review.notes_append.trim()||!review.notes_source?.trim()))throw Error('New note needs source');
  if('notes' in review)throw Error('Use notes_append to preserve existing notes');
}
export async function applyReview(manifest,snapshot,{base,request=fetch,apply=false,readFile=fs.readFile}={}) {
  const api=client(base,request); const date=isoDate(snapshot.date);
  const rows=manifest.trades||[], skipped=manifest.skipped||[];
  const ids=[...rows,...skipped].map(t=>t.id);
  if(new Set(ids).size!==ids.length||canonical([...ids].sort())!==canonical(snapshot.trades.map(t=>t.id).sort()))throw Error('Every imported trade must be reviewed or explicitly skipped');
  if(skipped.some(t=>!t.reason?.trim()))throw Error('Skipped trade needs reason');
  const [current,tags,groups]=await Promise.all(['/journal/','/tags/?page_type=journal','/tags/groups?page_type=journal'].map(p=>api(p)));
  if(canonical(planDay(current,date).map(t=>t.id).sort())!==canonical(snapshot.trades.map(t=>t.id).sort()))throw Error('Day trade list changed; take a new snapshot');
  const liveChartHashes=new Map(await Promise.all(rows.map(async row=>{
    const old=snapshot.trades.find(t=>t.id===row.id);
    return [row.id,old?.has_chart?hash(decode((await api(`/journal/${row.id}/image`)).chart)):null];
  })));
  const prepared=[];
  const views=rows.map(row=>({resolution:String(row.chart_annotations?.resolution||''),range:row.chart_annotations?.visible_range}));
  if(new Set(views.map(view=>view.resolution)).size>1)throw Error('Every trade screenshot must preserve the same chart resolution');
  const spans=views.map(view=>Number(view.range?.to)-Number(view.range?.from));
  if(spans.length>1&&spans.every(Number.isFinite)){
    const shortest=Math.min(...spans),longest=Math.max(...spans);
    const barSeconds=Number(views[0].resolution)*60;
    if(longest-shortest>Math.max(shortest*0.01,barSeconds*2))throw Error('Every trade screenshot must preserve the same chart zoom');
  }
  for(const row of rows){
    const old=snapshot.trades.find(t=>t.id===row.id),live=current.find(t=>t.id===row.id);
    if(!live||fingerprint(old)!==fingerprint(live))throw Error(`Stale trade ${row.id}`);
    validateReview(row,old,tags,groups,date);
    const oldHash=liveChartHashes.get(old.id);
    if(oldHash!==snapshot.chart_hashes[old.id])throw Error(`Chart changed since snapshot ${old.id}`);
    let image=null;
    if(row.chart_path){image=await readFile(row.chart_path);if(!png(image))throw Error('Chart must be a PNG');}
    else if(!old.has_chart)throw Error(`No saved or new chart for ${old.id}`);
    const updates=[];
    if(image&&hash(image)!==oldHash)updates.push(['chart',image.toString('base64')]);
    if(!sameTags(old.tags||[],row.tags))updates.push(['tags',row.tags]);
    if('rr' in row&&row.rr!==old.rr)updates.push(['rr',row.rr]);
    if(row.notes_append){const escaped=row.notes_append.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');updates.push(['notes',`${old.notes||''}<p>${escaped}</p>`]);}
    prepared.push({row,old,oldHash,updates,chartHash:image?hash(image):oldHash});
  }
  const verified=[];
  for(const p of prepared){
    let expected={...p.old};
    if(apply){
      const start=(await api('/journal/')).find(t=>t.id===p.old.id);
      if(!start||fingerprint(start)!==fingerprint(expected))throw Error(`Concurrent change ${p.old.id}`);
      if(p.old.has_chart&&hash(decode((await api(`/journal/${p.old.id}/image`)).chart))!==p.oldHash)throw Error(`Concurrent chart change ${p.old.id}`);
      for(const [propName,value] of p.updates){
        const latest=(await api('/journal/')).find(t=>t.id===p.old.id);
        if(!latest||fingerprint(latest)!==fingerprint(expected))throw Error(`Concurrent change ${p.old.id}; stopped before next write`);
        await api(`/journal/${p.old.id}`,{propName,value});
        if(propName==='chart')expected.has_chart=true;else expected[propName]=value;
        const readBack=(await api('/journal/')).find(t=>t.id===p.old.id);
        if(!readBack||fingerprint(readBack)!==fingerprint(expected))throw Error(`Read-back mismatch ${p.old.id}/${propName}; partial writes may exist, inspect before retrying`);
      }
      const finalTrade=(await api('/journal/')).find(t=>t.id===p.old.id);
      if(!finalTrade||fingerprint(finalTrade)!==fingerprint(expected))throw Error(`Final read-back mismatch ${p.old.id}`);
      if(hash(decode((await api(`/journal/${p.old.id}/image`)).chart))!==p.chartHash)throw Error(`Saved chart mismatch ${p.old.id}`);
    }
    verified.push({id:p.old.id,fields:p.updates.map(u=>u[0]),tag_count:p.row.tags.length,verified:apply});
  }
  return {date,mode:apply?'apply':'dry_run',complete:apply&&skipped.length===0,reviewed:verified,skipped};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [command,arg,directory]=process.argv.slice(2);const base=(process.env.TRADING_API_URL||'http://100.125.89.9:5555').replace(/\/$/,'');
  if(command==='snapshot')console.log(JSON.stringify(await snapshotDay(arg,directory,{base}),null,2));
  else if(command==='review') {const m=JSON.parse(await fs.readFile(arg,'utf8'));const s=JSON.parse(await fs.readFile(m.snapshot_path,'utf8'));console.log(JSON.stringify(await applyReview(m,s,{base,apply:process.argv.includes('--apply')}),null,2));}
  else throw Error('Usage: journal-capture.mjs snapshot YYYY-MM-DD new-run-directory | review manifest.json [--apply]');
}
