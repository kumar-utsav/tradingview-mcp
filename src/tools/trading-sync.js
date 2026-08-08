import { z } from "zod";
import { jsonResult } from "./_format.js";
import * as core from "../core/trading-sync.js";

const input = {
  idempotency_key: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Optional retry key. A deterministic key is generated when omitted.",
    ),
};

const dayInput = {
  idempotency_key: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Optional retry key. Omit it for a fresh reconciliation invocation.",
    ),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "Optional Pacific chart date. When omitted, TradingView prompts for a candle selection.",
    ),
};

const runJournal =
  (type, isMiss) =>
  async ({ idempotency_key }) => {
    try {
      return jsonResult(
        await core.captureJournal({
          type,
          isMiss,
          idempotencyKey: idempotency_key,
        }),
      );
    } catch (error) {
      return jsonResult({ success: false, error: error.message }, true);
    }
  };

export function registerTradingSyncTools(server) {
  server.tool(
    "capture_journal_call_trade",
    "Interactively select a TradingView bar, capture a Call trade chart, and update the matching imported journal trade",
    input,
    runJournal("Call", false),
  );
  server.tool(
    "capture_journal_put_trade",
    "Interactively select a TradingView bar, capture a Put trade chart, and update the matching imported journal trade",
    input,
    runJournal("Put", false),
  );
  server.tool(
    "capture_journal_call_miss",
    "Interactively select a TradingView bar, capture a missed Call, and create a missed journal trade",
    input,
    runJournal("Call", true),
  );
  server.tool(
    "capture_journal_put_miss",
    "Interactively select a TradingView bar, capture a missed Put, and create a missed journal trade",
    input,
    runJournal("Put", true),
  );
  server.tool(
    "capture_backtest_day",
    "Reconcile one visible TradingView day, using DAY: for the daily thought and numbered notes such as 1: and 2: to match trades from earliest to latest; capture an isolated screenshot for each trade with other Long/Short tools temporarily hidden, restore chart visibility, and safely remove assigned notes before publishing",
    dayInput,
    async ({ date, idempotency_key }) => {
      try {
        return jsonResult(
          await core.captureBacktestDay({
            date,
            idempotencyKey: idempotency_key,
          }),
        );
      } catch (error) {
        return jsonResult({ success: false, error: error.message }, true);
      }
    },
  );
  server.tool(
    "capture_backtest_batch",
    "Capture every long/short position drawing, nearby reasoning note, entry range/level/rectangle context, outcomes, and reusable checklist tags, then sync one backtest batch",
    input,
    async ({ idempotency_key }) => {
      try {
        return jsonResult(
          await core.captureBacktestBatch({ idempotencyKey: idempotency_key }),
        );
      } catch (error) {
        return jsonResult({ success: false, error: error.message }, true);
      }
    },
  );
}
