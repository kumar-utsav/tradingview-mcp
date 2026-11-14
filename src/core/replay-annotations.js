import { evaluate } from '../connection.js';
import { jumpToReplay, validateReplayPlan } from './replay-jump.js';
import { getOhlcv } from './data.js';
import { getProperties } from './drawing.js';
import { planAnnotation, drawTradeAnnotations, validatePositionPrices, readPositionRR } from '../../workflows/journal-annotate.mjs';
import { removeJournalAnnotations } from '../../workflows/journal-screenshot.mjs';

const CHART = 'window.TradingViewApi._activeChartWidgetWV.value()';
const REGISTRY = '__tradeReplayAnnotationsV1';

export function annotationWindow(plan) {
  validateReplayPlan(plan);
  const a = plan.annotation;
  if (a?.version !== 1 || !['journal', 'backtest'].includes(a.source) || !Number.isSafeInteger(a.tradeId) || a.tradeId < 1 || a.trade?.id !== a.tradeId) throw Error('Saved trade annotation identity is missing');
  const fills = a.trade.transactions;
  if (!Array.isArray(fills) || fills.length < 2 || fills.length > 100) throw Error('Complete saved trade fills are required (maximum 100)');
  const times = fills.map(f => Date.parse(f.filledTime));
  if (times.some(t => !Number.isFinite(t) || t <= 0)) throw Error('Invalid saved fill timestamp');
  const step = Number(plan.timeframe) * 60000;
  const first = Math.floor(Math.min(...times) / step) * step;
  const last = Math.floor(Math.max(...times) / step) * step;
  const end = Math.max(last, plan.targetTime);
  const count = Math.ceil((end - first) / step) + 20;
  if (count > 2500) throw Error('Trade history exceeds the supported annotation window');
  return { first, last, end, count, step };
}

async function clearPreviousAnnotations() {
  await evaluate(`(()=>{const c=${CHART};const legacy=c._chartWidget.id();const key=legacy+':'+c.symbol();const r=window.${REGISTRY}||{};const ids=r[key]?.ids||r[legacy]?.ids||[];const existing=new Set(c.getAllShapes().map(s=>String(s.id)));for(const id of ids)if(existing.has(String(id)))c.removeEntity(id);delete r[key];delete r[legacy];window.${REGISTRY}=r;return true;})()`);
}

async function verifyAnnotations(receipt, annotationPlan, tickSize) {
  const position = await getProperties({ entity_id: receipt.position_entity_id });
  validatePositionPrices(annotationPlan, position, tickSize);
  const rr = await readPositionRR(receipt.position_entity_id);
  for (const fill of receipt.transaction_markers) {
    const leader = await getProperties({ entity_id: fill.leader_entity_id });
    const label = await getProperties({ entity_id: fill.entity_id });
    if (Number(leader.points?.[0]?.time) !== fill.anchor_time || !Number.isFinite(leader.points?.[0]?.price) || Math.abs(Number(leader.points?.[0]?.price) - fill.anchor_price) > 1e-6 || label.properties?.text !== fill.text) throw Error('Trade fill annotations did not retain their exact anchors after replay reset');
  }
  return rr;
}

export async function replayWithAnnotations(plan) {
  const window = annotationWindow(plan);
  let receipt;
  let restored = false;
  try {
    // Load through the final exit to calculate the same full-trade bands and
    // label placement as capture. Final replay still stops near the entry.
    await jumpToReplay({ ...plan, targetTime: window.end, selectTime: window.end + window.step });
    await clearPreviousAnnotations();
    const data = await getOhlcv({ count: window.count, summary: false });
    const instrument = await evaluate(`(()=>{const s=${CHART}._chartWidget.model().mainSeries().symbolInfo();return {type:s.type,tick_size:Number(s.minmov)/Number(s.pricescale)};})()`);
    if (!(instrument.tick_size > 0)) throw Error('Chart tick size is unavailable');
    const trade = { ...plan.annotation.trade, ticker: plan.symbol, instrument };
    // Replay futures and imported futures use the chart's verified tick size.
    if (trade.type === 'Futures' && instrument.type !== 'futures') throw Error('Saved futures trade does not match the TradingView instrument');
    const annotationPlan = planAnnotation(trade, data.bars, plan.timeframe);
    if (annotationPlan.futures && instrument.type !== 'futures') throw Error('Saved futures trade does not match the TradingView instrument');
    const result = await jumpToReplay(plan);
    restored = true;
    const padding = Math.max(15 * window.step, (window.last - window.first) * 0.25);
    const context = data.bars.filter(b => b.time >= (window.first - padding) / 1000);
    const prices = [annotationPlan.start.price, annotationPlan.end.price, annotationPlan.stop_price, ...annotationPlan.fills.map(f => f.price), ...context.flatMap(b => [b.low, b.high])];
    const low = Math.min(...prices), high = Math.max(...prices), margin = Math.max((high - low) * 0.2, instrument.tick_size * 20);
    // Place against the FINAL replay viewport. Full-history candles supply only
    // collision geometry for future fills; they are never added to replay data.
    const layout = `(()=>{const c=${CHART},m=c._chartWidget.model(),s=m.mainSeries(),ts=m.timeScale(),ps=s.priceScale();const left=ts.timePointToIndex(${(window.first - padding) / 1000}),right=ts.timePointToIndex(${(window.last + padding) / 1000});if(!Number.isFinite(left)||!Number.isFinite(right))throw Error('Trade annotation time range unavailable');ts.zoomToBarsRange(left,right);ps.setMode({autoScale:false});const range=ps.priceRange().clone();range.setMinValue(${low - margin});range.setMaxValue(${high + margin});ps.setPriceRange(range,true);return true;})()`;
    await evaluate(layout);
    await new Promise(resolve => setTimeout(resolve, 600));
    await evaluate(layout);
    const geometry = await evaluate(`(()=>{const m=${CHART}._chartWidget.model(),s=m.mainSeries(),ts=m.timeScale(),ps=s.priceScale(),first=s.firstValue();return {width:ts.width(),height:ps.height(),bars:${JSON.stringify(context)}.map(b=>({time:b.time,x:ts.timeToCoordinate(b.time),highY:ps.priceToCoordinate(b.high,first),lowY:ps.priceToCoordinate(b.low,first),openY:ps.priceToCoordinate(b.open,first),closeY:ps.priceToCoordinate(b.close,first)}))};})()`);
    receipt = await drawTradeAnnotations(annotationPlan, { disableSave: true, geometry });
    const rr = await verifyAnnotations(receipt, annotationPlan, instrument.tick_size);
    await evaluate(`(()=>{const c=${CHART};const r=window.${REGISTRY}||(window.${REGISTRY}={});r[c._chartWidget.id()+':'+c.symbol()]={ids:${JSON.stringify(receipt.annotation_ids)},source:${JSON.stringify(plan.annotation.source)},tradeId:${plan.annotation.tradeId}};return true;})()`);
    return { ...result, annotations: { verified: true, source: plan.annotation.source, tradeId: plan.annotation.tradeId, fillCount: receipt.transaction_markers.length, positionId: receipt.position_entity_id, nativeRR: rr.value, policy: annotationPlan.position_policy || 'option_underlying', drawingIds: receipt.annotation_ids } };
  } catch (error) {
    if (receipt) await removeJournalAnnotations(receipt.annotation_ids).catch(() => {});
    throw error;
  } finally {
    if (!restored) await jumpToReplay(plan).catch(() => {});
  }
}
