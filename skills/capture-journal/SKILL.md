---
name: capture-journal
description: Capture imported journal trades with chart annotations, screenshots, RR, evidence-based tags and dated videos from Neto and Kay Capitals. Capture screenshots/RR/evidence first and release TradingView, then process user notes and save from the local pack without chart access; use batch replay without manual notes when explicitly requested across dates. Use for capture journal, capture journal day, batch journal capture, or continuation of a pending capture.
---

# Capture Journal

This local skill always operates in `/Users/utsav/Projects/tradingview-mcp`, even
when invoked elsewhere. Read and follow the complete, maintained workflow at
[capture-journal.md](/Users/utsav/Projects/tradingview-mcp/workflows/capture-journal.md),
run its helpers from that project. Keep disposable work in the OS temporary
directory, outside the checkout. Pending capture packs are durable user artifacts
under `/Users/utsav/Desktop/Journal Captures/`, so chat compaction, a later
continuation or a changed chart cannot lose the screenshots/evidence.

## Capture first, then finish without TradingView

1. **Capture and release.** Snapshot every imported trade for the chosen day.
   Freeze trade numbers by first actual fill, then ID. Cache dated candles,
   levels/zones, user drawings and range completeness once. For each trade,
   draw its approved position tool and all BUY/SELL callouts, read native RR,
   capture and visually accept its commentary-free PNG, then remove its own
   marks. Correct unclear captures now. Restore/verify original chart, user
   drawings and price scale, then disconnect.
   Use `journal-pack.mjs create` to seal the accepted PNGs/RR, evidence and
   mapping into a Desktop capture pack with a gallery and `notes.md`. Then say
   **TradingView is free to use**, link/open the pack and ask for numbered notes in chat or that file, then **continue**.
   No journal writes happen at this handoff; no annotations need to stay on the
   live chart. Reuse an existing ready pack on a repeated start request.
2. **Process and save away from the chart.** On continuation, resume the pack's
   date and numbers, not today's visible chart. Read user notes, refresh only
   server records/catalog/resources and use `journal-pack.mjs resume` to build
   the review from cached images/native RR and the latest server baseline.
   Analyze supported tags/checklists, check both video channels, save and verify
   every trade. **Do not call TradingView tools, redraw, recapture, or restore
   the old chart during this stage.** The user may freely trade, change tabs,
   replay or navigate. Missing evidence stays unknown; a changed trade or
   damaged capture needs a coordinated new capture window, not an automatic
   chart interruption. Preserve existing notes and imported financial fields.

The maintained [capture-first procedure](../../workflows/capture-journal.md#two-stages-capture-first-finish-away-from-tradingview)
describes pack inputs, notes formats, stale checks and release verification.
Pack files, not model memory, are the source of truth. This workflow permits
working while the user uses TradingView; it does not promise unattended work
between turns or create an automation. Stage two is authorized by continuation.

For an existing pending retained-chart capture or an explicit request to leave
annotations for chart notes, read only then
[journal-chart-notes.md](../../workflows/journal-chart-notes.md). New captures use
the pack flow. Existing captured commentary must still be preserved/mapped and
removed before final PNGs; unrelated commentary is hidden temporarily and restored
before chart release. New pack notes are entered after PNGs and appear only in
app Notes. Do not silently use the legacy flow or make a second screenshot pass.

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

During stage two, and for every date in an authorized batch, check both
**Trade with Neto** and **Kay Capitals** for relevant dated videos. Follow the
[dated-video procedure](../../workflows/capture-journal.md#dated-videos-from-both-channels),
save verified links in that journal day's shared resources, and verify the saved
URLs. Report each channel as found, checked with no match, or unavailable;
preserving existing resources alone does not fulfill this check. Stage one still
pauses for notes without resource writes.

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
must reuse the pending pack; legacy runs reuse/repair their recorded annotations.
Explicit requests to do both stages together may override the pause. A notes-stage
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
Keep BUY/SELL callouts above the position tool in visual order, with no overlap
or clipping. Final journal screenshots must contain no free-form user commentary;
verify this in every PNG before accepting it. Captured commentary belongs only
in the app's trade/daily Notes sections.

For ordinary capture, preserve the original timeframe and zoom. Batch replay
uses its explicitly established day view. Adjust annotation placement until the
position bands, every note, every leader, and every anchor are clearly readable.
Inspect each final PNG before accepting it; automatic placement and successful
property read-back do not establish that the layout is clear.

Run `workflows/journal-annotate.mjs` in stage one for the default capture-pack
handoff: it removes its own drawings after each screenshot. Inspect and correct
its PNGs before chart release; automatic layout is not visual acceptance. Only
the explicitly requested legacy mode retains all drawings for live-chart notes.

If the workflow or required services are unavailable, name the dependency rather
than creating substitute records or claiming completion. This skill is local to
this Mac and does not provision remote or web environments.
