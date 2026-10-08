---
name: capture-backtest-day
description: Capture all TradingView backtest trades and evidence first, release the chart, then wait for numbered chat notes before assembling, saving and verifying records. Use for capture backtest day, dictation variants and continuation of a pending capture.
---

# Capture Backtest Day

This local skill always operates in `/Users/utsav/Projects/tradingview-mcp`, even
when invoked elsewhere. Read and follow the complete, maintained workflow at
[capture-backtest-day.md](/Users/utsav/Projects/tradingview-mcp/workflows/capture-backtest-day.md),
run its helpers from that project, and keep its audit artifacts there.

Start with the workflow's chart-only `backtest-freeze.mjs freeze-chat` phase before
backend snapshots or tag review. Capture the original annotated
chart, structural drawings, loaded bars, Pine evidence, and each trade screenshot
into a durable local bundle with fixed chronological trade numbers. Do not read,
assign, extract or delete chart commentary as notes. Existing chart text may
remain visible in images, but is not a substitute for the user's chat notes.
This needs a brief exclusive chart window; do not
promise an instantaneous capture. Only after the helper succeeds with
`chart_released: true` and you have visually checked each local trade image
shows only its mapped position tool, tell the user they can move on in TradingView.
Never accept duplicate/full-day images as individual-trade capture; retain the
pack and report failure rather than publish or claim success.
That confirms local evidence capture, not an app save or workflow completion.

Present the numbered trade list (direction and entry/exit times) and ask for
`1: ...`, `2: ...`, optional `DAY: ...`, or explicit `N: NO NOTE`. Then STOP and
wait; stage one makes no server writes. Never infer notes from charts, assume
silence means no note, or assemble an incomplete response. On continuation,
resume the saved pending pack, not whichever chart is now open. Resolve missing
or ambiguous numbers in chat. An explicit request for a new capture creates a
separate pack; never silently replace a pending one.

After release, use only the frozen bundle, local images, and trading app reads
and writes. Never read or mutate the live chart, restore its old view, or invoke
Undo. Once every captured trade has notes or explicit NO NOTE, assemble the
verbatim chat notes using the saved mapping. Snapshot app recovery state, then
publish the assembled bundle and original idempotency
key; never retry by recapturing whichever chart the user now has open. Preserve
recovery files on failure. Missing frozen evidence stays unknown; a further
chart capture or restoration needs explicit user direction. The legacy one-call
MCP capture does not provide this wait-for-chat-notes contract. Existing legacy
chart-notes packs may be resumed with their original mode; all new runs use chat.

Use the helper-generated compact review packet and same-run evidence. Validate
the review locally before applying it; live apply must still refresh state,
check concurrent edits and independently verify persistence. Serialize chart
mutations and saves. Never optimize away chart inspection, any checklist group,
or read-back.

Use the available trading and TradingView MCP tools. Ingestion is not completion:
finish every required evidence review, tag update, and independent
read-back. Invocation authorizes only the workflow's scoped app/chart mutations,
not broker orders, commits, deployment, or unrelated history.

Do not search for, verify, or attach YouTube videos during capture. Preserve
existing daily resources unchanged; missing videos never block completion.

If the workflow or required services are unavailable, name the dependency rather
than creating substitute records or claiming completion. This skill is local to
this Mac and does not provision remote or web environments.
