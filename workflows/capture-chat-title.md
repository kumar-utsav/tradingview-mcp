# Capture chat title

During a backtest or journal capture, rename the current chat as soon as the
selected trading date and ticker are established, before the notes handoff.
Apply this on saved-pack continuations too, using pack metadata without accessing
TradingView again. Editing a workflow alone does not trigger a capture rename.

Use `YYYY-MM-DD TICKER — Backtest` or `YYYY-MM-DD TICKER — Journal`, for example
`2026-10-16 MES — Backtest`. Use the selected Pacific trading date, not today's
date or the capture-run timestamp. Use the traded instrument's short ticker
without the exchange prefix; group MES futures contracts under `MES` and MNQ
contracts under `MNQ`. For option journals, use the underlying ticker. Preserve
the original symbols in all capture and financial records.

For a multi-day batch, use `YYYY-MM-DD to YYYY-MM-DD`; for multiple tickers, list
the distinct tickers separated by commas. Build the title from the full selected
scope so processing the next trade does not rename it to only that trade.

Discover `set_thread_title` and call it with `title`, omitting `threadId` to
target the current chat. A successful tool result completes the rename; no
additional confirmation is needed. If the tool is unavailable or fails, continue
the capture and briefly report that the chat title could not be updated. Respect
an explicit user title or instruction to keep the existing title.
