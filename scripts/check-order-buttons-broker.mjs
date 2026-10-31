#!/usr/bin/env node
// Read-only/dry-run validation. Never starts a service or enables submission.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { evaluateAsync, disconnect, getClient } from '../src/connection.js';
import { selectOrderTarget, sessionSnapshot } from './order-buttons.mjs';
import { runOrder } from '../src/core/order-buttons.js';

const tradeStation = process.argv.includes('--tradestation');
const brokerName = tradeStation ? 'TradeStation' : 'Webull';
const brokerId = tradeStation ? 'TRADESTATION' : 'WEBULL';
const target = process.argv.slice(2).find(arg => !arg.startsWith('--')) || null;

try {
  await selectOrderTarget('dry-run', target, brokerName);
  const snapshot = await sessionSnapshot();
  assert.equal(snapshot.brokerId, brokerId, 'Expected the selected broker adapter');
  assert.equal(snapshot.inReplay, false, 'Replay must not be active');
  const market = await evaluateAsync(`(async()=>{
    const t=window.TradingViewApi._tradingService.trading(),b=t.activeBroker();
    if(b.metainfo().id!==${JSON.stringify(brokerId)})throw new Error('Expected selected broker');
    const symbol=(await t.getActualSymbol(t.linking().value().symbol)).symbol;
    const [info,quotes]=await Promise.all([b.symbolInfo(symbol),b.quotesSnapshot(symbol)]);
    return {symbol,minTick:info.minTick,quantity:info.qty,bid:quotes.bid,ask:quotes.ask};
  })()`);
  assert.ok(Number.isFinite(market.minTick) && market.minTick > 0);
  assert.ok(Number.isFinite(market.bid) && Number.isFinite(market.ask) && market.bid <= market.ask);
  const policy = { mode: 'dry-run', allowLive: false, broker: snapshot.broker, account: snapshot.account, symbol: snapshot.symbol };
  const client = await getClient();
  const results = [];
  for (const side of ['buy', 'sell']) for (const type of ['limit', 'stop']) for (const quantity of [4, 3, 2, 1]) {
    // Keep every proposed order safely on its pending side of the snapshot.
    const above = (side === 'buy') === (type === 'stop');
    const price = above ? market.ask + 100 * market.minTick : market.bid - 100 * market.minTick;
    const result = await runOrder({ id: randomUUID(), side, type, quantity, price, chartSymbol: snapshot.chartSymbol, capturedAt: Date.now() }, policy, client);
    assert.equal(result.submitted, false);
    assert.equal(result.verified, true);
    results.push({ side, type, quantity, verified: true, submitted: false });
  }
  console.log(JSON.stringify({ pass: true, target: brokerName, accountType: snapshot.accountType, market, checks: results.length, submitted: false, limitation: 'Quote freshness, market-data entitlement, and real broker acceptance are not established by this check.' }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ pass: false, submitted: false, error: error.message }));
  process.exitCode = 1;
} finally {
  await disconnect();
}
