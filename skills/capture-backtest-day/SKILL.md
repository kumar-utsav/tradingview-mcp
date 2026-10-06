---
name: capture-backtest-day
description: Capture a TradingView backtest day into the trading app, review charts and notes, apply supported tags, and check dated videos from Neto and Kay Capitals. Use for capture backtest day and dictation variants.
---

# Capture Backtest Day

This local skill always operates in `/Users/utsav/Projects/tradingview-mcp`, even
when invoked elsewhere. Read and follow the complete, maintained workflow at
[capture-backtest-day.md](/Users/utsav/Projects/tradingview-mcp/workflows/capture-backtest-day.md),
run its helpers from that project, and keep its audit artifacts there.

Start with the workflow's chart-only `backtest-freeze.mjs freeze` phase before
backend snapshots, video searches, or tag review. Capture the original annotated
chart, notes, drawings, loaded bars, Pine evidence, and clean trade screenshots
into a durable local bundle. This needs a brief exclusive chart window; do not
promise an instantaneous capture. Only after the helper succeeds with
`chart_released: true`, immediately tell the user they can move on in TradingView.
That confirms local evidence capture, not an app save or workflow completion.

After release, use only the frozen bundle, local images, and trading app reads
and writes. Never read or mutate the live chart, restore its old view, or invoke
Undo. Snapshot app recovery state, then publish the same bundle and idempotency
key; never retry by recapturing whichever chart the user now has open. Preserve
recovery files on failure. Missing frozen evidence stays unknown; a further
chart capture or restoration needs explicit user direction. The legacy one-call
MCP capture does not provide this early-release contract.

Use the helper-generated compact review packet and same-run evidence. Validate
the review locally before applying it; live apply must still refresh state,
check concurrent edits and independently verify persistence. Batch independent
video-date reads, but serialize chart mutations and saves. Never optimize away
chart inspection, any checklist group, either channel check, or read-back.

Use the available trading and TradingView MCP tools. Ingestion is not completion:
finish every required evidence review, tag/resource update, and independent
read-back. Invocation authorizes only the workflow's scoped app/chart mutations,
not broker orders, commits, deployment, or unrelated history.

Check both Trade with Neto and Kay Capitals for videos recorded or publicly
released on the chart date. Save verified matches; a properly checked no-match
for either or both channels is normal and does not block completion. A failed or
incomplete search is not a verified no-match. Follow the workflow's date-evidence
and resource-preservation rules.

If the workflow or required services are unavailable, name the dependency rather
than creating substitute records or claiming completion. This skill is local to
this Mac and does not provision remote or web environments.
