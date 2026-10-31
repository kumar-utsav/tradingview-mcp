import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import net from 'node:net';
import { mkdtemp, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve, closeOrderService } from '../scripts/order-buttons.mjs';
import { orderInPage, validateOrderRequest, runOrder } from '../src/core/order-buttons.js';
import { OrderButtonQueue } from '../src/core/order-button-queue.js';

const policy = { mode: 'paper', broker: 'Paper Trading', account: 'demo-account', symbol: 'CME_MINI:MES1!' };
const request = overrides => ({ side: 'buy', type: 'limit', quantity: 4, price: 7500.12, chartSymbol: policy.symbol, capturedAt: Date.now(), ...overrides });
function fixture(options = {}) {
  const orders = [];
  const calls = [];
  const broker = {
    metainfo: () => ({ id: options.brokerId || 'Paper', title: options.title || 'Paper Trading' }),
    currentAccount: () => options.account || 'demo-account', currentAccountType: () => options.accountType || 'demo', isConnected: () => true,
    sessionId: () => options.session || 'replay-session',
    symbolInfo: async () => ({ minTick: .25, qty: { min: 1, max: 100, step: 1 } }),
    quotesSnapshot: async () => options.quotes || ({ bid: 7614, ask: 7614.5 }),
    createInitialPreOrder: async order => options.addBrackets ? { ...order, stopLoss: 7400 } : order,
    orders: async () => options.staleReplayCache ? [] : orders,
    _brokerConnection: { _brokerConnection: { currentAccountApi: () => ({ ordersCapability: { get: async () => orders } }) } },
    placeOrder: async order => {
      calls.push({ ...order });
      if (options.throws) throw new Error('network lost');
      orders.push({ ...order, id: String(orders.length + 1), status: 6 });
      return undefined; // Desktop adapter can return no ID; read-back must work.
    },
  };
  const trading = { activeBroker: () => broker, isInReplay: () => ({ value: () => !!options.inReplay }), linking: () => ({ value: () => ({ symbol: policy.symbol }) }), getActualSymbol: async symbol => ({ symbol }) };
  const replay = { isReplayStarted: () => ({ value: () => options.replayStarted !== false }), currentDate: () => ({ value: () => options.replayTime ?? 1700000000 }) };
  const fn = vm.runInNewContext(`(${orderInPage.toString()})`, { window: { TradingViewApi: { _tradingService: { trading: () => trading }, _replayApi: replay } }, performance, Date, setTimeout });
  return { run: (r, p = policy) => fn(r, p), calls, orders };
}

test('opposite-side and repeated orders retain each prior order with unique IDs', async () => {
  const f = fixture();
  for (const r of [request({ quantity: 1 }), request({ side: 'sell', price: 8000, quantity: 2 }), request({ type: 'stop', price: 8000, quantity: 3 }), request({ side: 'sell', type: 'stop', price: 7500, quantity: 4 }), request({ quantity: 7 })]) {
    const result = await f.run(r);
    assert.equal(result.verified, true);
  }
  assert.equal(f.orders.length, 5);
  assert.equal(new Set(f.orders.map(o => o.id)).size, 5);
  assert.deepEqual(f.orders.map(o => o.qty), [1, 2, 3, 4, 7]);
  assert.equal(f.orders[0].limitPrice, 7500);
  assert.ok(f.calls.every(o => !o.id && !o.parentId && !o.stopLoss && !o.takeProfit));
});

for (const [name, r, options, p, error] of [
  ['wrong account', request(), { account: 'other-account' }, policy, /configured destination/],
  ['real broker in paper mode', request(), { brokerId: 'Webull', title: 'Paper Trading' }, policy, /simulator/],
  ['live activation missing', request(), { brokerId: 'Webull', title: 'Webull' }, { ...policy, broker: 'Webull', mode: 'live' }, /explicitly enabled/],
  ['stale captured price', request({ capturedAt: Date.now() - 10000 }), {}, policy, /expired/],
  ['inherited brackets', request(), { addBrackets: true }, policy, /defaults changed/],
  ['marketable buy', request({ price: 8000 }), {}, policy, /marketable/],
  ['triggered sell stop', request({ side: 'sell', type: 'stop', price: 8000 }), {}, policy, /marketable/],
]) test(name + ' is rejected before any submission', async () => {
  const f = fixture(options);
  await assert.rejects(f.run(r, p), error);
  assert.equal(f.calls.length, 0);
});

test('dry-run never places orders', async () => {
  const f = fixture();
  assert.equal((await f.run(request(), { ...policy, mode: 'dry-run' })).submitted, false);
  assert.equal(f.calls.length, 0);
});

test('unknown submission is reported and never automatically retried', async () => {
  const f = fixture({ throws: true });
  const result = await f.run(request());
  assert.equal(result.uncertain, true);
  assert.equal(f.calls.length, 1);
});

test('quantity supports arbitrary positive whole numbers, rejecting invalid sizes', () => {
  assert.equal(validateOrderRequest(request({ quantity: 17 })).quantity, 17);
  for (const quantity of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => validateOrderRequest(request({ quantity })));
});

test('rapid distinct presses are serialized, snapshot their data, and deduplicate repeated IDs', async () => {
  const queue = new OrderButtonQueue();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const seen = [];
  const execute = async r => { await gate; seen.push(r.quantity); return { submitted: true }; };
  const r = { id: 'one', quantity: 1 };
  const a = queue.enqueue(r, execute);
  const duplicate = queue.enqueue(r, execute);
  const b = queue.enqueue({ id: 'two', quantity: 2 }, execute);
  r.quantity = 99;
  assert.equal(a, duplicate);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(queue.pending, 0);
});

test('uncertain result blocks subsequent queued submissions', async () => {
  const queue = new OrderButtonQueue();
  let calls = 0;
  const execute = async () => { calls++; return { uncertain: true }; };
  await queue.enqueue({ id: 'a' }, execute);
  await assert.rejects(queue.enqueue({ id: 'b' }, execute), /outcome unknown/);
  assert.equal(calls, 1);
});

const replayPolicy = { ...policy, mode: 'replay', broker: 'Replay Broker', replaySession: 'replay-session' };
const replayRequest = overrides => request({ replaySession: 'replay-session', replayTime: 1700000000, ...overrides });
const replayOptions = { brokerId: 'REPLAYBROKER', title: 'Replay Broker', inReplay: true };

test('paused Replay uses its current native order store despite stale facade cache', async () => {
  const f = fixture({ ...replayOptions, staleReplayCache: true });
  for (const side of ['buy', 'sell']) for (const type of ['limit', 'stop']) for (const quantity of [1, 2, 3, 4]) {
    const price = (side === 'buy' && type === 'limit') || (side === 'sell' && type === 'stop') ? 7500 : 8000;
    const result = await f.run(replayRequest({ side, type, quantity, price }), replayPolicy);
    assert.equal(result.verified, true);
  }
  assert.equal(f.orders.length, 16);
  assert.equal(new Set(f.orders.map(o => o.id)).size, 16);
  assert.ok(f.orders.every(o => o.status === 6));
});

for (const [name, options, r, p, error] of [
  ['replay stopped', { ...replayOptions, inReplay: false }, replayRequest(), replayPolicy, /active Replay Broker/],
  ['replay toolbar without a started session', { ...replayOptions, replayStarted: false }, replayRequest(), replayPolicy, /Start Replay/],
  ['new replay session', { ...replayOptions, session: 'new-session' }, replayRequest(), replayPolicy, /session changed/],
  ['queued press from a different session', replayOptions, replayRequest({ replaySession: 'old-session' }), replayPolicy, /session changed/],
  ['rewind after key press', { ...replayOptions, replayTime: 1699999900 }, replayRequest(), replayPolicy, /rewound/],
  ['Paper broker cannot receive Replay orders', { inReplay: true }, replayRequest(), { ...replayPolicy, broker: 'Paper Trading' }, /active Replay Broker/],
  ['Webull cannot receive Replay orders', { brokerId: 'WEBULL', title: 'Webull', inReplay: true }, replayRequest(), { ...replayPolicy, broker: 'Webull' }, /active Replay Broker/],
  ['Paper service cannot send while Replay is active', replayOptions, replayRequest(), { ...policy, broker: 'Replay Broker' }, /Replay is active/],
  ['historical quotes determine stop eligibility', { ...replayOptions, quotes: { bid: 7731, ask: 7731 } }, replayRequest({ type: 'stop', price: 7650 }), replayPolicy, /already triggered/],
]) test(name + ' is rejected without sending', async () => {
  const f = fixture(options);
  await assert.rejects(f.run(r, p), error);
  assert.equal(f.calls.length, 0);
});

const tradeStationPolicy = { ...policy, mode: 'broker-demo', broker: 'TradeStation', brokerId: 'TRADESTATION', accountType: 'demo' };
test('TradeStation demo accepts all four order types without cancelling prior orders', async () => {
  const f = fixture({ brokerId: 'TRADESTATION', title: 'TradeStation' });
  for (const side of ['buy', 'sell']) for (const type of ['limit', 'stop']) {
    const above = (side === 'buy') === (type === 'stop');
    assert.equal((await f.run(request({ side, type, price: above ? 8000 : 7500 }), tradeStationPolicy)).verified, true);
  }
  assert.equal(f.orders.length, 4);
});
test('TradeStation demo refuses a real account before submitting', async () => {
  const f = fixture({ brokerId: 'TRADESTATION', title: 'TradeStation', accountType: 'live' });
  await assert.rejects(f.run(request(), tradeStationPolicy), /account type changed/);
  assert.equal(f.calls.length, 0);
});
test('TradeStation live requires explicit activation and a live account', async () => {
  const livePolicy = { ...tradeStationPolicy, mode: 'live', accountType: 'live', allowLive: false };
  const f = fixture({ brokerId: 'TRADESTATION', title: 'TradeStation', accountType: 'live' });
  await assert.rejects(f.run(request(), livePolicy), /explicitly enabled/);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.run(request(), { ...livePolicy, allowLive: true })).verified, true);
});
test('TradeStation dry run validates without submitting', async () => {
  const f = fixture({ brokerId: 'TRADESTATION', title: 'TradeStation' });
  assert.equal((await f.run(request(), { ...tradeStationPolicy, mode: 'dry-run' })).submitted, false);
  assert.equal(f.calls.length, 0);
});
test('live routing refuses an unrelated adapter with the same title', async () => {
  const f = fixture({ brokerId: 'Other', title: 'TradeStation', accountType: 'live' });
  await assert.rejects(f.run(request(), { ...policy, mode: 'live', broker: 'TradeStation', allowLive: true }), /explicitly enabled/);
  assert.equal(f.calls.length, 0);
});

for (const [brokerId, title, accountType, inReplay] of [
  ['Paper', 'Paper Trading', 'demo', false],
  ['REPLAYBROKER', 'Replay Broker', 'demo', true],
  ['WEBULL', 'Webull', 'live', false],
  ['TRADESTATION', 'TradeStation', 'demo', false],
  ['TRADESTATION', 'TradeStation', 'live', false],
]) {
  test(`connected mode routes all 16 combinations to ${title} ${accountType}`, async () => {
    const f = fixture({ brokerId, title, accountType, inReplay, staleReplayCache: inReplay });
    const p = { ...policy, mode: 'connected', broker: title, brokerId, accountType, allowLive: true, replaySession: inReplay ? 'replay-session' : null };
    for (const side of ['buy', 'sell']) for (const type of ['limit', 'stop']) for (const quantity of [4, 3, 2, 1]) {
      const price = (side === 'buy') === (type === 'stop') ? 8000 : 7500;
      assert.equal((await f.run(replayRequest({ side, type, quantity, price }), p)).verified, true);
    }
    assert.equal(f.orders.length, 16);
  });
}
test('connected mode blocks account type changes and unsupported broker identities', async () => {
  const p = { ...policy, mode: 'connected', broker: 'TradeStation', brokerId: 'TRADESTATION', accountType: 'demo', allowLive: true };
  const live = fixture({ brokerId: 'TRADESTATION', title: 'TradeStation', accountType: 'live' });
  await assert.rejects(live.run(request(), p), /account type changed/);
  assert.equal(live.calls.length, 0);
  const other = fixture({ brokerId: 'Other', title: 'Other' });
  await assert.rejects(other.run(request(), { ...p, broker: 'Other', brokerId: 'Other' }), /Unsupported connected/);
  assert.equal(other.calls.length, 0);
});


test('transport failure uses only the pinned client and blocks later queued orders', async () => {
  const queue = new OrderButtonQueue();
  let dispatches = 0;
  const client = { Runtime: { evaluate: async () => { dispatches++; throw new Error('Pinned tab disconnected after dispatch'); } } };
  const first = await queue.enqueue({ ...request(), id: 'first' }, r => runOrder(r, policy, client));
  assert.equal(first.uncertain, true);
  assert.equal(first.submitted, null);
  assert.equal(queue.blocked, true);
  await assert.rejects(queue.enqueue({ ...request(), id: 'second' }, r => runOrder(r, policy, client)), /outcome unknown/);
  assert.equal(dispatches, 1, 'No retry or fallback client may receive the order');
});
test('runOrder requires a pinned client and surfaces known page validation errors', async () => {
  await assert.rejects(runOrder(request(), policy), /pinned chart client/);
  const client = { Runtime: { evaluate: async () => ({ exceptionDetails: { text: 'Quantity outside broker limits' } }) } };
  await assert.rejects(runOrder(request(), policy, client), /Quantity outside/);
});


test('a failed destination preflight never stops the existing service', async () => {
  let socketChecks = 0;
  const start = vm.runInNewContext(`(${serve.toString()})`, {
    selectOrderTarget: async () => { throw new Error('No active destination'); },
    lstat: async () => { socketChecks++; throw new Error('Must not touch old service'); },
  });
  await assert.rejects(start({ mode: 'connected' }), /No active destination/);
  assert.equal(socketChecks, 0);
});
test('replacement waits for shutdown cleanup and keeps its new socket', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'tv-order-service-test-'));
  const path = join(folder, 'service.sock');
  const oldServer = net.createServer(socket => socket.end());
  let replacement;
  try {
    await new Promise(resolve => oldServer.listen(path, resolve));
    let release;
    const draining = new Promise(resolve => { release = resolve; });
    const stopped = closeOrderService(oldServer, () => draining);
    assert.ok((await lstat(path)).isSocket(), 'Old socket must remain while acknowledgement drains');
    release();
    await stopped;
    await assert.rejects(lstat(path), { code: 'ENOENT' });
    replacement = net.createServer(socket => socket.end('ready'));
    await new Promise(resolve => replacement.listen(path, resolve));
    const reply = await new Promise((resolve, reject) => {
      const c = net.createConnection(path); let text = '';
      c.on('error', reject); c.on('data', chunk => { text += chunk; }); c.on('end', () => resolve(text));
    });
    assert.equal(reply, 'ready');
    assert.ok((await lstat(path)).isSocket(), 'Old shutdown must not unlink the new socket');
  } finally {
    if (oldServer.listening) await new Promise(resolve => oldServer.close(resolve));
    if (replacement?.listening) await new Promise(resolve => replacement.close(resolve));
    await rm(folder, { recursive: true, force: true });
  }
});
