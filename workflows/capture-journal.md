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
trade IDs without waiting for manual notes. Keep capture-first with a notes handoff
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
   onto one chart as a notes-stage handoff. Final PNGs contain no free-form user
   commentary; follow the chart-text procedure below if chart notes are present.
   Preserve existing app notes and other user drawings; omit `notes_append`
   unless the user explicitly supplied new notes
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
   fills, P/L, outcomes, existing notes and daily resources. Check both video
   channels and save verified links using the dated-video procedure below.
   Verify the entire
   selected day before proceeding to the next. On a failed or concurrent save,
   inspect partial state and refresh the snapshot before retrying. Continue other
   days only when the failure is isolated and cannot contaminate their evidence.

Finish with counts by date and every unresolved trade, restore the original
chart/replay context where it was changed, and clean temporary drawings, files
and preview processes. Retain completed capture records and unresolved recovery
state. No manual-notes pause or further routine save confirmation is required
for this explicitly selected batch mode.

## Two stages: capture first, finish away from TradingView

This is the default for new journal captures. Only stage one occupies TradingView.
Stage two works from a durable capture pack, user notes, the trading server and
video sources. It must not reconnect to TradingView, read the user's new chart,
change replay/layout, redraw, recapture, or restore the previous view after the
chart has been released. A changed chart day is unrelated to the pending pack.

### Stage one: capture each trade once, then release the chart

1. Complete sections 1-2 once for the chosen day. Freeze ordinals by first actual
   fill time, then imported ID. Reuse the day's fetched candles and chart evidence
   for every trade rather than fetching the same history repeatedly. Cache the
   relevant underlying/timeframe candles, manual drawings and visible dated
   indicator levels/zones; include supporting panes only when needed. Capture
   full previous regular-session and premarket/opening ranges when available.
   Record a missing/incomplete range as unknown with its reason now; do not
   plan to retrieve it from TradingView during stage two.
2. Use section 3 to draw **one trade at a time**, read its native tool RR, capture
   its final commentary-free PNG, and remove only that trade's generated marks.
   Run `node workflows/journal-annotate.mjs /absolute/run/before.json` now,
   not after the notes handoff. Keep the approved zoom, stop, MFE, final-exit
   edge, fill callouts and leaders. Inspect every PNG while the capture window
   is still open; correct unclear annotations now. Set `chart_reviewed`,
   `view_preserved`, `overlap_checked`, `screenshot_after_annotations` and
   `chart_annotations.commentary_free` true only after that inspection.
   Missing/invalid captures remain incomplete, not ready for notes.
3. Finish all TradingView work: remove run-created marks, restore any temporarily
   hidden commentary, verify the user's original drawings/styles/points, pane,
   symbol, timeframe, horizontal view and price scale. History loading can shift
   unloaded drawing anchors; restore original points only after those anchors
   are loaded. Save release verification with `chart_restored`,
   `user_drawings_preserved`, `temporary_annotations_removed` and
   `tradingview_released` all true. Disconnect the capture session. Do not use
   the chart again after announcing its release.
4. Seal the accepted PNGs, chart review, native RR, frozen IDs and supporting
   evidence into a unique durable folder under
   `/Users/utsav/Desktop/Journal Captures/YYYY-MM-DD-<run-id>/`. The capture pack
   is the source of truth, not conversational/model memory. Temporary scripts
   and drafts stay in the OS temporary directory. No journal writes happen yet.
   `journal-pack.mjs create` writes the gallery, notes template and ready state
   only when all trades are visually reviewed and release is verified:

   ```sh
   node workflows/journal-pack.mjs create /absolute/run/pack-config.json "/Users/utsav/Desktop/Journal Captures/YYYY-MM-DD-<run-id>"
   ```

   `pack-config.json` contains absolute `snapshot_path`, `review_path`,
   `evidence_path`, and `release_path`. Evidence is dated JSON:
   `{date, captured_at, sources:[{ticker, time_frame, bars, drawings, indicators,
   ranges}]}`. Bars use `{time,open,high,low,close,volume}`. Every source records
   `pm`, `pd`, `5m`, `15m` ranges as either
   `{status:"complete", date, from, to, low, high, bar_count, source}` or
   `{status:"unknown", reason}`. Native drawing IDs are historical evidence;
   never dereference them in a later TradingView session.
5. Open/link `capture-pack.md` and `notes.md`, give the fixed trade numbers,
   and say **TradingView is free to use**. The user can dictate/type numbered
   notes here or edit `notes.md`, then say continue. `NO NOTE` explicitly skips
   a trade's commentary. Do not require notes to be placed on the chart.
   A repeated capture request for this pending day reopens the saved pack,
   without repeating the live capture. If notes were already supplied and a
   combined save was authorized, continue directly into stage two.

Once the chart is released, local evidence review and read-only video/server
preparation can run independently while the user trades. Stop for the notes
handoff without journal writes; later saving requires the user's continuation.
This describes concurrent use of TradingView, not a promise that a stopped chat
keeps running or a request to create an automation/worker.

### Stage two: process the pack and save without TradingView

Resume the recorded `mode: capture_first` pack/date/ordinals. First read notes
from the user's message or the pack's `notes.md`; chat/dictation can be copied
verbatim into `user-notes.json` with
`{date, trades:[{number,trade_id,text,no_note:false}], daily:""}`. Every trade
needs text or explicit `no_note:true`. Preserve the source text and file hash.
Unresolved ordinals are not silently reassigned or treated as no note.

Take a fresh **server-only** snapshot into a new temporary child directory to
refresh trades, catalog/groups and notes/resources. Use the existing snapshot
helper; it does not connect to TradingView. Prepare a fresh review using cached
charts/RR, the latest tags/notes and the frozen mapping:

```sh
node workflows/journal-capture.mjs snapshot YYYY-MM-DD /absolute/new/run/server-snapshot
node workflows/journal-pack.mjs resume "/absolute/pack" /absolute/new/run/server-snapshot/before.json /absolute/new/run/review.json [absolute-notes-file]
```

Resume checks image integrity, financial/fill identity and chart changes during
handoff. Current notes/tags/resources are preserved, and group review starts
fresh against the current catalog. The returned review is an **analysis draft**:
complete every tag's evidence and every group's reason under section 4. Do not
copy old checklist judgments or append already-saved exact note paragraphs.
Optional Day text is a separate pending daily-note merge preserving resources.

A changed fill, entry candle, underlying, timeframe or day/ID set requires a new
capture; a missing/corrupt PNG or incompatible server chart also stays unresolved.
Report the affected IDs and coordinate a brief new capture window. Do not
interrupt the user's current TradingView session to repair these automatically.
Missing evidence can instead remain unknown with unsupported tags unselected.

Finish sections 4-5 and the two dated-video checks using cached evidence. Batch
independent file/server/video reads; serialize writes per trade and daily record
with the existing stale guards. Verify exact PNG bytes, notes, tags/checklist
selections, Details RR, immutable fields and daily resources. This continuation
already authorizes saving; no extra routine permission step is needed.

Mark the pack complete only after required read-back and app UI verification.
Retain the accepted pack/completed records; clean temporary drafts/native
screenshot copies after verification. Do not touch TradingView for cleanup or
restore the old chart at the end of stage two: it was restored in stage one.

### Existing or explicitly requested chart-note handoffs

For a pending retained-chart capture without `mode: capture_first`, finish it
under [journal-chart-notes.md](journal-chart-notes.md), preserving its frozen
mapping and note recovery. Use that same optional mode for an explicit request
for live-chart annotations/notes. Do not load its detailed instructions for the
normal saved-pack workflow. If the user explicitly puts new notes on the chart
for a saved pack, read/map/back up those notes in one agreed brief access window,
then release TradingView again; use the already captured PNGs/RR, not a second
annotation pass. Preserve/remove captured commentary under the chart-text rules.

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

During stage one, view the saved chart first. If missing, stale, mismatched, or inadequate, navigate
to the matching historical session at the preserved zoom and capture enough
pre-entry structure, entry, levels, and management context. Preserve multi-pane
context when relevant; focus a pane only to read candles. All panes used as
evidence must show the same date. Reading/downloading an image is not visual
inspection. An older server image is review evidence only; it does not replace the new
per-trade annotated PNG. A sealed pack's accepted PNG is the final image for its
stage-two continuation and must be reused without a second capture.

Match notes/drawings by explicit trade ID, else by unique date+ticker+direction+
timing. Inspect text, rectangles, position drawings, and relevant indicator
boxes/lines/labels. Use bounded historical bars only when pixels are insufficient.
Never compare option premium with underlying levels, infer RR from option P/L, or
use today's levels for a past trade. Copy Details RR from the verified,
trade-matched position-tool label as described below. Remove this run's temporary
annotations and the captured commentary drawings authorized below; preserve
unrelated drawings.

### Chart-text notes

Normal capture-first notes come from chat or the pack file, after screenshots
are captured. These drawing rules apply only to existing chart commentary or an
explicit chart-note mode. Before early screenshots, back up and temporarily hide
visible commentary using supported per-drawing visibility, then restore it before
release; never delete unrelated notes. Commentary being captured now may instead
be removed after mapping/analysis and recovery as described below. Unresolved
commentary visibility keeps the PNG incomplete.

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
back both destinations.

For future captures, the user authorizes removal of captured commentary from the
chart after all notes have been read and analyzed, before any final journal PNG:

1. Save every source drawing's exact raw text, routed text, trade ID or `DAY:`
   destination, entity ID, pane, points and style properties in a recovery file.
   Re-read that file and confirm all source notes are present before removing
   anything. Complete the frozen mapping and note-based review for all trades;
   unresolved associations must be resolved before those source notes are removed.
2. Remove only those captured commentary drawing IDs with the TradingView drawing
   tools. Remove them all before the first final screenshot, so another trade's
   commentary cannot appear in a later PNG. Re-read the drawing list and verify
   that every recorded commentary ID is absent. Keep position tools, BUY/SELL
   callouts, their leaders, and structural/key-level drawings.
3. Preserve unrelated notes and drawings. If unrelated commentary is visible in
   the capture view, temporarily hide that commentary using a supported drawing
   visibility control, record its prior state, and restore it after screenshots.
   Do not delete it or hide all drawings. If it cannot be excluded safely, leave
   that screenshot unresolved rather than saving commentary in the PNG.
4. Build app notes and tag evidence from the preserved source file after removal.
   Visually verify every final PNG has no free-form commentary and still has all
   required transaction callouts. Confirm the note text persisted in the app's
   Notes section. On interruption or save failure, retain note recovery data and
   deletion progress; resume from it without duplicating app text. If the capture
   is abandoned before persistence, restore unsaved source drawings from that
   recovery data. Successfully captured notes remain off the chart.

Stage-one handoff notes remain visible until the explicit continuation. This
preference applies to future captures; do not rewrite previously accepted
screenshots solely to remove commentary unless the user requests it.

## 3. Annotation rules and early screenshots

Default capture-first runs `journal-annotate.mjs` during stage one, before notes
are requested. It draws each position and compact BUY/SELL callouts, records
native RR, captures one PNG per trade and removes its own marks. It restores
starting symbol, timeframe and horizontal range; separately verify original
user drawings and price scale before release. It caches candles once per
underlying for the day. Replay must already include the final fill; one minute
resolution must match the stored trades and the view must include their fills.

Inspect `annotation-draft.json`, the prefilled `review.draft.json`, every PNG and
every skip while chart access is still available. Automatic placement/property
read-back do not prove clear labels, leaders, anchors or bands. Adjust unclear
annotations and recapture affected images now; never certify unseen PNGs.
The helper neither extracts nor excludes user commentary, so use the chart-text
procedure first when necessary. For a legacy chart-note handoff this same helper
runs only after notes have been read and recorded marks/commentary removed.
Batch uses it after the authorized replay/day view has been established.

For final journal screenshots, work one row at a time so run-created annotations
never overlap another trade. Only the explicitly selected legacy handoff retains
all trades on the live chart. Default continuation never invokes this helper.
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
overlap or free-form user commentary. Inspect each anchor independently: it must remain visible and its
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

Complete the dated-video checks below, preserve daily resources, and read daily
notes/resources and journal rows back. Restore the original TradingView view
before releasing it in stage one (or before release in batch/legacy mode), never
at the end of a capture-first continuation.
Report date, rows reviewed, tools/markers/charts/tags/notes/resources verified,
each channel's video result, and every skip or unresolved item. Do not claim
completion with required work unresolved. When only editing this workflow,
perform no live capture writes.

## Dated videos from both channels

For stage two and every authorized batch date, independently check
[Trade with Neto](https://www.youtube.com/@TradeWithNeto) and
[Kay Capitals](https://www.youtube.com/@KayCapitals/videos). Follow the discovery,
exact publication/recording-date verification, metadata helper and date-window
coverage rules in [the shared backtest procedure](capture-backtest-day.md#dated-videos-from-both-channels).
That reference supplies video checks only: keep this workflow's journal IDs,
two-stage handoff and journal destination. Search each channel for the session
date (including Neto's YYMMDD title), inspect chronological Videos and available
Live listings, and record each channel as `found`, `checked_no_match`, or
`unavailable`. Empty title searches or failed lookups do not establish no match.
Use fresh evidence for the selected date; do not reuse an earlier no-match audit.

Save every verified relevant link in the journal day's shared
`external_resources`, labelled by channel and deduplicated by canonical YouTube
video ID. These shared resources appear with all trades on that day; do not
insert links into individual trade notes. Read current daily notes/resources
before merging and preserve existing links and note text. Write only
`external_resources` with `PUT /journal/daily-notes/YYYY-MM-DD`; omit `notes`.
Independently read `GET /journal/daily-notes` and verify exact URLs and unchanged
notes. Do not use the backtest destination from the referenced procedure.

A verified link must be attached and read back before reporting completion.
Adequate no-match checks require no resource write and allow completion. An
unavailable or incomplete check remains explicitly unresolved; finish other
verified work and report the limitation, without inventing a link or claiming
full capture completion. Retain the per-channel coverage and candidate evidence
with the completed capture record or unresolved recovery state.
