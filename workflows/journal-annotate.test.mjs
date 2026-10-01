import test from 'node:test';
import assert from 'node:assert/strict';
import { planAnnotation, placeLabels, prefillReview } from './journal-annotate.mjs';

const at = minute => new Date(Date.parse('2026-09-24T14:00:00Z') + minute * 60000).toISOString();
const t = minute => Math.floor(Date.parse(at(minute)) / 1000);
const bars = [
  {time:t(0),high:100.5,low:100,open:100.2,close:100.3},
  {time:t(1),high:100.3,low:99.5,open:100.2,close:99.8},
  {time:t(2),high:100.1,low:99.7,open:99.9,close:100},
  {time:t(3),high:100.7,low:99.8,open:100,close:100.2},
];
const trade = type => ({id:1,type,ticker:'SPY',transactions:[
  {side:'BUY',quantity:1,price:1.11,filledTime:at(0)},
  {side:'BUY',quantity:1,price:0.92,filledTime:at(1)},
  {side:'SELL',quantity:2,price:1.35,filledTime:at(3)},
]});

test('Put position uses the lowest low through the final flat exit and a $0.50 stop', () => {
  const plan=planAnnotation(trade('Put'),bars,'1');
  assert.deepEqual(plan.start,{time:t(0),price:100});
  assert.deepEqual(plan.end,{time:t(1),price:99.5});
  assert.equal(plan.stop_price,100.5);
  assert.equal(plan.fills[1].text,'BUY 1 @ $0.92');
  assert.equal(plan.fills[2].text,'SELL 2 @ $1.35');
});

test('Call position uses the highest high and a $0.50 stop below entry', () => {
  const plan=planAnnotation(trade('Call'),bars,'1');
  assert.deepEqual(plan.start,{time:t(0),price:100.5});
  assert.deepEqual(plan.end,{time:t(3),price:100.7});
  assert.equal(plan.stop_price,100);
});

test('missing fill candles and unclosed positions stop annotation', () => {
  assert.throws(()=>planAnnotation(trade('Put'),bars.filter(b=>b.time!==t(1)),'1'),/gap/);
  const open=trade('Put');open.transactions.pop();
  assert.throws(()=>planAnnotation(open,bars,'1'),/final flat exit/);
});

test('labels stay clear of candles, each other, and chart edges', () => {
  const plan=planAnnotation(trade('Put'),bars,'1');
  const geometry={width:500,height:300,bars:Array.from({length:20},(_,i)=>({time:t(i),x:25+i*23,highY:120,lowY:160}))};
  const labels=placeLabels(plan,geometry);
  assert.equal(labels.length,3);
  for(const label of labels){
    assert.ok(label.bounds.left>=10 && label.bounds.right<=490);
    assert.ok(label.bounds.bottom<115 || label.bounds.top>165);
  }
  for(let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++) {
    const a=labels[i].bounds,b=labels[j].bounds;
    assert.ok(a.right<=b.left || b.right<=a.left || a.bottom<=b.top || b.bottom<=a.top);
  }
});

test('review draft receives geometry and IDs while keeping visual review pending', () => {
  const snapshot={date:'2026-09-24',trades:[{...trade('Put'),date:'9/24/2026',time_frame:1,entry_candle:'06:59',outcome:'Win',tags:[]}],groups:[]};
  const plan=planAnnotation(snapshot.trades[0],bars,'1');
  const result={id:1,chart_path:'/tmp/run/trade-1.png',position_entity_id:'tool-1',
    position_start_candle_time:plan.start.time,position_end_candle_time:plan.end.time,
    position_entry_price:plan.start.price,position_target_price:plan.end.price,
    position_stop_price:plan.stop_price,stop_distance:.5,resolution:'1',
    visible_range:{from:t(0)-60,to:t(3)+60},
    transaction_markers:plan.fills.map((f,i)=>({...f,entity_id:`label-${i}`,leader_entity_id:`leader-${i}`}))};
  const review=prefillReview(snapshot,'/tmp/run',[result],[]);
  assert.equal(review.trades[0].chart_annotations.position_entity_id,'tool-1');
  assert.equal(review.trades[0].chart_annotations.transaction_markers[0].entity_id,'label-0');
  assert.equal(review.trades[0].chart_annotations.overlap_checked,false);
  assert.equal(review.trades[0].chart_reviewed,false);
});
