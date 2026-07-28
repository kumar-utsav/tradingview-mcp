import fs from 'node:fs';
import path from 'node:path';

const SOURCE_FILES = process.argv.length > 2 ? process.argv.slice(2) : [
  '/tmp/spx-5m-feb-apr-2026.json',
  '/tmp/spx-5m-apr-jul-2026.json',
];
const OUTPUT_DIR = path.resolve('reports/dynamite-zone-analysis-2026-02-01-to-2026-07-27');
const FROM = Math.floor(new Date('2026-02-01T00:00:00-05:00').getTime() / 1000);
const TO = Math.floor(new Date('2026-07-27T23:59:59-04:00').getTime() / 1000);
const STEP = 50;
const WIDTH = 2;

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partsForTime(time) {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(time * 1000))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    timestamp: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function touchedLevels(bar) {
  const first = Math.ceil((bar.low - WIDTH) / STEP) * STEP;
  const last = Math.floor((bar.high + WIDTH) / STEP) * STEP;
  const levels = [];
  for (let level = first; level <= last; level += STEP) levels.push(level);
  return levels;
}

function touches(bar, level) {
  return bar.low <= level + WIDTH && bar.high >= level - WIDTH;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function reactionWindow(bars, index, level, direction, horizon) {
  const sessionDate = bars[index].sessionDate;
  const future = [];
  for (let offset = 1; offset <= horizon; offset += 1) {
    const candidate = bars[index + offset];
    if (!candidate || candidate.sessionDate !== sessionDate) break;
    future.push(candidate);
  }

  const directionSign = direction === 'from_above' ? 1 : -1;
  const favorablePrices = [bars[index].close];
  const adversePrices = [bars[index].close];
  for (const bar of future) {
    favorablePrices.push(directionSign === 1 ? bar.high : bar.low);
    adversePrices.push(directionSign === 1 ? bar.low : bar.high);
  }

  const favorable = directionSign === 1
    ? Math.max(...favorablePrices) - level
    : level - Math.min(...favorablePrices);
  const adverse = directionSign === 1
    ? level - Math.min(...adversePrices)
    : Math.max(...adversePrices) - level;
  const finalClose = future.length === horizon ? future.at(-1).close : null;

  return {
    favorable: round(Math.max(0, favorable)),
    adverse: round(Math.max(0, adverse)),
    closeMove: finalClose == null ? null : round(directionSign * (finalClose - level)),
    barsAvailable: future.length,
    full: future.length === horizon,
  };
}

function neutralReactionWindow(bars, index, level, horizon) {
  const sessionDate = bars[index].sessionDate;
  const future = [];
  for (let offset = 1; offset <= horizon; offset += 1) {
    const candidate = bars[index + offset];
    if (!candidate || candidate.sessionDate !== sessionDate) break;
    future.push(candidate);
  }

  const upsidePrices = [bars[index].close, ...future.map((bar) => bar.high)];
  const downsidePrices = [bars[index].close, ...future.map((bar) => bar.low)];
  const finalClose = future.length === horizon ? future.at(-1).close : null;

  return {
    upside: round(Math.max(0, Math.max(...upsidePrices) - level)),
    downside: round(Math.max(0, level - Math.min(...downsidePrices))),
    closeRelative: finalClose == null ? null : round(finalClose - level),
    full: future.length === horizon,
  };
}

function csvEscape(value) {
  if (value == null) return '';
  const text = Array.isArray(value) ? value.join('|') : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(filePath, rows, columns) {
  const lines = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

const barMap = new Map();
for (const sourceFile of SOURCE_FILES) {
  for (const bar of JSON.parse(fs.readFileSync(sourceFile, 'utf8'))) {
    if (bar.time >= FROM && bar.time <= TO) barMap.set(bar.time, bar);
  }
}

const bars = [...barMap.values()]
  .sort((a, b) => a.time - b.time)
  .map((bar) => {
    const timeParts = partsForTime(bar.time);
    return {
      ...bar,
      timestampEt: timeParts.timestamp,
      sessionDate: timeParts.date,
      sessionTime: timeParts.time,
      touchedLevels: touchedLevels(bar),
    };
  });

const events = [];
const touchObservations = [];
const candleRows = bars.map((bar, index) => {
  const previous = bars[index - 1];
  const firstTouches = [];
  const approaches = [];

  for (const level of bar.touchedLevels) {
    const previousTouched = previous
      && previous.sessionDate === bar.sessionDate
      && touches(previous, level);

    let candleApproach = 'continuation_in_zone';
    if (bar.open > level + WIDTH) candleApproach = 'from_above';
    else if (bar.open < level - WIDTH) candleApproach = 'from_below';
    else if (!previousTouched && previous?.close > level + WIDTH) candleApproach = 'from_above';
    else if (!previousTouched && previous?.close < level - WIDTH) candleApproach = 'from_below';

    const candleReaction5 = candleApproach === 'continuation_in_zone'
      ? null
      : reactionWindow(bars, index, level, candleApproach, 1);
    const candleReaction15 = candleApproach === 'continuation_in_zone'
      ? null
      : reactionWindow(bars, index, level, candleApproach, 3);
    const candleReaction30 = candleApproach === 'continuation_in_zone'
      ? null
      : reactionWindow(bars, index, level, candleApproach, 6);
    const candleReaction60 = candleApproach === 'continuation_in_zone'
      ? null
      : reactionWindow(bars, index, level, candleApproach, 12);
    const neutral5 = neutralReactionWindow(bars, index, level, 1);
    const neutral15 = neutralReactionWindow(bars, index, level, 3);
    const neutral30 = neutralReactionWindow(bars, index, level, 6);
    const neutral60 = neutralReactionWindow(bars, index, level, 12);
    const candleDirectionSign = candleApproach === 'from_above'
      ? 1
      : candleApproach === 'from_below'
        ? -1
        : 0;

    touchObservations.push({
      touch_observation_id: touchObservations.length + 1,
      timestamp_et: bar.timestampEt,
      session_date_et: bar.sessionDate,
      session_time_et: bar.sessionTime,
      level,
      zone_low: level - WIDTH,
      zone_high: level + WIDTH,
      approach: candleApproach,
      consecutive_touch: Boolean(previousTouched),
      previous_close: previous?.close ?? null,
      touch_open: bar.open,
      touch_high: bar.high,
      touch_low: bar.low,
      touch_close: bar.close,
      touch_close_response_points: candleDirectionSign
        ? round(candleDirectionSign * (bar.close - level))
        : null,
      full_5m_window: neutral5.full,
      upside_5m_points: neutral5.upside,
      downside_5m_points: neutral5.downside,
      close_relative_5m_points: neutral5.closeRelative,
      favorable_5m_points: candleReaction5?.favorable ?? null,
      adverse_5m_points: candleReaction5?.adverse ?? null,
      close_move_5m_points: candleReaction5?.closeMove ?? null,
      full_15m_window: neutral15.full,
      upside_15m_points: neutral15.upside,
      downside_15m_points: neutral15.downside,
      close_relative_15m_points: neutral15.closeRelative,
      favorable_15m_points: candleReaction15?.favorable ?? null,
      adverse_15m_points: candleReaction15?.adverse ?? null,
      close_move_15m_points: candleReaction15?.closeMove ?? null,
      full_30m_window: neutral30.full,
      upside_30m_points: neutral30.upside,
      downside_30m_points: neutral30.downside,
      close_relative_30m_points: neutral30.closeRelative,
      favorable_30m_points: candleReaction30?.favorable ?? null,
      adverse_30m_points: candleReaction30?.adverse ?? null,
      close_move_30m_points: candleReaction30?.closeMove ?? null,
      dominant_30m_reaction: candleReaction30?.full
        ? candleReaction30.favorable > candleReaction30.adverse
        : null,
      heavy_10pt_30m_reaction: candleReaction30?.full
        ? candleReaction30.favorable >= 10
        : null,
      full_60m_window: neutral60.full,
      upside_60m_points: neutral60.upside,
      downside_60m_points: neutral60.downside,
      close_relative_60m_points: neutral60.closeRelative,
      favorable_60m_points: candleReaction60?.favorable ?? null,
      adverse_60m_points: candleReaction60?.adverse ?? null,
      close_move_60m_points: candleReaction60?.closeMove ?? null,
    });

    if (previousTouched) continue;

    firstTouches.push(level);
    const reference = previous?.close ?? bar.open;
    let direction = 'indeterminate';
    if (reference > level + WIDTH) direction = 'from_above';
    if (reference < level - WIDTH) direction = 'from_below';
    approaches.push(`${level}:${direction}`);

    const directionSign = direction === 'from_above' ? 1 : direction === 'from_below' ? -1 : 0;
    const reaction5 = directionSign ? reactionWindow(bars, index, level, direction, 1) : null;
    const reaction15 = directionSign ? reactionWindow(bars, index, level, direction, 3) : null;
    const reaction30 = directionSign ? reactionWindow(bars, index, level, direction, 6) : null;
    const reaction60 = directionSign ? reactionWindow(bars, index, level, direction, 12) : null;

    events.push({
      event_id: events.length + 1,
      timestamp_et: bar.timestampEt,
      session_date_et: bar.sessionDate,
      session_time_et: bar.sessionTime,
      level,
      zone_low: level - WIDTH,
      zone_high: level + WIDTH,
      approach: direction,
      previous_close: previous?.close ?? null,
      touch_open: bar.open,
      touch_high: bar.high,
      touch_low: bar.low,
      touch_close: bar.close,
      touch_close_response_points: directionSign ? round(directionSign * (bar.close - level)) : null,
      full_5m_window: reaction5?.full ?? false,
      favorable_5m_points: reaction5?.favorable ?? null,
      adverse_5m_points: reaction5?.adverse ?? null,
      close_move_5m_points: reaction5?.closeMove ?? null,
      full_15m_window: reaction15?.full ?? false,
      favorable_15m_points: reaction15?.favorable ?? null,
      adverse_15m_points: reaction15?.adverse ?? null,
      close_move_15m_points: reaction15?.closeMove ?? null,
      full_30m_window: reaction30?.full ?? false,
      favorable_30m_points: reaction30?.favorable ?? null,
      adverse_30m_points: reaction30?.adverse ?? null,
      close_move_30m_points: reaction30?.closeMove ?? null,
      dominant_30m_reaction: reaction30?.full
        ? reaction30.favorable > reaction30.adverse
        : null,
      heavy_10pt_30m_reaction: reaction30?.full
        ? reaction30.favorable >= 10
        : null,
      full_60m_window: reaction60?.full ?? false,
      favorable_60m_points: reaction60?.favorable ?? null,
      adverse_60m_points: reaction60?.adverse ?? null,
      close_move_60m_points: reaction60?.closeMove ?? null,
    });
  }

  return {
    timestamp_et: bar.timestampEt,
    session_date_et: bar.sessionDate,
    session_time_et: bar.sessionTime,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    touched_dynamite_zone: bar.touchedLevels.length > 0,
    touched_levels: bar.touchedLevels,
    first_touch_event: firstTouches.length > 0,
    first_touch_levels: firstTouches,
    approach_directions: approaches,
  };
});

function summarizeEventGroup(group) {
  const complete30 = group.filter((event) => event.full_30m_window);
  const complete60 = group.filter((event) => event.full_60m_window);
  const countAtLeast = (threshold) => complete30.filter(
    (event) => event.favorable_30m_points >= threshold,
  ).length;
  const ratio = (numerator, denominator) => denominator ? round((numerator / denominator) * 100, 1) : null;

  return {
    event_count: group.length,
    complete_30m_event_count: complete30.length,
    median_touch_close_response_points: round(median(group
      .map((event) => event.touch_close_response_points)
      .filter((value) => value != null))),
    average_favorable_30m_points: round(average(complete30.map((event) => event.favorable_30m_points))),
    median_favorable_30m_points: round(median(complete30.map((event) => event.favorable_30m_points))),
    average_adverse_30m_points: round(average(complete30.map((event) => event.adverse_30m_points))),
    median_adverse_30m_points: round(median(complete30.map((event) => event.adverse_30m_points))),
    dominant_30m_reaction_rate_pct: ratio(
      complete30.filter((event) => event.dominant_30m_reaction).length,
      complete30.length,
    ),
    favorable_5pt_within_30m_rate_pct: ratio(countAtLeast(5), complete30.length),
    favorable_10pt_within_30m_rate_pct: ratio(countAtLeast(10), complete30.length),
    favorable_20pt_within_30m_rate_pct: ratio(countAtLeast(20), complete30.length),
    median_close_move_30m_points: round(median(complete30.map((event) => event.close_move_30m_points))),
    complete_60m_event_count: complete60.length,
    median_favorable_60m_points: round(median(complete60.map((event) => event.favorable_60m_points))),
    median_adverse_60m_points: round(median(complete60.map((event) => event.adverse_60m_points))),
    median_close_move_60m_points: round(median(complete60.map((event) => event.close_move_60m_points))),
  };
}

const directionalEvents = events.filter((event) => event.approach !== 'indeterminate');
const directionalTouchObservations = touchObservations.filter(
  (observation) => observation.approach !== 'continuation_in_zone',
);
const byDirection = Object.fromEntries(
  ['from_above', 'from_below'].map((direction) => [
    direction,
    summarizeEventGroup(directionalEvents.filter((event) => event.approach === direction)),
  ]),
);
const touchCandleByDirection = Object.fromEntries(
  ['from_above', 'from_below'].map((direction) => [
    direction,
    summarizeEventGroup(
      directionalTouchObservations.filter((observation) => observation.approach === direction),
    ),
  ]),
);

const monthlyGroups = new Map();
const levelGroups = new Map();
const touchLevelGroups = new Map();
for (const event of directionalEvents) {
  const monthKey = `${event.session_date_et.slice(0, 7)}|${event.approach}`;
  const levelKey = `${event.level}|${event.approach}`;
  if (!monthlyGroups.has(monthKey)) monthlyGroups.set(monthKey, []);
  if (!levelGroups.has(levelKey)) levelGroups.set(levelKey, []);
  monthlyGroups.get(monthKey).push(event);
  levelGroups.get(levelKey).push(event);
}
for (const observation of directionalTouchObservations) {
  const levelKey = `${observation.level}|${observation.approach}`;
  if (!touchLevelGroups.has(levelKey)) touchLevelGroups.set(levelKey, []);
  touchLevelGroups.get(levelKey).push(observation);
}

const monthlySummary = [...monthlyGroups.entries()].map(([key, group]) => {
  const [month, approach] = key.split('|');
  return { month, approach, ...summarizeEventGroup(group) };
}).sort((a, b) => a.month.localeCompare(b.month) || a.approach.localeCompare(b.approach));

const levelSummary = [...levelGroups.entries()].map(([key, group]) => {
  const [level, approach] = key.split('|');
  return { level: Number(level), approach, ...summarizeEventGroup(group) };
}).sort((a, b) => a.level - b.level || a.approach.localeCompare(b.approach));

const touchCandleLevelSummary = [...touchLevelGroups.entries()].map(([key, group]) => {
  const [level, approach] = key.split('|');
  return { level: Number(level), approach, ...summarizeEventGroup(group) };
}).sort((a, b) => a.level - b.level || a.approach.localeCompare(b.approach));

const touchCoverageByLevel = [...new Set(touchObservations.map((observation) => observation.level))]
  .sort((a, b) => a - b)
  .map((level) => {
    const levelTouches = touchObservations.filter((observation) => observation.level === level);
    return {
      level,
      total_touching_candles: levelTouches.length,
      from_above_touching_candles:
        levelTouches.filter((observation) => observation.approach === 'from_above').length,
      from_below_touching_candles:
        levelTouches.filter((observation) => observation.approach === 'from_below').length,
      continuation_in_zone_candles:
        levelTouches.filter((observation) => observation.approach === 'continuation_in_zone').length,
    };
  });

const sessionDates = [...new Set(bars.map((bar) => bar.sessionDate))];
const summary = {
  instrument: 'SPCFD:SPX',
  timeframe: '5 minutes',
  timezone: 'America/New_York',
  requested_period: {
    from: '2026-02-01',
    to: '2026-07-27',
  },
  observed_period: {
    first_candle_et: bars[0]?.timestampEt ?? null,
    last_candle_et: bars.at(-1)?.timestampEt ?? null,
    session_count: sessionDates.length,
    candle_count: bars.length,
  },
  dynamite_zone_definition: {
    level_step_points: STEP,
    tolerance_points_each_side: WIDTH,
  },
  event_definition: 'First 5-minute candle touching a +/-2 point band around a $50 multiple, after the immediately preceding candle in the same session did not touch that band.',
  reaction_definition: {
    from_above: 'Favorable movement is upward (support bounce).',
    from_below: 'Favorable movement is downward (resistance rejection).',
    window: 'Touch-candle close plus subsequent same-session candles. A 30-minute window requires six subsequent 5-minute candles.',
    dominant_reaction: 'Favorable excursion is greater than adverse excursion within the complete 30-minute window.',
    heavy_reaction: 'Favorable excursion reaches at least 10 SPX points within the complete 30-minute window.',
  },
  all_events: summarizeEventGroup(directionalEvents),
  by_direction: byDirection,
  indeterminate_event_count: events.length - directionalEvents.length,
  every_touching_candle_analysis: {
    total_touch_observations: touchObservations.length,
    directional_touch_observations: directionalTouchObservations.length,
    continuation_in_zone_observations:
      touchObservations.length - directionalTouchObservations.length,
    approach_definition: 'For each touching candle and each touched $50 level: from above when the candle opened above the +2 boundary, from below when it opened below the -2 boundary. For a first touch that opened inside the band, the preceding close determines direction. Consecutive candles opening inside the band are continuation_in_zone and are not forced into a direction.',
    all_directional_touch_candles: summarizeEventGroup(directionalTouchObservations),
    by_direction: touchCandleByDirection,
    coverage_by_level: touchCoverageByLevel,
    level_summary: touchCandleLevelSummary,
  },
  monthly_summary: monthlySummary,
  level_summary: levelSummary,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeCsv(path.join(OUTPUT_DIR, 'spx-5m-all-candles.csv'), candleRows, [
  'timestamp_et',
  'session_date_et',
  'session_time_et',
  'open',
  'high',
  'low',
  'close',
  'volume',
  'touched_dynamite_zone',
  'touched_levels',
  'first_touch_event',
  'first_touch_levels',
  'approach_directions',
]);
writeCsv(path.join(OUTPUT_DIR, 'spx-5m-dynamite-events.csv'), events, Object.keys(events[0] ?? {}));
writeCsv(
  path.join(OUTPUT_DIR, 'spx-5m-all-touch-reactions.csv'),
  touchObservations,
  Object.keys(touchObservations[0] ?? {}),
);
writeCsv(path.join(OUTPUT_DIR, 'spx-5m-monthly-summary.csv'), monthlySummary, Object.keys(monthlySummary[0] ?? {}));
writeCsv(path.join(OUTPUT_DIR, 'spx-5m-level-summary.csv'), levelSummary, Object.keys(levelSummary[0] ?? {}));
writeCsv(
  path.join(OUTPUT_DIR, 'spx-5m-all-touch-level-summary.csv'),
  touchCandleLevelSummary,
  Object.keys(touchCandleLevelSummary[0] ?? {}),
);
writeCsv(
  path.join(OUTPUT_DIR, 'spx-5m-touch-coverage-by-level.csv'),
  touchCoverageByLevel,
  Object.keys(touchCoverageByLevel[0] ?? {}),
);
fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

console.log(JSON.stringify(summary, null, 2));
