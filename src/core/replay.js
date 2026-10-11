/**
 * Core replay mode logic.
 */
import { evaluate as _evaluate, getReplayApi as _getReplayApi } from '../connection.js';

export const VALID_AUTOPLAY_DELAYS = [100, 143, 200, 300, 1000, 2000, 3000, 5000, 10000];

function wv(path) {
  return `(function(){ var v = ${path}; return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; })()`;
}

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    getReplayApi: deps?.getReplayApi || _getReplayApi,
  };
}

export async function start({ date, _deps } = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const available = await evaluate(wv(`${rp}.isReplayAvailable()`));
  if (!available) throw new Error('Replay is not available for the current symbol/timeframe');

  await evaluate(`${rp}.showReplayToolbar()`);

  // selectDate() is async — it calls enableReplayMode() then _onPointSelected()
  // which initializes the server-side replay session. Must be awaited inside the
  // page context, otherwise the promise is fire-and-forget and replay state says
  // "started" but stepping doesn't work (issue #26).
  if (date) {
    const ts = new Date(date).getTime();
    if (isNaN(ts)) throw new Error(`Invalid date: "${date}". Use YYYY-MM-DD format.`);
    await evaluate(`${rp}.selectDate(${ts}).then(function() { return 'ok'; })`);
  } else {
    await evaluate(`${rp}.selectFirstAvailableDate()`);
  }

  // Poll until replay is fully initialized: isReplayStarted AND currentDate is set.
  // selectDate()'s promise resolves before the data series is ready, so we need
  // to wait for currentDate to become non-null before stepping will work.
  let started = false;
  let currentDate = null;
  for (let i = 0; i < 30; i++) {
    started = await evaluate(wv(`${rp}.isReplayStarted()`));
    currentDate = await evaluate(wv(`${rp}.currentDate()`));
    if (started && currentDate !== null) break;
    await new Promise(r => setTimeout(r, 250));
  }

  if (!started) {
    try { await evaluate(`${rp}.stopReplay()`); } catch {}
    throw new Error('Replay failed to start. The selected date may not have data for this timeframe. Try a more recent date or a higher timeframe (e.g., Daily).');
  }

  return { success: true, replay_started: true, date: date || '(first available)', current_date: currentDate };
}

const PACIFIC = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function pacificWallTime(date, clock) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    throw new Error('date must be a valid YYYY-MM-DD date');
  const desired = Date.parse(`${date}T${clock}:00Z`);
  let candidate = desired;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(PACIFIC.formatToParts(new Date(candidate)).map(p => [p.type, p.value]));
    const wall = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    if (wall === desired) return candidate;
    candidate += desired - wall;
  }
  throw new Error(`Could not resolve ${date} ${clock} in Pacific time`);
}

/** Start replay so the requested Pacific-time minute is the final replay candle. */
export async function startToCutoff({ date, cutoff, _deps } = {}) {
  const clock = cutoff === 'open' ? '06:30' : cutoff === 'morning' ? '09:00' : null;
  if (!clock) throw new Error('cutoff must be "open" (6:30 AM) or "morning" (9:00 AM)');
  const target = pacificWallTime(date, clock);
  const { evaluate } = _resolve(_deps);
  const resolution = await evaluate('window.TradingViewApi._activeChartWidgetWV.value().resolution()');
  if (String(resolution) !== '1') throw new Error(`This shortcut requires a 1-minute chart; the current chart is ${resolution}. Change the timeframe to 1 minute and try again.`);
  // TradingView excludes the selected replay candle on some layouts; selecting
  // the next one-minute bar makes the requested minute the inclusive endpoint.
  const result = await start({ date: new Date(target + 60_000).toISOString(), _deps });
  const { getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  let currentDate = null;
  for (let i = 0; i < 20; i++) {
    currentDate = await evaluate(wv(`${rp}.currentDate()`));
    if (currentDate !== null && Number(currentDate) * 1000 >= target) break;
    await new Promise(r => setTimeout(r, 250));
  }
  if (currentDate === null || Number(currentDate) * 1000 < target || Number(currentDate) * 1000 >= target + 60_000)
    throw new Error(`Replay did not land on the ${clock} Pacific cutoff for ${date}; current replay time was ${currentDate ?? 'unavailable'}`);
  return { ...result, requested_date: date, cutoff_pacific: `${date} ${clock}`, current_date: currentDate };
}

export async function step({ _deps } = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');
  const before = await evaluate(wv(`${rp}.currentDate()`));
  await evaluate(`${rp}.doStep()`);
  // doStep() is async internally — currentDate takes ~500ms to update.
  // Poll until it changes or timeout after 3s.
  let currentDate = before;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 250));
    currentDate = await evaluate(wv(`${rp}.currentDate()`));
    if (currentDate !== before) break;
  }
  return { success: true, action: 'step', current_date: currentDate };
}

export async function autoplay({ speed, _deps } = {}) {
  // Validate BEFORE any CDP calls — invalid values corrupt cloud account state permanently
  if (speed > 0 && !VALID_AUTOPLAY_DELAYS.includes(speed))
    throw new Error(`Invalid autoplay delay ${speed}ms. Valid values: ${VALID_AUTOPLAY_DELAYS.join(', ')}`);

  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');
  if (speed > 0) {
    await evaluate(`${rp}.changeAutoplayDelay(${speed})`);
  }
  await evaluate(`${rp}.toggleAutoplay()`);
  const isAutoplay = await evaluate(wv(`${rp}.isAutoplayStarted()`));
  const currentDelay = await evaluate(wv(`${rp}.autoplayDelay()`));
  return { success: true, autoplay_active: !!isAutoplay, delay_ms: currentDelay };
}

export async function stop({ _deps } = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) {
    return { success: true, action: 'already_stopped' };
  }
  await evaluate(`${rp}.stopReplay()`);
  return { success: true, action: 'replay_stopped' };
}

export async function trade({ action, _deps }) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const started = await evaluate(wv(`${rp}.isReplayStarted()`));
  if (!started) throw new Error('Replay is not started. Use replay_start first.');

  if (action === 'buy') await evaluate(`${rp}.buy()`);
  else if (action === 'sell') await evaluate(`${rp}.sell()`);
  else if (action === 'close') await evaluate(`${rp}.closePosition()`);
  else throw new Error('Invalid action. Use: buy, sell, or close');

  const position = await evaluate(wv(`${rp}.position()`));
  const pnl = await evaluate(wv(`${rp}.realizedPL()`));
  return { success: true, action, position, realized_pnl: pnl };
}

export async function status({ _deps } = {}) {
  const { evaluate, getReplayApi } = _resolve(_deps);
  const rp = await getReplayApi();
  const st = await evaluate(`
    (function() {
      var r = ${rp};
      function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }
      return {
        is_replay_available: unwrap(r.isReplayAvailable()),
        is_replay_started: unwrap(r.isReplayStarted()),
        is_autoplay_started: unwrap(r.isAutoplayStarted()),
        replay_mode: unwrap(r.replayMode()),
        current_date: unwrap(r.currentDate()),
        autoplay_delay: unwrap(r.autoplayDelay()),
      };
    })()
  `);
  const pos = await evaluate(wv(`${rp}.position()`));
  const pnl = await evaluate(wv(`${rp}.realizedPL()`));
  return { success: true, ...st, position: pos, realized_pnl: pnl };
}
