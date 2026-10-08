import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluate } from '../src/connection.js';
import { getState, getVisibleRange, setSymbol } from '../src/core/chart.js';
import { status as replayStatus } from '../src/core/replay.js';
import { getOhlcv } from '../src/core/data.js';
import { drawShape, getProperties, setVisualOrder } from '../src/core/drawing.js';
import { captureJournalTradeImage, removeJournalAnnotations } from './journal-screenshot.mjs';
import { reviewTemplate, entryCandleTime, positionRR, parsePositionRRLabel } from './journal-capture.mjs';

const CHART = 'window.TradingViewApi._activeChartWidgetWV.value()';
const STOP = 0.5;
const FILL_FONT_SIZE = 16;
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
  const entryTime = entryCandleTime(trade);
  if (entryTime > firstTime || entryTime % seconds !== 0) throw Error(`Trade ${trade.id}: stored entry_candle is after the first fill or is not aligned to the chart timeframe`);
  const byTime = new Map(bars.map(bar => [Number(bar.time), bar]));
  const entry = byTime.get(entryTime);
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
    start: { time: entryTime, price: entryPrice },
    end: { time: lastTime, price: target },
    mfe: { time: mfe.time, price: target },
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

// Ask TradingView's own label formatter for its value. A detached receiver captures
// the text without replacing renderer data or changing the user's drawing.
export async function readPositionRR(entityId, {evaluateChart=evaluate}={}) {
  const read=await evaluateChart(`(function() {
    var source=${CHART}._chartWidget.model().dataSourceForId(${JSON.stringify(entityId)});
    if(!source)throw Error('Position drawing is unavailable');
    var properties=source.properties().childs();
    if(!properties.infoBlocks.childs().riskRewardRatio.childs().visible.value())throw Error('Position-tool RR label is hidden');
    var views=Array.from(source._paneViews.values()).flat();
    var view=views.find(function(v){return typeof v._createMiddleLabel==='function'});
    if(!view)throw Error('TradingView position-tool label reader is unavailable');
    var reader=Object.create(view);
    // Newer renderers access pixel points before the first paint. The detached
    // label reader needs only a harmless position; prices still come from source.
    reader._points=[{x:0,y:0},{x:100,y:0}];
    reader._addCenterLabel=function(renderer,label,data){return data.txt};
    var label=view._createMiddleLabel.call(reader,{
      entryPrice:source.entryPrice(),profitPrice:source.profitPrice(),stopPrice:source.stopPrice(),
      currentPrice:source.entryPrice(),pl:0,left:0,edge:100,isClosed:false
    },null,source.ownerSource().symbolSource().symbolInfo());
    return {label:label,compact:properties.compact.value()};
  })()`);
  return {entity_id:entityId,source:'tradingview_position_tool_label',...read,
    value:parsePositionRRLabel(read.label,read.compact)};
}

export async function preservePositionAnchors(entityId, plan, {evaluateChart=evaluate}={}) {
  // Creation quantizes adjusted historical prices to the display tick. The
  // public point setter retains their precision, keeping the actual candle
  // anchor and both price bands consistent with the reviewed OHLC values.
  const points=[plan.start,{time:plan.end.time,price:plan.start.price}];
  await evaluateChart(`window.TradingViewApi._activeChartWidgetWV.value().getShapeById(${JSON.stringify(entityId)}).setPoints(${JSON.stringify(points)})`);
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
    var current=c.getVisibleRange();
    if(current.from===${range.from}&&current.to===${range.to})return {actual:current};
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

export function segmentIntersectsBox(start, end, box) {
  let from = 0, to = 1;
  for (const [axis, low, high] of [['x', box.left, box.right], ['y', box.top, box.bottom]]) {
    const delta = end[axis] - start[axis];
    if (delta === 0) {
      if (start[axis] < low || start[axis] > high) return false;
      continue;
    }
    const a = (low - start[axis]) / delta, b = (high - start[axis]) / delta;
    from = Math.max(from, Math.min(a, b));
    to = Math.min(to, Math.max(a, b));
    if (from > to) return false;
  }
  return true;
}

// Lay out the labels in screen pixels so a change in price scale does not make
// them enormous or push them over candles. Each label stays close to its fill.
export function placeLabels(plan, geometry) {
  const visible = geometry.bars.filter(b => b.x >= 0 && b.x <= geometry.width);
  if (!visible.length) throw Error(`Trade ${plan.id}: no visible candles`);
  const gaps = visible.slice(1).map((bar, i) => Math.abs(bar.x - visible[i].x)).filter(n => n > 0).sort((a, b) => a - b);
  const candleHalfWidth = Math.min(5, (gaps[Math.floor(gaps.length / 2)] || 10) * .3) + 3;
  const candleBoxes = visible.map(bar => ({left:bar.x-candleHalfWidth,right:bar.x+candleHalfWidth,top:bar.highY-3,bottom:bar.lowY+3}));
  // Reserve all fill anchors before placing the first note, including later fills.
  const anchorClearance = plan.fills.flatMap(fill => {
    const bar = visible.find(item => item.time === fill.time);
    return bar ? [bar.highY-8,bar.lowY+8].map(y => ({
      time:fill.time,left:bar.x-14,right:bar.x+14,top:y-14,bottom:y+14,
    })) : [];
  });
  function candidates(fill, distances, reach) {
    const anchor = geometry.bars.find(b => b.time === fill.time);
    if (!anchor || anchor.x < 8 || anchor.x > geometry.width - 8) throw Error(`Trade ${plan.id}: fill ${fill.transaction_index} is outside the visible chart`);
    const width = Math.ceil(fill.text.length * FILL_FONT_SIZE * 0.6 + 16);
    const height = FILL_FONT_SIZE + 10;
    const found = [];
    for (const sign of [1, -1]) {
      // Opposite fills in one candle need separate, visible wick anchors.
      const opposite=plan.fills.some(other=>other.time===fill.time&&['BUY','SELL'].includes(other.side)&&other.side!==fill.side);
      if(['BUY','SELL'].includes(fill.side)&&opposite&&sign!==(fill.side==='BUY'?1:-1))continue;
      const anchorY = sign === 1 ? anchor.lowY + 8 : anchor.highY - 8;
      for (const dy of distances) {
        for (const near of visible) {
          const dx = near.x - anchor.x;
          if (Math.abs(dx) < 40 || Math.abs(dx) > reach) continue;
          const y = anchorY + sign * dy;
          const leaderStart = {x:anchor.x,y:anchorY}, leaderEnd = {x:near.x,y};
          // TradingView text starts at its point and extends right/down; it is
          // not centered on that point. Keep a small conservative padding.
          const box = { left: near.x-4, right: near.x+width, top: y-4, bottom: y+height };
          if (box.left < 10 || box.right > geometry.width - 10 || box.top < 14 || box.bottom > geometry.height - 24) continue;
          if (anchorClearance.some(other => intersects(box, other))) continue;
          if (visible.some(bar => bar.x >= box.left - 5 && bar.x <= box.right + 5 && bar.highY <= box.bottom + 5 && bar.lowY >= box.top - 5)) continue;
          if (candleBoxes.some(obstacle => segmentIntersectsBox(leaderStart, leaderEnd, obstacle))) continue;
          // Neighboring candles can be less than 14px apart at the user's zoom.
          // Keep the full 14px exclusion for note boxes, but protect the actual
          // connector endpoints with a smaller radius so adjacent anchors do not
          // make every possible leader fail merely at its own starting point.
          if (anchorClearance.some(other => other.time !== fill.time && segmentIntersectsBox(leaderStart, leaderEnd, {
            left:(other.left+other.right)/2-6,right:(other.left+other.right)/2+6,
            top:(other.top+other.bottom)/2-6,bottom:(other.top+other.bottom)/2+6,
          }))) continue;
          const score = Math.hypot(dx, dy) + (sign === 1 ? 0 : 35);
          found.push({ ...fill, anchor:{time:fill.time,x:anchor.x,y:anchorY},
            label:{time:near.time,x:near.x,y},bounds:box,score });
        }
      }
    }
    return found.sort((a,b)=>a.score-b.score);
  }
  // Choose the entire cluster together: a greedy early note can occupy the only
  // safe lane for a later fill, even though another complete layout exists.
  for(const search of [{distances:[70,95,120,145,170],reach:190},
    {distances:[45,70,95,120,145,170,195,220],reach:250}]) {
    const options=plan.fills.map(fill=>candidates(fill,search.distances,search.reach));
    if(options.some(list=>!list.length))continue;
    const order=options.map((list,index)=>({index,count:list.length})).sort((a,b)=>a.count-b.count);
    const selected=new Array(plan.fills.length),chosen=[];
    let visits=0;
    function choose(depth) {
      if(depth===order.length)return true;
      if(++visits>50000)return false;
      const index=order[depth].index;
      for(const note of options[index]) {
        if(chosen.some(other=>intersects(note.bounds,other.bounds)||
          segmentIntersectsBox(note.anchor,note.label,other.bounds)||
          segmentIntersectsBox(other.anchor,other.label,note.bounds)))continue;
        selected[index]=note;chosen.push(note);
        if(choose(depth+1))return true;
        chosen.pop();
        if(visits>50000)break;
      }
      return false;
    }
    if(choose(0))return selected;
  }
  throw Error(`Trade ${plan.id}: no jointly clear label layout at the preserved zoom`);
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

export function positionToolLevels(plan, tickSize) {
  if (!Number.isFinite(tickSize) || tickSize <= 0) throw Error('Position tool requires the underlying tick size');
  // TradingView's stopLevel/profitLevel are tick counts, not price distances.
  // Historical candles can contain sub-cent trades. Fractional tick counts are
  // supported by the drawing API; preserve the actual price instead of rounding.
  const stopLevel = round(Math.abs(plan.start.price - plan.stop_price) / tickSize);
  const profitLevel = round(Math.abs(plan.end.price - plan.start.price) / tickSize);
  if (Math.abs(stopLevel * tickSize - STOP) > 1e-6 ||
      Math.abs(profitLevel * tickSize - Math.abs(plan.end.price - plan.start.price)) > 1e-6) {
    throw Error(`Trade ${plan.id}: position levels cannot be represented at the underlying tick size`);
  }
  return { stopLevel, profitLevel };
}

export function validatePositionPrices(plan, drawing, tickSize) {
  const short = plan.position_tool === 'short_position';
  const entry = Number(drawing.points?.[0]?.price);
  const stopTicks = Number(drawing.properties?.stopLevel);
  const profitTicks = Number(drawing.properties?.profitLevel);
  const stop = entry + (short ? 1 : -1) * stopTicks * tickSize;
  const target = entry + (short ? -1 : 1) * profitTicks * tickSize;
  if (![entry, stopTicks, profitTicks, stop, target].every(Number.isFinite) ||
      Math.abs(entry - plan.start.price) > 1e-6 ||
      Math.abs(stop - plan.stop_price) > 1e-6 || Math.abs(target - plan.end.price) > 1e-6 ||
      Number(drawing.points?.[1]?.time) !== plan.end.time) {
    throw Error(`Trade ${plan.id}: rendered position stop/target prices did not read back`);
  }
  return { stop, target };
}

async function renderTrade(plan, outputDir, seenImages) {
  const created = [];
  try {
    const geometry = await chartGeometry();
    const entryBar = geometry.bars.find(bar => bar.time === plan.start.time);
    if (!entryBar || entryBar.x < 0 || entryBar.x > geometry.width) throw Error(`Trade ${plan.id}: stored entry_candle is outside the preserved view`);
    const placements = placeLabels(plan, geometry);
    await pixelPrices(placements);
    const tickSize = await evaluate(`(function() {
      var info=${CHART}._chartWidget.model().mainSeries().symbolInfo();
      return info && Number(info.minmov) / Number(info.pricescale);
    })()`);
    const levels = positionToolLevels(plan, tickSize);
    const position = await drawShape({shape:plan.position_tool,point:plan.start,
      point2:{time:plan.end.time,price:plan.start.price},
      overrides:JSON.stringify({...levels,compact:true,fontsize:10})});
    if (!position.entity_id) throw Error(`Trade ${plan.id}: position tool has no ID`);
    created.push(position.entity_id);
    await preservePositionAnchors(position.entity_id,plan);
    const positionRead = await assertDrawing(position.entity_id,plan.position_tool,plan.start);
    validatePositionPrices(plan, positionRead, tickSize);
    const positionRRRead = await readPositionRR(position.entity_id);
    const markers=[];
    for (const p of placements) {
      const color=p.side==='BUY'?'#218838':'#C62828';
      const leader=await drawShape({shape:'trend_line',point:{time:p.anchor.time,price:p.anchor.price},point2:{time:p.label.time,price:p.label.price},overrides:JSON.stringify({linecolor:color,linewidth:1})});
      if (!leader.entity_id) throw Error(`Trade ${plan.id}: leader line has no ID`);
      created.push(leader.entity_id);
      await assertDrawing(leader.entity_id,'trend_line',{time:p.anchor.time,price:p.anchor.price});
      const label=await drawShape({shape:'text',point:{time:p.label.time,price:p.label.price},text:p.text,
        overrides:JSON.stringify({color:'#ffffff',backgroundColor:color,fillBackground:true,backgroundTransparency:0,drawBorder:false,wordWrap:false,fontsize:FILL_FONT_SIZE,bold:false})});
      if (!label.entity_id) throw Error(`Trade ${plan.id}: text label has no ID`);
      created.push(label.entity_id);
      const labelRead=await assertDrawing(label.entity_id,'text',{time:p.label.time,price:p.label.price});
      if (labelRead.properties?.text!==p.text || labelRead.properties?.wordWrap!==false || labelRead.properties?.backgroundColor!==color || Number(labelRead.properties?.fontsize)!==FILL_FONT_SIZE) throw Error(`Trade ${plan.id}: label text or style did not read back`);
      await setVisualOrder({entity_id:label.entity_id,action:'bring_to_front'});
      markers.push({transaction_index:p.transaction_index,entity_id:label.entity_id,leader_entity_id:leader.entity_id,
        side:p.side,quantity:p.quantity,price:p.price,filled_time:p.filled_time,text:p.text,
        candle_time:p.time,label_time:p.label.time,label_price:p.label.price});
    }
    const shot=await captureJournalTradeImage({tradeId:plan.id,positionId:position.entity_id,annotationIds:created,seenImages});
    const destination=path.join(outputDir,`trade-${plan.id}.png`);
    await fs.writeFile(destination,shot.image,{flag:'wx'});
    const view=(await getVisibleRange()).visible_range;
    return {id:plan.id,chart_path:destination,position_entity_id:position.entity_id,position_start_candle_time:plan.start.time,
      position_end_candle_time:plan.end.time,position_mfe_candle_time:plan.mfe.time,
      position_entry_price:plan.start.price,position_target_price:plan.end.price,
      position_stop_price:plan.stop_price,stop_distance:STOP,position_rr:positionRRRead,position_tick_size:tickSize,
      position_stop_ticks:levels.stopLevel,position_profit_ticks:levels.profitLevel,
      resolution:plan.resolution,visible_range:view,transaction_markers:markers,
      screenshot_checks:shot.screenshot_checks,layout_automated:true,visual_review_required:true};
  } finally {
    await removeJournalAnnotations(created);
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
      position_rr:result.position_rr,
      position_start_candle_time:result.position_start_candle_time,
      position_end_candle_time:result.position_end_candle_time,
      position_mfe_candle_time:result.position_mfe_candle_time,
      position_entry_price:result.position_entry_price,
      position_target_price:result.position_target_price,
      position_stop_price:result.position_stop_price,
      stop_distance:result.stop_distance,
      resolution:result.resolution,
      visible_range:result.visible_range,
      position_created_before_markers:true,
      markers_brought_to_front:true,
      screenshot_checks:result.screenshot_checks,
    });
    for (const marker of a.transaction_markers) {
      const found=result.transaction_markers.find(item=>item.transaction_index===marker.transaction_index);
      if (!found) throw Error(`Trade ${row.id}: missing fill marker ${marker.transaction_index}`);
      marker.entity_id=found.entity_id;
      marker.leader_entity_id=found.leader_entity_id;
    }
    row.chart_path=result.chart_path;
    row.rr=positionRR(a);
    row.rr_evidence=`TradingView position tool ${a.position_entity_id} label: ${a.position_rr.label}. Copied directly; no independent RR calculation.`;
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
  const candleCache=new Map();
  const seenImages=new Set();
  try {
    for (const trade of trades) {
      try {
        const ticker=String(trade.ticker).toUpperCase();
        const symbol=ticker.includes(':')?ticker:ticker==='SPY'?'AMEX:SPY':ticker==='QQQ'?'NASDAQ:QQQ':ticker;
        const state=await getState();
        if (state.symbol!==symbol) await setSymbol({symbol});
        await restoreExactRange(range);
        await sleep(350);
        if(!candleCache.has(symbol)) candleCache.set(symbol,(await getOhlcv({count:2500})).bars);
        const candles=candleCache.get(symbol);
        const plan=planAnnotation(trade,candles,resolutions[0]);
        annotated.push(await renderTrade(plan,outputDir,seenImages));
      } catch(error) {
        skipped.push({id:trade.id,reason:error.message});
        if (error.captureUnsafe) {
          for (const pending of trades.slice(trades.indexOf(trade)+1)) skipped.push({id:pending.id,reason:'Capture stopped after unverified screenshot or annotation cleanup; coordinate a new capture window'});
          break;
        }
      }
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
