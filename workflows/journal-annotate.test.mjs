import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { planAnnotation, placeLabels, prefillReview, positionToolLevels, validatePositionPrices, segmentIntersectsBox, preservePositionAnchors } from './journal-annotate.mjs';
import { captureJournalTradeImage, removeJournalAnnotations } from './journal-screenshot.mjs';

const at = minute => new Date(Date.parse('2026-09-24T14:00:00Z') + minute * 60000).toISOString();
const t = minute => Math.floor(Date.parse(at(minute)) / 1000);
const pngFrame = text => Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from(text)]);
function screenshotFixture(frames=['all','hidden','trade']) {
  const visibility=new Map([['position',true],['user-position',true],['user-hidden',false],['marker',true],['leader',true]]);
  const names={position:'long_position','user-position':'short_position','user-hidden':'long_position',marker:'text',leader:'trend_line'};
  const chart={getAllShapes:()=>[...visibility.keys()].map(id=>({id,name:names[id]})),
    getShapeById:id=>visibility.has(id)?{getProperties:()=>({visible:visibility.get(id)}),setProperties:p=>visibility.set(id,p.visible)}:null};
  const window={requestAnimationFrame:cb=>cb(),TradingViewApi:{activeChart:()=>chart,_activeChartWidgetWV:{value:()=>chart}}};
  const execute=expression=>new Function('window',`return (${expression});`)(window);
  let captures=0;
  const deps={evaluate:async expression=>execute(expression),evaluateAsync:async expression=>execute(expression),
    capture:async()=>{captures++;return pngFrame(frames.shift() || 'stuck');}};
  const input={tradeId:1,positionId:'position',annotationIds:['position','marker','leader'],seenImages:new Set()};
  return {deps,input,visibility,window,captures:()=>captures};
}

test('journal capture isolates one tool, keeps fill marks, and restores user visibility',async()=>{
  const f=screenshotFixture();
  const result=await captureJournalTradeImage(f.input,f.deps);
  assert.deepEqual(result.image,pngFrame('trade'));assert.equal(result.screenshot_checks.attempts,1);
  assert.equal(f.visibility.get('user-position'),true);assert.equal(f.visibility.get('user-hidden'),false);
  assert.equal(f.visibility.get('marker'),true);assert.equal(f.input.seenImages.size,1);
});
test('journal capture retries a stale frame before accepting a new one',async()=>{
  const f=screenshotFixture(['all','hidden','hidden','trade']);
  const result=await captureJournalTradeImage(f.input,f.deps);
  assert.equal(result.screenshot_checks.attempts,2);assert.equal(f.captures(),4);
});
test('journal capture rejects persistent full-day and tools-hidden frames',async()=>{
  for(const frame of ['all','hidden']) {
    const f=screenshotFixture(['all','hidden',frame,frame,frame]);
    await assert.rejects(captureJournalTradeImage(f.input,f.deps),error=>error.captureUnsafe&&/stale, duplicate or multi-tool/.test(error.message));
    assert.equal(f.visibility.get('user-position'),true);assert.equal(f.input.seenImages.size,0);
  }
});
test('journal capture rejects a previous trade image and empty screenshots',async()=>{
  const f=screenshotFixture(['all','hidden','trade']);
  await captureJournalTradeImage(f.input,f.deps);
  f.deps.capture=async()=>pngFrame('trade');
  await assert.rejects(captureJournalTradeImage({...f.input,tradeId:2},f.deps),/duplicate/);
  f.deps.capture=async()=>Buffer.alloc(0);
  await assert.rejects(captureJournalTradeImage(f.input,f.deps),/empty or not a PNG/);
});
test('journal capture fails when a fill annotation is hidden or isolation is ignored',async()=>{
  const f=screenshotFixture();f.visibility.set('marker',false);
  await assert.rejects(captureJournalTradeImage(f.input,f.deps),/callout or leader visibility/);
  assert.equal(f.visibility.get('user-position'),true);
  const g=screenshotFixture(),read=g.deps.evaluate;
  g.deps.evaluateAsync=async expression=>expression.includes('isolation-show')?{success:true}:read(expression);
  // The real visibility checker below is tested by the backtest suite; here a stuck
  // renderer must still be rejected even when an upstream mock reports success.
  g.deps.capture=async()=>pngFrame('all');
  await assert.rejects(captureJournalTradeImage(g.input,g.deps),/multi-tool/);
});
test('journal capture never accepts a PNG when original visibility restoration fails',async()=>{
  const f=screenshotFixture(),read=f.deps.evaluateAsync;
  f.deps.evaluateAsync=async expression=>expression.includes('isolation-restore')?{success:false}:read(expression);
  await assert.rejects(captureJournalTradeImage(f.input,f.deps),error=>error.captureUnsafe&&/could not be restored/.test(error.message));
  assert.equal(f.input.seenImages.size,0);
});
test('journal cleanup attempts every mark and independently detects a leftover',async()=>{
  const remaining=new Set(['position','marker','leader']),attempts=[];
  await assert.rejects(removeJournalAnnotations([...remaining],{
    remove:async({entity_id})=>{attempts.push(entity_id);if(entity_id==='leader')throw Error('remove failed');remaining.delete(entity_id);},
    evaluate:async()=>[...remaining],
  }),error=>error.captureUnsafe&&/leader/.test(error.message));
  assert.deepEqual(attempts,['leader','marker','position']);
  await removeJournalAnnotations([...remaining],{remove:async({entity_id})=>remaining.delete(entity_id),evaluate:async()=>[...remaining]});
  assert.equal(remaining.size,0);
});
const bars = [
  {time:t(-1),high:100.4,low:100.1,open:100.2,close:100.3},
  {time:t(0),high:100.5,low:100,open:100.2,close:100.3},
  {time:t(1),high:100.3,low:99.5,open:100.2,close:99.8},
  {time:t(2),high:100.1,low:99.7,open:99.9,close:100},
  {time:t(3),high:100.7,low:99.8,open:100,close:100.2},
];
const trade = type => ({id:1,type,ticker:'SPY',date:'2026-09-24',entry_candle:'06:59',transactions:[
  {side:'BUY',quantity:1,price:1.11,filledTime:at(0)},
  {side:'BUY',quantity:1,price:0.92,filledTime:at(1)},
  {side:'SELL',quantity:2,price:1.35,filledTime:at(3)},
]});

test('Put position uses the lowest low through the final flat exit and a $0.50 stop', () => {
  const plan=planAnnotation(trade('Put'),bars,'1');
  assert.deepEqual(plan.start,{time:t(-1),price:100.1});
  assert.deepEqual(plan.end,{time:t(3),price:99.5});
  assert.deepEqual(plan.mfe,{time:t(1),price:99.5});
  assert.equal(plan.stop_price,100.6);
  assert.equal(plan.fills[1].text,'BUY 1 @ $0.92');
  assert.equal(plan.fills[2].text,'SELL 2 @ $1.35');
});

test('Call position uses the highest high and a $0.50 stop below entry', () => {
  const plan=planAnnotation(trade('Call'),bars,'1');
  assert.deepEqual(plan.start,{time:t(-1),price:100.4});
  assert.deepEqual(plan.end,{time:t(3),price:100.7});
  assert.equal(plan.stop_price,99.9);
});

test('stored entry candle controls the tool while markers and MFE follow actual fills', () => {
  const priorExtreme = bars.map(bar => bar.time===t(-1) ? {...bar,low:98} : bar);
  const plan=planAnnotation(trade('Put'),priorExtreme,'1');
  assert.equal(plan.start.time,t(-1));
  assert.equal(plan.fills[0].time,t(0));
  assert.equal(plan.end.time,t(3));
  assert.equal(plan.mfe.time,t(1));
  assert.equal(plan.end.price,99.5);
  assert.throws(()=>planAnnotation(trade('Call'),bars.filter(bar=>bar.time!==t(-1)),'1'),/not loaded/);
  assert.throws(()=>planAnnotation({...trade('Call'),entry_candle:''},bars,'1'),/entry_candle required/);
});

test('missing fill candles and unclosed positions stop annotation', () => {
  assert.throws(()=>planAnnotation(trade('Put'),bars.filter(b=>b.time!==t(1)),'1'),/gap/);
  const open=trade('Put');open.transactions.pop();
  assert.throws(()=>planAnnotation(open,bars,'1'),/final flat exit/);
});

test('position levels expand both bands in underlying ticks and reject the former dollar-unit bug', () => {
  for (const type of ['Call', 'Put']) {
    const plan = planAnnotation(trade(type), bars, '1');
    const levels = positionToolLevels(plan, .01);
    assert.equal(levels.stopLevel, 50);
    const drawing = {points:[plan.start,{time:plan.end.time,price:plan.start.price}],properties:levels};
    assert.deepEqual(validatePositionPrices(plan, drawing, .01), {stop:plan.stop_price,target:plan.end.price});
    drawing.properties = {stopLevel:.5,profitLevel:Math.abs(plan.end.price-plan.start.price)};
    assert.throws(() => validatePositionPrices(plan, drawing, .01), /stop\/target prices/);
    drawing.properties = {};
    assert.throws(() => validatePositionPrices(plan, drawing, .01), /stop\/target prices/);
  }
  const quarterTickPlan = {id:2,start:{price:100},end:{price:101},stop_price:99.5};
  assert.deepEqual(positionToolLevels(quarterTickPlan, .25), {stopLevel:2,profitLevel:4});
  assert.throws(() => positionToolLevels(quarterTickPlan, 0), /tick size/);
  const subcentPlan={id:2930,position_tool:'short_position',start:{time:t(0),price:771.41},end:{time:t(1),price:771.305},stop_price:771.91};
  const subcentLevels=positionToolLevels(subcentPlan,.01);
  assert.deepEqual(subcentLevels,{stopLevel:50,profitLevel:10.5});
  assert.deepEqual(validatePositionPrices(subcentPlan,{points:[subcentPlan.start,{time:t(1),price:771.41}],properties:subcentLevels},.01),{stop:771.91,target:771.305});
});

test('adjusted candle anchors retain sub-cent prices despite creation tick rounding', async () => {
  const plan={id:2871,position_tool:'short_position',start:{time:t(0),price:769.89835784},end:{time:t(7),price:768.93076036},stop_price:770.39835784};
  const drawing={points:[{time:t(0),price:769.9},{time:t(7),price:769.9}],properties:positionToolLevels(plan,.01)};
  assert.throws(()=>validatePositionPrices(plan,drawing,.01),/stop\/target prices/);
  const chart={getShapeById(id){assert.equal(id,'adjusted-tool');return {setPoints(points){drawing.points=structuredClone(points)}}}};
  await preservePositionAnchors('adjusted-tool',plan,{evaluateChart:async expression=>vm.runInNewContext(expression,{window:{TradingViewApi:{_activeChartWidgetWV:{value:()=>chart}}}})});
  assert.equal(drawing.points[0].price,plan.start.price);
  assert.equal(drawing.points[1].time,plan.end.time);
  assert.deepEqual(validatePositionPrices(plan,drawing,.01),{stop:plan.stop_price,target:plan.end.price});
});

test('labels stay clear of candles, each other, and chart edges', () => {
  const plan=planAnnotation(trade('Put'),bars,'1');
  const geometry={width:500,height:500,bars:Array.from({length:20},(_,i)=>({time:t(i),x:25+i*23,highY:120,lowY:160}))};
  const labels=placeLabels(plan,geometry);
  assert.equal(labels.length,3);
  for(const label of labels){
    assert.ok(label.bounds.left>=10 && label.bounds.right<=490);
    assert.ok(label.bounds.top>=14 && label.bounds.bottom<=geometry.height-24);
    assert.ok(label.bounds.bottom<115 || label.bounds.top>165);
    assert.ok(Math.abs(label.anchor.x-label.label.x)>=40);
    for(const bar of geometry.bars) {
      assert.equal(segmentIntersectsBox(label.anchor,label.label,{left:bar.x-5,right:bar.x+5,top:bar.highY,bottom:bar.lowY}),false);
    }
  }
  for(let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++) {
    const a=labels[i].bounds,b=labels[j].bounds;
    assert.ok(a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top);
  }
});

test('leader collision check catches a wick between clear endpoints in either direction', () => {
  const wick={left:49,right:51,top:40,bottom:80};
  assert.equal(segmentIntersectsBox({x:0,y:0},{x:100,y:100},wick),true);
  assert.equal(segmentIntersectsBox({x:100,y:100},{x:0,y:0},wick),true);
  assert.equal(segmentIntersectsBox({x:0,y:100},{x:100,y:150},wick),false);
});

test('BUY and SELL in the same candle use distinct visible wick anchors',()=>{
  const geometry={width:1000,height:600,bars:Array.from({length:40},(_,i)=>({time:t(i),x:100+i*20,highY:200,lowY:250}))};
  const plan={id:2940,fills:[{time:t(12),side:'BUY',text:'BUY 1 @ $1.19',transaction_index:0},{time:t(12),side:'SELL',text:'SELL 1 @ $1.33',transaction_index:1}]};
  const [buy,sell]=placeLabels(plan,geometry);
  assert.equal(buy.anchor.y,258);assert.equal(sell.anchor.y,192);
  assert.notDeepEqual(buy.anchor,sell.anchor);
  for(const [a,b] of [[buy,sell],[sell,buy]])assert.equal(segmentIntersectsBox(a.anchor,a.label,{left:b.anchor.x-6,right:b.anchor.x+6,top:b.anchor.y-6,bottom:b.anchor.y+6}),false);
});

test('adjacent fill candles at a wide view retain visible anchors and clear leaders', () => {
  const geometry={width:1200,height:600,bars:Array.from({length:60},(_,i)=>({time:t(i),x:200+i*11,highY:120,lowY:160}))};
  const labels=placeLabels(planAnnotation(trade('Put'),bars,'1'),geometry);
  assert.equal(labels.length,3);
  for(const label of labels) for(const other of labels) {
    if(label.transaction_index===other.transaction_index)continue;
    assert.equal(segmentIntersectsBox(label.anchor,label.label,{left:other.anchor.x-6,right:other.anchor.x+6,top:other.anchor.y-6,bottom:other.anchor.y+6}),false);
    const box=label.bounds,anchor=other.anchor;
    assert.ok(anchor.x+14<=box.left||anchor.x-14>=box.right||anchor.y+14<=box.top||anchor.y-14>=box.bottom);
  }
});

test('dense real trade clusters fit every fill without changing the chart view', () => {
  const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/journal-crowded-labels.json',import.meta.url),'utf8'));
  for(const plan of fixture.plans) {
    const labels=placeLabels(plan,fixture.geometry);
    assert.equal(labels.length,plan.fills.length);
    assert.deepEqual(labels.map(n=>n.transaction_index),plan.fills.map(f=>f.transaction_index));
    for(const label of labels) for(const other of labels) {
      if(label===other)continue;
      const a=label.bounds,b=other.bounds;
      assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);
      assert.equal(segmentIntersectsBox(label.anchor,label.label,other.bounds),false);
    }
  }
});

test('a note cannot hide another fill anchor on a rising sequence of candles', () => {
  // Screen geometry from the first guided trade, rounded to pixels.
  const screenBars = [[-6,586,555,599],[-5,602,513,571],[-4,617,526,595],[-3,633,553,605],
    [-2,648,553,606],[-1,664,575,626],[0,680,509,583],[1,695,444,527],
    [2,711,445,518],[3,726,387,449],[4,742,389,431],[5,758,398,435],
    [6,773,410,507],[7,789,438,499],[8,804,431,492],[9,820,443,512]];
  const geometry={width:1200,height:900,bars:screenBars.map(([minute,x,highY,lowY])=>({time:t(minute),x,highY,lowY}))};
  const labels=placeLabels(planAnnotation(trade('Call'),bars,'1'),geometry);
  for(const note of labels) for(const other of labels) {
    const b=note.bounds,a=other.anchor;
    assert.ok(a.x+14<=b.left || a.x-14>=b.right || a.y+14<=b.top || a.y-14>=b.bottom,
      `note ${note.transaction_index} covers anchor ${other.transaction_index}`);
  }
});

test('review draft receives geometry and IDs while keeping visual review pending', () => {
  const snapshot={date:'2026-09-24',trades:[{...trade('Put'),date:'9/24/2026',time_frame:1,entry_candle:'06:59',outcome:'Win',tags:[]}],groups:[]};
  const plan=planAnnotation(snapshot.trades[0],bars,'1');
  const result={id:1,chart_path:'/tmp/run/trade-1.png',position_entity_id:'tool-1',position_rr:{entity_id:'tool-1',source:'tradingview_position_tool_label',label:'1.19',compact:true,value:1.19},
    position_start_candle_time:plan.start.time,position_end_candle_time:plan.end.time,position_mfe_candle_time:plan.mfe.time,
    position_entry_price:plan.start.price,position_target_price:plan.end.price,
    position_stop_price:plan.stop_price,stop_distance:.5,resolution:'1',
    visible_range:{from:t(0)-60,to:t(3)+60},
    transaction_markers:plan.fills.map((f,i)=>({...f,entity_id:`label-${i}`,leader_entity_id:`leader-${i}`}))};
  const review=prefillReview(snapshot,'/tmp/run',[result],[]);
  assert.equal(review.trades[0].rr,1.19);
  assert.match(review.trades[0].rr_evidence,/tool-1/);
  assert.match(review.trades[0].rr_evidence,/1\.19/);
  const missing=structuredClone(result);delete missing.position_rr;
  assert.throws(()=>prefillReview(snapshot,'/tmp/run',[missing],[]),/RR/);
  assert.equal(review.trades[0].chart_annotations.position_entity_id,'tool-1');
  assert.equal(review.trades[0].chart_annotations.transaction_markers[0].entity_id,'label-0');
  assert.equal(review.trades[0].chart_annotations.overlap_checked,false);
  assert.equal(review.trades[0].chart_reviewed,false);
});
