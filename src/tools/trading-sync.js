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
