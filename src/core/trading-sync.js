import { createHash } from "node:crypto";
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
      (label) => Number.isFinite(label.price) && label.price >= low && label.price <= high,
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

async function captureChartScreenshot(evaluate = defaultEvaluate) {
  const client = await getClient();
  const bounds = await evaluate(`
    (function() {
      var el = document.querySelector('[data-name="pane-canvas"]')
        || document.querySelector('[class*="chart-container"]')
        || document.querySelector('canvas');
      if (!el) return null;
      var rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()
  `);
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

export const backtestExtractionExpression = `
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
    function outcome(startIndex, entryPrice, profit, stop, isLong) {
      if (profit == null || stop == null || entryPrice == null || startIndex < 0) {
        return { outcome: 'Open', exit_candle: null, duration_minutes: null };
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
          outcome: targetHit && !stopHit ? 'Win' : 'Loss',
          exit_candle: timeData(value[0] * 1000).time,
          duration_minutes: (value[0] - entryTs) / 60
        };
      }
      return { outcome: 'Open', exit_candle: null, duration_minutes: null };
    }
    var allShapes = chart.getAllShapes() || [];
    var shapes = allShapes.filter(function(shape) {
      return shape.name === 'long_position' || shape.name === 'short_position';
    }).slice(0, ${MAX_TRADES_BATCH});
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
        _entry_price: entryPrice
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
    var notes = [];
    for (var noteIndex = 0; noteIndex < allShapes.length; noteIndex++) {
      var noteMeta = allShapes[noteIndex];
      if (noteMeta.name === 'long_position' || noteMeta.name === 'short_position') continue;
      if (!/text|note|callout|balloon/i.test(noteMeta.name || '')) continue;
      try {
        var noteShape = chart.getShapeById(noteMeta.id);
        if (!noteShape) continue;
        var noteProperties = noteShape.getProperties ? noteShape.getProperties() : {};
        var text = noteText(noteShape, noteProperties);
        if (!text) continue;
        var notePoints = noteShape.getPoints ? noteShape.getPoints() : [];
        if (!notePoints.length || notePoints[0].time == null) continue;
        notes.push({
          text: text,
          time: Number(notePoints[0].time),
          price: notePoints[0].price == null ? null : Number(notePoints[0].price)
        });
      } catch (error) {}
    }
    notes.sort(function(left, right) {
      return left.time - right.time || (left.price || 0) - (right.price || 0);
    });
    var secondsPerBar = Math.max(
      60,
      Number.isFinite(timeFrame) ? timeFrame * 60 : 60
    );
    for (var n = 0; n < notes.length; n++) {
      var bestIndex = -1;
      var bestScore = Infinity;
      for (var tradeIndex = 0; tradeIndex < trades.length; tradeIndex++) {
        var candidate = trades[tradeIndex];
        var timeDistance = Math.abs(notes[n].time - candidate._entry_time);
        var maxTimeDistance = secondsPerBar * 40;
        if (timeDistance > maxTimeDistance) continue;
        var priceDistance = notes[n].price == null
          ? 0
          : Math.abs(notes[n].price - candidate._entry_price);
        var maxPriceDistance = Math.max(Math.abs(candidate._entry_price) * 0.12, 1);
        if (priceDistance > maxPriceDistance) continue;
        var score = timeDistance / maxTimeDistance + priceDistance / maxPriceDistance;
        if (score < bestScore) {
          bestScore = score;
          bestIndex = tradeIndex;
        }
      }
      if (bestIndex >= 0) {
        trades[bestIndex].notes = trades[bestIndex].notes
          ? trades[bestIndex].notes + '\\n\\n' + notes[n].text
          : notes[n].text;
      }
    }
    for (var cleanIndex = 0; cleanIndex < trades.length; cleanIndex++) {
      delete trades[cleanIndex]._entry_time;
      delete trades[cleanIndex]._entry_price;
    }
    return trades;
  })()
`;

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
