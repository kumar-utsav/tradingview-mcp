#!/usr/bin/env node
import net from 'node:net';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import CDP from 'chrome-remote-interface';
import { evaluate, evaluateAsync, disconnect, reconnectTo, CDP_HOST, CDP_PORT } from '../src/connection.js';
import { runOrder, validateOrderRequest, evaluateOrderPage } from '../src/core/order-buttons.js';
import { OrderButtonQueue } from '../src/core/order-button-queue.js';

export const socketPath = join(tmpdir(), `tv-order-buttons-${process.getuid()}.sock`);

function installKeys(mode, quantities, ownerId, brokerLabel) {
  if (!document.body) { document.addEventListener('DOMContentLoaded', () => installKeys(mode, quantities, ownerId, brokerLabel), { once: true }); return; }
  window.__tvOrderButtons?.dispose();
  document.getElementById('tv-order-buttons-status')?.remove();
  document.getElementById('tv-order-preview-status')?.remove();
  let pointer = null;
  const onMove = event => { if (event.isTrusted) pointer = { x: event.clientX, y: event.clientY }; };
  const clearPointer = () => { pointer = null; };
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerleave', clearPointer);
  window.addEventListener('blur', clearPointer);
  const outbox = [];
  const enqueue = message => {
    if (outbox.length >= 64) { console.warn('Order button link backlog; nothing added'); return; }
    outbox.push(message);
  };
  const feedback = text => enqueue({ feedback: text });
  feedback(mode === 'replay' ? 'REPLAY TRADING · historical simulated orders enabled' : mode === 'paper' ? 'PAPER TRADING · independent simulated orders enabled' : mode === 'connected' ? `${brokerLabel} · connected-account order shortcuts enabled` : mode === 'live' ? `LIVE ${brokerLabel} · real order submission enabled` : mode === 'broker-demo' ? `${brokerLabel} DEMO · simulated orders enabled` : `${brokerLabel} DRY RUN · nothing will be submitted`);
  const capture = () => {
    if (!document.hasFocus() || document.visibilityState !== 'visible') throw new Error('Focus the connected TradingView tab');
    const trading = window.TradingViewApi?._tradingService?.trading();
    const chart = window.TradingViewApi?._activeChartWidgetWV.value()._chartWidget;
    const series = chart?.model().mainSeries();
    const pane = chart?.paneWidgets().find(p => p.state().dataSources().includes(series));
    const rect = pane?.canvasElement().getBoundingClientRect();
    if (!pointer || !rect || pointer.x < rect.left || pointer.x >= rect.right || pointer.y < rect.top || pointer.y >= rect.bottom) throw new Error('Move the cursor over the price chart');
    // Read the price at the actual pointer Y. Native crosshairPrice can snap to
    // a candle/drawing when modifier keys temporarily enable magnet behavior.
    const price = series.priceScale().coordinateToPrice((pointer.y - rect.top) * pane.height() / rect.height, series.firstValue());
    if (!Number.isFinite(price)) throw new Error('Chart price scale is not ready');
    const broker = trading.activeBroker();
    const replayTime = window.TradingViewApi._replayApi?.currentDate();
    return { price, capturedAt: Date.now(), chartSymbol: trading.linking().value().symbol,
      ...(broker.metainfo().id === 'REPLAYBROKER' ? { replaySession: broker.sessionId(), replayTime: typeof replayTime?.value === 'function' ? replayTime.value() : replayTime } : {}) };
  };
  const onKey = e => {
    // F14/F15 can be intercepted before reaching Electron on macOS.
    const key = e.code || e.key;
    const index = key === 'F17' ? 1 : key === 'F18' ? 2 : ['F13', 'F14', 'F15', 'F16'].indexOf(key);
    if (index < 0 || e.altKey || e.metaKey || !e.isTrusted) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    if (document.activeElement?.matches('input,textarea,[contenteditable="true"]')) { feedback('Finish editing the input before placing an order'); return; }
    try {
      const [side, type] = [['buy', 'limit'], ['buy', 'stop'], ['sell', 'limit'], ['sell', 'stop']][index];
      const quantity = quantities[e.ctrlKey ? (e.shiftKey ? 3 : 2) : (e.shiftKey ? 1 : 0)];
      enqueue({ request: { id: crypto.randomUUID(), side, type, quantity, ...capture() } });
    } catch (error) { feedback(error.message); }
  };
  document.addEventListener('keydown', onKey, true);
  window.__tvOrderButtons = { ownerId, drain: () => outbox.splice(0), feedback, capture, dispose: () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointermove', onMove, true); document.removeEventListener('pointerleave', clearPointer); window.removeEventListener('blur', clearPointer); } };
}

export async function sessionSnapshot(client = null) {
  const read = client ? expression => evaluateOrderPage(client, expression) : evaluateAsync;
  return read(`(async () => {
    const trading = window.TradingViewApi?._tradingService?.trading();
    const broker = trading?.activeBroker();
    if (!broker?.isConnected()) throw new Error('Connect the intended broker first');
    const chartSymbol = trading.linking().value().symbol;
    const replay = trading.isInReplay();
    const replayTime = window.TradingViewApi._replayApi?.currentDate();
    return { broker: broker.metainfo().title, brokerId: broker.metainfo().id,
      account: String(broker.currentAccount()), accountType: broker.currentAccountType(),
      symbol: (await trading.getActualSymbol(chartSymbol)).symbol, chartSymbol,
      inReplay: typeof replay?.value === 'function' ? replay.value() : replay,
      replaySession: broker.metainfo().id === 'REPLAYBROKER' ? broker.sessionId() : null,
      replayTime: typeof replayTime?.value === 'function' ? replayTime.value() : replayTime };
  })()`);
}

export async function selectOrderTarget(mode, targetId = null, executionBroker = 'Webull') {
  const targets = await CDP.List({ host: CDP_HOST, port: CDP_PORT });
  const eligible = [];
  for (const target of targets.filter(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url) && (!targetId || t.id === targetId))) {
    let probe;
    try {
      probe = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });
      const { result } = await probe.Runtime.evaluate({ expression: `(()=>{const t=window.TradingViewApi?._tradingService?.trading(),b=t?.activeBroker(),r=t?.isInReplay();return {brokerId:b?.metainfo().id,title:b?.metainfo().title,visible:document.visibilityState==='visible',focused:document.hasFocus()&&document.visibilityState==='visible',replay:typeof r?.value==='function'?r.value():r}})()`, returnByValue: true });
      const state = result.value;
      if (state && (mode === 'connected' ? (state.visible || !!targetId) && ['Paper', 'REPLAYBROKER', 'WEBULL', 'TRADESTATION'].includes(state.brokerId) : mode === 'replay' ? state.brokerId === 'REPLAYBROKER' && state.replay : mode === 'paper' ? state.brokerId === 'Paper' && !state.replay : state.title === executionBroker && !state.replay)) eligible.push({ ...target, focused: state.focused });
    } catch {
      // Ignore tabs that closed or are not ready; they cannot be destinations.
    } finally { await probe?.close(); }
  }
  const selected = eligible.find(t => t.focused) || (eligible.length === 1 ? eligible[0] : null);
  if (!selected) throw new Error(eligible.length ? 'Multiple matching chart tabs; focus the intended tab or pass --target TARGET_ID' : 'No connected chart tab matches the requested execution mode');
  await reconnectTo(selected.id);
  return selected;
}

export async function serve({ mode, allowLive = false, quantities = [4, 3, 2, 1], targetId = null, executionBroker = 'Webull' }) {
  if (!['paper', 'replay', 'dry-run', 'live', 'broker-demo', 'connected'].includes(mode)) throw new Error('Choose a supported mode; the standard launcher uses --connected');
  if (!['Webull', 'TradeStation'].includes(executionBroker)) throw new Error('Unsupported broker');
  if (mode === 'connected') allowLive = true; // Explicit user-selected execution mode.
  if (mode === 'live' && !allowLive) throw new Error('Live activation requires --enable-live-orders');
  if (quantities.length !== 4 || quantities.some(qty => !Number.isSafeInteger(qty) || qty < 1)) throw new Error('--sizes requires four positive whole numbers');
  const target = await selectOrderTarget(mode, targetId, executionBroker);
  let c = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });
  const snapshot = await sessionSnapshot(c);
  if (mode === 'connected' ? !['Paper', 'REPLAYBROKER', 'WEBULL', 'TRADESTATION'].includes(snapshot.brokerId) || !['demo', 'live'].includes(snapshot.accountType) || !snapshot.account : mode === 'replay' ? snapshot.brokerId !== 'REPLAYBROKER' || snapshot.accountType !== 'demo' || !snapshot.inReplay || !Number.isFinite(snapshot.replayTime) : mode === 'paper' ? snapshot.brokerId !== 'Paper' || snapshot.accountType !== 'demo' || snapshot.inReplay : snapshot.broker !== executionBroker || snapshot.brokerId !== (executionBroker === 'TradeStation' ? 'TRADESTATION' : 'WEBULL') || snapshot.inReplay || (mode === 'broker-demo' && snapshot.accountType !== 'demo') || (mode === 'live' && snapshot.accountType !== 'live')) throw new Error('Active broker does not match the selected service mode');
  const policy = { mode, brokerId: snapshot.brokerId, accountType: snapshot.accountType, broker: snapshot.broker, account: snapshot.account, symbol: snapshot.symbol, allowLive, replaySession: snapshot.replaySession };
  try {
    const entry = await lstat(socketPath);
    if (!entry.isSocket() || entry.uid !== process.getuid()) throw new Error('Refusing to replace unrelated socket-path contents');
    try {
      const reply = await send({ action: 'stop' });
      if (!reply.stopping) throw new Error('Existing service does not support automatic replacement; stop it once with Control+C');
      const deadline = Date.now() + 20000;
      while (true) {
        try { await lstat(socketPath); }
        catch (error) { if (error.code === 'ENOENT') break; throw error; }
        if (Date.now() >= deadline) throw new Error('Previous service is still shutting down; new service was not started');
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    catch (error) { if (error.code !== 'ECONNREFUSED') throw error; await unlink(socketPath); }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const queue = new OrderButtonQueue();
  const history = [];
  let stopping = false;
  const link = { connected: true, lastPollAt: null, error: null };
  const display = text => console.log(JSON.stringify({ event: 'order-buttons', message: text }));
  const execute = async request => {
    if (stopping) throw new Error('Order button service is stopping');
    if (!link.connected || !link.lastPollAt || Date.now() - link.lastPollAt > 2000) throw new Error('Chart link is disconnected; wait for reconnection or restart the service');
    validateOrderRequest(request);
    if (typeof request.id !== 'string' || !request.id || request.id.length > 100) throw new Error('Missing request ID');
    const result = await queue.enqueue(request, async frozen => {
      if (stopping) throw new Error('Service replaced; queued order was not submitted');
      const result = await runOrder(frozen, policy, c);
      history.push(result);
      if (history.length > 32) history.shift();
      const summary = `${result.side} ${result.type} ${result.quantity} @ ${result.price} · ${result.symbol}`;
      await display(result.uncertain ? 'CHECK ORDERS · ' + result.error : result.error ? 'REJECTED · ' + result.error : mode === 'dry-run' ? `DRY RUN · ${summary} · nothing submitted` : `${mode.toUpperCase()} · ${summary} · ID ${result.id} · ${result.status === 2 ? 'FILLED' : 'working'} · ${Math.round(result.totalMs)} ms`);
      return result;
    });
    return result;
  };
  const handle = async message => {
    if (message.action === 'stop') {
      stopping = true;
      setTimeout(() => { void shutdown(); }, 25);
      return { stopping: true };
    }
    if (message.action === 'status') return { mode, broker: policy.broker, accountType: policy.accountType, symbol: policy.symbol, target: target.id, quantities, pending: queue.pending, blocked: queue.blocked, link: { ...link, healthy: link.connected && !!link.lastPollAt && Date.now() - link.lastPollAt <= 2000 }, history };
    if (message.action !== 'order') throw new Error('Expected status or order');
    return execute(message.request);
  };
  const server = net.createServer(socket => {
    let input = '', handled = false;
    socket.setTimeout(15000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', async chunk => {
      if (handled) return;
      input += chunk;
      if (input.length > 8192) { handled = true; socket.end(JSON.stringify({ error: 'Request too large' }) + '\n'); return; }
      if (!input.includes('\n')) return;
      handled = true;
      try { socket.end(JSON.stringify(await handle(JSON.parse(input.split('\n')[0]))) + '\n'); }
      catch (e) { socket.end(JSON.stringify({ error: e.message }) + '\n'); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  const ownerId = randomUUID();
  const source = `(${installKeys.toString()})(${JSON.stringify(mode)},${JSON.stringify(quantities)},${JSON.stringify(ownerId)},${JSON.stringify(policy.broker)})`;
  const installed = await c.Page.addScriptToEvaluateOnNewDocument({ source });
  await evaluateOrderPage(c, source);
  // Pull the page outbox instead of relying on Runtime.bindingCalled events:
  // a binding function can remain in a reloaded page after its event link dies.
  let polling = false;
  let nextReconnectAt = 0;
  const poll = async () => {
    if (polling || stopping) return;
    polling = true;
    try {
      const response = await c.Runtime.evaluate({ expression: `(()=>{const keys=window.__tvOrderButtons;return keys?.ownerId===${JSON.stringify(ownerId)}?{installed:true,messages:keys.drain()}:{installed:false}})()`, returnByValue: true });
      if (response.exceptionDetails || !response.result?.value) throw new Error('Chart outbox unavailable');
      link.connected = true; link.lastPollAt = Date.now(); link.error = null;
      if (!response.result.value.installed) {
        const installed = await c.Runtime.evaluate({ expression: source, returnByValue: true });
        if (installed.exceptionDetails) throw new Error('Could not restore the chart key handler');
      } else {
        for (const message of response.result.value.messages) {
          if (typeof message.feedback === 'string') display(message.feedback.slice(0, 1000));
          else if (message.request) void execute(message.request).catch(error => display('NOT SENT · ' + error.message.split('\n')[0].replace(/^JS evaluation error: Error: /, '')));
        }
      }
    } catch (error) {
      if (link.connected) display('Chart link lost; reconnecting to the same tab');
      link.connected = false; link.error = error.message;
      if (Date.now() >= nextReconnectAt) {
        nextReconnectAt = Date.now() + 2000;
        try { await c.close().catch(() => {}); c = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id }); } catch { /* Never attach to another tab. */ }
      }
    } finally { polling = false; }
  };
  const pollTimer = setInterval(() => { void poll(); }, 25);
  await poll();
  console.log(JSON.stringify({ ready: true, mode, broker: policy.broker, accountType: policy.accountType, symbol: policy.symbol, socket: socketPath }));
  let shutdownStarted = false;
  const shutdown = async () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    stopping = true;
    clearInterval(pollTimer);
    await closeOrderService(server, async () => {
      while (polling) await new Promise(resolve => setTimeout(resolve, 25));
      await evaluateOrderPage(c, `if(window.__tvOrderButtons?.ownerId===${JSON.stringify(ownerId)}){window.__tvOrderButtons.dispose();delete window.__tvOrderButtons}`).catch(() => {});
      // Let accepted requests finish acknowledgement before disconnecting.
      while (queue.pending) await new Promise(resolve => setTimeout(resolve, 50));
      await c.Page.removeScriptToEvaluateOnNewDocument({ identifier: installed.identifier }).catch(() => {});
      await c.close().catch(() => {});
      await disconnect();
    });
    process.exit(0);
  };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  return server;
}

/** Keep the owned socket present until cleanup/acknowledgements are complete. */
export async function closeOrderService(server, cleanup) {
  await cleanup();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  // Node removes this server's Unix socket. Never unlink a replacement's path.
}

export async function send(message) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let text = '';
    socket.setTimeout(15000, () => socket.destroy(new Error('Response timed out; inspect orders before retrying')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify(message) + '\n'));
    socket.on('data', chunk => { text += chunk; });
    socket.on('end', () => { try { resolve(JSON.parse(text)); } catch (e) { reject(e); } });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === 'status') console.log(JSON.stringify(await send({ action: 'status' }), null, 2));
    else if (args[0] === 'serve') {
      const modes = ['--connected', '--paper', '--replay', '--live-webull', '--dry-run-webull', '--demo-tradestation', '--live-tradestation', '--dry-run-tradestation'].filter(flag => args.includes(flag));
      if (modes.length !== 1) throw new Error('Select exactly one execution mode');
      const sizeIndex = args.indexOf('--sizes');
      if (args.includes('--target') && (!args[args.indexOf('--target') + 1] || args[args.indexOf('--target') + 1].startsWith('--'))) throw new Error('--target requires a chart target ID');
      await serve({ executionBroker: modes[0].endsWith('-tradestation') ? 'TradeStation' : 'Webull', mode: modes[0] === '--connected' ? 'connected' : modes[0] === '--replay' ? 'replay' : modes[0] === '--paper' ? 'paper' : modes[0] === '--demo-tradestation' ? 'broker-demo' : modes[0].startsWith('--live-') ? 'live' : 'dry-run', allowLive: args.includes('--enable-live-orders'), quantities: sizeIndex < 0 ? [4, 3, 2, 1] : (args[sizeIndex + 1] || '').split(',').map(Number), targetId: args.includes('--target') ? args[args.indexOf('--target') + 1] : null });
    }
    else if (args[0] === 'order') {
      const [, side, type, qty = '4'] = args;
      const status = await send({ action: 'status' });
      await reconnectTo(status.target);
      const priceIndex = args.indexOf('--price');
      const snap = await sessionSnapshot();
      const capture = priceIndex < 0 ? await evaluate('window.__tvOrderButtons.capture()') : { price: Number(args[priceIndex + 1]), capturedAt: Date.now(), chartSymbol: snap.chartSymbol, replaySession: snap.replaySession, replayTime: snap.replayTime };
      const result = await send({ action: 'order', request: { id: randomUUID(), side, type, quantity: Number(qty), ...capture } });
      console.log(JSON.stringify(result, null, 2));
      if (result.error) process.exitCode = 1;
      await disconnect();
    } else throw new Error('Use serve --connected | status | order buy|sell limit|stop quantity [--price PRICE]');
  } catch (error) { console.error(error.message); await disconnect(); process.exitCode = 1; }
}
