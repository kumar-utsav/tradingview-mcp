#!/usr/bin/env node
// Non-submitting validation of every chart registered in the layout.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import CDP from 'chrome-remote-interface';
import { disconnect, CDP_HOST, CDP_PORT } from '../src/connection.js';
import { selectOrderTarget, sessionSnapshot } from './order-buttons.mjs';
import { runOrder, evaluateOrderPage } from '../src/core/order-buttons.js';

const paper = process.argv.includes('--paper');
const tradeStation = process.argv.includes('--tradestation');
if (paper && tradeStation) throw new Error('Select only one broker');
const brokerName = paper ? 'Paper Trading' : tradeStation ? 'TradeStation' : 'Webull';
const brokerId = paper ? 'Paper' : tradeStation ? 'TRADESTATION' : 'WEBULL';
const targetId = process.argv.slice(2).find(arg => !arg.startsWith('--')) || null;
let client;
try {
  const target = await selectOrderTarget(paper ? 'paper' : 'dry-run', targetId, brokerName);
  client = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });
  const snapshot = await sessionSnapshot(client);
  assert.equal(snapshot.brokerId, brokerId, 'Expected the selected broker adapter');
  assert.equal(snapshot.inReplay, false, 'Replay must not be active');
  const charts = snapshot.charts?.length ? snapshot.charts : [{ chartSymbol: snapshot.chartSymbol, symbol: snapshot.symbol }];
  const policy = { mode: 'dry-run', allowLive: false, broker: snapshot.broker, brokerId, accountType: snapshot.accountType, account: snapshot.account, symbol: snapshot.symbol, charts };
  const markets = [];
  let checks = 0;
  for (const chart of charts) {
    const market = await evaluateOrderPage(client, `(async()=>{
      const b=window.TradingViewApi._tradingService.trading().activeBroker();
      if(b.metainfo().id!==${JSON.stringify(brokerId)})throw new Error('Expected selected broker');
      const symbol=${JSON.stringify(chart.symbol)};
      const [info,quotes]=await Promise.all([b.symbolInfo(symbol),b.quotesSnapshot(symbol)]);
      return {symbol,minTick:info.minTick,quantity:info.qty,bid:quotes.bid,ask:quotes.ask};
    })()`);
    assert.ok(Number.isFinite(market.minTick) && market.minTick > 0);
    assert.ok(Number.isFinite(market.bid) && Number.isFinite(market.ask) && market.bid <= market.ask);
    for (const side of ['buy', 'sell']) for (const type of ['limit', 'stop']) for (const quantity of [4, 3, 2, 1]) {
      const above = (side === 'buy') === (type === 'stop');
      const price = above ? market.ask + 100 * market.minTick : market.bid - 100 * market.minTick;
      const result = await runOrder({ id: randomUUID(), chartId: chart.id, side, type, quantity, price, chartSymbol: chart.chartSymbol, capturedAt: Date.now() }, policy, client);
      assert.equal(result.submitted, false);
      assert.equal(result.verified, true);
      assert.equal(result.symbol, chart.symbol);
      checks++;
    }
    markets.push(market);
  }
  console.log(JSON.stringify({ pass: true, target: brokerName, accountType: snapshot.accountType, markets, checks, submitted: false,
    limitation: 'Quote freshness, market-data entitlement, and real broker acceptance are not established by this check.' }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ pass: false, submitted: false, error: error.message }));
  process.exitCode = 1;
} finally {
  await client?.close();
  await disconnect();
}
