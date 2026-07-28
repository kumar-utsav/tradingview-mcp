import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BreakRetestEvaluator,
  normalizeStrategyMonitorConfig,
  rectangleToZone,
} from '../src/core/strategy-monitor.js';

const ZONE = {
  id: 'spy-zone',
  label: 'SPY flip zone',
  low: 745.66,
  high: 746.01,
  direction: 'short',
};

function timestamp(time) {
  return Date.parse(`2026-07-20T${time}:00-07:00`) / 1000;
}

function bar(time, open, high, low, close, volume = 1000) {
  return { time: timestamp(time), open, high, low, close, volume };
}

function evaluator(overrides = {}) {
  return new BreakRetestEvaluator({
    timezone: 'America/Los_Angeles',
    session: { start: '06:30', end: '08:30' },
    blackouts: [],
    zonesFromDrawings: false,
    zones: [ZONE],
    ...overrides,
  });
}

describe('BreakRetestEvaluator', () => {
  it('tracks the annotated short from break through invalidation', () => {
    const engine = evaluator();

    engine.processClosedBar(bar('06:57', 746.10, 746.15, 745.80, 745.80));
    let events = engine.processClosedBar(bar('06:58', 745.81, 745.99, 745.59, 745.61));
    assert.deepEqual(events.map(event => event.event), ['BREAK_CONFIRMED']);

    events = engine.processClosedBar(bar('06:59', 745.60, 745.86, 745.52, 745.69));
    assert.deepEqual(events.map(event => event.event), ['RETEST_CONFIRMED']);
    assert.equal(events[0].entry, 745.52);
    assert.equal(events[0].stop, 745.86);

    events = engine.processClosedBar(bar('07:00', 745.68, 745.98, 745.55, 745.88));
    assert.deepEqual(events.map(event => event.event), ['RETEST_UPDATED']);
    assert.equal(events[0].entry, 745.55);
    assert.equal(events[0].stop, 745.98);

    events = engine.processFormingBar(bar('07:01', 745.88, 745.96, 745.39, 745.70));
    assert.deepEqual(events.map(event => event.event), ['ENTRY_TRIGGERED']);
    assert.equal(events[0].risk_points, 0.43);

    events = engine.processClosedBar(bar('07:02', 745.67, 746.04, 745.62, 746.0318));
    assert.deepEqual(events.map(event => event.event), ['SETUP_INVALIDATED']);
    assert.equal(events[0].before_entry, false);
    assert.equal(engine.snapshot()[0].phase, 'waiting_break');
  });

  it('blocks a trigger in the seven-am window and requires a fresh retest', () => {
    const engine = evaluator({
      blackouts: [{ start: '06:58', end: '07:03', label: 'seven_am_window' }],
    });
    engine.processClosedBar(bar('06:57', 746.10, 746.15, 745.80, 745.80));
    engine.processClosedBar(bar('06:58', 745.81, 745.99, 745.59, 745.61));
    engine.processClosedBar(bar('06:59', 745.60, 745.86, 745.52, 745.69));
    engine.processClosedBar(bar('07:00', 745.68, 745.98, 745.55, 745.88));

    const events = engine.processFormingBar(bar('07:01', 745.88, 745.96, 745.39, 745.70));
    assert.deepEqual(events.map(event => event.event), ['ENTRY_BLOCKED']);
    assert.equal(events[0].reason, 'seven_am_window');
    assert.equal(engine.snapshot()[0].phase, 'waiting_retest');

    const repeated = engine.processFormingBar(bar('07:01', 745.88, 745.96, 745.30, 745.50));
    assert.equal(repeated.length, 0);
  });

  it('uses the most recent retest candle for entry and stop', () => {
    const engine = evaluator();
    engine.processClosedBar(bar('06:49', 746.10, 746.20, 745.90, 745.90));
    engine.processClosedBar(bar('06:50', 746.20, 746.22, 745.90, 745.60));
    engine.processClosedBar(bar('06:51', 745.70, 745.90, 745.50, 745.75));

    const events = engine.processClosedBar(bar('06:52', 745.75, 745.95, 745.58, 745.80));
    assert.deepEqual(events.map(event => event.event), ['RETEST_UPDATED']);
    assert.equal(engine.snapshot()[0].entry, 745.58);
    assert.equal(engine.snapshot()[0].stop, 745.95);
  });

  it('does not use a still-forming retest as an active entry when disabled', () => {
    const engine = evaluator({ allowActiveRetestEntry: false });
    engine.processClosedBar(bar('06:49', 746.10, 746.20, 745.90, 745.90));
    engine.processClosedBar(bar('06:50', 746.20, 746.22, 745.90, 745.60));
    engine.processClosedBar(bar('06:51', 745.70, 745.90, 745.50, 745.75));

    const events = engine.processFormingBar(bar('06:52', 745.75, 745.90, 745.40, 745.60));
    assert.equal(events.length, 0);
  });

  it('supports the inverse long setup', () => {
    const engine = new BreakRetestEvaluator({
      timezone: 'America/Los_Angeles',
      session: { start: '06:30', end: '08:30' },
      blackouts: [],
      zonesFromDrawings: false,
      zones: [{ id: 'long-zone', low: 100, high: 101, direction: 'long' }],
    });

    engine.processClosedBar(bar('06:44', 100.5, 100.9, 100.4, 100.8));
    assert.equal(engine.processClosedBar(bar('06:45', 100.8, 101.3, 100.7, 101.2))[0].event, 'BREAK_CONFIRMED');
    const retest = engine.processClosedBar(bar('06:46', 101.2, 101.4, 100.8, 101.1))[0];
    assert.equal(retest.event, 'RETEST_CONFIRMED');
    assert.equal(retest.entry, 101.4);
    assert.equal(retest.stop, 100.8);
    assert.equal(engine.processFormingBar(bar('06:47', 101.1, 101.5, 101.05, 101.45))[0].event, 'ENTRY_TRIGGERED');
  });

  it('fails a break when the retest closes through the invalid side', () => {
    const engine = evaluator();
    engine.processClosedBar(bar('06:44', 746.0, 746.1, 745.8, 745.8));
    engine.processClosedBar(bar('06:45', 746.0, 746.1, 745.5, 745.6));
    const events = engine.processClosedBar(bar('06:46', 745.8, 746.2, 745.7, 746.1));
    assert.deepEqual(events.map(event => event.event), ['BREAK_FAILED']);
    assert.equal(engine.snapshot()[0].phase, 'waiting_break');
  });
});

describe('strategy monitor configuration and chart zones', () => {
  it('converts a manual rectangle to a two-sided zone', () => {
    const zone = rectangleToZone({
      entity_id: 'rect-1',
      name: 'rectangle',
      points: [{ price: 746.01 }, { price: 745.66 }],
      properties: { text: 'Flip zone' },
    });
    assert.deepEqual(zone, {
      id: 'rect-1',
      label: 'Flip zone',
      low: 745.66,
      high: 746.01,
      direction: 'both',
      source: 'manual_rectangle',
    });
  });

  it('accepts compact blackout strings', () => {
    const config = normalizeStrategyMonitorConfig({
      blackouts: ['06:30-06:40'],
      zones: [ZONE],
    });
    assert.deepEqual(config.blackouts, [{
      start: '06:30',
      end: '06:40',
      label: 'blackout_1',
    }]);
  });
});
