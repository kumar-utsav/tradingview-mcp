import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotationWindow } from '../src/core/replay-annotations.js';
import { planAnnotation } from '../workflows/journal-annotate.mjs';

const first = Date.parse('2026-08-31T06:42:00-07:00');
function request() {
  const targetTime = Date.parse('2026-08-31T06:46:00-07:00');
  return { symbol: 'CME_MINI:MES1!', timeframe: '2', targetTime, selectTime: targetTime + 120000,
    annotation: { version: 1, source: 'backtest', tradeId: 561, trade: { id: 561, type: 'Futures', ticker: 'CME_MINI:MES1!', outcome: 'Win', instrument: { tick_size: 0.25 }, transactions: [
      { side: 'SELL', quantity: 4, price: 7687.75, filledTime: new Date(first).toISOString() },
      { side: 'BUY', quantity: 2, price: 7676.75, filledTime: new Date(first + 42 * 60000).toISOString() },
      { side: 'BUY', quantity: 2, price: 7687.75, filledTime: new Date(first + 58 * 60000).toISOString() },
    ] } } };
}

test('full annotation history extends to later exits without changing the requested replay candle', () => {
  const plan = request(), before = structuredClone(plan);
  const window = annotationWindow(plan);
  assert.equal(window.end, first + 58 * 60000);
  assert.ok(window.end > plan.targetTime);
  assert.deepEqual(plan, before);
  const bars = Array.from({ length: 30 }, (_, i) => ({ time: first / 1000 + i * 120, open: 7687, high: 7690, low: 7675, close: 7680 }));
  const drawing = planAnnotation(plan.annotation.trade, bars, '2');
  assert.equal(drawing.end.time, window.last / 1000);
  assert.equal(drawing.end.price, 7676.75);
  assert.equal(drawing.stop_price, 7692.75);
  assert.equal(drawing.fills.length, 3);
});

test('journal fill format follows the same full-trade annotation policy', () => {
  const plan = request();
  plan.annotation.source = 'journal';
  plan.annotation.trade.type = 'Short';
  plan.annotation.trade.transactions.forEach(f => { f.instrumentType = 'FUTURES'; });
  assert.equal(annotationWindow(plan).last, first + 58 * 60000);
});

test('invalid identity, missing timestamps and oversized windows fail before chart access', () => {
  const invalid = request(); invalid.annotation.trade.id = 999;
  assert.throws(() => annotationWindow(invalid), /identity/);
  const missing = request(); missing.annotation.trade.transactions[0].filledTime = 'invalid';
  assert.throws(() => annotationWindow(missing), /timestamp/);
  const excessive = request(); excessive.annotation.trade.transactions[2].filledTime = new Date(first + 20 * 86400000).toISOString();
  assert.throws(() => annotationWindow(excessive), /window/);
});
