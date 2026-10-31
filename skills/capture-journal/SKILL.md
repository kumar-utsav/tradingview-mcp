---
name: capture-journal
description: Capture one chart per imported journal trade with native tool RR, release TradingView, collect concise notes, select supported existing checklist items, then save and verify. Use for capture journal, capture journal day, batches and pending continuations.
---

# Capture Journal

Create new capture runs under `/Users/utsav/Projects/tradingview-mcp/captures/journal/YYYY-MM-DD-run-id/`.
Never create capture folders, screenshots, notes or audit files on the Desktop.
Keep unfinished packs for recovery; delete completed packs only after API verification.

Operate in `/Users/utsav/Projects/tradingview-mcp`. Read the maintained
[capture-journal.md](/Users/utsav/Projects/tradingview-mcp/workflows/capture-journal.md).
Keep disposable scripts and audits in the OS temporary directory.

User update, 2026-10-26: after collecting notes, automatically review the existing
journal checklist against supplied notes, imported fills and frozen charts, using
the same behavior as backtest capture. Reuse supported existing categories so
later filtering groups comparable trades. Keep the specific reason in concise
notes: for example, select `Poor execution` for orders left unchanged after new
candles; do not create a separate item for each execution mistake. Propose a
new, generic reusable item only when no existing category fits usefully. Show
its proposed label, group and description, and give the user the choice to add
it or keep the detail in notes only. Never create it without explicit agreement.
Preserve unrelated existing selections. Follow the maintained workflow's
checklist-only API save and read-back procedure. An explicit notes-only or
no-checklist request skips selection. Questionnaires and research comparisons
remain excluded. This supersedes the 2026-10-19 ban on journal checklist selection.

Summarize only supplied notes precisely, without headings; short bullets are
allowed. Preserve raw dictation, existing notes and daily resources. Silence is
not NO NOTE. Explicit finish/continue with complete mapped notes authorizes
saving notes and supported existing selections without another confirmation.

## One chart per journal trade — user correction 2026-10-22

For new journal captures, capture exactly one chart per imported trade showing
ALL its opening fills, adds, partial exits and final exit. Do not create separate
entry screenshots or require separate entry notes/RR. This supersedes all older
per-entry view and attachment requirements below. Keep broker entries and fills
intact; do not consolidate financial records. New packs use `trade_chart_only:true`
and save the whole-trade chart/RR/notes, without writing entry-capture attachments.
Do not run journal-entries.mjs for new captures. Older sealed packs are retained
unchanged for recovery; an explicitly authorized recapture creates a replacement
pack. This correction applies to journal capture, not backtests.

## Current annotation rules — user update 2026-10-22

These rules supersede older font and futures MFE/fixed-stop instructions below
for newly generated journal annotations. Do not rewrite already sealed packs.

- Always map every MES contract to `CME_MINI:MES1!` for chart selection; retain
  imported broker symbols, fills, quantities and financial records unchanged.
- Use 12-point white BUY/SELL text on green/red content-sized backgrounds.
  Prefer short diagonal leaders and nearby whitespace. Try compact positions
  first; expand only as needed. No text overlap, clipping, covered fill anchors,
  crossed leaders, or leaders passing through another label. Arrange labels
  jointly across all trades when leaving a combined live chart annotated.
- Futures tools start at the actual opening fill price/candle. Every tool's
  right edge is the final closing fill candle, including partial-exit trades.
  Winning trades use the farthest favorable actual closing fill as the target
  band (lowest BUY exit for shorts, highest SELL exit for longs), not the final
  exit price or MFE. The right edge still extends to the final closing candle.
  Losing trades use the final exit fill price as the stop band. Winners retain
  the 20-tick display stop; losers retain the in-window MFE target. Zero-result
  fills use a final-exit target. These are display conventions, not realized R.
- Whole-trade outcome comes from the imported result when supplied. Independent
  entry views use their own FIFO-allocated fills and gross result; never inherit
  the parent's outcome. If the selected band fill lies on the wrong side of the opening
  anchor for that outcome, stop and report the conflict rather than inventing
  a level or changing imported facts.
- Read back exact band prices, tick conversion, final candle and refreshed native
  RR after every geometry change. Visually inspect the result. Cache MFE separately
  even when the displayed target uses the final exit. New futures evidence records
  `position_policy: farthest_exit_v2`, the changed band and final fill price.
  Zero-result trades retain the final-exit target. Preserve sealed older policies.
  When correcting saved screenshots, update native RR to the corrected tool
  value and independently verify screenshots/RR while preserving notes,
  checklist selections, daily resources and imported financial records.
- Option fills are premium prices, so they cannot define an underlying chart band.
  Keep option journal entry/stop/MFE price rules; apply the smaller, nearby,
  non-crossing label layout to them too. Backtest tools remain unchanged.
- Default capture still removes generated annotations and releases the chart.
  Leave annotations on the live chart only when explicitly requested. Changes
  after release do not amend an existing sealed journal pack automatically.

## Journal identity and per-entry views

User update, 2026-10-22: always use `CME_MINI:MES1!` as the TradingView chart
for every MES futures contract, including dated broker symbols. Preserve the
original imported contract symbol and execution fills; only chart selection maps
to continuous MES.

Imported broker rows, IDs, fills, quantity, P/L and outcome remain authoritative.
Do not split or duplicate those financial rows. Attach independent entry views
(one opening fill, including each add) to the original row. Allocate exits FIFO;
each entry gets a separate position-tool PNG, native RR and supplied note.
Overall imported net P/L remains counted once. Show derived per-entry gross P/L
as gross; leave per-entry net unknown when the import has no entry-specific fees.
Never apply the MES replay commission setting to unrelated broker imports.

Use `journal-entries.mjs` to prepare temporary annotation views. Preserve the
original stored entry candle for the first entry; add views use the same offset
between the first fill candle and stored entry candle as the original parent.
Record that as a display convention, not a verified trigger. Every view retains
journal's fixed $0.50 underlying display stop, in-window MFE target, native RR,
and all allocated fill callouts. Unsupported instrument policies fail explicitly;
do not apply the option/underlying stop rule to futures.

## Capture first, save without TradingView

1. Run `capture-notes.mjs` notes-only readiness check before chart access. Freeze
   imported day/ID selection and immutable fill facts. Capture whole-trade and
   each entry's tool, fill callouts, native RR and dated evidence. Visually inspect
   every PNG; correct unclear captures before release.
2. Remove only generated annotations, restore/verify original chart/drawings,
   and disconnect. Seal with `journal-pack.mjs create-notes`, including the
   accepted entry review. Give fixed trade and entry ordinals and say
   **TradingView is free to use**. Pause for notes. No journal writes yet.
3. On continuation, use `journal-notes.mjs` with the saved pack and mapped note
   summaries. It saves images/RR/notes and entry attachments, preserves imported
   facts and tags, and independently reads back each result. Retain the scoped
   checklist plan outside the pack before publishing (the publisher deletes a
   verified pack), then save and verify checklist-only selections as described
   in the maintained workflow. Never access or restore TradingView after release.
   Failed saves remain resumable.

Existing pending packs keep their sealed evidence; explicit notes-only completion
can bypass an old questionnaire without generating tags. Do not rewrite old
sealed files. Repeated starts reuse a pending pack. No historical capture is
selected just because this workflow is being edited.

Explicit multi-day batches may omit the notes handoff when requested, but never
invent notes; preserve existing notes, mark absent supplied commentary explicitly,
and follow the same image, native RR, imported-fact and save checks. Use the
requested dates/IDs and 09:00 Pacific cutoff unless the user specifies otherwise.

Do not search for videos, perform routine trading-app screen checks, export CSV
backups, run restore tests, backfill history or migrate/deploy during a capture.
Workflow/feature development is separate from executing a live capture.

## Approved annotation rules

Start the long/short position tool on the trade's stored `entry_candle` in Pacific
time, using that candle's HIGH for a Call or LOW for a Put. On the current
1-minute imports this is the candle before the first fill. Use the stored field
as the source of truth; do not shift BUY/SELL markers off their actual fill
candles, and do not add seconds to their note text.

For the whole-trade tool, extend through the final closing fill. For each entry
view, extend through the last FIFO-allocated exit for that opening fill. Its right edge must never
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

Use **12-point, white text** in content-sized green BUY and red SELL callouts.
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

## Required position-tool RR

Every captured trade and entry must retain the exact RR displayed by its uniquely
mapped TradingView long/short position tool. Read the native label during stage
one, before chart release, and store the drawing ID, label, compact flag, numeric
value and source as evidence. Refresh the read after tool changes. Copy that
numeric value into the saved Details `rr` and independently read it back during
stage two. Zero is valid; blank or unreadable RR prevents completion. Never
substitute a ratio calculated from fills, P/L or tool geometry. This is displayed
tool RR, not verified historical initial risk or realized R. Preserve sealed
older packs; missing native evidence requires a coordinated amendment, never
silent recapture after chart release.

## Actual captured ticks — non-option trades only

Capture actual entry-to-exit ticks for non-option trades, using verified instrument
tick size and direction-aware, FIFO-matched execution fills. Weight partial-exit
moves by their allocated quantities: sum(quantity × signed price move / tick size)
divided by total closed quantity. This is the price move per contract; retain
contract-ticks separately, never multiply the displayed move by position size.
Preserve each exit lot's ticks, prices and quantity as evidence. Keep losses
negative and breakeven zero; fractional weighted averages are valid. Adds have
separate entry metrics; position totals use every matched lot once.

Replay capture seals `tick_capture` in each entry's execution evidence and saves
an explicit actual-move line in trade notes, independently verified on read-back.
Do not use tool targets, MFE, RR, commission-adjusted P/L or dollar multipliers to
infer actual ticks. Without actual underlying/instrument fills and verified tick
size, leave actual ticks unavailable with a reason; drawing geometry is insufficient.
Option journal trades are explicitly excluded: add no tick metric or placeholder
entry for them. Futures journal tools use the separately specified 20-tick policy;
do not substitute the option annotation policy. Do not backfill or
rewrite older sealed captures automatically.

## Exact futures fill annotations

For futures, anchor every BUY/SELL callout leader at the actual fill price on its
actual chart candle (bucket fill time to the chart resolution). Do not move the
anchor to a candle high/low or infer a price from the position tool. Text stays
in nearby whitespace: `BUY|SELL quantity @ $price`, white 12-point text on green
or red. A short diagonal leader may cross its own fill candle to reach the exact
price; keep neighboring candles, other anchors and label text clear. Preserve
separate fills even within the same candle. Per-entry captures use only that
entry's FIFO-allocated quantities and exits.

Read back exact anchor time/price and label text before screenshots. Inspect all
PNGs before release; failed placement remains incomplete. Remove only generated
annotations in finally, verify removal and original chart restoration, and keep
annotation receipts in the sealed pack. Replay capture uses
`futures-fill-annotations.mjs` through per-trade isolation hooks. Option journal
annotations retain their current wick-based anchoring because option premium
fills are not underlying chart prices. Futures journal tools use the 20-tick stop policy below; never apply the
option $0.50 stop policy to futures.

## Futures journal stop — user update 2026-10-20

Use a fixed 20-tick display stop for futures journal long/short tools. Read and
verify tick size from the actual futures chart metadata; stop distance is
20 × tick size (MES: 5 points). Long stops are below actual opening fill price;
short stops are above it. Start the tool on the actual first-fill candle at its
exact fill price, including each add's independent entry view. Extend through
the final allocated exit and retain the in-window MFE target. Read native tool
RR after final geometry. Label every fill at its actual price/candle. Preserve
option journal conventions, imported fills, P/L and actual order stops. This is
an annotation/RR convention, not proof of the historical stop or realized R.
Backtest tools retain their existing user-drawn stop/target; this default applies
to generated futures journal tools.
