// Opt-in integration test: only Paper Trading or Replay is permitted.
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getClient, evaluate, evaluateAsync, disconnect, reconnectTo } from '../src/connection.js';
import { sessionSnapshot, send } from './order-buttons.mjs';
import { list as listTabs, switchTab } from '../src/core/tab.js';

const replayMode = process.argv.includes('--replay-simulation');
if (!replayMode && !process.argv.includes('--paper-simulation')) throw new Error('Pass --paper-simulation or --replay-simulation to create and clean up simulated test orders');
const mode = replayMode ? 'replay' : 'paper';
const serviceStatus = await send({ action: 'status' });
assert.ok([mode, 'connected'].includes(serviceStatus.mode), 'Expected connected or matching simulator mode');
await reconnectTo(serviceStatus.target);
const snapshot = await sessionSnapshot();
assert.equal(snapshot.brokerId, replayMode ? 'REPLAYBROKER' : 'Paper');
assert.equal(snapshot.accountType, 'demo');
if (replayMode) {
  assert.equal(await evaluate(`(()=>{const p=window.TradingViewApi._replayApi.isAutoplayStarted();return typeof p?.value==='function'?p.value():p})()`), false, 'Pause Replay before running this test');
}
const chartTabs = await listTabs();
const tabIndex = chartTabs.tabs.findIndex(tab => tab.id === serviceStatus.target);
assert.notEqual(tabIndex, -1, 'Service chart tab must exist');
await switchTab({ index: tabIndex });
const c = await getClient();
const created = [];
const samples = [];
let report;
const read = () => evaluateAsync(`(async()=>{
  const b=window.TradingViewApi._tradingService.trading().activeBroker();
  if(b.metainfo().id!==${JSON.stringify(replayMode ? 'REPLAYBROKER' : 'Paper')}||b.currentAccountType()!=='demo')throw new Error('Expected simulator required');
  const orders=${replayMode ? 'await b._brokerConnection._brokerConnection.currentAccountApi().ordersCapability.get()' : 'await b.orders()'};
  return orders.map(o=>({id:String(o.id),symbol:o.symbol,side:o.side,type:o.type,qty:o.qty,status:o.status,price:o.limitPrice??o.stopPrice}));
})()`);
const beforeAll = await read();
const before = beforeAll.filter(o => [3, 4, 6].includes(o.status));
const positionsBefore = await evaluateAsync(`window.TradingViewApi._tradingService.trading().activeBroker().positions().then(p=>p.map(x=>({symbol:x.symbol,qty:x.qty,side:x.side})))`);
try {
  await c.Page.bringToFront();
  const focusDeadline = Date.now() + 3000;
  while (!(await evaluate("document.hasFocus() && document.visibilityState === 'visible'"))) {
    if (Date.now() > focusDeadline) throw new Error('TradingView did not receive focus for the keyboard test');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  // Reproduce a vanished/reloaded key handler and a dead legacy binding.
  // Recovery must be automatic and must not submit an order.
  const owner = await evaluate(`window.__tvOrderButtons?.ownerId`);
  assert.ok(owner, 'Service must own the page handler');
  await evaluate(`window.__tvOrderButtons.dispose(); delete window.__tvOrderButtons; delete window.__tvOrderButton`);
  const recoveryDeadline = Date.now() + 2000;
  while (!(await evaluate(`window.__tvOrderButtons?.ownerId===${JSON.stringify(owner)} && typeof window.__tvOrderButtons?.drain==='function'`))) {
    if (Date.now() > recoveryDeadline) throw new Error('Page handler recovery failed');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const rect = await evaluate(`(()=>{const r=document.querySelector('.chart-gui-wrapper').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  for (let index = 0; index < 4; index++) {
    for (const [quantity, modifiers] of [[4, 0], [3, 8], [2, 2], [1, 10]]) {
      const previousId = (await send({ action: 'status' })).history.at(-1)?.id;
      const y = rect.y + rect.h * (index === 0 || index === 3 ? .82 : .18);
      await c.Input.dispatchMouseEvent({ type: 'mouseMoved', x: rect.x + rect.w * .65, y });
      await new Promise(resolve => setTimeout(resolve, 30));
      const alias = (quantity === 4 || quantity === 2) && (index === 1 || index === 2);
      const key = alias ? (index === 1 ? 'F17' : 'F18') : 'F' + (13 + index);
      const virtualKey = alias ? (index === 1 ? 128 : 129) : 124 + index;
      await c.Input.dispatchKeyEvent({ type: 'keyDown', key, code: key, windowsVirtualKeyCode: virtualKey, modifiers });
      await c.Input.dispatchKeyEvent({ type: 'keyUp', key, code: key, windowsVirtualKeyCode: virtualKey, modifiers });
      let result;
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const status = await send({ action: 'status' });
        if (status.history.at(-1)?.id && status.history.at(-1).id !== previousId) { result = status.history.at(-1); break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(result, 'Hotkey must acknowledge an order');
      if (result.id) created.push(result.id);
      assert.equal(result.verified, true, JSON.stringify(result));
      assert.equal(result.status, 6, 'Test order must remain working');
      assert.equal(result.quantity, quantity);
      samples.push(result);
    }
  }
  const rapid = await Promise.all([1, 2, 3, 7].map((quantity, index) => send({ action: 'order', request: { id: randomUUID(), side: index % 2 ? 'sell' : 'buy', type: 'limit', quantity, price: index % 2 ? 10000 + quantity : 5000 - quantity, chartSymbol: snapshot.chartSymbol, capturedAt: Date.now(), replaySession: snapshot.replaySession, replayTime: snapshot.replayTime } })));
  for (const result of rapid) {
    if (result.id) created.push(result.id);
    assert.equal(result.verified, true, JSON.stringify(result));
    assert.equal(result.status, 6);
    samples.push(result);
  }
  const after = await read();
  assert.equal(new Set(created).size, 20);
  for (const id of [...before.map(o => o.id), ...created]) assert.equal(after.find(o => o.id === id)?.status, 6, 'Every prior order must still be working');
  const positions = await evaluateAsync(`window.TradingViewApi._tradingService.trading().activeBroker().positions().then(p=>p.map(x=>({symbol:x.symbol,qty:x.qty,side:x.side})))`);
  assert.deepEqual(positions, positionsBefore, 'Existing positions must not change');
  for (const prior of beforeAll) assert.deepEqual(after.find(o => o.id === prior.id), prior, 'Every preexisting order must remain unchanged');
  const clockAfter = (await sessionSnapshot()).replayTime;
  if (replayMode) assert.equal(clockAfter, snapshot.replayTime, 'Test must not advance or reset Replay');
  report = { testedAt: new Date().toISOString(), broker: snapshot.broker, symbol: snapshot.symbol, pageHandlerRecoveryVerified: true, legacyBindingIndependent: true, nativeHotkeyOrders: 16, rapidQueuedOrders: 4, independentWorkingOrders: after.filter(o => o.status === 6).length, allIndependent: true, positionsUnchanged: true, existingOrdersUnchanged: true, ...(replayMode ? { replayClockUnchanged: true, replayTime: clockAfter } : {}), elapsedMs: samples.map(r => r.totalMs), orders: samples };
  console.log(JSON.stringify({ pass: true, hotkeys: 16, queued: 4, independentWorkingOrders: report.independentWorkingOrders, minMs: Math.min(...report.elapsedMs), maxMs: Math.max(...report.elapsedMs) }));
} finally {
  if (created.length) {
    await evaluateAsync(`(async()=>{const t=window.TradingViewApi._tradingService.trading(),b=t.activeBroker();if(b.metainfo().id!==${JSON.stringify(replayMode ? 'REPLAYBROKER' : 'Paper')}||b.currentAccountType()!=='demo'||String(b.currentAccount())!==${JSON.stringify(snapshot.account)}${replayMode ? '||b.sessionId()!==' + JSON.stringify(snapshot.replaySession) : ''})throw new Error('Simulator account/session changed; no cleanup attempted');for(const id of ${JSON.stringify(created)})await b.cancelOrder(id);})()`);
    let remaining;
    const cleanupDeadline = Date.now() + 5000;
    do {
      remaining = await read();
      if (created.every(id => !remaining.some(o => o.id === id && [3, 4, 6].includes(o.status)))) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < cleanupDeadline);
    assert.ok(created.every(id => !remaining.some(o => o.id === id && [3, 4, 6].includes(o.status))), 'All generated test orders must be cleaned up');
    if (report) {
      report.cleanupVerified = true;
      report.cleanedTestOrders = created.length;
      const folder = await mkdtemp(join(tmpdir(), 'tv-order-verification-'));
      const reportPath = join(folder, mode + '.json');
      await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify({ reportPath }));
    }
    console.log(JSON.stringify({ cleanedTestOrders: created.length }));
  }
  await disconnect();
}
