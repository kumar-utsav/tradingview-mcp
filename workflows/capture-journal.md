# Capture journal

## Scope and fast path

On **capture journal**, **capture journal day**, or a clear dictation variant,
enrich every already-imported journal row for the requested date; otherwise use
the single visible TradingView session date. If several dates are visible and the
intended one is unclear, ask. Use `America/Los_Angeles` with DST. Exclude
`outcome: Miss`. Never create/import rows, use backtest ingestion, merge separate
rows, or split one row's scale-ins/outs/reentries. Invocation authorizes these
chart preparation in stage one and journal updates on explicit continuation in
stage two, not broker orders, commits, deployment, or other dates.

Minimize round trips: read chart state/panes once, use the snapshot's batched app
data and prefilled manifest, inspect saved evidence before requesting Pine/OHLC,
and fetch only the bounded evidence still missing. Reuse data throughout the run;
do not repeatedly fetch the catalog, chart state, or full history.

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
record every skip. End with the date, annotated count, number-to-ID mapping, and
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

Record the original pane, symbol, timeframe, and visible range. Every annotation
and screenshot must retain that timeframe and zoom: never change resolution,
call `chart_set_visible_range`, use zoom controls, or alter bar spacing. Horizontal
panning is allowed only to reach an off-screen date; restore the original view.

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
use today's levels for a past trade. Save RR only from a uniquely matched position
drawing; otherwise preserve it. Remove only this run's temporary annotations.

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
those review booleans or saves to the journal app.

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
   establish planned risk or RR.
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
original resolution/range. A combined day view is optional and needs separate
trade-ID lanes.

Generated position bands are duration markers, not RR evidence unless an
independent plan or uniquely matched pre-existing drawing supports their levels.

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
entity IDs, geometry, preserved range, review booleans, and optional note/RR
fields; do not delete required fields. Optional `rr` needs `rr_evidence`;
`notes_append` needs `notes_source`; never supply a replacement `notes` field.

```sh
node workflows/journal-capture.mjs review /absolute/run/review.json
node workflows/journal-capture.mjs review /absolute/run/review.json --apply
```

Dry-run first. The helper validates complete ID coverage, chart identity and PNG,
annotation/fill coverage, catalog/group/evidence rules, tag removals/conflicts,
staleness, and one preserved view. Apply updates only chart, tags, optional RR,
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
