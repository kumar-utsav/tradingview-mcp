import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluate } from '../src/connection.js';
import { getState, getVisibleRange, setSymbol } from '../src/core/chart.js';
import { status as replayStatus } from '../src/core/replay.js';
import { getOhlcv } from '../src/core/data.js';
import { drawShape, getProperties, removeOne, setVisualOrder } from '../src/core/drawing.js';
import { captureScreenshot } from '../src/core/capture.js';
import { reviewTemplate } from './journal-capture.mjs';

const CHART = 'window.TradingViewApi._activeChartWidgetWV.value()';
const STOP = 0.5;
const round = n => Math.round(n * 1e8) / 1e8;
const bucket = (milliseconds, seconds) => Math.floor(milliseconds / 1000 / seconds) * seconds;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export function planAnnotation(trade, bars, resolution) {
  const seconds = Number(resolution) * 60;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw Error(`Trade ${trade.id}: minute chart resolution required`);
  const kind = String(trade.type).toLowerCase();
  if (!['call', 'put'].includes(kind)) throw Error(`Trade ${trade.id}: Call or Put required`);
  const fills = (trade.transactions || []).map((fill, index) => ({
    index, side: String(fill.side || '').toUpperCase(), quantity: Number(fill.quantity),
    price: Number(fill.price), filled_time: fill.filledTime,
    millis: Date.parse(String(fill.filledTime || '')),
  })).sort((a, b) => a.millis - b.millis || a.index - b.index);
  if (!fills.length || fills.some(f => !Number.isFinite(f.millis) || !['BUY', 'SELL'].includes(f.side) || !Number.isFinite(f.quantity) || f.quantity <= 0 || !Number.isFinite(f.price) || f.price < 0)) throw Error(`Trade ${trade.id}: invalid fill data`);
  let open = 0; let final = null;
  for (const fill of fills) {
    open += fill.side === fills[0].side ? fill.quantity : -fill.quantity;
    if (open < 0) throw Error(`Trade ${trade.id}: fills reverse the open position`);
    if (open === 0) final = fill;
  }
  if (open !== 0 || !final) throw Error(`Trade ${trade.id}: final flat exit is missing`);
  const firstTime = bucket(fills[0].millis, seconds);
  const lastTime = bucket(final.millis, seconds);
  const byTime = new Map(bars.map(bar => [Number(bar.time), bar]));
  const entry = byTime.get(firstTime);
  if (!entry || !byTime.has(lastTime)) throw Error(`Trade ${trade.id}: entry or final exit candle is not loaded`);
  const window = bars.filter(bar => bar.time >= firstTime && bar.time <= lastTime).sort((a, b) => a.time - b.time);
  if (window.length !== (lastTime - firstTime) / seconds + 1) throw Error(`Trade ${trade.id}: candle history has a gap during the trade`);
  const short = kind === 'put';
  let mfe = window[0];
  for (const bar of window.slice(1)) if (short ? bar.low < mfe.low : bar.high > mfe.high) mfe = bar;
  const entryPrice = Number(short ? entry.low : entry.high);
  const target = Number(short ? mfe.low : mfe.high);
  const stop = round(entryPrice + (short ? STOP : -STOP));
  if (![entryPrice, target, stop].every(Number.isFinite)) throw Error(`Trade ${trade.id}: invalid candle prices`);
  return {
    id: trade.id, symbol: trade.ticker, resolution: String(resolution),
    position_tool: short ? 'short_position' : 'long_position',
    first_entry_time: fills[0].filled_time, final_exit_time: final.filled_time,
    start: { time: firstTime, price: entryPrice },
    end: { time: mfe.time, price: target },
    stop_price: stop, stop_distance: STOP,
    fills: fills.map(fill => {
      const time = bucket(fill.millis, seconds);
      if (!byTime.has(time)) throw Error(`Trade ${trade.id}: fill candle ${fill.filled_time} is not loaded`);
      return { transaction_index: fill.index, side: fill.side, quantity: fill.quantity,
        price: fill.price, filled_time: fill.filled_time, time,
        text: `${fill.side} ${fill.quantity} @ $${fill.price.toFixed(2)}` };
    }),
  };
}

async function chartGeometry() {
  return evaluate(`(function() {
    var chart=${CHART}, model=chart._chartWidget.model(), series=model.mainSeries();
    var bars=series.bars(), ts=model.timeScale(), ps=series.priceScale(), first=series.firstValue();
    var width=ts.width(), height=ps.height(), out=[];
    for(var i=bars.firstIndex();i<=bars.lastIndex();i++) {
      var bar=bars.valueAt(i); if(!bar) continue;
      var x=ts.timeToCoordinate(bar[0]);
      if(!Number.isFinite(x)||x < -200||x > width+200) continue;
      out.push({time:bar[0],x:x,highY:ps.priceToCoordinate(bar[2],first),lowY:ps.priceToCoordinate(bar[3],first)});
    }
    return {width:width,height:height,bars:out};
  })()`);
}

async function restoreExactRange(range) {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) return;
  // The public helper clamps the right edge to the last loaded candle. TradingView
  // itself can represent future whitespace, so restore both logical endpoints.
  const result=await evaluate(`(function() {
    var c=${CHART},ts=c._chartWidget.model().timeScale();
    var left=ts.timePointToIndex(${range.from}),right=ts.timePointToIndex(${range.to});
    if(!Number.isFinite(left)||!Number.isFinite(right)||left>=right) return {error:'range cannot be mapped'};
    ts.zoomToBarsRange(left,right);
    return {actual:c.getVisibleRange()};
  })()`);
  if (result?.error) throw Error(result.error);
}

function intersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Lay out the labels in screen pixels so a change in price scale does not make
// them enormous or push them over candles. Each label stays close to its fill.
export function placeLabels(plan, geometry) {
  const occupied = [];
  const visible = geometry.bars.filter(b => b.x >= 0 && b.x <= geometry.width);
  if (!visible.length) throw Error(`Trade ${plan.id}: no visible candles`);
  const placements = [];
  for (const fill of plan.fills) {
    const anchor = geometry.bars.find(b => b.time === fill.time);
    if (!anchor || anchor.x < 8 || anchor.x > geometry.width - 8) throw Error(`Trade ${plan.id}: fill ${fill.transaction_index} is outside the visible chart`);
    const anchorY = anchor.lowY;
    const width = Math.ceil(fill.text.length * 5.8 + 16);
    const height = 20;
    let best = null;
    for (const sign of [1, -1]) {
      for (const dy of [70, 95, 120, 145, 170]) {
        for (const near of visible) {
          const dx = near.x - anchor.x;
          if (Math.abs(dx) > 190) continue;
          const y = anchorY + sign * dy;
          const box = { left: near.x - width / 2, right: near.x + width / 2, top: y - height / 2, bottom: y + height / 2 };
          if (box.left < 10 || box.right > geometry.width - 10 || box.top < 14 || box.bottom > geometry.height - 24) continue;
          if (occupied.some(other => intersects(box, other))) continue;
          if (visible.some(bar => bar.x >= box.left - 5 && bar.x <= box.right + 5 && bar.highY <= box.bottom + 5 && bar.lowY >= box.top - 5)) continue;
          const score = Math.hypot(dx, dy) + (sign === 1 ? 0 : 35);
          if (!best || score < best.score) best = { time: near.time, x: near.x, y, box, score };
        }
      }
    }
    if (!best) throw Error(`Trade ${plan.id}: no clear label space for fill ${fill.transaction_index}`);
    occupied.push(best.box);
    placements.push({ ...fill, anchor: { time: fill.time, y: anchorY }, label: { time: best.time, y: best.y }, bounds: best.box });
  }
  return placements;
}

async function pixelPrices(placements) {
  const values = placements.flatMap(p => [p.anchor.y, p.label.y]);
  const prices = await evaluate(`(function() {
    var s=${CHART}._chartWidget.model().mainSeries(), p=s.priceScale(), first=s.firstValue();
    return ${JSON.stringify(values)}.map(function(y){return p.coordinateToPrice(y,first)});
  })()`);
  placements.forEach((p, i) => {
    p.anchor.price = round(prices[2 * i]);
    p.label.price = round(prices[2 * i + 1]);
  });
}

async function assertDrawing(id, name, point) {
  const shape = await getProperties({ entity_id: id });
  if (shape.name !== name || !shape.points?.length || Math.abs(Number(shape.points[0].price) - point.price) > 0.02 || Number(shape.points[0].time) !== point.time) throw Error(`Drawing ${id} did not read back as ${name}`);
  return shape;
}

async function renderTrade(plan, outputDir) {
  const created = [];
  try {
    const geometry = await chartGeometry();
    const placements = placeLabels(plan, geometry);
    await pixelPrices(placements);
    const profit = round(Math.abs(plan.start.price - plan.end.price));
    const position = await drawShape({shape:plan.position_tool,point:plan.start,
      point2:{time:plan.end.time,price:plan.start.price},
      overrides:JSON.stringify({stopLevel:STOP,profitLevel:profit,compact:true,fontsize:10})});
    if (!position.entity_id) throw Error(`Trade ${plan.id}: position tool has no ID`);
    created.push(position.entity_id);
    const positionRead = await assertDrawing(position.entity_id,plan.position_tool,plan.start);
    if (Math.abs(Number(positionRead.properties?.stopLevel)-STOP)>1e-8 || Math.abs(Number(positionRead.properties?.profitLevel)-profit)>1e-8 || Number(positionRead.points[1]?.time)!==plan.end.time) throw Error(`Trade ${plan.id}: position levels did not read back`);
    const markers=[];
    for (const p of placements) {
      const color=p.side==='BUY'?'#218838':'#C62828';
      const leader=await drawShape({shape:'trend_line',point:{time:p.anchor.time,price:p.anchor.price},point2:{time:p.label.time,price:p.label.price},overrides:JSON.stringify({linecolor:color,linewidth:1})});
      if (!leader.entity_id) throw Error(`Trade ${plan.id}: leader line has no ID`);
      created.push(leader.entity_id);
      await assertDrawing(leader.entity_id,'trend_line',{time:p.anchor.time,price:p.anchor.price});
      const label=await drawShape({shape:'text',point:{time:p.label.time,price:p.label.price},text:p.text,
        overrides:JSON.stringify({color:'#ffffff',backgroundColor:color,fillBackground:true,backgroundTransparency:0,drawBorder:false,wordWrap:false,fontsize:10,bold:false})});
      if (!label.entity_id) throw Error(`Trade ${plan.id}: text label has no ID`);
      created.push(label.entity_id);
      const labelRead=await assertDrawing(label.entity_id,'text',{time:p.label.time,price:p.label.price});
      if (labelRead.properties?.text!==p.text || labelRead.properties?.wordWrap!==false || labelRead.properties?.backgroundColor!==color) throw Error(`Trade ${plan.id}: label text or style did not read back`);
      await setVisualOrder({entity_id:label.entity_id,action:'bring_to_front'});
      markers.push({transaction_index:p.transaction_index,entity_id:label.entity_id,leader_entity_id:leader.entity_id,
        side:p.side,quantity:p.quantity,price:p.price,filled_time:p.filled_time,text:p.text,
        candle_time:p.time,label_time:p.label.time,label_price:p.label.price});
    }
    const shot=await captureScreenshot({region:'chart',filename:`journal-${plan.id}-${Date.now()}`,waitForRender:true});
    const destination=path.join(outputDir,`trade-${plan.id}.png`);
    await fs.copyFile(shot.file_path,destination,fs.constants.COPYFILE_EXCL);
    const view=(await getVisibleRange()).visible_range;
    return {id:plan.id,chart_path:destination,position_entity_id:position.entity_id,position_start_candle_time:plan.start.time,
      position_end_candle_time:plan.end.time,position_entry_price:plan.start.price,position_target_price:plan.end.price,
      position_stop_price:plan.stop_price,stop_distance:STOP,resolution:plan.resolution,visible_range:view,transaction_markers:markers,
      layout_automated:true,visual_review_required:true};
  } finally {
    for (const id of created.reverse()) await removeOne({entity_id:id});
  }
}

export function prefillReview(snapshot, outputDir, annotated, skipped, snapshotPath=path.join(outputDir,'before.json')) {
  const draft=reviewTemplate(snapshot,outputDir);
  draft.snapshot_path=path.resolve(snapshotPath);
  const completed=new Map(annotated.map(row=>[row.id,row]));
  draft.trades=draft.trades.filter(row=>completed.has(row.id)).map(row=>{
    const result=completed.get(row.id),a=row.chart_annotations;
    Object.assign(a,{
      position_entity_id:result.position_entity_id,
      position_start_candle_time:result.position_start_candle_time,
      position_end_candle_time:result.position_end_candle_time,
      position_entry_price:result.position_entry_price,
      position_target_price:result.position_target_price,
      position_stop_price:result.position_stop_price,
      stop_distance:result.stop_distance,
      resolution:result.resolution,
      visible_range:result.visible_range,
      position_created_before_markers:true,
      markers_brought_to_front:true,
    });
    for (const marker of a.transaction_markers) {
      const found=result.transaction_markers.find(item=>item.transaction_index===marker.transaction_index);
      if (!found) throw Error(`Trade ${row.id}: missing fill marker ${marker.transaction_index}`);
      marker.entity_id=found.entity_id;
      marker.leader_entity_id=found.leader_entity_id;
    }
    row.chart_path=result.chart_path;
    return row;
  });
  draft.skipped=skipped.filter(item=>Number.isSafeInteger(item.id));
  return draft;
}

export async function annotateSnapshot(snapshotPath, { outputDir=path.dirname(path.resolve(snapshotPath)) }={}) {
  const snapshot=JSON.parse(await fs.readFile(snapshotPath,'utf8'));
  const trades=snapshot.trades || [];
  if (!trades.length) return {date:snapshot.date,annotated:[],skipped:[]};
  const resolutions=[...new Set(trades.map(t=>String(t.time_frame)))];
  if (resolutions.length!==1 || !/^\d+$/.test(resolutions[0])) throw Error('All trades in this batch must use one minute-based chart resolution');
  await fs.mkdir(outputDir,{recursive:true});
  for (const trade of trades) {
    const destination=path.join(outputDir,`trade-${trade.id}.png`);
    if (await fs.stat(destination).then(()=>true,()=>false)) throw Error(`Refusing to overwrite ${destination}`);
  }
  const draftPath=path.join(outputDir,'annotation-draft.json');
  if (await fs.stat(draftPath).then(()=>true,()=>false)) throw Error(`Refusing to overwrite ${draftPath}`);
  const reviewPath=path.join(outputDir,'review.draft.json');
  if (await fs.stat(reviewPath).then(()=>true,()=>false)) throw Error(`Refusing to overwrite ${reviewPath}`);
  const first=Math.min(...trades.flatMap(t=>t.transactions.map(f=>Date.parse(f.filledTime)/1000)));
  const last=Math.max(...trades.flatMap(t=>t.transactions.map(f=>Date.parse(f.filledTime)/1000)));
  if (!Number.isFinite(first)||!Number.isFinite(last)) throw Error('Invalid transaction times');
  const replay=await replayStatus();
  if (replay.is_replay_started && Number(replay.current_date)<last) throw Error(`Replay is at ${new Date(Number(replay.current_date)*1000).toISOString()}, before the last fill. Advance replay past all trades before annotating.`);
  const original=await getState();
  const originalRange=(await getVisibleRange()).visible_range;
  if (String(original.resolution)!==resolutions[0]) throw Error(`Active chart must be at the trades' ${resolutions[0]}-minute timeframe`);
  if (originalRange.from>first || originalRange.to<last) throw Error('The original chart view must include every trade; pan to the session before annotating');
  const range=originalRange;
  const annotated=[];const skipped=[];
  try {
    for (const trade of trades) {
      try {
        const ticker=String(trade.ticker).toUpperCase();
        const symbol=ticker.includes(':')?ticker:ticker==='SPY'?'AMEX:SPY':ticker==='QQQ'?'NASDAQ:QQQ':ticker;
        const state=await getState();
        if (state.symbol!==symbol) await setSymbol({symbol});
        await restoreExactRange(range);
        await sleep(350);
        const candles=(await getOhlcv({count:2500})).bars;
        const plan=planAnnotation(trade,candles,resolutions[0]);
        annotated.push(await renderTrade(plan,outputDir));
      } catch(error) { skipped.push({id:trade.id,reason:error.message}); }
    }
  } finally {
    try {
      const state=await getState();
      if (state.symbol!==original.symbol) await setSymbol({symbol:original.symbol});
      if (originalRange?.from && originalRange?.to) await restoreExactRange(originalRange);
    } catch(error) { skipped.push({id:null,reason:`Could not restore original chart view: ${error.message}`}); }
  }
  const result={date:snapshot.date,source:path.resolve(snapshotPath),requested_range:range,annotated,skipped,
    note:'Screenshots and drawing IDs are drafts. Inspect each image and complete the journal review before saving to the app.'};
  await fs.writeFile(draftPath,JSON.stringify(result,null,2),{flag:'wx'});
  await fs.writeFile(reviewPath,JSON.stringify(prefillReview(snapshot,outputDir,annotated,skipped,snapshotPath),null,2),{flag:'wx'});
  return result;
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [snapshotPath,outputDir]=process.argv.slice(2);
  if (!snapshotPath) throw Error('Usage: node workflows/journal-annotate.mjs /absolute/run/before.json [new-output-directory]');
  console.log(JSON.stringify(await annotateSnapshot(snapshotPath,{outputDir}),null,2));
}
