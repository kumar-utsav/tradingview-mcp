import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  backtestExtractionExpression,
  captureBacktestBatch,
  captureJournal,
  classifyLevelLabel,
  enrichTradesWithStudyLabels,
} from "../src/core/trading-sync.js";

function response(body, status = 201, replayed = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: () => (replayed ? "true" : null) },
  };
}

function withConfiguration(run) {
  const previousUrl = process.env.TRADING_BACKEND_URL;
  const previousToken = process.env.TRADINGVIEW_INGESTION_TOKEN;
  process.env.TRADING_BACKEND_URL = "http://127.0.0.1:5555";
  process.env.TRADINGVIEW_INGESTION_TOKEN = "test-token";
  return Promise.resolve(run()).finally(() => {
    if (previousUrl === undefined) delete process.env.TRADING_BACKEND_URL;
    else process.env.TRADING_BACKEND_URL = previousUrl;
    if (previousToken === undefined)
      delete process.env.TRADINGVIEW_INGESTION_TOKEN;
    else process.env.TRADINGVIEW_INGESTION_TOKEN = previousToken;
  });
}

const journalCapture = {
  chart_date: "2026-08-01",
  entry_candle: "06:35",
  ticker: "SPY",
  time_frame: 1,
  rr: 2,
  type: "Call",
  tags: ["pa_inside_pm"],
};

const backtestTrade = {
  ...journalCapture,
  exit_candle: "06:40",
  duration_minutes: 5,
  entry_price: 630,
  target_price: 632,
  stop_price: 629,
  outcome: "Win",
};

describe("Trading journal capture sync", () => {
  it("uses interactive extraction and sends directly to the imported endpoint", () =>
    withConfiguration(async () => {
      const requests = [];
      const result = await captureJournal({
        type: "Call",
        isMiss: false,
        _deps: {
          evaluateAsync: async (expression) => {
            assert.match(expression, /requestSelectBar/);
            return journalCapture;
          },
          captureScreenshot: async () => "cG5n",
          fetch: async (url, options) => {
            requests.push({ url, options });
            return response({ records: [{ id: 1 }] });
          },
        },
      });
      assert.equal(result.success, true);
      assert.equal(
        requests[0].url,
        "http://127.0.0.1:5555/ingestion/journal/imported",
      );
      assert.equal(
        requests[0].options.headers.Authorization,
        "Bearer test-token",
      );
      assert.ok(requests[0].options.headers["Idempotency-Key"]);
      assert.equal(JSON.parse(requests[0].options.body).capture.ticker, "SPY");
    }));

  it("generates the same retry key when only screenshot bytes differ", () =>
    withConfiguration(async () => {
      const keys = [];
      let screenshot = "b25l";
      const deps = {
        evaluateAsync: async () => journalCapture,
        captureScreenshot: async () => screenshot,
        fetch: async (_url, options) => {
          keys.push(options.headers["Idempotency-Key"]);
          return response({ records: [{ id: 1 }] });
        },
      };
      await captureJournal({ type: "Call", isMiss: true, _deps: deps });
      screenshot = "dHdv";
      await captureJournal({ type: "Call", isMiss: true, _deps: deps });
      assert.equal(keys[0], keys[1]);
    }));
});

describe("Trading backtest batch capture sync", () => {
  it("associates a nearby text drawing with the closest position", () => {
    const entryTime = 1785591300;
    const bars = [
      { value: [entryTime - 86400, 629, 632, 626, 629] },
      { value: [entryTime - 600, 629, 631, 628, 630] },
      { value: [entryTime - 300, 629, 630, 628.5, 629.5] },
      { value: [entryTime, 629, 631, 628, 630] },
      { value: [entryTime + 60, 630, 633, 629.5, 632] },
    ];
    const shapes = [
      { id: "position", name: "long_position" },
      { id: "zone", name: "rectangle" },
      { id: "reason", name: "text" },
      { id: "far-note", name: "text" },
    ];
    const shapeById = {
      position: {
        getProperties: () => ({ profitLevel: 200, stopLevel: 100 }),
        getPoints: () => [{ time: entryTime, price: 630 }],
      },
      zone: {
        getProperties: () => ({ extendRight: { value: () => true } }),
        getPoints: () => [
          { time: entryTime - 120, price: 629.5 },
          { time: entryTime - 60, price: 630.5 },
        ],
      },
      reason: {
        getProperties: () => ({ text: "Flip zone held after displacement" }),
        getPoints: () => [{ time: entryTime + 60, price: 630.5 }],
      },
      "far-note": {
        getProperties: () => ({ text: "Unrelated chart note" }),
        getPoints: () => [{ time: entryTime + 10000, price: 630 }],
      },
    };
    const chart = {
      getSeries: () => ({ data: () => ({ bars: () => ({ _items: bars }) }) }),
      symbolExt: () => ({ symbol: "SPY" }),
      resolution: () => "1",
      getAllShapes: () => shapes,
      getShapeById: (id) => shapeById[id],
    };
    const run = new Function(
      "window",
      `return (${backtestExtractionExpression.trim()});`,
    );
    const trades = run({ TradingViewApi: { activeChart: () => chart } });
    assert.equal(trades.length, 1);
    assert.equal(trades[0].notes, "Flip zone held after displacement");
    assert.ok(trades[0].tags.includes("bt_confluence_decision_zone"));
    assert.ok(trades[0].tags.includes("bt_position_inside_prior_day"));
    assert.ok(trades[0].tags.includes("bt_position_inside_premarket"));
    assert.ok(trades[0].tags.includes("bt_confluence_prior_day_close"));
    assert.equal(trades[0].chart_context.ranges.first_15m.high, null);
    assert.equal(trades[0].chart_context.touching_drawings[0].kind, "rectangle");
    assert.equal("_entry_time" in trades[0], false);
  });

  it("classifies and attaches only supported named indicator levels", () => {
    assert.equal(classifyLevelLabel("PWH"), "bt_confluence_prior_week_high");
    assert.equal(classifyLevelLabel("VWAP"), "bt_confluence_vwap");
    assert.equal(classifyLevelLabel("200 SMA 1h"), "bt_confluence_moving_average");
    assert.equal(classifyLevelLabel("MHH"), undefined);
    const [trade] = enrichTradesWithStudyLabels(
      [
        {
          ...backtestTrade,
          tags: [],
          chart_context: {
            entry_candle: { open: 630, high: 631, low: 629, close: 630.5 },
            touching_drawings: [],
          },
        },
      ],
      {
        studies: [
          { name: "Key Levels", labels: [{ text: "PWH", price: 630 }] },
          { name: "Combined Indicator", labels: [{ text: "VWAP", price: 630.25 }] },
          { name: "Market Structures", labels: [{ text: "MHH", price: 630.4 }] },
          { name: "Key Levels", labels: [{ text: "PDH", price: 635 }] },
        ],
      },
    );
    assert.deepEqual(trade.tags.sort(), [
      "bt_confluence_prior_week_high",
      "bt_confluence_vwap",
    ]);
    assert.equal(trade.chart_context.touching_drawings.length, 2);
  });

  it("sends one screenshot for the complete calculated batch", () =>
    withConfiguration(async () => {
      let request;
      await captureBacktestBatch({
        _deps: {
          evaluate: async (expression) => {
            assert.match(expression, /long_position/);
            assert.match(expression, /targetHit/);
            return [backtestTrade, { ...backtestTrade, type: "Put" }];
          },
          captureScreenshot: async () => "cG5n",
          getPineLabels: async () => ({ success: true, studies: [] }),
          fetch: async (url, options) => {
            request = { url, options };
            return response({ records: [{ id: 1 }, { id: 2 }] });
          },
        },
      });
      const body = JSON.parse(request.options.body);
      assert.equal(
        request.url,
        "http://127.0.0.1:5555/ingestion/backtest/batch",
      );
      assert.equal(body.trades.length, 2);
      assert.equal(body.screenshot.base64, "cG5n");
      assert.equal("chart" in body.trades[0], false);
    }));
});
