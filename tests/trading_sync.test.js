import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activeChartBoundsExpression,
  backtestExtractionExpression,
  beginPositionIsolationExpression,
  captureBacktestBatch,
  captureBacktestDay,
  captureJournal,
  classifyLevelLabel,
  createBacktestExtractionExpression,
  enrichTradesWithStudyLabels,
  finishTradeNoteDeletionExpression,
  restorePositionIsolationExpression,
  showOnlyPositionExpression,
  tradeNoteDeletionExpression,
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
  it("selects the active chart container in a multi-pane layout", () => {
    const charts = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const selectors = [];
    const run = new Function(
      "window",
      "document",
      `return (${activeChartBoundsExpression.trim()});`,
    );
    const bounds = run(
      {
        TradingViewApi: {
          _chartWidgetCollection: { getAll: () => charts },
          _activeChartWidgetWV: { value: () => ({ _chartWidget: charts[3] }) },
        },
      },
      {
        querySelector: (selector) => {
          selectors.push(selector);
          if (selector !== '[aria-label="Chart #4"]') return null;
          return {
            getBoundingClientRect: () => ({
              x: 56,
              y: 624,
              width: 2455,
              height: 697,
            }),
          };
        },
      },
    );
    assert.deepEqual(selectors, ['[aria-label="Chart #4"]']);
    assert.deepEqual(bounds, {
      x: 56,
      y: 624,
      width: 2455,
      height: 697,
      active_index: 3,
    });
  });

  it("removes an unchanged trade note with an undo checkpoint and can restore it", () => {
    let shapes = [{ id: "note-1", name: "text" }];
    const note = {
      getProperties: () => ({ text: "1: Retest held" }),
    };
    let checkpointShapes;
    const history = {
      createUndoCheckpoint: () => {
        checkpointShapes = [...shapes];
        return { id: "checkpoint" };
      },
      undoToCheckpoint: () => {
        shapes = [...checkpointShapes];
      },
    };
    const chart = {
      getAllShapes: () => shapes,
      getShapeById: () => note,
      chartUndoModel: () => ({ undoHistory: () => history }),
      removeEntityWithUndo: (id) => {
        shapes = shapes.filter((shape) => shape.id !== id);
      },
    };
    const window = { TradingViewApi: { activeChart: () => chart } };
    const remove = new Function(
      "window",
      `return (${tradeNoteDeletionExpression(
        [
          {
            drawing_id: "note-1",
            text: "Retest held",
            trade_source_id: "position-1",
          },
        ],
        "checkpoint-key",
      ).trim()});`,
    );
    assert.equal(remove(window).success, true);
    assert.equal(shapes.length, 0);

    const restore = new Function(
      "window",
      `return (${finishTradeNoteDeletionExpression(
        "checkpoint-key",
        true,
      ).trim()});`,
    );
    assert.equal(restore(window).restored, true);
    assert.equal(shapes.length, 1);
  });

  it("isolates one position for a screenshot and restores original visibility", async () => {
    const visibility = new Map([
      ["one", true],
      ["two", true],
      ["already-hidden", false],
    ]);
    const shapes = [
      { id: "one", name: "long_position" },
      { id: "two", name: "short_position" },
      { id: "already-hidden", name: "long_position" },
    ];
    const shapeById = Object.fromEntries(
      shapes.map((meta) => [
        meta.id,
        {
          getProperties: () => ({ visible: visibility.get(meta.id) }),
          setProperties: ({ visible }) => visibility.set(meta.id, visible),
        },
      ]),
    );
    const window = {
      requestAnimationFrame: (callback) => callback(),
      TradingViewApi: {
        activeChart: () => ({
          getAllShapes: () => shapes,
          getShapeById: (id) => shapeById[id],
        }),
      },
    };
    const begin = new Function(
      "window",
      "return (" + beginPositionIsolationExpression("session").trim() + ");",
    );
    const showOnly = new Function(
      "window",
      "return (" +
        showOnlyPositionExpression("session", "two").trim() +
        ");",
    );
    const restore = new Function(
      "window",
      "return (" +
        restorePositionIsolationExpression("session").trim() +
        ");",
    );

    assert.equal(begin(window).success, true);
    assert.equal((await showOnly(window)).success, true);
    assert.deepEqual(Object.fromEntries(visibility), {
      one: false,
      two: true,
      "already-hidden": false,
    });
    assert.equal((await restore(window)).success, true);
    assert.deepEqual(Object.fromEntries(visibility), {
      one: true,
      two: true,
      "already-hidden": false,
    });
  });

  it("matches numbered notes to trades from earliest to latest and strips the prefix", () => {
    const firstEntry = 1785591300;
    const secondEntry = firstEntry + 240;
    const bars = [
      { value: [firstEntry, 629, 631, 628, 630] },
      { value: [secondEntry, 630, 632, 629, 631] },
      { value: [secondEntry + 60, 631, 633, 630, 632] },
    ];
    const shapes = [
      { id: "later", name: "short_position" },
      { id: "note-two", name: "text" },
      { id: "earlier", name: "short_position" },
      { id: "note-one", name: "text" },
    ];
    const shapeById = {
      earlier: {
        getProperties: () => ({ profitLevel: 100, stopLevel: 50 }),
        getPoints: () => [{ time: firstEntry, price: 630 }],
      },
      later: {
        getProperties: () => ({ profitLevel: 200, stopLevel: 100 }),
        getPoints: () => [{ time: secondEntry, price: 631 }],
      },
      "note-one": {
        getProperties: () => ({ text: "1: First trade reasoning" }),
        getPoints: () => [{ time: firstEntry + 1800, price: 600 }],
      },
      "note-two": {
        getProperties: () => ({ text: "2: Second trade reasoning" }),
        getPoints: () => [{ time: firstEntry + 60, price: 700 }],
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
      "return (" +
        createBacktestExtractionExpression(null, "2026-08-01", true).trim() +
        ");",
    );
    const result = run({
      location: { pathname: "/chart/layout/" },
      TradingViewApi: { activeChart: () => chart },
    });
    assert.deepEqual(
      result.trades.map((trade) => [trade.source_id, trade.notes]),
      [
        ["/chart/layout/::earlier", "First trade reasoning"],
        ["/chart/layout/::later", "Second trade reasoning"],
      ],
    );
    assert.deepEqual(
      result.note_audit.map((note) => [note.status, note.trade_source_id]),
      [
        ["assigned", "/chart/layout/::later"],
        ["assigned", "/chart/layout/::earlier"],
      ],
    );
  });

  it("leaves duplicate and out-of-range numbered notes unresolved", () => {
    const entryTime = 1785591300;
    const bars = [{ value: [entryTime, 629, 631, 628, 630] }];
    const shapes = [
      { id: "position", name: "long_position" },
      { id: "duplicate-a", name: "text" },
      { id: "duplicate-b", name: "text" },
      { id: "out-of-range", name: "text" },
    ];
    const shapeById = {
      position: {
        getProperties: () => ({ profitLevel: 100, stopLevel: 100 }),
        getPoints: () => [{ time: entryTime, price: 630 }],
      },
      "duplicate-a": {
        getProperties: () => ({ text: "1: First version" }),
        getPoints: () => [{ time: entryTime, price: 630 }],
      },
      "duplicate-b": {
        getProperties: () => ({ text: "1: Second version" }),
        getPoints: () => [{ time: entryTime, price: 630 }],
      },
      "out-of-range": {
        getProperties: () => ({ text: "3: Missing trade" }),
        getPoints: () => [{ time: entryTime, price: 630 }],
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
      "return (" +
        createBacktestExtractionExpression(null, "2026-08-01", true).trim() +
        ");",
    );
    const result = run({
      location: { pathname: "/chart/layout/" },
      TradingViewApi: { activeChart: () => chart },
    });
    assert.equal(result.trades[0].notes, "");
    assert.deepEqual(
      result.note_audit.map((note) => note.status),
      ["ambiguous", "ambiguous", "unassigned"],
    );
  });

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
      { id: "daily-thought", name: "text" },
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
        getProperties: () => ({
          text: "Flip zone held after displacement",
        }),
        getPoints: () => [{ time: entryTime + 60, price: 630.5 }],
      },
      "daily-thought": {
        getProperties: () => ({ text: "DAY: Waited for opening range" }),
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
    assert.equal(
      trades[0].chart_context.touching_drawings[0].kind,
      "rectangle",
    );
    assert.equal("_entry_time" in trades[0], false);
  });

  it("audits ambiguous and unassigned trade notes without attaching them", () => {
    const entryTime = 1785591300;
    const bars = [
      { value: [entryTime, 629, 631, 628, 630] },
      { value: [entryTime + 60, 630, 631, 629, 630] },
    ];
    const shapes = [
      { id: "one", name: "long_position" },
      { id: "two", name: "long_position" },
      { id: "between", name: "text" },
      { id: "far", name: "text" },
      { id: "prior-day", name: "text" },
    ];
    const positions = {
      one: {
        getProperties: () => ({ profitLevel: 100, stopLevel: 100 }),
        getPoints: () => [{ time: entryTime, price: 629.9 }],
      },
      two: {
        getProperties: () => ({ profitLevel: 100, stopLevel: 100 }),
        getPoints: () => [{ time: entryTime, price: 630.1 }],
      },
      between: {
        getProperties: () => ({ text: "Waited for confirmation" }),
        getPoints: () => [{ time: entryTime, price: 630 }],
      },
      far: {
        getProperties: () => ({ text: "Tomorrow's idea" }),
        getPoints: () => [{ time: entryTime + 10000, price: 630 }],
      },
      "prior-day": {
        getProperties: () => ({ text: "Prior session note" }),
        getPoints: () => [{ time: entryTime - 86400, price: 630 }],
      },
    };
    const chart = {
      getSeries: () => ({ data: () => ({ bars: () => ({ _items: bars }) }) }),
      symbolExt: () => ({ symbol: "SPY" }),
      resolution: () => "1",
      getAllShapes: () => shapes,
      getShapeById: (id) => positions[id],
    };
    const run = new Function(
      "window",
      `return (${createBacktestExtractionExpression(null, "2026-08-01", true).trim()});`,
    );
    const result = run({
      location: { pathname: "/chart/layout/" },
      TradingViewApi: { activeChart: () => chart },
    });
    assert.equal(result.trades.length, 2);
    assert.deepEqual(
      result.note_audit.map((note) => note.status),
      ["ambiguous", "unassigned"],
    );
    assert.equal(result.trades[0].notes, "");
    assert.equal(result.trades[1].notes, "");
    assert.deepEqual(
      result.note_audit.map((note) => note.drawing_id),
      ["between", "far"],
    );
  });

  it("classifies and attaches only supported named indicator levels", () => {
    assert.equal(classifyLevelLabel("PWH"), "bt_confluence_prior_week_high");
    assert.equal(classifyLevelLabel("VWAP"), "bt_confluence_vwap");
    assert.equal(
      classifyLevelLabel("200 SMA 1h"),
      "bt_confluence_moving_average",
    );
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
          {
            name: "Combined Indicator",
            labels: [{ text: "VWAP", price: 630.25 }],
          },
          {
            name: "Market Structures",
            labels: [{ text: "MHH", price: 630.4 }],
          },
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

  it("reconciles only the selected day with fresh invocation keys", () =>
    withConfiguration(async () => {
      const requests = [];
      const actions = [];
      const dayTrade = {
        ...backtestTrade,
        source_id: "/chart/test-layout/::position-1",
        notes: "Retest held",
      };
      const deps = {
        evaluateAsync: async (expression) => {
          if (expression.includes("requestSelectBar")) return "2026-08-01";
          if (expression.includes("backtest-position-isolation-show")) {
            actions.push("isolate");
            return { success: true, visible_drawing_id: "position-1" };
          }
          if (expression.includes("backtest-position-isolation-restore")) {
            actions.push("restore-positions");
            return { success: true, restored: 2 };
          }
          throw new Error("Unexpected async expression");
        },
        evaluate: async (expression) => {
          if (expression.includes("backtest-day-inventory")) {
            return [
              {
                drawing_id: "position-1",
                source_id: dayTrade.source_id,
                entry_time: 1785591300,
              },
              {
                drawing_id: "position-2",
                source_id: "/chart/test-layout/::position-2",
                entry_time: 1785591360,
              },
            ];
          }
          if (expression.includes("backtest-day-notes")) {
            return { count: 1, note: "Waited for the opening range." };
          }
          if (expression.includes("getVisibleRange")) {
            return {
              date_visible: true,
              visible_from: "2026-08-01",
              visible_to: "2026-08-01",
            };
          }
          if (expression.includes("backtest-trade-note-delete")) {
            actions.push("delete");
            return { success: true, removed_ids: ["note-1"] };
          }
          if (expression.includes("backtest-trade-note-commit")) {
            actions.push("commit");
            return { success: true, restored: false };
          }
          if (expression.includes("backtest-position-isolation-begin")) {
            actions.push("begin-isolation");
            return { success: true, positions: 2 };
          }
          return {
            trades: [dayTrade, { ...dayTrade, chart_date: "2026-07-31" }],
            note_audit: [
              {
                drawing_id: "note-1",
                source_id: "/chart/test-layout/::note-1",
                text: "Retest held",
                status: "assigned",
                trade_source_id: dayTrade.source_id,
                candidate_source_ids: [dayTrade.source_id],
              },
            ],
          };
        },
        captureScreenshot: async () => {
          actions.push("screenshot");
          return "cG5n";
        },
        getPineLabels: async () => ({ success: true, studies: [] }),
        fetch: async (url, options) => {
          actions.push("publish");
          requests.push({ url, options });
          return response({
            capture_date: "2026-08-01",
            summary: { inserted: 1, updated: 0, unchanged: 0, skipped: 1 },
            accepted_trade_source_ids: [dayTrade.source_id],
            records: [{ id: 1 }],
          });
        },
      };

      const firstResult = await captureBacktestDay({ _deps: deps });
      await captureBacktestDay({ _deps: deps });

      const body = JSON.parse(requests[0].options.body);
      assert.equal(
        requests[0].url,
        "http://127.0.0.1:5555/ingestion/backtest/day",
      );
      assert.equal(body.capture_date, "2026-08-01");
      assert.equal(body.trades.length, 1);
      assert.equal(body.daily_note, "Waited for the opening range.");
      assert.equal(body.skipped.length, 1);
      assert.equal(body.trade_notes_found, 1);
      assert.equal(body.trade_screenshots.length, 1);
      assert.equal(body.trade_screenshots[0].source_id, dayTrade.source_id);
      assert.equal("drawing_id" in body.note_assignments[0], false);
      assert.equal(body.screenshot_context.date_visible, true);
      assert.equal(firstResult.trade_notes_deleted, 1);
      assert.deepEqual(actions.slice(0, 8), [
        "delete",
        "screenshot",
        "begin-isolation",
        "isolate",
        "screenshot",
        "restore-positions",
        "publish",
        "commit",
      ]);
      assert.notEqual(
        requests[0].options.headers["Idempotency-Key"],
        requests[1].options.headers["Idempotency-Key"],
      );
    }));

  it("restores assigned chart notes when publishing fails", () =>
    withConfiguration(async () => {
      const actions = [];
      const dayTrade = {
        ...backtestTrade,
        source_id: "/chart/test-layout/::position-1",
        notes: "Retest held",
      };
      await assert.rejects(
        captureBacktestDay({
          date: "2026-08-01",
          _deps: {
            evaluate: async (expression) => {
              if (expression.includes("backtest-day-inventory")) {
                return [
                  {
                    drawing_id: "position-1",
                    source_id: dayTrade.source_id,
                    entry_time: 1785591300,
                  },
                ];
              }
              if (expression.includes("backtest-day-notes")) {
                return { count: 1, note: "Daily plan" };
              }
              if (expression.includes("getVisibleRange")) {
                return {
                  date_visible: true,
                  visible_from: "2026-08-01",
                  visible_to: "2026-08-01",
                };
              }
              if (expression.includes("backtest-trade-note-delete")) {
                actions.push("delete");
                return { success: true, removed_ids: ["note-1"] };
              }
              if (expression.includes("backtest-trade-note-restore")) {
                actions.push("restore");
                return { success: true, restored: true };
              }
              if (expression.includes("backtest-position-isolation-begin")) {
                actions.push("begin-isolation");
                return { success: true, positions: 1 };
              }
              return {
                trades: [dayTrade],
                note_audit: [
                  {
                    drawing_id: "note-1",
                    source_id: "/chart/test-layout/::note-1",
                    text: "Retest held",
                    status: "assigned",
                    trade_source_id: dayTrade.source_id,
                    candidate_source_ids: [dayTrade.source_id],
                  },
                ],
              };
            },
            evaluateAsync: async (expression) => {
              if (expression.includes("backtest-position-isolation-show")) {
                actions.push("isolate");
                return { success: true, visible_drawing_id: "position-1" };
              }
              if (expression.includes("backtest-position-isolation-restore")) {
                actions.push("restore-positions");
                return { success: true, restored: 1 };
              }
              throw new Error("Unexpected async expression");
            },
            captureScreenshot: async () => {
              actions.push("screenshot");
              return "cG5n";
            },
            getPineLabels: async () => ({ success: true, studies: [] }),
            fetch: async () => {
              actions.push("publish");
              return response({ message: "Backend rejected capture" }, 400);
            },
          },
        }),
        /removed trade notes were restored/,
      );
      assert.deepEqual(actions, [
        "delete",
        "screenshot",
        "begin-isolation",
        "isolate",
        "screenshot",
        "restore-positions",
        "publish",
        "restore",
      ]);
    }));

  it("refuses a day capture when that date is not visible for the screenshot", () =>
    withConfiguration(async () => {
      await assert.rejects(
        captureBacktestDay({
          date: "2026-08-01",
          _deps: {
            evaluate: async (expression) => {
              if (expression.includes("backtest-day-inventory")) return [];
              if (expression.includes("backtest-day-notes")) {
                return { count: 0, note: null };
              }
              if (expression.includes("getVisibleRange")) {
                return {
                  date_visible: false,
                  visible_from: "2026-08-02",
                  visible_to: "2026-08-03",
                };
              }
              return { trades: [], note_audit: [] };
            },
          },
        }),
        /not visible in the active chart/,
      );
    }));
});
