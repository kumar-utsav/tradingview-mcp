/* global window, performance */

export function validateOrderRequest(request) {
  if (!['buy', 'sell'].includes(request?.side) || !['limit', 'stop'].includes(request?.type)) throw new Error('Expected buy/sell and limit/stop');
  if (!Number.isSafeInteger(request.quantity) || request.quantity < 1) throw new Error('Quantity must be a positive whole number');
  if (!Number.isFinite(request.price)) throw new Error('No chart price captured');
  return request;
}

/** Evaluate only on the caller's pinned CDP client; never reconnect implicitly. */
export async function evaluateOrderPage(client, expression) {
  const response = await client.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) {
    const error = new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Order page evaluation failed');
    error.pageException = true;
    throw error;
  }
  return response.result?.value;
}

export async function runOrder(request, policy, client) {
  validateOrderRequest(request);
  if (!client?.Runtime?.evaluate) throw new Error('A pinned chart client is required');
  try {
    return await evaluateOrderPage(client, `(${orderInPage.toString()})(${JSON.stringify(request)}, ${JSON.stringify(policy)})`);
  } catch (error) {
    if (error.pageException) throw error; // Page validation rejected before submission.
    // The page may already have sent the order when its transport disappeared.
    // Never retry or allow the queue to continue on an unknown outcome.
    return { mode: policy.mode, broker: policy.broker, symbol: policy.symbol,
      side: request.side, type: request.type, quantity: request.quantity, price: request.price,
      submitted: null, uncertain: true,
      error: 'Chart connection failed; inspect broker orders before retrying: ' + error.message };
  }
}

// Keep self-contained: this function is serialized into the connected chart.
export async function orderInPage(request, policy) {
  const started = performance.now();
  if (!['paper', 'replay', 'dry-run', 'live', 'broker-demo', 'connected'].includes(policy.mode)) throw new Error('Unknown execution mode');
  if (!Number.isSafeInteger(request.quantity) || request.quantity < 1 || !Number.isFinite(request.price)) throw new Error('Invalid quantity or price');
  if (!['buy', 'sell'].includes(request.side) || !['limit', 'stop'].includes(request.type)) throw new Error('Unsupported order type');
  if (!Number.isFinite(request.capturedAt) || Date.now() - request.capturedAt > 5000 || request.capturedAt > Date.now() + 1000) throw new Error('Captured price expired; move the pointer and press again');
  const trading = window.TradingViewApi?._tradingService?.trading();
  const broker = trading?.activeBroker();
  if (!broker) throw new Error('No connected broker');
  const identity = () => ({ id: broker.metainfo().id, title: broker.metainfo().title, account: String(broker.currentAccount()), accountType: broker.currentAccountType() });
  const original = identity();
  const replayDestination = policy.mode === 'replay' || (policy.mode === 'connected' && policy.brokerId === 'REPLAYBROKER');
  const assertDestination = () => {
    const current = identity();
    if ((policy.brokerId && current.id !== policy.brokerId) || (policy.accountType && current.accountType !== policy.accountType)) throw new Error('Broker identity or account type changed');
    if (trading.activeBroker() !== broker || !broker.isConnected() || current.id !== original.id || current.account !== original.account) throw new Error('Broker or account changed');
    if (current.title !== policy.broker || current.account !== policy.account) throw new Error('Connected broker/account does not match the configured destination');
    const replay = trading.isInReplay();
    const inReplay = typeof replay?.value === 'function' ? replay.value() : replay;
    if (policy.mode === 'connected') {
      const names = { Paper: 'Paper Trading', REPLAYBROKER: 'Replay Broker', WEBULL: 'Webull', TRADESTATION: 'TradeStation' };
      if (!policy.brokerId || !policy.accountType || current.title !== names[current.id] || !['demo', 'live'].includes(current.accountType)) throw new Error('Unsupported connected broker/account');
      if (current.accountType === 'live' && policy.allowLive !== true) throw new Error('Live submission has not been explicitly enabled');
      if (['Paper', 'REPLAYBROKER'].includes(current.id) && current.accountType !== 'demo') throw new Error('Simulator account required');
    }
    if (replayDestination) {
      if (!inReplay || current.id !== 'REPLAYBROKER' || current.accountType !== 'demo') throw new Error('Replay mode requires the active Replay Broker');
      const api = window.TradingViewApi._replayApi;
      const started = api?.isReplayStarted();
      const replayTime = api?.currentDate();
      const date = typeof replayTime?.value === 'function' ? replayTime.value() : replayTime;
      if (!(typeof started?.value === 'function' ? started.value() : started) || !Number.isFinite(date)) throw new Error('Start Replay before placing replay orders');
      if (!policy.replaySession || broker.sessionId() !== policy.replaySession || request.replaySession !== policy.replaySession) throw new Error('Replay session changed; restart the Replay order service');
      if (!Number.isFinite(request.replayTime) || date < request.replayTime) throw new Error('Replay was rewound after this press; nothing submitted');
    } else if (inReplay) throw new Error('Replay is active; start the service in Replay mode');
    if (policy.mode === 'paper' && (current.id !== 'Paper' || current.accountType !== 'demo')) throw new Error('Paper mode requires the Paper Trading simulator');
    if (policy.mode === 'broker-demo' && (current.id !== 'TRADESTATION' || current.title !== 'TradeStation' || current.accountType !== 'demo')) throw new Error('TradeStation demo mode requires a demo account');
    if (policy.mode === 'live' && (policy.allowLive !== true || current.accountType !== 'live' || !((current.title === 'Webull' && current.id === 'WEBULL') || (current.title === 'TradeStation' && current.id === 'TRADESTATION')))) throw new Error('Live submission has not been explicitly enabled for this broker and live account');
  };
  assertDestination();
  // Replay's facade and provider caches lag while paused. Read its native
  // replay transport capability so acknowledgement never needs a bar advance.
  const readOrders = replayDestination ? () => broker._brokerConnection._brokerConnection.currentAccountApi().ordersCapability.get() : () => broker.orders();
  const chartSymbol = trading.linking().value().symbol;
  if (chartSymbol !== request.chartSymbol) throw new Error('Chart changed after the key press');
  const resolved = await trading.getActualSymbol(chartSymbol);
  const symbol = resolved.symbol;
  if (symbol !== policy.symbol) throw new Error('Tradable symbol changed: ' + symbol);
  const [info, quotes] = await Promise.all([broker.symbolInfo(symbol), broker.quotesSnapshot(symbol)]);
  const tick = info.minTick;
  if (!Number.isFinite(tick) || tick <= 0 || info.variableMinTick) throw new Error('Unsupported or missing tick size');
  const price = Number((Math.round(request.price / tick) * tick).toFixed(10));
  const quantityInfo = info.qty;
  if (!quantityInfo || !Number.isFinite(quantityInfo.min) || !Number.isFinite(quantityInfo.max) || !Number.isFinite(quantityInfo.step) || quantityInfo.step <= 0 || request.quantity < quantityInfo.min || request.quantity > quantityInfo.max || Math.abs((request.quantity - quantityInfo.min) / quantityInfo.step - Math.round((request.quantity - quantityInfo.min) / quantityInfo.step)) > 1e-8) throw new Error('Quantity is outside broker instrument limits');
  const { bid, ask } = quotes;
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid > ask) throw new Error('Valid bid/ask quotes unavailable');
  const pending = request.type === 'limit' ? (request.side === 'buy' ? price < ask : price > bid) : (request.side === 'buy' ? price > ask : price < bid);
  if (!pending) throw new Error('Price would be marketable or already triggered; choose a pending price');
  const order = { symbol, side: request.side === 'buy' ? 1 : -1, type: request.type === 'limit' ? 1 : 3, qty: request.quantity, duration: { type: 'DAY' }, currentQuotes: { bid, ask }, [request.type === 'limit' ? 'limitPrice' : 'stopPrice']: price };
  // No parent, OCO group, brackets, cancellation or modification: each press is
  // an independent new order, regardless of the preceding side or quantity.
  const prepared = await broker.createInitialPreOrder(order);
  if (prepared.symbol !== symbol || prepared.qty !== request.quantity || prepared.type !== (request.type === 'limit' ? 1 : 3) || prepared.side !== (request.side === 'buy' ? 1 : -1) || prepared[request.type === 'limit' ? 'limitPrice' : 'stopPrice'] !== price || prepared.parentId != null || prepared.id != null || prepared.isClose || prepared.stopLoss != null || prepared.takeProfit != null || prepared.exitLevels?.length) throw new Error('Broker defaults changed the requested independent order');
  assertDestination();
  if (Date.now() - request.capturedAt > 5000) throw new Error('Order preparation took too long; nothing submitted');
  const common = { mode: policy.mode, broker: original.title, symbol, side: request.side, type: request.type, quantity: request.quantity, price };
  if (policy.mode === 'dry-run') return { ...common, submitted: false, verified: true, totalMs: performance.now() - started };
  const beforeOrders = await readOrders();
  const beforeIds = new Set(beforeOrders.map(item => String(item.id)));
  assertDestination();
  if (Date.now() - request.capturedAt > 5000) throw new Error('Order preparation took too long; nothing submitted');
  let response;
  try {
    response = await broker.placeOrder(prepared);
  } catch (error) {
    return { ...common, submitted: null, uncertain: true, error: 'Submission outcome unknown; inspect broker orders before retrying: ' + error.message };
  }
  const id = response?.orderId ? String(response.orderId) : null;
  // Read-back never retries a submission. A missing acknowledgement stops the
  // caller instead of risking a duplicate order.
  const deadline = performance.now() + 3000;
  try { do {
    assertDestination();
    const items = await readOrders();
    const matches = items.filter(item => id ? String(item.id) === id : !beforeIds.has(String(item.id)) && item.symbol === symbol && item.qty === request.quantity && item.side === order.side && item.type === order.type && item[request.type === 'limit' ? 'limitPrice' : 'stopPrice'] === price);
    if (matches.length > 1) return { ...common, submitted: null, uncertain: true, error: 'Multiple matching acknowledgements; inspect orders before retrying' };
    const actual = matches[0];
    if (actual && actual.status !== 4) {
      const verified = actual.symbol === symbol && actual.qty === request.quantity && actual.side === order.side && actual.type === order.type && actual[request.type === 'limit' ? 'limitPrice' : 'stopPrice'] === price;
      const accepted = actual.status === 6 || actual.status === 2;
      return { ...common, id: String(actual.id), submitted: true, verified: verified && accepted, uncertain: !verified, status: actual.status, ...(accepted ? {} : { error: 'Broker returned order status ' + actual.status }), totalMs: performance.now() - started };
    }
    await new Promise(resolve => setTimeout(resolve, 30));
  } while (performance.now() < deadline); }
  catch (error) { return { ...common, id, submitted: null, uncertain: true, error: 'Submission read-back failed; inspect broker orders before retrying: ' + error.message }; }
  return { ...common, id, submitted: id ? true : null, uncertain: true, error: 'Order read-back is pending; inspect broker orders before retrying' };
}
