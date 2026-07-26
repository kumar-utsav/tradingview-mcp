/**
 * Zero-token, deterministic break-and-retest monitoring.
 *
 * The hot path intentionally contains no model calls. It reads the active
 * TradingView bar, evaluates configured/manual rectangle zones, and emits
 * compact JSON events that an AI layer may explain asynchronously.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getState } from './chart.js';
import { getOhlcv } from './data.js';
import { getProperties, listDrawings } from './drawing.js';
import { fetchLastBar } from './stream.js';

const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_HISTORY_BARS = 100;
const MAX_BUFFERED_EVENTS = 500;
const DIRECTIONS = ['long', 'short'];

export const DEFAULT_STRATEGY_MONITOR_CONFIG = Object.freeze({
  symbol: 'SPY',
  timezone: 'America/Los_Angeles',
  session: { start: '06:30', end: '08:30' },
  blackouts: [
    { start: '06:30', end: '06:40', label: 'opening_10_minutes' },
    { start: '06:58', end: '07:03', label: 'seven_am_window' },
  ],
  zonesFromDrawings: true,
  requireOneMinuteChart: true,
  allowActiveRetestEntry: true,
  zones: [],
});

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a finite number`);
  return number;
}

function parseClock(value, name) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) {
    throw new Error(`${name} must use HH:MM format`);
  }
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) throw new Error(`${name} is not a valid time`);
  return hours * 60 + minutes;
}

function normalizeWindow(window, index) {
  if (typeof window === 'string') {
    const [start, end] = window.split('-');
    if (!start || !end) throw new Error(`blackouts[${index}] must use HH:MM-HH:MM`);
    return { start, end, label: `blackout_${index + 1}` };
  }
  if (!window || typeof window !== 'object') {
    throw new Error(`blackouts[${index}] must be an object or HH:MM-HH:MM string`);
  }
  const normalized = {
    start: window.start,
    end: window.end,
    label: window.label || `blackout_${index + 1}`,
  };
  parseClock(normalized.start, `blackouts[${index}].start`);
  parseClock(normalized.end, `blackouts[${index}].end`);
  return normalized;
}

export function normalizeZone(zone, index = 0) {
  if (!zone || typeof zone !== 'object') throw new Error(`zones[${index}] must be an object`);
  const low = finiteNumber(zone.low, `zones[${index}].low`);
  const high = finiteNumber(zone.high, `zones[${index}].high`);
  if (low === high) throw new Error(`zones[${index}] must have non-zero height`);
  const direction = zone.direction || 'both';
  if (!['long', 'short', 'both'].includes(direction)) {
    throw new Error(`zones[${index}].direction must be long, short, or both`);
  }
  return {
    id: String(zone.id || `zone_${index + 1}`),
    label: String(zone.label || zone.id || `Zone ${index + 1}`),
    low: Math.min(low, high),
    high: Math.max(low, high),
    direction,
    source: zone.source || 'config',
  };
}

export function normalizeStrategyMonitorConfig(raw = {}) {
  const config = {
    ...DEFAULT_STRATEGY_MONITOR_CONFIG,
    ...raw,
    session: { ...DEFAULT_STRATEGY_MONITOR_CONFIG.session, ...(raw.session || {}) },
    blackouts: raw.blackouts === undefined
      ? DEFAULT_STRATEGY_MONITOR_CONFIG.blackouts.map(window => ({ ...window }))
      : raw.blackouts.map(normalizeWindow),
    zones: (raw.zones || []).map(normalizeZone),
  };
  parseClock(config.session.start, 'session.start');
  parseClock(config.session.end, 'session.end');
  if (config.symbol !== null && typeof config.symbol !== 'string') {
    throw new Error('symbol must be a string or null');
  }
  // Validate the timezone eagerly.
  new Intl.DateTimeFormat('en-US', { timeZone: config.timezone }).format(new Date());
  return config;
}

export function readStrategyMonitorConfig(filePath) {
  if (!filePath) return normalizeStrategyMonitorConfig();
  const absolutePath = resolve(filePath);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read strategy monitor config ${absolutePath}: ${error.message}`);
  }
  return normalizeStrategyMonitorConfig(parsed);
}

function clockMinutes(timestamp, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(timestamp * 1000));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return (Number(values.hour) % 24) * 60 + Number(values.minute);
}

function containsMinute(minute, start, end) {
  const startMinute = parseClock(start, 'window.start');
  const endMinute = parseClock(end, 'window.end');
  if (startMinute <= endMinute) return minute >= startMinute && minute < endMinute;
  return minute >= startMinute || minute < endMinute;
}

function barTimeLabel(timestamp, timezone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp * 1000));
}

function normalizeBar(bar) {
  const time = finiteNumber(bar.time ?? bar.bar_time, 'bar.time');
  return {
    time,
    open: finiteNumber(bar.open, 'bar.open'),
    high: finiteNumber(bar.high, 'bar.high'),
    low: finiteNumber(bar.low, 'bar.low'),
    close: finiteNumber(bar.close, 'bar.close'),
    volume: Number(bar.volume) || 0,
  };
}

function touchesZone(bar, zone) {
  return bar.low <= zone.high && bar.high >= zone.low;
}

function riskPoints(entry, stop) {
  return Math.round(Math.abs(entry - stop) * 10000) / 10000;
}

function directionsFor(zone) {
  return zone.direction === 'both' ? DIRECTIONS : [zone.direction];
}

function initialState(zone, direction) {
  return {
    zone,
    direction,
    phase: 'waiting_break',
    breakBarTime: null,
    retestBarTime: null,
    entry: null,
    stop: null,
    blockedBarTime: null,
  };
}

/**
 * Pure state machine. Feed forming updates through processFormingBar() and
 * finalized candles through processClosedBar().
 */
export class BreakRetestEvaluator {
  constructor(config = {}) {
    this.config = normalizeStrategyMonitorConfig(config);
    this.states = new Map();
    this.previousClosedBar = null;
    for (const zone of this.config.zones) {
      for (const direction of directionsFor(zone)) {
        this.states.set(`${zone.id}:${direction}`, initialState(zone, direction));
      }
    }
  }

  _event(type, state, bar, details = {}) {
    return {
      event: type,
      bar_time: bar.time,
      time: barTimeLabel(bar.time, this.config.timezone),
      direction: state.direction,
      phase: state.phase,
      zone: {
        id: state.zone.id,
        label: state.zone.label,
        low: state.zone.low,
        high: state.zone.high,
        source: state.zone.source,
      },
      bar,
      ...details,
    };
  }

  _entryBlock(timestamp) {
    const minute = clockMinutes(timestamp, this.config.timezone);
    if (!containsMinute(minute, this.config.session.start, this.config.session.end)) {
      return 'outside_session';
    }
    const blackout = this.config.blackouts.find(window =>
      containsMinute(minute, window.start, window.end));
    return blackout?.label || null;
  }

  _reset(state) {
    const reset = initialState(state.zone, state.direction);
    Object.assign(state, reset);
  }

  processFormingBar(input) {
    const bar = normalizeBar(input);
    const events = [];
    for (const state of this.states.values()) {
      if (state.phase !== 'armed') continue;
      if (!this.config.allowActiveRetestEntry && touchesZone(bar, state.zone)) continue;
      const crossed = state.direction === 'long'
        ? bar.high > state.entry
        : bar.low < state.entry;
      if (!crossed) continue;

      const blockReason = this._entryBlock(bar.time);
      if (blockReason) {
        if (state.blockedBarTime === bar.time) continue;
        state.blockedBarTime = bar.time;
        events.push(this._event('ENTRY_BLOCKED', state, bar, {
          reason: blockReason,
          entry: state.entry,
          stop: state.stop,
        }));
        // Once price leaves without us during a blackout, require a fresh
        // retest instead of issuing a late entry when the blackout ends.
        state.phase = 'waiting_retest';
        state.breakBarTime = bar.time;
        state.retestBarTime = null;
        state.entry = null;
        state.stop = null;
        continue;
      }

      state.phase = 'triggered';
      events.push(this._event('ENTRY_TRIGGERED', state, bar, {
        entry: state.entry,
        stop: state.stop,
        risk_points: riskPoints(state.entry, state.stop),
        provisional: true,
      }));
    }
    return events;
  }

  processClosedBar(input) {
    const bar = normalizeBar(input);
    const events = this.processFormingBar(bar);
    const previousClose = this.previousClosedBar?.close;

    for (const state of this.states.values()) {
      const { zone, direction } = state;

      if (state.phase === 'waiting_break') {
        const broke = previousClose !== undefined && (direction === 'long'
          ? previousClose <= zone.high && bar.close > zone.high
          : previousClose >= zone.low && bar.close < zone.low);
        if (!broke) continue;
        state.phase = 'waiting_retest';
        state.breakBarTime = bar.time;
        events.push(this._event('BREAK_CONFIRMED', state, bar, {
          boundary: direction === 'long' ? zone.high : zone.low,
        }));
        continue;
      }

      if (state.phase === 'waiting_retest') {
        if (state.breakBarTime === bar.time) continue;
        const failed = direction === 'long' ? bar.close < zone.low : bar.close > zone.high;
        if (failed) {
          events.push(this._event('BREAK_FAILED', state, bar, {
            invalid_boundary: direction === 'long' ? zone.low : zone.high,
          }));
          this._reset(state);
          continue;
        }
        if (!touchesZone(bar, zone)) continue;
        state.phase = 'armed';
        state.retestBarTime = bar.time;
        state.entry = direction === 'long' ? bar.high : bar.low;
        state.stop = direction === 'long' ? bar.low : bar.high;
        events.push(this._event('RETEST_CONFIRMED', state, bar, {
          entry: state.entry,
          stop: state.stop,
          risk_points: riskPoints(state.entry, state.stop),
        }));
        continue;
      }

      if (state.phase === 'armed') {
        const invalid = direction === 'long' ? bar.close < zone.low : bar.close > zone.high;
        if (invalid) {
          events.push(this._event('SETUP_INVALIDATED', state, bar, {
            invalid_boundary: direction === 'long' ? zone.low : zone.high,
            before_entry: true,
          }));
          this._reset(state);
          continue;
        }
        if (state.retestBarTime !== bar.time && touchesZone(bar, zone)) {
          state.retestBarTime = bar.time;
          state.entry = direction === 'long' ? bar.high : bar.low;
          state.stop = direction === 'long' ? bar.low : bar.high;
          events.push(this._event('RETEST_UPDATED', state, bar, {
            entry: state.entry,
            stop: state.stop,
            risk_points: riskPoints(state.entry, state.stop),
          }));
        }
        continue;
      }

      if (state.phase === 'triggered') {
        const invalid = direction === 'long' ? bar.close < zone.low : bar.close > zone.high;
        if (!invalid) continue;
        events.push(this._event('SETUP_INVALIDATED', state, bar, {
          invalid_boundary: direction === 'long' ? zone.low : zone.high,
          before_entry: false,
        }));
        this._reset(state);
      }
    }

    this.previousClosedBar = bar;
    return events;
  }

  snapshot() {
    return [...this.states.values()].map(state => ({
      zone_id: state.zone.id,
      zone_label: state.zone.label,
      zone_low: state.zone.low,
      zone_high: state.zone.high,
      direction: state.direction,
      phase: state.phase,
      break_bar_time: state.breakBarTime,
      retest_bar_time: state.retestBarTime,
      entry: state.entry,
      stop: state.stop,
    }));
  }
}

export function rectangleToZone(shape, index = 0) {
  if (!shape || shape.name !== 'rectangle' || !Array.isArray(shape.points) || shape.points.length < 2) {
    return null;
  }
  const prices = shape.points.map(point => Number(point.price)).filter(Number.isFinite);
  if (prices.length < 2 || prices[0] === prices[1]) return null;
  return normalizeZone({
    id: shape.entity_id || shape.id || `drawing_${index + 1}`,
    label: shape.properties?.text || `Rectangle ${index + 1}`,
    low: Math.min(...prices),
    high: Math.max(...prices),
    direction: 'both',
    source: 'manual_rectangle',
  }, index);
}

export async function loadRectangleZones() {
  const drawings = await listDrawings();
  const rectangles = drawings.shapes.filter(shape => shape.name === 'rectangle');
  const properties = await Promise.all(rectangles.map(shape =>
    getProperties({ entity_id: shape.id })));
  return properties.map(rectangleToZone).filter(Boolean);
}

function mergeZones(configured, drawn) {
  const zones = new Map();
  for (const zone of drawn) zones.set(zone.id, zone);
  for (const zone of configured) zones.set(zone.id, zone);
  return [...zones.values()];
}

function emitJsonLine(event, writer = process.stdout) {
  writer.write(`${JSON.stringify(event)}\n`);
}

async function prepareMonitor(configInput, historyBars) {
  const config = normalizeStrategyMonitorConfig(configInput);
  const chart = await getState();
  const currentSymbol = String(chart.symbol || '').split(':').at(-1);
  if (config.symbol && currentSymbol.toUpperCase() !== config.symbol.toUpperCase()) {
    throw new Error(`Strategy monitor requires ${config.symbol}; current symbol is ${chart.symbol}`);
  }
  if (config.requireOneMinuteChart && String(chart.resolution) !== '1') {
    throw new Error(`Strategy monitor requires the 1-minute chart; current resolution is ${chart.resolution}`);
  }
  const drawnZones = config.zonesFromDrawings ? await loadRectangleZones() : [];
  const zones = mergeZones(config.zones, drawnZones);
  if (zones.length === 0) {
    throw new Error('No zones found. Draw rectangles on the chart or add zones to the monitor config.');
  }

  const evaluator = new BreakRetestEvaluator({ ...config, zones });
  const history = await getOhlcv({ count: historyBars, summary: false });
  const bars = history.bars.map(normalizeBar);
  for (const bar of bars.slice(0, -1)) evaluator.processClosedBar(bar);

  return {
    config: { ...config, zones },
    chart,
    evaluator,
    currentBar: bars.at(-1),
  };
}

/**
 * Run a foreground JSONL monitor. This is used by `tv monitor strategy`.
 */
export async function monitorStrategy({
  config = {},
  interval = DEFAULT_INTERVAL_MS,
  history = DEFAULT_HISTORY_BARS,
  once = false,
  writer = process.stdout,
} = {}) {
  const pollInterval = Math.max(100, finiteNumber(interval, 'interval'));
  const historyBars = Math.max(2, Math.floor(finiteNumber(history, 'history')));
  const prepared = await prepareMonitor(config, historyBars);
  let currentBar = prepared.currentBar;

  const started = {
    event: 'MONITOR_STARTED',
    symbol: prepared.chart.symbol,
    resolution: prepared.chart.resolution,
    interval_ms: pollInterval,
    zone_count: prepared.config.zones.length,
    ai_model_calls: 0,
  };

  if (once) {
    const events = prepared.evaluator.processFormingBar(currentBar);
    return {
      success: true,
      ...started,
      events,
      states: prepared.evaluator.snapshot(),
    };
  }

  emitJsonLine(started, writer);
  let running = true;
  const stop = () => { running = false; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    while (running) {
      const latest = normalizeBar(await fetchLastBar());
      let events;
      if (latest.time !== currentBar.time) {
        events = prepared.evaluator.processClosedBar(currentBar);
        currentBar = latest;
      } else {
        currentBar = latest;
        events = [];
      }
      events.push(...prepared.evaluator.processFormingBar(currentBar));
      for (const event of events) {
        emitJsonLine({
          ...event,
          symbol: prepared.chart.symbol,
          resolution: prepared.chart.resolution,
          ai_model_calls: 0,
        }, writer);
      }
      await new Promise(resolveSleep => setTimeout(resolveSleep, pollInterval));
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }

  emitJsonLine({ event: 'MONITOR_STOPPED', ai_model_calls: 0 }, writer);
  return { success: true, stopped: true };
}

class StrategyMonitorService {
  constructor() {
    this.running = false;
    this.error = null;
    this.events = [];
    this.nextEventId = 1;
    this.startedAt = null;
    this.stopRequested = false;
    this.evaluator = null;
    this.chart = null;
    this.config = null;
    this.currentBar = null;
    this.loopPromise = null;
  }

  _push(event) {
    const stored = { id: this.nextEventId++, ...event, ai_model_calls: 0 };
    this.events.push(stored);
    if (this.events.length > MAX_BUFFERED_EVENTS) this.events.shift();
    return stored;
  }

  async start({ config = {}, interval = DEFAULT_INTERVAL_MS, history = DEFAULT_HISTORY_BARS } = {}) {
    if (this.running) throw new Error('Strategy monitor is already running');
    const pollInterval = Math.max(100, finiteNumber(interval, 'interval'));
    const historyBars = Math.max(2, Math.floor(finiteNumber(history, 'history')));
    const prepared = await prepareMonitor(config, historyBars);

    this.running = true;
    this.error = null;
    this.events = [];
    this.nextEventId = 1;
    this.startedAt = Date.now();
    this.stopRequested = false;
    this.evaluator = prepared.evaluator;
    this.chart = prepared.chart;
    this.config = prepared.config;
    this.currentBar = prepared.currentBar;
    this.interval = pollInterval;
    this._push({
      event: 'MONITOR_STARTED',
      symbol: this.chart.symbol,
      resolution: this.chart.resolution,
      interval_ms: pollInterval,
      zone_count: this.config.zones.length,
    });

    this.loopPromise = this._loop().catch(error => {
      this.error = error.message;
      this._push({ event: 'MONITOR_ERROR', error: error.message });
    }).finally(() => {
      this.running = false;
    });

    return this.status();
  }

  async _loop() {
    while (!this.stopRequested) {
      const latest = normalizeBar(await fetchLastBar());
      let events;
      if (latest.time !== this.currentBar.time) {
        events = this.evaluator.processClosedBar(this.currentBar);
        this.currentBar = latest;
      } else {
        this.currentBar = latest;
        events = [];
      }
      events.push(...this.evaluator.processFormingBar(this.currentBar));
      for (const event of events) {
        this._push({
          ...event,
          symbol: this.chart.symbol,
          resolution: this.chart.resolution,
        });
      }
      await new Promise(resolveSleep => setTimeout(resolveSleep, this.interval));
    }
    this._push({ event: 'MONITOR_STOPPED' });
  }

  status() {
    return {
      success: true,
      running: this.running,
      error: this.error,
      started_at: this.startedAt,
      symbol: this.chart?.symbol || null,
      resolution: this.chart?.resolution || null,
      interval_ms: this.interval || null,
      zone_count: this.config?.zones?.length || 0,
      buffered_event_count: this.events.length,
      latest_event_id: this.nextEventId - 1,
      ai_model_calls: 0,
      states: this.evaluator?.snapshot() || [],
    };
  }

  getEvents({ afterId = 0, limit = 100, clear = false } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const matching = this.events.filter(event => event.id > Number(afterId || 0)).slice(0, safeLimit);
    if (clear && matching.length) {
      const lastId = matching.at(-1).id;
      this.events = this.events.filter(event => event.id > lastId);
    }
    return {
      success: true,
      running: this.running,
      events: matching,
      returned: matching.length,
      latest_event_id: this.nextEventId - 1,
      ai_model_calls: 0,
    };
  }

  async stop() {
    if (!this.running) return { success: true, running: false, stopped: false };
    this.stopRequested = true;
    await this.loopPromise;
    return { success: true, running: false, stopped: true, ai_model_calls: 0 };
  }
}

export const strategyMonitorService = new StrategyMonitorService();
