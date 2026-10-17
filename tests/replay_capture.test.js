import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildReplayLedger,mapReplayDrawings,pacific} from '../src/core/replay-capture.js';
import {publishFrozenBacktestDay} from '../src/core/trading-sync.js';
const source=JSON.parse(await fs.readFile(new URL('./fixtures/replay-mes-scale.json',import.meta.url),'utf8'));
const fixture=()=>structuredClone(source);

test('MES scaling: 10 unique fills form 2 trades, with 8 matched lots and reconciled P/L',()=>{
  const ledger=buildReplayLedger(fixture(),'2026-09-01'),[long,short]=ledger.trades;
  assert.deepEqual([ledger.trade_count,ledger.fill_count,ledger.matched_row_count,ledger.net_pnl],[2,10,8,297.5]);
  assert.deepEqual(long.transactions.map(t=>t.position_after),[5,2,5,2,4,0]);
  assert.deepEqual(short.transactions.map(t=>t.position_after),[-5,-2,-1,0]);
  assert.deepEqual([long.entered_quantity,long.peak_quantity,long.net_pnl],[10,5,176.25]);
  assert.deepEqual([short.entered_quantity,short.peak_quantity,short.net_pnl],[5,5,121.25]);
  assert.equal(long.matched_lots.at(-1).net_pnl,-45);
  assert.equal(long.realized_r,null);assert.equal(long.initial_cash_risk,null);
  assert.equal(long.entry_candle,'07:10:00');assert.equal(short.exit_candle,'08:18:00');
  assert.deepEqual(ledger.trades.map(t=>t.source_id),buildReplayLedger(fixture(),'2026-09-01').trades.map(t=>t.source_id));
});
test('drawings are context: tick-size geometry never overwrites actual entry or exits',()=>{
  const ledger=buildReplayLedger(fixture(),'2026-09-01');
  const evidence={drawings:ledger.trades.map((t,i)=>({id:'drawing-'+i,name:t.direction+'_position',points:[{time:t.entry_time/1000-180,price:t.weighted_entry_price-.25},{time:t.exit_time/1000+60,price:0}],properties:{stopLevel:22,profitLevel:66}}))};
  const mapped=mapReplayDrawings(ledger,evidence);
  assert.equal(mapped[0].drawing.current_stop_distance,5.5);assert.equal(mapped[0].drawing.current_target_distance,16.5);
  assert.equal(mapped[0].drawing.historical_initial_risk_verified,false);
  assert.equal(mapped[0].transactions[0].price,7725);assert.equal(mapped[0].exit_candle,'07:42:00');
  assert.throws(()=>mapReplayDrawings(ledger,{drawings:[]}),/unique/);
  assert.throws(()=>mapReplayDrawings(ledger,{drawings:[...evidence.drawings,{...evidence.drawings[0],id:'ambiguous'}]}),/unique/);
});
test('missing/duplicate fills, wrong multiplier, truncated rows and conflicting totals fail closed',()=>{
  const changes=[s=>s.report.filledOrders.push(s.report.filledOrders[0]),s=>s.report.filledOrders.shift(),
    s=>s.instrument.point_value=50,s=>s.report.firstTradeIndex=1,s=>s.report.trades.pop(),
    s=>s.report.performance.all.netProfit++,s=>s.report.position.qty=1,
    s=>s.report.filledOrders[1].utm=s.report.filledOrders[0].utm-1,
    s=>s.report.filledOrders[0].q=0,s=>s.report.position.symbolToAccountRate=1.1,
    s=>s.report.trades.push(s.report.trades[0]),s=>s.report.filledOrders[0].b='true'];
  for(const change of changes){const s=fixture();change(s);assert.throws(()=>buildReplayLedger(s,'2026-09-01'));}
});
test('recorded commissions reduce actual net and reconcile independently',()=>{
  const s=fixture();for(const row of s.report.trades){row.cm=1;row.tp.v-=1;}
  s.report.performance.all.netProfit-=8;s.report.performance.all.commissionPaid=8;
  const l=buildReplayLedger(s,'2026-09-01');assert.equal(l.net_pnl,289.5);assert.equal(l.trades[0].commission,5);
  s.report.trades[0].tp.v++;assert.throws(()=>buildReplayLedger(s,'2026-09-01'),/reconciliation/);
});
test('same-time fills use source sequence; display-array order does not change grouping',()=>{
  const s=fixture(),old=s.report.filledOrders[2].utm,time=s.report.filledOrders[1].utm;
  s.report.filledOrders[2].utm=time;for(const r of s.report.trades)if(r.e.tm===old)r.e.tm=time;
  const expected=buildReplayLedger(s,'2026-09-01');s.report.filledOrders.reverse();
  assert.deepEqual(buildReplayLedger(s,'2026-09-01'),expected);
  assert.deepEqual(expected.trades[0].transactions.slice(0,3).map(t=>t.position_after),[5,2,5]);
});
test('midnight selection groups the complete history before selecting entry date',()=>{
  const s=fixture(),delta=Date.parse('2026-09-02T06:50:00Z')-s.report.filledOrders[0].utm;
  for(const f of s.report.filledOrders)f.utm+=delta;
  for(const r of s.report.trades){r.e.tm+=delta;r.x.tm+=delta;}
  const previous=buildReplayLedger(s,'2026-09-01'),next=buildReplayLedger(s,'2026-09-02');
  assert.equal(previous.trade_count,1);assert.equal(previous.trades[0].entry_candle,'23:50:00');
  assert.equal(previous.trades[0].exit_candle,'00:22:00');assert.equal(previous.trades[0].net_pnl,176.25);
  assert.equal(next.trade_count,1);assert.equal(next.trades[0].direction,'short');
  assert.equal(pacific(Date.parse('2026-11-02T15:10:00Z')).time,'07:10:00');
});
test('reversal fill closes and opens separate episodes while preserving one source order',()=>{
  const s=fixture(),t=s.report.filledOrders[0].utm;
  s.report.filledOrders=[{id:'a',b:true,p:100,q:2,tm:0,utm:t},{id:'reverse',b:false,p:102,q:3,tm:1,utm:t+60000},{id:'c',b:true,p:101,q:1,tm:2,utm:t+120000}];
  s.report.trades=[{e:{p:100,tm:t,tp:'le'},x:{p:102,tm:t+60000,tp:'lx'},q:2,tp:{v:20},cm:0},{e:{p:102,tm:t+60000,tp:'se'},x:{p:101,tm:t+120000,tp:'sx'},q:1,tp:{v:5},cm:0}];
  s.report.performance.all={netProfit:25,commissionPaid:0,totalTrades:2};
  const l=buildReplayLedger(s,'2026-09-01');assert.equal(l.fill_count,3);assert.equal(l.trade_count,2);
  assert.equal(l.trades[0].transactions[1].quantity,2);assert.equal(l.trades[1].transactions[0].quantity,1);
  assert.equal(l.trades[0].transactions[1].order_id,l.trades[1].transactions[0].order_id);
});
test('legacy publisher rejects replay packs before network access',async()=>{
  await assert.rejects(publishFrozenBacktestDay({capture_kind:'replay_fills'},{_deps:{fetch:()=>assert.fail('Network must not run')}}),/discard transactions/);
});
