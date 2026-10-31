import {test} from 'node:test';
import assert from 'node:assert/strict';
import {futuresFillPlan} from './futures-fill-annotations.mjs';
import {placeLabels} from './journal-annotate.mjs';
import {captureIsolatedTradeScreenshots} from '../src/core/trading-sync.js';
test('each futures execution keeps exact price, allocated quantity, side and chart candle',()=>{
 const result=futuresFillPlan({source_id:'entry-1',transactions:[{timestamp:1785851340123,price:7744.25,quantity:4,side:'BUY'},{timestamp:1785851400999,price:7748.25,quantity:2,side:'SELL'}]},'1');
 assert.equal(result.fills.length,2);assert.equal(result.fills[0].time,1785851340);assert.equal(result.fills[0].price,7744.25);assert.equal(result.fills[1].text,'SELL 2 @ $7748.25');
 assert.throws(()=>futuresFillPlan({transactions:[{side:'BUY',price:1,quantity:1}]},'1'),/Exact futures/);
});
test('futures label leader starts inside its candle at the exact price coordinate',()=>{
 const bars=Array.from({length:50},(_,i)=>({time:i*60,x:30+i*18,highY:300,lowY:380,openY:325,closeY:360}));
 const plan={id:'futures',fills:[{time:20*60,anchor_y:340,price:7744.25,side:'BUY',text:'BUY 4 @ $7744.25'}]};
 const labels=placeLabels(plan,{width:1100,height:800,bars});assert.equal(labels[0].anchor.y,340);assert.equal(labels[0].anchor.time,1200);assert.equal(labels[0].price,7744.25);
});
test('per-entry annotations clean up before restoration even when annotation creation fails',async()=>{
 const events=[];
 await assert.rejects(captureIsolatedTradeScreenshots([{source_id:'a'}],[{source_id:'a',drawing_id:'p'}],{
 evaluate:async()=>({success:true,visible_positions:1}),evaluateAsync:async()=>{events.push('restore-or-isolate');return {success:true};},captureScreenshot:async()=> 'control',
 beforeTrade:async()=>{events.push('annotate');throw Error('annotation failed');},afterTrade:async()=>{events.push('cleanup');}
 }),/annotation failed/);
 assert(events.indexOf('cleanup')>events.indexOf('annotate'));assert.equal(events.at(-1),'restore-or-isolate');
});
