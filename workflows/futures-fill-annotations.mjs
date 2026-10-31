import {evaluate} from '../src/connection.js';
import {drawShape,getProperties,setVisualOrder} from '../src/core/drawing.js';
import {placeLabels,chartGeometry,pixelPrices} from './journal-annotate.mjs';
import {removeJournalAnnotations} from './journal-screenshot.mjs';

export function futuresFillPlan(trade,resolution){
 const step=Number(resolution)*60;
 if(!Number.isSafeInteger(step)||step<=0)throw Error('Minute chart timeframe required for fill annotation');
 return {id:trade.source_id,fills:trade.transactions.map((f,index)=>{
  if(!['BUY','SELL'].includes(f.side)||![f.timestamp,f.price,f.quantity].every(Number.isFinite)||f.quantity<=0)throw Error('Exact futures fill facts required');
  return {transaction_index:index,time:Math.floor(f.timestamp/1000/step)*step,filled_time:f.timestamp,side:f.side,quantity:f.quantity,price:f.price,text:`${f.side} ${f.quantity} @ $${f.price.toFixed(2)}`};
 })};
}
// Generate only this entry's allocated transactions; callers clean up in finally.
export async function annotateFuturesFills(trade,resolution,created,receipt){
 const plan=futuresFillPlan(trade,resolution),geometry=await chartGeometry();
 const ys=await evaluate(`(()=>{var s=window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries();return ${JSON.stringify(plan.fills.map(f=>f.price))}.map(p=>s.priceScale().priceToCoordinate(p,s.firstValue()));})()`);
 plan.fills.forEach((f,i)=>{if(!Number.isFinite(ys[i])||ys[i]<0||ys[i]>geometry.height)throw Error('Fill price outside visible chart');f.anchor_y=ys[i];});
 const placements=placeLabels(plan,geometry);await pixelPrices(placements);
 for(const p of placements){
  const color=p.side==='BUY'?'#218838':'#C62828';
  const start={time:p.time,price:p.price},end={time:p.label.time,price:p.label.price};
  const leader=await drawShape({shape:'trend_line',point:start,point2:end,overrides:JSON.stringify({linecolor:color,linewidth:1})});
  if(!leader.entity_id)throw Error('Fill leader creation failed');created.push(leader.entity_id);
  // Restore exact price/time through the public API, avoiding creation rounding.
  await evaluate(`window.TradingViewApi._activeChartWidgetWV.value().getShapeById(${JSON.stringify(leader.entity_id)}).setPoints(${JSON.stringify([start,end])})`);
  const actual=await getProperties({entity_id:leader.entity_id});
  if(actual.points?.[0]?.time!==start.time||!Number.isFinite(actual.points?.[0]?.price)||Math.abs(actual.points[0].price-start.price)>1e-8)throw Error('Exact fill anchor read-back failed');
  const label=await drawShape({shape:'text',point:end,text:p.text,overrides:JSON.stringify({color:'#ffffff',backgroundColor:color,fillBackground:true,backgroundTransparency:0,wordWrap:false,fontsize:16})});
  if(!label.entity_id)throw Error('Fill label creation failed');created.push(label.entity_id);
  const labelRead=await getProperties({entity_id:label.entity_id});
  if(labelRead.properties?.text!==p.text)throw Error('Fill label read-back failed');
  await setVisualOrder({entity_id:label.entity_id,action:'bring_to_front'});
  receipt.push({...p,anchor_rule:'actual_fill_price',anchor:start,leader_entity_id:leader.entity_id,entity_id:label.entity_id});
 }
}
export async function cleanupFuturesFills(created){
 await removeJournalAnnotations(created);created.splice(0);
}
