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
    "Reconcile one visible TradingView day, provisionally look up its YYMMDD Trade With Neto stream, use DAY: for the daily thought and numbered notes such as 1: and 2: to match trades from earliest to latest; capture isolated trade screenshots, restore chart visibility, and safely remove assigned notes before publishing. REQUIRED AFTER CAPTURE: inspect every saved chart and note against the live tag catalog, review all checklist groups, preserve user corrections, save supported tags and verify them. Independently check both Trade With Neto and Kay Capitals for relevant videos recorded or publicly released on the exact chart date, attach verified matches as daily resources and read them back. A properly checked no-match for either or both channels is normal and does not block completion; a failed/incomplete search is not no-match. Follow workflows/capture-backtest-day.md. The tool supplies provisional tags and does not perform the full two-channel date review",
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
