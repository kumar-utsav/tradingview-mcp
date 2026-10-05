---
name: capture-journal
description: Capture imported journal trades with chart annotations, screenshots, RR and evidence-based tags. Normally use a two-stage notes handoff; use batch replay without manual notes when explicitly requested across dates. Use for capture journal, capture journal day, batch journal capture, or continuation of a pending capture.
---

# Capture Journal

This local skill always operates in `/Users/utsav/Projects/tradingview-mcp`, even
when invoked elsewhere. Read and follow the complete, maintained workflow at
[capture-journal.md](/Users/utsav/Projects/tradingview-mcp/workflows/capture-journal.md),
run its helpers from that project. Keep pending run state and disposable evidence
in a unique operating-system temporary directory outside the checkout; preserve
that state across the notes handoff and clean it up after verified completion.

## Two-stage capture

1. **Prepare the chart.** Read every imported trade for the requested/visible
   day. Add all position tools, BUY/SELL quantity/price callouts, diagonal leaders,
   and clear trade numbers using the approved rules below. Leave all those
   drawings on the chart so the user can add notes for each numbered trade.
   Save the fixed number-to-trade-ID mapping, created drawing IDs, and chart/run
   state. Stop with the chart ready for notes; do not write charts, notes, tags,
   RR, or resources to the journal in this stage.
2. **Continue and save.** When the user explicitly asks to continue the pending
   capture after adding notes, resume its day and mapping. Read the latest user
   notes and chart evidence, refresh journal records and the live catalog, save
   the final per-trade charts and supported notes/tags/resources, and independently
   verify persistence. Preserve imported financial fields and user drawings.

## Batch replay without manual notes

When the user supplies multiple dates/trade IDs and requests automatic journaling
without a manual-notes handoff, use the batch procedure in
[capture-journal.md](/Users/utsav/Projects/tradingview-mcp/workflows/capture-journal.md#batch-replay-without-manual-notes).
Process each day separately through **09:00 America/Los_Angeles** unless the user
specifies another cutoff. Use the stored trade timeframe (normally 1 minute),
establish a readable view for that day, and keep it consistent across its
screenshots. Apply the same position-tool, fill-callout, RR, visual review and
save-verification rules. Save directly within the requested batch; do not pause
for the user to add notes. Preserve existing notes; add no invented commentary.
Use chart evidence and any existing matched notes for tags. Leave unsupported
intent/emotion/checklist choices unselected, with the reason in the review.
No dates or trade IDs means no live batch has been selected yet.

Every saved trade must also have **RR Ratio** filled in under Details. Read the
RR displayed by that trade's TradingView long/short position tool and copy its
numeric value exactly. Do not calculate or round a separate ratio from prices.
Record the tool ID and its RR label in `chart_annotations.position_rr` and
`rr_evidence`; read the saved `rr` back. Refresh this read after any tool change
and before removing the tool. If the automatic reader is unavailable, visually
read the same matched tool. Missing tool RR keeps the capture incomplete; stage
one reads it without journal writes.

"Capture journal" starts stage one. "Continue" or "continue capture journal"
resumes stage two when a pending capture is established; do not infer a new day
from a chart the user navigated to during the pause. A repeated start request
must reuse/repair the pending annotations rather than duplicate them. Explicit
requests to do both stages together may override the pause. A notes-stage
handoff is deliberate and is not a claim that journal saving is complete.

Use the available trading and TradingView MCP tools. Authorization remains scoped
to the selected capture stages or explicit batch, not broker orders, commits,
deployment, or unrelated history.

## Approved annotation rules

Start the long/short position tool on the trade's stored `entry_candle` in Pacific
time, using that candle's HIGH for a Call or LOW for a Put. On the current
1-minute imports this is the candle before the first fill. Use the stored field
as the source of truth; do not shift BUY/SELL markers off their actual fill
candles, and do not add seconds to their note text.

Extend the position tool horizontally through the candle containing the final
closing transaction that returns the position to flat. Its right edge must never
stop at an earlier MFE candle.

Every journal position tool must use a fixed $0.50 underlying stop. Its target
price must be the maximum favorable excursion reached between the first actual
fill candle and the final closing fill, inclusive: the lowest LOW for a Put
(`short_position`) or the highest HIGH for a Call (`long_position`). This rule
applies to wins, losses, and break-even trades; it is what makes the displayed
tool useful for reading the trade's realized risk-to-reward potential. Never
use the option premium as a chart price, and never replace the MFE target price
with the exit price when price traveled farther in the trade's direction. Record the
MFE candle and price separately from the final-exit right edge in the review
manifest and validate the $0.50 stop before capturing the PNG.
TradingView position levels use tick counts, not dollar distances. Convert using
the underlying tick size, validate the read-back stop/target prices, and visually
confirm both position bands reach those levels before accepting the screenshot.
Historical adjusted candles can have sub-cent prices. TradingView may round the
initial position anchor during creation; restore both anchors with its public
`setPoints` API using the exact candle price, then validate the stop, target and
final-fill right edge and read native RR again. Do not round the source candle
to make validation pass.

Use **16-point, white text** in content-sized green BUY and red SELL callouts.
Each line is `BUY|SELL quantity @ $price` with two decimal places and no added
timestamp, for example `BUY 2 @ $0.97`. Keep every imported fill represented.

Connect each note to its actual fill candle with a short diagonal leader into
nearby whitespace. Start just beyond the high or low wick. The full leader must
clear candle bodies and wicks; vertical leaders through candles fail review.
Reserve space around all fill anchors before placing any note, including later
fills. No note or another leader may hide an anchor. Check the full rendered
text bounds extending right/down from its placement point, not a centered box.
Keep notes above the position tool in visual order, with no overlap or clipping.

For ordinary capture, preserve the original timeframe and zoom. Batch replay
uses its explicitly established day view. Adjust annotation placement until the
position bands, every note, every leader, and every anchor are clearly readable.
Inspect each final PNG before accepting it; automatic placement and successful
property read-back do not establish that the layout is clear.

For stage one, create and retain the drawings with the TradingView MCP, using
the workflow's retained-chart procedure. `workflows/journal-annotate.mjs` removes
its own drawings after each screenshot, so it is a stage-two helper, not the
stage-one handoff. Review and adjust its PNG drafts before journal apply; its
automatic layout is not proof that every label is visually clear.

If the workflow or required services are unavailable, name the dependency rather
than creating substitute records or claiming completion. This skill is local to
this Mac and does not provision remote or web environments.
