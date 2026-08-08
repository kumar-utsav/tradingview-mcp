import { createHash, randomUUID } from "node:crypto";
import {
  evaluate as defaultEvaluate,
  evaluateAsync as defaultEvaluateAsync,
  getClient,
} from "../connection.js";
import { getPineLabels } from "./data.js";

const CHART_API = "window.TradingViewApi._activeChartWidgetWV.value()";
const MAX_TRADES_BATCH = 1000;

const LEVEL_TAG_PATTERNS = [
  [/^PWH\b/i, "bt_confluence_prior_week_high"],
  [/^PWL\b/i, "bt_confluence_prior_week_low"],
  [/^PDH\d*\b/i, "bt_confluence_prior_day_high"],
  [/^PDL\d*\b/i, "bt_confluence_prior_day_low"],
  [/^PDC\b/i, "bt_confluence_prior_day_close"],
  [/^PMH\b/i, "bt_confluence_premarket_high"],
  [/^PML\b/i, "bt_confluence_premarket_low"],
  [/^5MH\b/i, "bt_confluence_first_5m_high"],
  [/^5ML\b/i, "bt_confluence_first_5m_low"],
  [/^15MH\b/i, "bt_confluence_first_15m_high"],
  [/^15ML\b/i, "bt_confluence_first_15m_low"],
  [/^OPEN\b/i, "bt_confluence_session_open"],
  [/^HIGH\b/i, "bt_confluence_hod"],
  [/^LOW\b/i, "bt_confluence_lod"],
  [/\bVWAP\b/i, "bt_confluence_vwap"],
  [/\b(?:EMA|SMA|MOVING AVERAGE)\b/i, "bt_confluence_moving_average"],
  [/\b(?:PSYCH|DYN|ATH|ROUND)\b/i, "bt_confluence_htf_round_dynamic"],
];

export function classifyLevelLabel(label) {
  return LEVEL_TAG_PATTERNS.find(([pattern]) => pattern.test(label || ""))?.[1];
}

export function enrichTradesWithStudyLabels(trades, labelResult) {
  const labels = (labelResult?.studies || [])
    .filter((study) => !/market structures|zigzag/i.test(study.name || ""))
    .flatMap((study) =>
      (study.labels || []).map((label) => ({ ...label, study: study.name })),
    );
  return trades.map((trade) => {
    const low = trade.chart_context?.entry_candle?.low;
    const high = trade.chart_context?.entry_candle?.high;
    if (!Number.isFinite(low) || !Number.isFinite(high)) return trade;
    const touching = labels.filter(
      (label) =>
        Number.isFinite(label.price) &&
        label.price >= low &&
        label.price <= high,
    );
    const tags = new Set(trade.tags || []);
    touching.forEach((level) => {
      const tag = classifyLevelLabel(level.text);
      if (tag) tags.add(tag);
    });
    return {
      ...trade,
      tags: [...tags],
      chart_context: {
        ...trade.chart_context,
        touching_drawings: [
          ...(trade.chart_context?.touching_drawings || []),
          ...touching.map((level) => ({
            kind: "indicator_level",
            label: level.text || level.study,
            price_low: level.price,
            price_high: level.price,
          })),
        ].slice(0, 50),
      },
    };
  });
}

function dependencies(overrides = {}) {
  return {
    evaluate: overrides.evaluate || defaultEvaluate,
    evaluateAsync: overrides.evaluateAsync || defaultEvaluateAsync,
    captureScreenshot: overrides.captureScreenshot || captureChartScreenshot,
    fetch: overrides.fetch || globalThis.fetch,
    getPineLabels: overrides.getPineLabels || getPineLabels,
  };
}

function configuration() {
  const backendUrl = String(process.env.TRADING_BACKEND_URL || "").replace(
    /\/+$/,
    "",
  );
  const token = process.env.TRADINGVIEW_INGESTION_TOKEN || "";
  if (!backendUrl) throw new Error("TRADING_BACKEND_URL is required");
  if (!token) throw new Error("TRADINGVIEW_INGESTION_TOKEN is required");
  return { backendUrl, token };
}

function fingerprint(operation, payload) {
  return createHash("sha256")
    .update(JSON.stringify({ operation, payload }))
    .digest("hex");
}

export const activeChartBoundsExpression = `
  (function() {
    var api = window.TradingViewApi;
    var collection = api && api._chartWidgetCollection;
    var active = api && api._activeChartWidgetWV
      ? api._activeChartWidgetWV.value() : null;
    var charts = collection && collection.getAll ? collection.getAll() : [];
    var activeIndex = -1;
    for (var index = 0; index < charts.length; index++) {
      if (active && active._chartWidget && charts[index] === active._chartWidget) {
        activeIndex = index;
        break;
      }
    }
    var el = activeIndex >= 0
      ? document.querySelector('[aria-label="Chart #' + (activeIndex + 1) + '"]')
      : null;
    if (!el) {
      el = document.querySelector('[data-name="pane-canvas"]')
        || document.querySelector('[class*="chart-container"]')
        || document.querySelector('canvas');
    }
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      active_index: activeIndex
    };
  })()
`;

async function captureChartScreenshot(evaluate = defaultEvaluate) {
  const client = await getClient();
  const bounds = await evaluate(activeChartBoundsExpression);
  const params = { format: "png" };
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    params.clip = { ...bounds, scale: 1 };
  }
  const { data } = await client.Page.captureScreenshot(params);
  return data;
}

async function postCapture(path, operation, payload, requestedKey, deps) {
  const { backendUrl, token } = configuration();
  const identityPayload = payload.capture || payload.trades;
  const idempotencyKey =
    requestedKey || fingerprint(operation, identityPayload);
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await deps.fetch(`${backendUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        return {
          success: true,
          idempotency_key: idempotencyKey,
          replayed: response.headers.get("idempotency-replayed") === "true",
          ...body,
        };
      }
      const error = new Error(
        body.message || `Backend ingestion failed with HTTP ${response.status}`,
      );
      error.retryable = response.status >= 500;
      throw error;
    } catch (error) {
      lastError = error;
      if (error.retryable === false || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  throw lastError;
}

function journalExtractionExpression(type) {
  return `(async function() {
    var chart = window.TradingViewApi.activeChart
      ? window.TradingViewApi.activeChart()
      : ${CHART_API};
    if (!chart) throw new Error('No active chart found');
    var symbolInfo = chart.symbolExt();
    var symbol = symbolInfo && (symbolInfo.symbol || symbolInfo.ticker);
    var timeFrame = Number(chart.resolution());
    var shapes = chart.getAllShapes() || [];
    var longPosition = shapes.find(function(shape) { return shape.name === 'long_position'; });
    var shortPosition = shapes.find(function(shape) { return shape.name === 'short_position'; });
    var shapeId = (longPosition || shortPosition) && (longPosition || shortPosition).id;
    var shape = shapeId ? chart.getShapeById(shapeId) : null;
    var properties = shape && shape.getProperties ? shape.getProperties() : {};
    var profitLevel = properties.profitLevel;
    var stopLevel = properties.stopLevel;
    var rr = profitLevel && stopLevel ? Number((profitLevel / stopLevel).toFixed(2)) : null;
    var bars = chart.getSeries().data().bars();
    var allBars = bars._items || [];
    var barTimestamp = await chart.requestSelectBar();
    var barIndex = allBars.findIndex(function(item) { return item.value[0] === barTimestamp; });
    if (barIndex < 0) throw new Error('Selected bar was not found in loaded chart data');
    var value = allBars[barIndex].value;
    var epochTime = value[0], high = value[2], low = value[3];
    var dateTime = new Date(epochTime * 1000);
    var zone = 'America/Los_Angeles';
    var barDateString = dateTime.toLocaleDateString('en-US', { timeZone: zone });
    function dateOf(item) {
      return new Date(item.value[0] * 1000).toLocaleDateString('en-US', { timeZone: zone });
    }
    function minutesOf(item) {
      var dt = new Date(item.value[0] * 1000);
      var hour = parseInt(dt.toLocaleTimeString('en-US', { timeZone: zone, hour: '2-digit', hour12: false }));
      var minute = parseInt(dt.toLocaleTimeString('en-US', { timeZone: zone, minute: '2-digit' }));
      return hour * 60 + minute;
    }
    function range(items) {
      if (!items.length) return { high: null, low: null };
      return {
        high: Math.max.apply(null, items.map(function(item) { return item.value[2]; })),
        low: Math.min.apply(null, items.map(function(item) { return item.value[3]; }))
      };
    }
    function inside(valueToCheck, values) {
      return values.high !== null && valueToCheck <= values.high && valueToCheck >= values.low;
    }
    var uniqueDates = Array.from(new Set(allBars.map(dateOf)));
    var dateIndex = uniqueDates.indexOf(barDateString);
    var previousDate = dateIndex > 0 ? uniqueDates[dateIndex - 1] : null;
    var previousDay = range(allBars.filter(function(item) {
      var minutes = minutesOf(item);
      return previousDate && dateOf(item) === previousDate && minutes >= 390 && minutes < 780;
    }));
    var premarket = range(allBars.filter(function(item) {
      var minutes = minutesOf(item);
      return dateOf(item) === barDateString && minutes >= 60 && minutes < 390;
    }));
    var first15 = range(allBars.filter(function(item) {
      var minutes = minutesOf(item);
      return dateOf(item) === barDateString && minutes >= 390 && minutes < 405;
    }));
    var first5 = range(allBars.filter(function(item) {
      var minutes = minutesOf(item);
      return dateOf(item) === barDateString && minutes >= 390 && minutes < 395;
    }));
    var useHigh = ${JSON.stringify(type)} === 'Call';
    var selectedPrice = useHigh ? high : low;
    var pacificDate = new Date(dateTime.toLocaleString('en-US', { timeZone: zone }));
    return {
      chart_date: pacificDate.toISOString().split('T')[0],
      entry_candle: dateTime.toLocaleTimeString('en-US', {
        timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false
      }),
      ticker: symbol,
      time_frame: timeFrame,
      rr: rr,
      type: ${JSON.stringify(type)},
      tags: [
        inside(selectedPrice, premarket) ? 'pa_inside_pm' : 'pa_outside_pm',
        inside(selectedPrice, previousDay) ? 'pa_inside_pd' : 'pa_outside_pd',
        inside(selectedPrice, first15) ? 'pa_inside_15m' : 'pa_outside_15m',
        inside(selectedPrice, first5) ? 'pa_inside_5m' : 'pa_outside_5m'
      ]
    };
  })()`;
}

export function createBacktestExtractionExpression(
  maxTrades = MAX_TRADES_BATCH,
  targetDate = null,
  includeAudit = false,
) {
  return `
  (function() {
    var chart = window.TradingViewApi.activeChart
      ? window.TradingViewApi.activeChart()
      : ${CHART_API};
    if (!chart) throw new Error('No active chart found');
    var barsItems = chart.getSeries().data().bars()._items || [];
    if (!barsItems.length) throw new Error('No loaded chart bars found');
    var symbolInfo = chart.symbolExt();
    var symbol = symbolInfo && (symbolInfo.symbol || symbolInfo.ticker);
    var timeFrame = Number(chart.resolution());
    var targetDate = ${JSON.stringify(targetDate)};
    var includeAudit = ${JSON.stringify(includeAudit)};
    var chartSource = window.location && window.location.pathname
      ? window.location.pathname : 'active-chart';
    var zone = 'America/Los_Angeles';
    var timeCache = new Map();
    function timeData(tsMs) {
      if (timeCache.has(tsMs)) return timeCache.get(tsMs);
      var dateObj = new Date(tsMs);
      var timeStr = dateObj.toLocaleTimeString('en-US', {
        timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false
      });
      var pacificDate = new Date(dateObj.toLocaleString('en-US', { timeZone: zone }));
      var data = { time: timeStr, date: pacificDate.toISOString().split('T')[0] };
      timeCache.set(tsMs, data);
      return data;
    }
    function barIndex(timestamp) {
      for (var i = 0; i < barsItems.length; i++) {
        if (barsItems[i].value[0] === timestamp) return i;
      }
      return -1;
    }
    function dateOf(item) {
      return timeData(item.value[0] * 1000).date;
    }
    function minutesOf(item) {
      var dt = new Date(item.value[0] * 1000);
      var hour = parseInt(dt.toLocaleTimeString('en-US', {
        timeZone: zone, hour: '2-digit', hour12: false
      }));
      var minute = parseInt(dt.toLocaleTimeString('en-US', {
        timeZone: zone, minute: '2-digit'
      }));
      return hour * 60 + minute;
    }
    function range(items) {
      if (!items.length) return { high: null, low: null };
      return {
        high: Math.max.apply(null, items.map(function(item) { return item.value[2]; })),
        low: Math.min.apply(null, items.map(function(item) { return item.value[3]; }))
      };
    }
    function rangePosition(price, values) {
      if (values.high == null || values.low == null) return 'unavailable';
      return price <= values.high && price >= values.low ? 'inside' : 'outside';
    }
    var barsByDate = new Map();
    barsItems.forEach(function(item) {
      var date = dateOf(item);
      if (!barsByDate.has(date)) barsByDate.set(date, []);
      barsByDate.get(date).push(item);
    });
    var uniqueDates = Array.from(barsByDate.keys());
    var sessionCache = new Map();
    function sessionContext(index, entryPrice) {
      var entryItem = barsItems[index];
      var entryDate = dateOf(entryItem);
      if (!sessionCache.has(entryDate)) {
        var dateIndex = uniqueDates.indexOf(entryDate);
        var previousDate = dateIndex > 0 ? uniqueDates[dateIndex - 1] : null;
        var previousItems = previousDate ? (barsByDate.get(previousDate) || []) : [];
        var entryItems = barsByDate.get(entryDate) || [];
        var previousRth = previousItems.filter(function(item) {
          var minutes = minutesOf(item);
          return minutes >= 390 && minutes < 780;
        });
        var previousDay = range(previousRth);
        previousDay.close = previousRth.length
          ? previousRth[previousRth.length - 1].value[4] : null;
        var premarket = range(entryItems.filter(function(item) {
          var minutes = minutesOf(item);
          return minutes >= 60 && minutes < 390;
        }));
        var first5 = range(entryItems.filter(function(item) {
          var minutes = minutesOf(item);
          return minutes >= 390 && minutes < 395;
        }));
        var first15 = range(entryItems.filter(function(item) {
          var minutes = minutesOf(item);
          return minutes >= 390 && minutes < 405;
        }));
        var openItem = entryItems.find(function(item) { return minutesOf(item) === 390; });
        sessionCache.set(entryDate, {
          previous_day: previousDay,
          premarket: premarket,
          first_5m: first5,
          first_15m: first15,
          session_open: openItem ? openItem.value[1] : null
        });
      }
      var base = sessionCache.get(entryDate);
      var entryMinutes = minutesOf(entryItem);
      return {
        previous_day: {
          high: base.previous_day.high,
          low: base.previous_day.low,
          close: base.previous_day.close,
          position: rangePosition(entryPrice, base.previous_day)
        },
        premarket: {
          high: base.premarket.high,
          low: base.premarket.low,
          position: rangePosition(entryPrice, base.premarket)
        },
        first_5m: entryMinutes >= 395 ? base.first_5m : { high: null, low: null },
        first_15m: entryMinutes >= 405 ? base.first_15m : { high: null, low: null },
        session_open: base.session_open
      };
    }
    function rrFrom(profit, stop) {
      if (profit == null || stop == null || stop === 0) return null;
      var ratio = profit / stop;
      return Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null;
    }
    function textValue(value) {
      if (typeof value === 'string') return value.trim();
      if (!value || typeof value !== 'object') return '';
      if (typeof value.value === 'function') {
        try { return textValue(value.value()); } catch (error) {}
      }
      return textValue(value.text || value.content || value.value || value.title);
    }
    function propertyBoolean(value) {
      if (value && typeof value.value === 'function') {
        try { return Boolean(value.value()); } catch (error) { return false; }
      }
      return Boolean(value);
    }
    function noteText(shape, properties) {
      var candidates = [
        properties.text,
        properties.content,
        properties.note,
        properties.description,
        properties.title
      ];
      if (shape && typeof shape.getText === 'function') {
        try { candidates.push(shape.getText()); } catch (error) {}
      }
      for (var i = 0; i < candidates.length; i++) {
        var text = textValue(candidates[i]);
        if (text) return text.slice(0, 10000);
      }
      return '';
    }
    function numberedTradeNote(text) {
      var match = String(text || '').match(
        /^#?([1-9]\\d{0,2})\\s*[:.)-]\\s+([\\s\\S]+)$/
      );
      if (!match) return null;
      var value = match[2].trim();
      return value ? { ordinal: Number(match[1]), text: value } : null;
    }
    function outcome(startIndex, entryPrice, profit, stop, isLong) {
      if (profit == null || stop == null || entryPrice == null || startIndex < 0) {
        return { outcome: 'Needs Review', exit_candle: null, duration_minutes: null };
      }
      var target = isLong ? entryPrice + profit / 100 : entryPrice - profit / 100;
      var stopPrice = isLong ? entryPrice - stop / 100 : entryPrice + stop / 100;
      var entryTs = barsItems[startIndex].value[0];
      for (var i = startIndex + 1; i < barsItems.length; i++) {
        var value = barsItems[i].value;
        var targetHit = isLong ? value[2] >= target : value[3] <= target;
        var stopHit = isLong ? value[3] <= stopPrice : value[2] >= stopPrice;
        if (!targetHit && !stopHit) continue;
        return {
          outcome: targetHit && stopHit
            ? 'Ambiguous' : (targetHit ? 'Win' : 'Loss'),
          exit_candle: timeData(value[0] * 1000).time,
          duration_minutes: (value[0] - entryTs) / 60
        };
      }
      return { outcome: 'Needs Review', exit_candle: null, duration_minutes: null };
    }
    var allShapes = chart.getAllShapes() || [];
    var shapes = allShapes.filter(function(shape) {
      return shape.name === 'long_position' || shape.name === 'short_position';
    })${maxTrades == null ? "" : `.slice(0, ${maxTrades})`};
    var trades = [];
    for (var i = 0; i < shapes.length; i++) {
      try {
      var meta = shapes[i];
      var shape = chart.getShapeById(meta.id);
      if (!shape) continue;
      var properties = shape.getProperties ? shape.getProperties() : {};
      var points = shape.getPoints ? shape.getPoints() : [];
      if (!points.length) continue;
      var entryTime = points[0].time;
      var entryPrice = points[0].price;
      if (targetDate && timeData(Number(entryTime) * 1000).date !== targetDate) continue;
      var index = entryTime == null ? -1 : barIndex(entryTime);
      if (index < 0) continue;
      var isLong = meta.name === 'long_position';
      var profit = properties.profitLevel == null ? null : properties.profitLevel;
      var stop = properties.stopLevel == null ? null : properties.stopLevel;
      var result = outcome(index, entryPrice, profit, stop, isLong);
      var context = timeData(barsItems[index].value[0] * 1000);
      var entryValue = barsItems[index].value;
      var sessions = sessionContext(index, entryPrice);
      var capturedTags = [];
      if (sessions.previous_day.position !== 'unavailable') {
        capturedTags.push(sessions.previous_day.position === 'inside'
          ? 'bt_position_inside_prior_day' : 'bt_position_outside_prior_day');
      }
      if (sessions.premarket.position !== 'unavailable') {
        capturedTags.push(sessions.premarket.position === 'inside'
          ? 'bt_position_inside_premarket' : 'bt_position_outside_premarket');
      }
      function touchLevel(price, tag) {
        if (price != null && entryValue[3] <= price && entryValue[2] >= price) {
          capturedTags.push(tag);
        }
      }
      touchLevel(sessions.previous_day.high, 'bt_confluence_prior_day_high');
      touchLevel(sessions.previous_day.low, 'bt_confluence_prior_day_low');
      touchLevel(sessions.previous_day.close, 'bt_confluence_prior_day_close');
      touchLevel(sessions.premarket.high, 'bt_confluence_premarket_high');
      touchLevel(sessions.premarket.low, 'bt_confluence_premarket_low');
      touchLevel(sessions.first_5m.high, 'bt_confluence_first_5m_high');
      touchLevel(sessions.first_5m.low, 'bt_confluence_first_5m_low');
      touchLevel(sessions.first_15m.high, 'bt_confluence_first_15m_high');
      touchLevel(sessions.first_15m.low, 'bt_confluence_first_15m_low');
      touchLevel(sessions.session_open, 'bt_confluence_session_open');
      var targetPrice = entryPrice != null
        ? (isLong ? entryPrice + (profit || 0) / 100 : entryPrice - (profit || 0) / 100)
        : 0;
      var stopPrice = entryPrice != null
        ? (isLong ? entryPrice - (stop || 0) / 100 : entryPrice + (stop || 0) / 100)
        : 0;
      trades.push({
        source_id: chartSource + '::' + String(meta.id),
        ticker: symbol,
        time_frame: timeFrame,
        chart_date: context.date,
        entry_candle: context.time,
        exit_candle: result.exit_candle,
        duration_minutes: result.duration_minutes,
        type: isLong ? 'Call' : 'Put',
        entry_price: entryPrice != null ? Number(entryPrice.toFixed(2)) : 0,
        target_price: Number(targetPrice.toFixed(2)),
        stop_price: Number(stopPrice.toFixed(2)),
        rr: rrFrom(profit, stop),
        outcome: result.outcome,
        tags: Array.from(new Set(capturedTags)),
        notes: '',
        chart_context: {
          entry_candle: {
            open: entryValue[1], high: entryValue[2], low: entryValue[3], close: entryValue[4]
          },
          ranges: sessions,
          touching_drawings: []
        },
        _entry_time: entryTime,
        _entry_price: entryPrice,
        _entry_date: context.date
      });
      } catch (error) {}
    }
    var drawingShapes = allShapes.filter(function(meta) {
      return meta.name === 'rectangle' || meta.name === 'horizontal_line'
        || meta.name === 'horizontal_ray' || meta.name === 'trend_line';
    });
    for (var drawingIndex = 0; drawingIndex < drawingShapes.length; drawingIndex++) {
      try {
        var drawingMeta = drawingShapes[drawingIndex];
        var drawing = chart.getShapeById(drawingMeta.id);
        var drawingProperties = drawing && drawing.getProperties ? drawing.getProperties() : {};
        var drawingPoints = drawing && drawing.getPoints ? drawing.getPoints() : [];
        if (!drawingPoints.length) continue;
        var drawingPrices = drawingPoints.map(function(point) { return Number(point.price); })
          .filter(Number.isFinite);
        var drawingTimes = drawingPoints.map(function(point) { return Number(point.time); })
          .filter(Number.isFinite);
        if (!drawingPrices.length) continue;
        var priceLow = Math.min.apply(null, drawingPrices);
        var priceHigh = Math.max.apply(null, drawingPrices);
        var timeLow = drawingTimes.length ? Math.min.apply(null, drawingTimes) : null;
        var timeHigh = drawingTimes.length ? Math.max.apply(null, drawingTimes) : null;
        var drawingLabel = noteText(drawing, drawingProperties) || drawingMeta.name;
        for (var drawingTradeIndex = 0; drawingTradeIndex < trades.length; drawingTradeIndex++) {
          var drawingTrade = trades[drawingTradeIndex];
          var candle = drawingTrade.chart_context.entry_candle;
          var priceTouches = candle.low <= priceHigh && candle.high >= priceLow;
          var timeTouches = timeLow == null || timeHigh == null
            || (drawingTrade._entry_time >= timeLow && drawingTrade._entry_time <= timeHigh)
            || (propertyBoolean(drawingProperties.extendRight)
              && drawingTrade._entry_time >= timeLow)
            || (propertyBoolean(drawingProperties.extendLeft)
              && drawingTrade._entry_time <= timeHigh);
          if (!priceTouches || !timeTouches) continue;
          if (drawingTrade.chart_context.touching_drawings.length < 50) {
            drawingTrade.chart_context.touching_drawings.push({
              kind: drawingMeta.name,
              label: drawingLabel,
              price_low: priceLow,
              price_high: priceHigh
            });
          }
          drawingTrade.tags.push(drawingMeta.name === 'rectangle'
            ? 'bt_confluence_decision_zone' : 'bt_confluence_manual_level');
          drawingTrade.tags = Array.from(new Set(drawingTrade.tags));
        }
      } catch (error) {}
    }
    trades.sort(function(left, right) {
      return left._entry_time - right._entry_time
        || left.source_id.localeCompare(right.source_id);
    });
    var notes = [];
    for (var noteIndex = 0; noteIndex < allShapes.length; noteIndex++) {
      var noteMeta = allShapes[noteIndex];
      if (noteMeta.name === 'long_position' || noteMeta.name === 'short_position') continue;
      if (!/text|note|callout|balloon/i.test(noteMeta.name || '')) continue;
      try {
        var noteShape = chart.getShapeById(noteMeta.id);
        if (!noteShape) continue;
        var noteProperties = noteShape.getProperties ? noteShape.getProperties() : {};
        var rawText = noteText(noteShape, noteProperties);
        if (!rawText || /^DAY\\s*:/i.test(rawText)) continue;
        var tradeText = rawText.replace(/^TRADE\\s*:\\s*/i, '').trim();
        var numbered = numberedTradeNote(tradeText);
        var text = numbered ? numbered.text : tradeText;
        if (!text) continue;
        var notePoints = noteShape.getPoints ? noteShape.getPoints() : [];
        if (!notePoints.length || notePoints[0].time == null) continue;
        var noteDate = timeData(Number(notePoints[0].time) * 1000).date;
        if (targetDate && noteDate !== targetDate) continue;
        notes.push({
          drawing_id: String(noteMeta.id),
          source_id: chartSource + '::' + String(noteMeta.id),
          text: text,
          ordinal: numbered ? numbered.ordinal : null,
          time: Number(notePoints[0].time),
          date: noteDate,
          price: notePoints[0].price == null ? null : Number(notePoints[0].price)
        });
      } catch (error) {}
    }
    notes.sort(function(left, right) {
      var numberedPriority = Number(left.ordinal == null)
        - Number(right.ordinal == null);
      return numberedPriority
        || left.time - right.time
        || (left.price || 0) - (right.price || 0);
    });
    var secondsPerBar = Math.max(
      60,
      Number.isFinite(timeFrame) ? timeFrame * 60 : 60
    );
    var noteAudit = [];
    var ordinalCounts = new Map();
    for (var countIndex = 0; countIndex < notes.length; countIndex++) {
      if (notes[countIndex].ordinal == null) continue;
      ordinalCounts.set(
        notes[countIndex].ordinal,
        (ordinalCounts.get(notes[countIndex].ordinal) || 0) + 1
      );
    }
    var numberedTradeIndexes = new Set();
    for (var n = 0; n < notes.length; n++) {
      if (notes[n].ordinal != null) {
        var numberedIndex = notes[n].ordinal - 1;
        var numberedTrade = trades[numberedIndex];
        var duplicateNumber = ordinalCounts.get(notes[n].ordinal) > 1;
        if (numberedTrade && !duplicateNumber) {
          numberedTrade.notes = numberedTrade.notes
            ? numberedTrade.notes + '\\n\\n' + notes[n].text
            : notes[n].text;
          numberedTradeIndexes.add(numberedIndex);
          noteAudit.push({
            drawing_id: notes[n].drawing_id,
            source_id: notes[n].source_id,
            text: notes[n].text,
            status: 'assigned',
            trade_source_id: numberedTrade.source_id,
            candidate_source_ids: [numberedTrade.source_id]
          });
        } else {
          noteAudit.push({
            drawing_id: notes[n].drawing_id,
            source_id: notes[n].source_id,
            text: notes[n].text,
            status: duplicateNumber ? 'ambiguous' : 'unassigned',
            trade_source_id: null,
            candidate_source_ids: numberedTrade ? [numberedTrade.source_id] : []
          });
        }
        continue;
      }
      var candidates = [];
      for (var tradeIndex = 0; tradeIndex < trades.length; tradeIndex++) {
        if (numberedTradeIndexes.has(tradeIndex)) continue;
        var candidate = trades[tradeIndex];
        if (notes[n].date !== candidate._entry_date) continue;
        var timeDistance = Math.abs(notes[n].time - candidate._entry_time);
        var maxTimeDistance = secondsPerBar * 40;
        if (timeDistance > maxTimeDistance) continue;
        var priceDistance = notes[n].price == null
          ? 0
          : Math.abs(notes[n].price - candidate._entry_price);
        var maxPriceDistance = Math.max(Math.abs(candidate._entry_price) * 0.12, 1);
        if (priceDistance > maxPriceDistance) continue;
        var score = timeDistance / maxTimeDistance + priceDistance / maxPriceDistance;
        candidates.push({ index: tradeIndex, score: score });
      }
      candidates.sort(function(left, right) { return left.score - right.score; });
      var best = candidates[0];
      var second = candidates[1];
      var ambiguous = best && second && second.score - best.score <= 0.15;
      if (best && !ambiguous) {
        trades[best.index].notes = trades[best.index].notes
          ? trades[best.index].notes + '\\n\\n' + notes[n].text
          : notes[n].text;
        noteAudit.push({
          drawing_id: notes[n].drawing_id,
          source_id: notes[n].source_id,
          text: notes[n].text,
          status: 'assigned',
          trade_source_id: trades[best.index].source_id,
          candidate_source_ids: [trades[best.index].source_id]
        });
      } else {
        noteAudit.push({
          drawing_id: notes[n].drawing_id,
          source_id: notes[n].source_id,
          text: notes[n].text,
          status: ambiguous ? 'ambiguous' : 'unassigned',
          trade_source_id: null,
          candidate_source_ids: candidates.slice(0, 3).map(function(item) {
            return trades[item.index].source_id;
          })
        });
      }
    }
    for (var cleanIndex = 0; cleanIndex < trades.length; cleanIndex++) {
      delete trades[cleanIndex]._entry_time;
      delete trades[cleanIndex]._entry_price;
      delete trades[cleanIndex]._entry_date;
    }
    return includeAudit ? { trades: trades, note_audit: noteAudit } : trades;
  })()
`;
}

export function tradeNoteDeletionExpression(candidates, checkpointKey) {
  return `
    (function() {
      /* backtest-trade-note-delete */
      var chart = window.TradingViewApi.activeChart
        ? window.TradingViewApi.activeChart()
        : ${CHART_API};
      if (!chart) return { success: false, error: 'No active chart found' };
      var candidates = ${JSON.stringify(candidates)};
      var seen = new Set();
      function textValue(value) {
        if (typeof value === 'string') return value.trim();
        if (!value || typeof value !== 'object') return '';
        if (typeof value.value === 'function') {
          try { return textValue(value.value()); } catch (error) {}
        }
        return textValue(value.text || value.content || value.value || value.title);
      }
      function noteText(shape, properties) {
        var values = [properties.text, properties.content, properties.note,
          properties.description, properties.title];
        if (shape && typeof shape.getText === 'function') {
          try { values.push(shape.getText()); } catch (error) {}
        }
        for (var index = 0; index < values.length; index++) {
          var text = textValue(values[index]);
          if (text) {
            var normalized = text.replace(/^TRADE\\s*:\\s*/i, '').trim();
            var numbered = normalized.match(
              /^#?([1-9]\\d{0,2})\\s*[:.)-]\\s+([\\s\\S]+)$/
            );
            return numbered ? numbered[2].trim() : normalized;
          }
        }
        return '';
      }
      var allShapes = chart.getAllShapes() || [];
      for (var index = 0; index < candidates.length; index++) {
        var candidate = candidates[index];
        if (!candidate.drawing_id || seen.has(candidate.drawing_id)) {
          return { success: false, error: 'A trade note drawing ID was missing or repeated' };
        }
        seen.add(candidate.drawing_id);
        var meta = allShapes.find(function(shape) {
          return String(shape.id) === candidate.drawing_id;
        });
        if (!meta || !/text|note|callout|balloon/i.test(meta.name || '')) {
          return { success: false, error: 'Trade note drawing was not found: ' + candidate.drawing_id };
        }
        var shape = chart.getShapeById(meta.id);
        var properties = shape && shape.getProperties ? shape.getProperties() : {};
        if (!shape || noteText(shape, properties) !== candidate.text) {
          return { success: false, error: 'Trade note changed before it could be removed: ' + candidate.drawing_id };
        }
      }
      var undoModel = chart.chartUndoModel && chart.chartUndoModel();
      var history = undoModel && undoModel.undoHistory && undoModel.undoHistory();
      if (!history || typeof history.createUndoCheckpoint !== 'function'
          || typeof history.undoToCheckpoint !== 'function'
          || typeof chart.removeEntityWithUndo !== 'function') {
        return { success: false, error: 'TradingView note removal with undo is unavailable' };
      }
      var checkpoints = window.__tradingviewMcpBacktestNoteCheckpoints
        || (window.__tradingviewMcpBacktestNoteCheckpoints = {});
      checkpoints[${JSON.stringify(checkpointKey)}] = {
        history: history,
        checkpoint: history.createUndoCheckpoint()
      };
      for (var removeIndex = 0; removeIndex < candidates.length; removeIndex++) {
        chart.removeEntityWithUndo(candidates[removeIndex].drawing_id);
      }
      var remaining = new Set((chart.getAllShapes() || []).map(function(shape) {
        return String(shape.id);
      }));
      var failed = candidates.filter(function(candidate) {
        return remaining.has(candidate.drawing_id);
      });
      if (failed.length) {
        var saved = checkpoints[${JSON.stringify(checkpointKey)}];
        saved.history.undoToCheckpoint(saved.checkpoint);
        delete checkpoints[${JSON.stringify(checkpointKey)}];
        return { success: false, error: 'TradingView did not remove every assigned trade note' };
      }
      return {
        success: true,
        removed_ids: candidates.map(function(candidate) { return candidate.drawing_id; })
      };
    })()
  `;
}

export function finishTradeNoteDeletionExpression(checkpointKey, restore) {
  return `
    (function() {
      /* backtest-trade-note-${restore ? "restore" : "commit"} */
      var checkpoints = window.__tradingviewMcpBacktestNoteCheckpoints || {};
      var saved = checkpoints[${JSON.stringify(checkpointKey)}];
      if (!saved) return { success: false, error: 'Trade note undo checkpoint was not found' };
      ${restore ? "saved.history.undoToCheckpoint(saved.checkpoint);" : ""}
      delete checkpoints[${JSON.stringify(checkpointKey)}];
      return { success: true, restored: ${JSON.stringify(restore)} };
    })()
  `;
}

function assignedTradeNoteCandidates(noteAudit = []) {
  return noteAudit
    .filter(
      (assignment) =>
        assignment.status === "assigned" &&
        assignment.drawing_id &&
        assignment.trade_source_id,
    )
    .map((assignment) => ({
      drawing_id: String(assignment.drawing_id),
      text: assignment.text,
      trade_source_id: assignment.trade_source_id,
    }));
}

function publicNoteAssignments(noteAudit = []) {
  return noteAudit.map(({ drawing_id: _drawingId, ...assignment }) => assignment);
}

async function removeAssignedTradeNotes(candidates, deps) {
  if (!candidates.length) return null;
  const checkpointKey = randomUUID();
  const result = await deps.evaluate(
    tradeNoteDeletionExpression(candidates, checkpointKey),
  );
  if (!result?.success) {
    throw new Error(result?.error || "Assigned trade notes could not be removed");
  }
  return { checkpointKey, candidates };
}

async function restoreAssignedTradeNotes(removal, deps) {
  if (!removal) return { success: true, restored: false };
  return deps.evaluate(
    finishTradeNoteDeletionExpression(removal.checkpointKey, true),
  );
}

async function commitAssignedTradeNoteRemoval(removal, deps) {
  if (!removal) return { success: true };
  return deps.evaluate(
    finishTradeNoteDeletionExpression(removal.checkpointKey, false),
  );
}

export const backtestExtractionExpression =
  createBacktestExtractionExpression(MAX_TRADES_BATCH);

function dayPositionInventoryExpression(targetDate) {
  return `
    (function() {
      /* backtest-day-inventory */
      var chart = window.TradingViewApi.activeChart
        ? window.TradingViewApi.activeChart()
        : ${CHART_API};
      if (!chart) throw new Error('No active chart found');
      var chartSource = window.location && window.location.pathname
        ? window.location.pathname : 'active-chart';
      var zone = 'America/Los_Angeles';
      function dateOf(timestamp) {
        var value = new Date(Number(timestamp) * 1000).toLocaleDateString('en-CA', {
          timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
        });
        return value;
      }
      var result = [];
      var shapes = chart.getAllShapes() || [];
      for (var index = 0; index < shapes.length; index++) {
        var meta = shapes[index];
        if (meta.name !== 'long_position' && meta.name !== 'short_position') continue;
        try {
          var shape = chart.getShapeById(meta.id);
          var points = shape && shape.getPoints ? shape.getPoints() : [];
          if (!points.length || points[0].time == null) continue;
          if (dateOf(points[0].time) !== ${JSON.stringify(targetDate)}) continue;
          result.push({
            drawing_id: String(meta.id),
            source_id: chartSource + '::' + String(meta.id),
            entry_time: Number(points[0].time)
          });
        } catch (error) {}
      }
      return result;
    })()
  `;
}

function dayNotesExtractionExpression(targetDate) {
  return `
    (function() {
      /* backtest-day-notes */
      var chart = window.TradingViewApi.activeChart
        ? window.TradingViewApi.activeChart()
        : ${CHART_API};
      if (!chart) throw new Error('No active chart found');
      var zone = 'America/Los_Angeles';
      function textValue(value) {
        if (typeof value === 'string') return value.trim();
        if (!value || typeof value !== 'object') return '';
        if (typeof value.value === 'function') {
          try { return textValue(value.value()); } catch (error) {}
        }
        return textValue(value.text || value.content || value.value || value.title);
      }
      function noteText(shape, properties) {
        var candidates = [properties.text, properties.content, properties.note,
          properties.description, properties.title];
        if (shape && typeof shape.getText === 'function') {
          try { candidates.push(shape.getText()); } catch (error) {}
        }
        for (var i = 0; i < candidates.length; i++) {
          var text = textValue(candidates[i]);
          if (text) return text.slice(0, 50000);
        }
        return '';
      }
      function dateOf(timestamp) {
        return new Date(Number(timestamp) * 1000).toLocaleDateString('en-CA', {
          timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
        });
      }
      var notes = [];
      var shapes = chart.getAllShapes() || [];
      for (var index = 0; index < shapes.length; index++) {
        var meta = shapes[index];
        if (!/text|note|callout|balloon/i.test(meta.name || '')) continue;
        try {
          var shape = chart.getShapeById(meta.id);
          var properties = shape && shape.getProperties ? shape.getProperties() : {};
          var rawText = noteText(shape, properties);
          if (!/^DAY\\s*:/i.test(rawText)) continue;
          var text = rawText.replace(/^DAY\\s*:\\s*/i, '').trim();
          var points = shape && shape.getPoints ? shape.getPoints() : [];
          if (!text || !points.length || points[0].time == null) continue;
          if (dateOf(points[0].time) !== ${JSON.stringify(targetDate)}) continue;
          notes.push({
            text: text,
            time: Number(points[0].time),
            price: points[0].price == null ? 0 : Number(points[0].price)
          });
        } catch (error) {}
      }
      notes.sort(function(left, right) {
        return left.time - right.time || left.price - right.price;
      });
      return {
        count: notes.length,
        note: notes.length ? notes.map(function(item) { return item.text; }).join('\\n\\n') : null
      };
    })()
  `;
}

function selectBacktestDateExpression() {
  return `(async function() {
    var chart = window.TradingViewApi.activeChart
      ? window.TradingViewApi.activeChart()
      : ${CHART_API};
    if (!chart) throw new Error('No active chart found');
    var timestamp = await chart.requestSelectBar();
    return new Date(Number(timestamp) * 1000).toLocaleDateString('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
    });
  })()`;
}

function dayScreenshotContextExpression(targetDate) {
  return `
    (function() {
      var chart = window.TradingViewApi.activeChart
        ? window.TradingViewApi.activeChart()
        : ${CHART_API};
      if (!chart) throw new Error('No active chart found');
      var visible = chart.getVisibleRange ? chart.getVisibleRange() : null;
      var zone = 'America/Los_Angeles';
      function dateOf(timestamp) {
        return new Date(Number(timestamp) * 1000).toLocaleDateString('en-CA', {
          timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
        });
      }
      if (!visible || visible.from == null || visible.to == null) {
        return { date_visible: false, visible_from: null, visible_to: null };
      }
      var fromDate = dateOf(visible.from);
      var toDate = dateOf(visible.to);
      return {
        date_visible: ${JSON.stringify(targetDate)} >= fromDate
          && ${JSON.stringify(targetDate)} <= toDate,
        visible_from: fromDate,
        visible_to: toDate
      };
    })()
  `;
}

export async function captureJournal({
  type,
  isMiss,
  idempotencyKey,
  _deps,
} = {}) {
  const deps = dependencies(_deps);
  const capture = await deps.evaluateAsync(journalExtractionExpression(type));
  const base64 = await deps.captureScreenshot(deps.evaluate);
  const operation = isMiss ? "journal.missed" : "journal.imported";
  const payload = {
    capture,
    screenshot: { mime_type: "image/png", base64 },
  };
  return postCapture(
    isMiss ? "/ingestion/journal/missed" : "/ingestion/journal/imported",
    operation,
    payload,
    idempotencyKey,
    deps,
  );
}

export async function captureBacktestBatch({ idempotencyKey, _deps } = {}) {
  const deps = dependencies(_deps);
  let trades = await deps.evaluate(backtestExtractionExpression);
  if (!trades.length)
    throw new Error("No long or short position drawings were found");
  try {
    const labels = await deps.getPineLabels({ max_labels: 250 });
    trades = enrichTradesWithStudyLabels(trades, labels);
  } catch {
    // Manual rectangles and session calculations still provide useful context.
  }
  const base64 = await deps.captureScreenshot(deps.evaluate);
  const payload = {
    trades,
    screenshot: { mime_type: "image/png", base64 },
  };
  return postCapture(
    "/ingestion/backtest/batch",
    "backtest.batch",
    payload,
    idempotencyKey,
    deps,
  );
}

export function beginPositionIsolationExpression(sessionKey) {
  return `
    (function() {
      /* backtest-position-isolation-begin */
      var chart = window.TradingViewApi.activeChart
        ? window.TradingViewApi.activeChart()
        : ${CHART_API};
      if (!chart) return { success: false, error: 'No active chart found' };
      var sessions = window.__tradingviewMcpPositionIsolation
        || (window.__tradingviewMcpPositionIsolation = {});
      var key = ${JSON.stringify(sessionKey)};
      if (sessions[key]) {
        return { success: false, error: 'Position isolation session already exists' };
      }
      function propertyBoolean(value, fallback) {
        if (value && typeof value.value === 'function') {
          try { return Boolean(value.value()); } catch (error) {}
        }
        return value == null ? fallback : Boolean(value);
      }
      var states = [];
      var shapes = chart.getAllShapes() || [];
      for (var index = 0; index < shapes.length; index++) {
        var meta = shapes[index];
        if (meta.name !== 'long_position' && meta.name !== 'short_position') continue;
        var shape = chart.getShapeById(meta.id);
        if (!shape || typeof shape.setProperties !== 'function') {
          return {
            success: false,
            error: 'A position drawing cannot be temporarily hidden: ' + String(meta.id)
          };
        }
        var properties = shape.getProperties ? shape.getProperties() : {};
        states.push({
          id: String(meta.id),
          visible: propertyBoolean(properties.visible, true)
        });
      }
      sessions[key] = { chart: chart, states: states };
      return { success: true, positions: states.length };
    })()
  `;
}

export function showOnlyPositionExpression(sessionKey, targetDrawingId) {
  return `
    (async function() {
      /* backtest-position-isolation-show */
      var sessions = window.__tradingviewMcpPositionIsolation || {};
      var saved = sessions[${JSON.stringify(sessionKey)}];
      if (!saved) return { success: false, error: 'Position isolation session was not found' };
      var target = ${JSON.stringify(String(targetDrawingId))};
      if (!saved.states.some(function(state) { return state.id === target; })) {
        return { success: false, error: 'Target position drawing was not found: ' + target };
      }
      for (var index = 0; index < saved.states.length; index++) {
        var state = saved.states[index];
        var shape = saved.chart.getShapeById(state.id);
        if (!shape) return { success: false, error: 'Position drawing disappeared: ' + state.id };
        shape.setProperties({ visible: state.id === target }, false);
      }
      await new Promise(function(resolve) {
        var finished = false;
        function finish() {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          resolve();
        }
        var timeout = setTimeout(finish, 250);
        if (typeof window.requestAnimationFrame !== 'function') return;
        window.requestAnimationFrame(function() {
          window.requestAnimationFrame(finish);
        });
      });
      return { success: true, visible_drawing_id: target };
    })()
  `;
}

export function restorePositionIsolationExpression(sessionKey) {
  return `
    (async function() {
      /* backtest-position-isolation-restore */
      var sessions = window.__tradingviewMcpPositionIsolation || {};
      var key = ${JSON.stringify(sessionKey)};
      var saved = sessions[key];
      if (!saved) return { success: false, error: 'Position isolation session was not found' };
      var missing = [];
      for (var index = 0; index < saved.states.length; index++) {
        var state = saved.states[index];
        var shape = saved.chart.getShapeById(state.id);
        if (!shape) {
          missing.push(state.id);
          continue;
        }
        shape.setProperties({ visible: state.visible }, false);
      }
      await new Promise(function(resolve) {
        var finished = false;
        function finish() {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          resolve();
        }
        var timeout = setTimeout(finish, 250);
        if (typeof window.requestAnimationFrame !== 'function') return;
        window.requestAnimationFrame(function() {
          window.requestAnimationFrame(finish);
        });
      });
      delete sessions[key];
      return missing.length
        ? { success: false, error: 'Some position drawings could not be restored', missing: missing }
        : { success: true, restored: saved.states.length };
    })()
  `;
}

async function captureIsolatedTradeScreenshots(trades, inventory, deps) {
  if (!trades.length) return [];
  const drawingIds = new Map(
    inventory.map((position) => [position.source_id, position.drawing_id]),
  );
  const targets = trades.map((trade) => ({
    source_id: trade.source_id,
    drawing_id: drawingIds.get(trade.source_id),
  }));
  const missing = targets.filter((target) => !target.drawing_id);
  if (missing.length) {
    throw new Error(
      `Position drawing IDs were unavailable for ${missing.length} trade${missing.length === 1 ? "" : "s"}`,
    );
  }

  const sessionKey = randomUUID();
  const started = await deps.evaluate(
    beginPositionIsolationExpression(sessionKey),
  );
  if (!started?.success) {
    throw new Error(started?.error || "Position isolation could not start");
  }

  const screenshots = [];
  let captureError;
  try {
    for (const target of targets) {
      const isolated = await deps.evaluateAsync(
        showOnlyPositionExpression(sessionKey, target.drawing_id),
      );
      if (!isolated?.success) {
        throw new Error(isolated?.error || "A trade position could not be isolated");
      }
      const base64 = await deps.captureScreenshot(deps.evaluate);
      screenshots.push({
        source_id: target.source_id,
        screenshot: { mime_type: "image/png", base64 },
      });
    }
  } catch (error) {
    captureError = error;
  }

  const restored = await deps
    .evaluateAsync(restorePositionIsolationExpression(sessionKey))
    .catch(() => null);
  if (!restored?.success) {
    const failurePrefix = captureError ? `${captureError.message}. ` : "";
    throw new Error(
      `${failurePrefix}TradingView position visibility could not be fully restored. Show all Long/Short tools manually before retrying.`,
    );
  }
  if (captureError) throw captureError;
  return screenshots;
}

export async function captureBacktestDay({ date, idempotencyKey, _deps } = {}) {
  const deps = dependencies(_deps);
  const captureDate =
    date || (await deps.evaluateAsync(selectBacktestDateExpression()));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(captureDate || "")) {
    throw new Error("A valid TradingView chart date is required");
  }

  const [inventory, extraction, dailyNotes, screenshotContext] = await Promise.all([
    deps.evaluate(dayPositionInventoryExpression(captureDate)),
    deps.evaluate(createBacktestExtractionExpression(null, captureDate, true)),
    deps.evaluate(dayNotesExtractionExpression(captureDate)),
    deps.evaluate(dayScreenshotContextExpression(captureDate)),
  ]);
  if (!screenshotContext?.date_visible) {
    throw new Error(
      `The selected date ${captureDate} is not visible in the active chart. Scroll to that day and retry.`,
    );
  }
  let trades = (extraction?.trades || []).filter(
    (trade) => trade.chart_date === captureDate,
  );
  try {
    const labels = await deps.getPineLabels({ max_labels: 250 });
    trades = enrichTradesWithStudyLabels(trades, labels);
  } catch {
    // Deterministic session and manual-drawing context remains available.
  }

  const capturedIds = new Set(trades.map((trade) => trade.source_id));
  const skipped = inventory
    .filter((position) => !capturedIds.has(position.source_id))
    .map((position) => ({
      source_id: position.source_id,
      entry_time: position.entry_time,
      reason: "The position entry candle is not loaded or could not be read",
    }));
  const noteCandidates = assignedTradeNoteCandidates(extraction?.note_audit);
  let noteRemoval;
  try {
    noteRemoval = await removeAssignedTradeNotes(noteCandidates, deps);
  } catch (error) {
    throw new Error(
      `The day was not published because its assigned trade notes could not be safely removed. ${error.message}`,
    );
  }

  let base64;
  let tradeScreenshots;
  try {
    base64 = await deps.captureScreenshot(deps.evaluate);
    tradeScreenshots = await captureIsolatedTradeScreenshots(
      trades,
      inventory,
      deps,
    );
  } catch (error) {
    const restored = await restoreAssignedTradeNotes(noteRemoval, deps).catch(
      () => null,
    );
    throw new Error(
      `${error.message}. ${restored?.success ? "The removed trade notes were restored." : "The removed trade notes could not be restored automatically; use TradingView Undo."}`,
    );
  }
  const payload = {
    capture_date: captureDate,
    positions_found: inventory.length,
    trades,
    skipped,
    daily_note: dailyNotes?.note || null,
    daily_note_drawings: dailyNotes?.count || 0,
    trade_notes_found: extraction?.note_audit?.length || 0,
    note_assignments: publicNoteAssignments(extraction?.note_audit),
    screenshot_context: screenshotContext,
    screenshot: { mime_type: "image/png", base64 },
    trade_screenshots: tradeScreenshots,
  };
  let result;
  try {
    result = await postCapture(
      "/ingestion/backtest/day",
      "backtest.day",
      payload,
      idempotencyKey || randomUUID(),
      deps,
    );
  } catch (error) {
    const restored = await restoreAssignedTradeNotes(noteRemoval, deps).catch(
      () => null,
    );
    throw new Error(
      `${error.message}. ${restored?.success ? "The removed trade notes were restored." : "The removed trade notes could not be restored automatically; use TradingView Undo."}`,
    );
  }

  const explicitlyAccepted = Array.isArray(result.accepted_trade_source_ids)
    ? new Set(result.accepted_trade_source_ids)
    : null;
  const rejected = new Set(
    (result.possible_duplicates || []).map((item) => item.source_id),
  );
  const acceptedCandidates = noteCandidates.filter((candidate) =>
    explicitlyAccepted
      ? explicitlyAccepted.has(candidate.trade_source_id)
      : !rejected.has(candidate.trade_source_id),
  );
  let keptRemoval = noteRemoval;
  let cleanupWarning;
  if (noteRemoval && acceptedCandidates.length !== noteCandidates.length) {
    const restored = await restoreAssignedTradeNotes(noteRemoval, deps).catch(
      () => null,
    );
    keptRemoval = null;
    if (!restored?.success) {
      cleanupWarning =
        "Some notes for trades the server did not accept could not be restored automatically; use TradingView Undo.";
    } else if (acceptedCandidates.length) {
      keptRemoval = await removeAssignedTradeNotes(acceptedCandidates, deps).catch(
        () => null,
      );
      if (!keptRemoval) {
        cleanupWarning =
          "The trades were saved, but their chart notes could not be removed after rejected notes were restored.";
      }
    }
  }
  if (keptRemoval) {
    const committed = await commitAssignedTradeNoteRemoval(
      keptRemoval,
      deps,
    ).catch(() => null);
    if (!committed?.success) {
      cleanupWarning =
        cleanupWarning ||
        "The trades were saved and the chart notes were removed, but the temporary undo checkpoint could not be cleared.";
    }
  }
  return {
    ...result,
    trade_notes_deleted: keptRemoval ? acceptedCandidates.length : 0,
    ...(cleanupWarning ? { trade_note_cleanup_warning: cleanupWarning } : {}),
  };
}
