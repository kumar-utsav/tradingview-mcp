# Capture journal

## Scope and fast path

On **capture journal**, **capture journal day**, or a clear dictation variant,
enrich every already-imported journal row for the requested date; otherwise use
the single visible TradingView session date. If several dates are visible and the
intended one is unclear, ask. Use `America/Los_Angeles` with DST. Exclude
`outcome: Miss`. Never create/import rows, use backtest ingestion, merge separate
rows, or split one row's scale-ins/outs/reentries. Invocation authorizes these
chart preparation in stage one and journal updates on explicit continuation in
stage two. An explicit batch request without manual notes authorizes the
selected days' complete capture and save as described below. Neither mode
authorizes broker orders, commits, deployment, or unselected dates.

Minimize round trips: read chart state/panes once, use the snapshot's batched app
data and prefilled manifest, inspect saved evidence before requesting Pine/OHLC,
and fetch only the bounded evidence still missing. Reuse data throughout the run;
do not repeatedly fetch the catalog, chart state, or full history.

## Batch replay without manual notes

Use this mode only for an explicit request to journal a selected set of dates or
trade IDs without waiting for manual notes. Keep the ordinary two-stage workflow
as the default. Resolve the provided trades to existing journal IDs, group by
Pacific session date, and process dates in order. If dates or IDs have not been
supplied, describe this mode and request the batch selection; do not infer all
journal history. A date selection includes every imported non-Miss trade for
that date; an ID selection includes only those IDs. Keep partial-ID batches in
a separate manifest and verify coverage against that frozen selection rather
than claiming the entire day was captured. The day-wide review helper expects
all imported IDs, so do not pass it an incomplete selection.

For each day:

1. Record original chart/tab/pane, resolution, range and replay state, including
   whether autoplay is running. Preserve user drawings and any pending notes
   capture. Prefer a suitable separate chart tab so another active replay is
   undisturbed. Snapshot the selected records, charts, catalog and daily resources
   into a unique temporary day directory. Maintain a batch ledger of selected
   IDs, each day's state, verified saves and unresolved rows for safe resumption.
2. Use the matching underlying and stored execution timeframe, normally 1 minute.
   Replay that day's session through **09:00 America/Los_Angeles**, accounting for
   DST. Convert the full date and clock to an explicit offset/UTC timestamp;
   never pass a bare date and assume it means Pacific midnight. The existing
   `entryCandleTime({date, entry_candle: '09:00'})` helper resolves the cutoff
   using Pacific DST; convert its seconds to an ISO timestamp. `replay_start`
   accepts a full ISO timestamp through its `date` argument. Seek to the cutoff
   with replay, verify `replay_status` and actual last loaded bar, and step only
   if needed. If autoplay is used, check its state before toggling it and pause
   at the cutoff. An endpoint selection alone is not proof that history loaded.
   Verify the entry, every fill candle and full trade window are present. Do not
   include candles beyond the cutoff in screenshots or use post-exit extremes
   for targets. Trades closing after the cutoff remain explicitly unresolved;
   do not shorten their tool or invent an exit. No replay trade orders are needed.
   If the user authorizes extending a day, include its final closing-fill candle.
   TradingView's replay date selection can exclude the selected bar: select one
   execution bar after the cutoff and verify the actual loaded last bar is the
   cutoff. Do not repeatedly step while bars are loading; check the replay clock
   first, and recheck it after capture to detect unintended advancement.
3. Establish a readable day view containing the selected trades through 09:00,
   with pre-entry structure and enough whitespace for annotations. This mode
   authorizes changing the view for each day; use the stored timeframe, not a
   coarser resolution to fit more candles. Record that chosen range and keep the
   same resolution/zoom for all accepted screenshots in the day. Position tools,
   16-point BUY/SELL callouts and diagonal leaders must follow section 3. Adjust
   layout or revise the day view and recapture until every note and anchor is
   visible. The automated helper requires one symbol/timeframe per run; handle
   unsupported batches explicitly rather than changing imported identity fields.
   Frame prices from the dated session candles with annotation padding; distant
   indicator levels must not flatten the candles. For multiple underlyings,
   establish and audit a separate view for each symbol, then combine the results
   against the full day's frozen ID selection. Never apply one symbol's ranges
   to another. Dismiss replay date/warning dialogs before capturing and visually
   confirm they are absent from every accepted image.
4. Capture and visually inspect every trade separately. Read native tool RR
   before removing its temporary drawings. Do not leave all batch trades piled
   onto one chart as a notes-stage handoff. Preserve existing user notes and
   drawings; omit `notes_append` unless the user explicitly supplied new notes
   to save. BUY/SELL annotations remain required even though manual commentary
   is omitted. Never write generated intent or emotion as the user's notes.
5. Review the current tag catalog and every checklist group. Chart-supported
   range/structure/setup tags may be selected; execution, management and
   emotional/process tags need their specific evidence. Existing matched notes
   remain usable evidence, but missing notes do not justify invented intent,
   an outcome-based judgment, or a Cannot assess tag. Explain unselected groups
   in `group_review`. Verify selected tag keys appear in the checklist and are
   selected under the correct groups; report catalog/UI inconsistencies.
6. Validate the manifest, save charts/RR/supported tags on the same imported IDs,
   and independently read records and image bytes back. Preserve all imported
   fills, P/L, outcomes, existing notes and daily resources. Verify the entire
   selected day before proceeding to the next. On a failed or concurrent save,
   inspect partial state and refresh the snapshot before retrying. Continue other
   days only when the failure is isolated and cannot contaminate their evidence.

Finish with counts by date and every unresolved trade, restore the original
chart/replay context where it was changed, and clean temporary drawings, files
and preview processes. Retain completed capture records and unresolved recovery
state. No manual-notes pause or further routine save confirmation is required
for this explicitly selected batch mode.

## Two stages and the notes handoff

### Stage one: leave every trade annotated on the chart

Complete sections 1-2 for the chosen day, then create the section 3 annotations
with the TradingView MCP and retain them. The screenshot helper in section 3
removes drawings; do not run it as the stage-one handoff. Use its exported
`planAnnotation`/position-level utilities when useful for computing geometry,
but create the retained tools and labels with MCP drawing tools and verify their
properties and appearance. No journal write helper or API mutation runs here.

Freeze trade order by first actual fill time, then imported ID, excluding Miss.
Give each trade a visible identity label such as `Trade 1 | ID 2923`, separate
from its transaction callouts. These numbers also route the user's subsequent
notes. Do not add invented trading commentary or empty user-note placeholders.
Use separate lanes and adjust placements across the entire day, so notes,
leaders, and anchors from neighboring trades remain clear. Leave every trade's
position tool and fill marks in place; do not remove one before drawing the
next. Use matching panes for different underlyings and preserve original zoom
and timeframe. Horizontal panning may be needed to inspect all trades.

Maintain `stage.json` in the pending run directory with `phase: awaiting_notes`,
the fixed date and snapshot path, the original pane/symbol/timeframe/range,
ordered `{number, trade_id}` pairs, every generated drawing ID grouped by trade
and pane, existing user-note drawing IDs/text, annotation results, and unresolved
rows. Record drawing IDs as they are created so interrupted preparation can be
repaired without duplicates. Exclude all generated IDs (including trade identity
labels) from user-note extraction. Preserve pre-existing drawings and user edits.

Inspect the full annotated chart and each trade; save a handoff screenshot and
record every skip. Read each retained tool's native RR using
`readPositionRR(entityId)` from `workflows/journal-annotate.mjs` (or read its
visible label), and store its `position_rr` evidence in the annotation results.
End with the date, annotated count, number-to-ID mapping, and
any unfinished trade. Tell the user to add notes numbered `1:`, `2:`, etc., then
say **continue**. Keep the chart annotations and pending run files intact while
waiting. Do not assess missing user commentary as a failure or claim journal
saving is complete. A repeated start for this pending day reuses/repairs existing
drawings instead of creating another set.

### Stage two: read the new notes, save, and verify

An explicit continuation resumes the pending date and frozen mapping. Locate
`stage.json` from this conversation; never silently substitute the chart's new
visible date or renumber trades. If pending state is unavailable, recover the
mapping from the recorded IDs/chart labels before mutating anything. If more
than one pending day could match, ask which one to resume.

Read current user-note drawings and chart context first, using the chart-text
rules below and the frozen numbering. Save their source IDs and text before
removing any stage-one drawings. User notes may have been added or edited during
the pause: re-read them now, rather than using stage-one text or screenshots.
Unresolved note mappings remain unresolved; do not guess or shift other numbers.

Take a fresh snapshot in a new run directory and reload the catalog, groups,
notes/resources, and imported records. Compare IDs and fills with the stage-one
snapshot. Preserve current notes/tags and use the fresh snapshot as the save
baseline, while keeping the original mapping. Re-annotate a changed trade before
saving it. Newly imported trades need their own annotations and note mapping;
report them explicitly rather than assigning an existing ordinal to another ID.

After preserving the user's notes, remove only the recorded stage-one generated
drawings and use section 3 to capture each final trade separately, including its
matched user-note context. Preserve user drawings throughout. Finish sections
4-5 using notes and chart evidence together. Dry-run, apply, and verify saved
charts, note text, tag keys/checklist selections, immutable fills/P&L/outcomes,
and relevant daily resources. A continuation authorizes this save; do not add
another routine confirmation step.

Mark the pending stage complete only after read-back succeeds. Restore the
original chart view and remove disposable drafts, previews and superseded
snapshots. Keep completed capture records and requested final artifacts; preserve
recovery files on failures and never delete the user's chart notes.

## 1. Snapshot and preserve

Record the original pane, symbol, timeframe, and visible range. For ordinary
two-stage capture, every annotation and screenshot must retain that timeframe
and zoom: never change resolution,
call `chart_set_visible_range`, use zoom controls, or alter bar spacing. Horizontal
panning is allowed only to reach an off-screen date; restore the original view.
For explicit batch replay, establish and record the readable day view under the
batch procedure instead, then preserve that view across the day's screenshots.

From `/Users/utsav/Projects/tradingview-mcp`, create a unique run directory outside
the checkout, using the operating system's temporary directory. Allocate a
temporary parent with `mktemp -d` and give the snapshot helper a new child path
(for example `/absolute/temporary/parent/stage-one`). The helper creates that
child itself and refuses an existing directory:

```sh
node workflows/journal-capture.mjs snapshot YYYY-MM-DD /absolute/temporary/parent/stage-one
```

This concurrently saves `before.json`, the live journal catalog/groups, daily
notes/resources, recovery charts, and `review.template.json`. Do not reuse a run
directory. If there are no rows, report it and stop. Treat imported IDs, fills,
P/L, outcomes, grouping, notes, tags, RR, and corrections as source data. Analyze
a sorted copy of transactions; never reorder the saved array.

The app API defaults to `http://100.125.89.9:5555`; set `TRADING_API_URL` when
live verification finds another endpoint. Ensure the journal list includes every
page/record before continuing.

## 2. Inspect matching evidence

For each row, prefer the pane matching its underlying ticker and stored
`time_frame`; the active pane may be SPX or another timeframe. The stored
`entry_candle` controls the position tool's start and uses the bookmarklet
convention (the candle before the fill bucket, so a 07:11:12 fill may store
07:10). Do not rewrite it or substitute the fill candle. Actual fill times
control transaction markers and the MFE search window.

View the saved chart first. If missing, stale, mismatched, or inadequate, navigate
to the matching historical session at the preserved zoom and capture enough
pre-entry structure, entry, levels, and management context. Preserve multi-pane
context when relevant; focus a pane only to read candles. All panes used as
evidence must show the same date. Reading/downloading an image is not visual
inspection. A prior saved image is review evidence only; it never replaces the
fresh per-trade annotated PNG required below.

Match notes/drawings by explicit trade ID, else by unique date+ticker+direction+
timing. Inspect text, rectangles, position drawings, and relevant indicator
boxes/lines/labels. Use bounded historical bars only when pixels are insufficient.
Never compare option premium with underlying levels, infer RR from option P/L, or
use today's levels for a past trade. Copy Details RR from the verified,
trade-matched position-tool label as described below. Remove only this run's
temporary annotations.

### Chart-text notes

Before creating temporary labels, inspect text/note/callout/balloon drawings
anchored to the date. Order trades by first actual entry time, then ID.

- `1: text`, `#2) text`, `3. text`, and `4- text` (ordinals 1-999) route through
  the stage-one frozen mapping; strip the prefix. For an explicitly requested
  single-pass capture without a handoff, use first-fill-time/ID order. Screen
  position never overrides the mapping. Ignore run-generated drawing IDs.
- Case-insensitive `DAY:` routes, without its prefix, to shared daily notes.
- Preserve multiple notes in drawing-time order separated by a blank line; do
  not duplicate destination text or replace existing notes/resources.
- Duplicate/out-of-range ordinals, empty prefixed text, and wrong-date drawings
  are unresolved. Record drawing ID/reason and never shift later ordinals.
- Use unnumbered non-`DAY:` text only when its normal trade association is unique.

Stage one only records existing source notes; it does not save them. On stage
two, record current source drawing IDs and stripped text. Use `notes_append` + `notes_source`
for trade notes. Update daily notes through
`PUT /journal/daily-notes/YYYY-MM-DD`, preserving `external_resources`, and read
back both destinations. Source drawings are user artifacts; do not delete them.

## 3. Annotation rules and stage-two screenshots

Stage-two fast path: after reading the user's notes, preserving their source
drawings, removing recorded stage-one marks, and taking the fresh snapshot, run
`node workflows/journal-annotate.mjs /absolute/run/before.json`. This reads the
imported fills and underlying candles, draws each position and compact BUY/SELL
callouts with leader lines, saves one PNG per trade, and removes only its own
temporary drawings. It restores the chart's starting symbol, timeframe, and
visible range. If replay is active before the final fill, advance replay first;
the script checks this before changing the chart. All rows in one run currently
need the same minute timeframe. Inspect `annotation-draft.json`, the prefilled
`review.draft.json`, every PNG, and every skip. The
script places 16-point labels and diagonal leaders using screen coordinates,
checks their paths against candles, and reserves clearance around all fill
anchors. Visual review must still check overlaps, clipping, indicator conflicts,
anchor visibility, and trade context.
Correct a draft by hand before marking `overlap_checked` and
`screenshot_after_annotations` true in `review.json`; the script never sets
those review booleans or saves to the journal app. Batch mode uses this same
per-trade capture path after establishing its replay endpoint and readable day
view, without requiring new user notes.

For final journal screenshots, work one row at a time so run-created annotations
never overlap another trade. Stage one instead retains all trades' drawings,
with separate lanes and a whole-chart overlap check.
For each row, using a chronological copy of all imported transactions:

1. Create one `long_position` for a Call or `short_position` for a Put. Start on
   the stored `entry_candle` on the trade's date in Pacific time; anchor a long at
   that candle's underlying HIGH and a short at its underlying LOW. The stored
   field is authoritative; if missing or not loaded, skip rather than guess.
   Option prices are never chart Y-values.
2. The tool spans the entire row. Find the final closing fill that returns the
   position to flat and extend the tool's right edge to that fill's candle. If
   the ledger never returns to flat, skip with that reason. An earlier MFE candle
   controls the target price only; it must never shorten the tool's width.
3. For every outcome, the position-tool target price is the maximum favorable
   excursion from the first actual fill candle through final exit inclusive:
   lowest LOW for a short, highest HIGH for a long; for ties use the first candle
   in that window. Never
   search past the final exit and never substitute its price for MFE merely because
   the trade was a win or break-even. This target is required so the tool
   shows how far the trade traveled and makes its potential risk-to-reward
   visible. Record the MFE candle separately as `position_mfe_candle_time`, use
   `position_end_rule: final_exit_candle` for duration, and use
   `position_target_rule: mfe_low|mfe_high` for the target level.
4. Display stop: exactly $0.50 adverse on the underlying (short `entry + .50`,
   long `entry - .50`). The stop is fixed for every outcome and does not
   establish planned risk; it defines the denominator for the displayed-tool RR.
   TradingView `stopLevel` and `profitLevel` use tick counts: divide the price
   distances by the underlying's `minmov / pricescale` (SPY $0.50 = 50 ticks).
   Preserve fractional tick counts when historical candles contain sub-cent
   prices; do not round the actual entry or MFE level to whole ticks.
   Convert the read-back ticks to stop/target prices and verify both bands expand
   visibly to those prices before accepting the PNG; matching raw overrides
   alone is insufficient.
5. After the position tool, mark every fill on its actual `filledTime` candle.
   Each callout line is `BUY|SELL quantity @ $price` with two decimals, using the
   imported option price (for example `BUY 2 @ $0.95`). Use 16-point white text,
   a content-sized green BUY or red SELL background, and no added timestamp.
   Same-side fills in one
   bucket may share a multiline callout only if every complete line is readable;
   opposite sides remain distinct.
6. Anchor callouts to candle high/low plus a small offset and leader line. Bring
   every callout to front above the position tool and all run-created marks.
   Use diagonal leaders starting just outside the high/low wick, and check the
   whole leader against candle bodies, wicks, and other notes. A clear note box
   alone does not prove a clear leader; vertical leaders through candles fail
   review.
   Reserve clearance around every fill anchor, including fills not yet labeled.
   No note or other fill's leader may cover an anchor. Account for the rendered
   text extending right/down from its placement point, rather than treating
   notes as centered boxes.

Use vertical lanes for nearby fills. Reposition annotations—not the chart—until
labels, bands, candles, and exit are unclipped, unambiguous, and collision-free.
Before the PNG, read drawings back and confirm tool type, entity IDs, start/end
candles and prices, $0.50 stop, every marker's text/anchor, visual order, and no
overlap. Inspect each anchor independently: it must remain visible and its
leader must trace clearly to exactly one note. Capture only then, record the evidence in `chart_annotations`, remove
only that row's temporary marks, and continue. Every screenshot uses the same
original resolution/range in ordinary capture, or the established day view in
batch mode. A combined day view is optional and needs separate
trade-ID lanes.

### Required Details RR

For every captured trade, read the RR displayed by its verified TradingView
long/short position tool and copy that numeric value into Details `rr` exactly.
Do not independently calculate or round RR from entry, target, stop, option
premium, P/L, or exit prices. Save a number (`2.9`, not a `1:2.9` string); zero
is valid when the tool displays zero.

Read while the tool exists, and refresh after any annotation correction. The
helper calls TradingView's own position-label formatter and records
`chart_annotations.position_rr` as `{entity_id, source, label, compact, value}`
with source `tradingview_position_tool_label`. The prefill copies this value;
the save validator requires the matched drawing ID, label, value and
`rr_evidence`. If the automatic reader cannot read the label, visually read the
same verified tool and record source `visual_position_tool_label` plus its exact
label text. Never fall back to a separately calculated ratio.

This is the RR shown by the annotated tool; preserve any user's stated planned
RR separately in their notes. Read during stage one without journal writes,
then save and read back `rr` in stage two. Include Details in final verification;
no reviewed trade may silently retain a blank RR. If the tool value cannot be
read, keep the trade incomplete or explicitly skip it with the reason.

## 4. Review the live catalog

Use the snapshot's complete live journal/shared catalog, including relevant tags
in inactive legacy groups. Review every group and record a supported selection or
an explicit unknown/not-applicable reason. Follow selection modes; require no
arbitrary tag count and never copy backtest-only tags. Give concrete evidence for
each selected tag.

Keep decisions separate: Setup Review is valid/planned-momentum-exception/
invalid; Entry Execution is planned/justified structural adjustment/
unplanned; Trade Management is planned/justified adjustment/fear exit/held past
invalidation/unknown. Outcome alone proves none of them. Read stored HTML as text
without rewriting it. Intent/emotion may come from a note when attributed; do not
append generated analysis as the user's note. FOMO,
chasing, P/L decisions, thesis/risk violations, fear exits, and holding past
invalidation need specific evidence. Size alone does not prove a risk violation.
Preserve existing tags unless explicit contrary evidence supports removal.

When evidence is insufficient, leave that group's tags unselected and explain
the uncertainty in `group_review`. The user removed the `j_setup_unclear`
("Cannot assess") tag from all trades and the catalog; never recreate or apply
it as an uncertainty fallback.

For positional ranges use the entry anchor HIGH for Call and LOW for Put against
completed, correctly dated bounds: premarket 01:00-06:30 Pacific, previous regular
session, opening 5m 06:30-06:35, and opening 15m 06:30-06:45. Respect holidays and
short sessions. A missing/incomplete range is UNKNOWN. If the catalog omits the
boundary rule, equality is inside and that convention must be recorded. Avoid
future-confirmed pivots. An opposing level is an obstacle, not automatic
confluence; a retest needs leave-and-return, not a wick alone; reentry issues
require the same thesis/zone and actual sequence.

`journal-workflow-2026-09-23/` is historical reference only (113-record baseline
plus observations); the current catalog, plan, and user corrections win.

## 5. Save and verify

Complete the generated `review.template.json`, save it as `review.json`, and
include each snapshot ID exactly once in `trades` or `skipped` with a reason. The
template already supplies immutable chart identity, existing tags, all group IDs,
expected position rules, and exact transaction label text. Fill its evidence,
entity IDs, geometry, preserved range, review booleans, required `rr` and
`rr_evidence`, and optional note fields; do not delete required fields.
`notes_append` needs `notes_source`; never supply a replacement `notes` field.

```sh
node workflows/journal-capture.mjs review /absolute/run/review.json
node workflows/journal-capture.mjs review /absolute/run/review.json --apply
```

Dry-run first. The helper validates complete ID coverage, chart identity and PNG,
annotation/fill coverage, catalog/group/evidence rules, tag removals/conflicts,
staleness, required RR, and one preserved view. Apply updates only chart, tags, RR,
and appended notes, then independently verifies records, exact tag sets, imported
financial fields, and chart bytes. HTTP success alone is not completion.

The API is non-transactional. On interruption, concurrency, or read-back mismatch,
stop; preserve recovery files, inspect partial state, and take a new snapshot
before continuing. Never blind-retry or roll back another person's changes.
On a normal rerun, detect existing notes/media and enrich the same IDs without
duplicating them.

Preserve daily resources. Attach a video only when its URL and date are verified
from the supplied/established source; preserve unrelated links and omit `notes`
when updating only `external_resources`. Read daily notes/resources and journal
rows back. Restore the original TradingView view. Report date, rows reviewed,
tools/markers/charts/tags/notes/resources verified, and every skip or unresolved
item. Do not claim completion with required work unresolved. When only editing
this workflow, perform no live capture writes.
