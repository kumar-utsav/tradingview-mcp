# Capture journal

For captures and saved-pack continuations, follow the shared
[chat-title step](capture-chat-title.md) once the trading date and ticker are known.

New run files belong under `/Users/utsav/Projects/tradingview-mcp/captures/journal/YYYY-MM-DD-run-id/`.
Never create capture folders or files on the Desktop. Keep pending packs here
for recovery; put disposable audits/scripts in the OS temporary directory.

User update, 2026-10-26: journal capture now follows backtest's automatic
existing-catalog checklist review after collecting user notes. Select only
supported existing items; propose missing reusable categories for the user's
choice before creating them. An explicit notes-only/no-checklist request skips
selection. Preserve unrelated selections. Questionnaires and research comparisons
remain excluded. This supersedes the 2026-10-19 ban on checklist selection.

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

## Scope

For all MES futures contracts, use `CME_MINI:MES1!` for TradingView chart
selection (user update 2026-10-22). Keep the imported broker contract symbol and
execution fills unchanged.

Enrich the selected already-imported journal trades for the requested day or
explicit dates/IDs; exclude Miss. Do not create duplicate broker trade rows,
merge identities, change financial fills/P&L/outcomes, or infer a historical
capture selection from a workflow-edit request. Dates and times are Pacific.

Each original row keeps the whole-trade chart/RR and imported financial record.
Each opening fill/add also gets an independent entry attachment with its own
FIFO-allocated exits, native tool RR, screenshot and user-supplied note. These
attachments are not additional financial trades and do not change totals.
Per-entry gross P/L is derived using the instrument multiplier. Per-entry net
P/L stays unknown when entry-level fees are unavailable; the broker's whole-row
net P/L stays authoritative. Never allocate a guessed fee or apply replay's MES
commission policy to broker imports.

## 1. Readiness and capture

Run the read-only notes backend check before accessing TradingView:

```sh
node --input-type=module --env-file=.env -e "import {preflightNotes} from './workflows/capture-notes.mjs'; console.log(await preflightNotes('journal'))"
node --env-file=.env workflows/journal-capture.mjs snapshot YYYY-MM-DD /absolute/new/run --notes-only
```

Require ready:true. This checks entry storage availability; it does not fetch a
questionnaire or tag catalog. Read chart tab/pane, symbol, timeframe, range and
paused replay state once. Preserve original drawings, view and price scale.
The full fill window must already be loaded. Do not advance replay to complete
ordinary capture. For an explicit batch, establish its requested day/cutoff and
verify loaded history before capturing.

Capture the whole imported row using the approved journal annotation helper:

```sh
node workflows/journal-annotate.mjs /absolute/run/before.json
node workflows/journal-entries.mjs /absolute/run/before.json /absolute/run/entries
node workflows/journal-annotate.mjs /absolute/run/entries/entry-snapshot.json
```

The entry snapshot contains only multi-entry rows requiring additional screenshots;
single-entry rows reuse the accepted original PNG/RR. If additional_screenshots is
zero, skip the second annotation command and omit entry_review_path.

Entry snapshot IDs are temporary annotation IDs only, mapped to immutable
`journal_id` and `entry_key`; never send those temporary IDs to journal update
routes. The original first-entry candle stays authoritative. Add views preserve
the original parent entry-to-fill candle offset as a recorded display convention,
not a verified trigger candle. Partial exits belong to the opening fill through
FIFO; use only each entry's allocated quantities in its BUY/SELL callouts.
Each entry tool extends to that entry's last allocated exit, uses its own
in-window MFE and fixed $0.50 underlying stop, and supplies its own native RR.
Unsupported futures annotation rules must remain explicit instead of inheriting
the options stop policy.

View every whole-trade and entry PNG. Require its correct single position tool,
all allocated fill callouts and diagonal leaders, unclipped readable price action,
and no free-form commentary. Correct any image now. Distinct bytes do not replace
visual review. Mark review/visibility/commentary flags only after inspection.

## 2. Restore and release the chart

Remove generated annotations, restore any temporarily hidden commentary, and
verify original symbol/timeframe/view/price scale and user drawings. Disconnect.
Create a unique durable pack under `/Users/utsav/Projects/tradingview-mcp/captures/journal/`:

```sh
node workflows/journal-pack.mjs create-notes /absolute/run/pack-config.json "/Users/utsav/Projects/tradingview-mcp/captures/journal/YYYY-MM-DD-run-id"
```

The config contains `snapshot_path`, `review_path`, `evidence_path`, `release_path`
and, for multi-entry rows, `entry_review_path` pointing to the visually accepted
entry review. Dated evidence contains cached bars/drawings/indicators plus explicit
coverage limits. Release JSON requires `chart_restored`, `user_drawings_preserved`,
`temporary_annotations_removed`, `tradingview_released` all true. The pack seals
whole-trade images, entry images, native RR, source fingerprints and exact mapping.
Single-entry rows reuse their accepted original screenshot; do not recapture them
unnecessarily. Multi-entry rows require separate reviewed entry images.

Say **TradingView is free to use** and show the fixed trade mapping plus the
nested `entry_ordered` mapping from stage.json (e.g. 1.1, 1.2). Collect supplied
notes by that mapping, without a questionnaire. No server writes at this handoff.
Repeat starts reuse a ready pending pack; new dates need a new pack.

## 3. Summarize supplied notes and save away from TradingView

Preserve raw dictation locally. Summarize the user's supplied setup/entry, stop,
management and exceptions only when actually mentioned. Use concise precise
sentences or short bullets, with no headings. Do not infer intentions, emotions,
entry confirmations or exit reasons from the chart. Summarize supported day-level
observations in daily notes; preserve existing daily notes and resources.
Each imported trade needs its concise summary or explicit no_note:true. Each
multi-entry view needs its mapped supplied summary or explicit no_note:true.
Single-entry views may reuse that trade's supplied summary. Never treat silence
as no note or silently discard supplied dictation.

Write notes-input.json:

```json
{
 "date":"YYYY-MM-DD", "user_finished":true, "raw_dictation":"Verbatim user notes",
 "trades":[{"number":1,"trade_id":123,"text":"- Concise supplied summary."}],
 "entries":[{"trade_id":123,"entry_key":"exact-frozen-entry-key","text":"- Supplied add-entry summary."}],
 "daily":"- Supported day-level summary."
}
```

For an old structured pack, require explicit notes-only direction and record
`notes_only_override:true`; preserve its original evidence/questionnaire files.
Do not perform the old questionnaire. Explicit notes-only continuation skips
checklist selection. For default capture, prepare the scoped checklist plan
below before running the save helper:

```sh
node --env-file=.env workflows/journal-notes.mjs PACK PACK/notes-input.json
```

This reads a fresh server-only baseline, validates pack/image integrity and
financial identity, checks every chart/annotation/native RR, saves per-entry
attachments and whole-trade chart/RR/notes, merges daily notes without touching
resources, and independently reads images, exact summaries, RR and imported
facts back. Tags are preserved without catalog analysis. Notes append safely
with duplicate checks; raw dictation stays in the pack. Expected revisions and
stable requests guard entry saves. A stale edit, invalid image or read-back
failure leaves recovery state and prevents a completion claim. Retry the same
pack; never reconnect to TradingView, restore the old view, or recapture the
user's new chart after release. Changed source fills require a coordinated new
capture window. No routine app screen checks, CSV exports or restore tests.

Completion is `notes-only-complete.json` with verified charts/native RR/notes,
entry attachments, daily notes/resources and preserved financial fields/tags.
The notes publisher preserves tags; checklist selections are a separate verified
API step below. Its completion file alone does not establish checklist completion.
Keep completed records and unresolved
recovery; clean only disposable task files after verified save. Workflow-only edits make no live
capture writes and do not backfill historical journals.

Journal entry structure is broker-owned: preserve every imported opening fill or
add as its own linked entry. Never consolidate broker entries into a synthetic
whole-trade entry. Capture one entry-specific chart attachment for each linked
entry; the whole trade remains visible through the linked entry set.

After the final API read-back succeeds, a completed pack under
`/Users/utsav/Projects/tradingview-mcp/captures/` (or a legacy Desktop pack) is deleted automatically. The trading app database is
the system of record; incomplete or failed packs remain on disk for recovery.

## 4. Review and save existing checklist selections

Unless the user explicitly requests no checklist, review all active groups in
the live journal catalog using supplied notes, imported broker fills and already
inspected frozen charts. Select only supported existing items. Prefer reusable
categories over a new item for each variation: use `Poor execution` for orders
left unchanged after new candles, and state the exact order-management failure
in notes. A losing result alone does not establish poor execution. Do not infer
unreported emotions, intent, historical stops or an add's setup from its parent.
Preserve unrelated selections and resolve contradictions with the user's notes.
Suggest a new generic, reusable item only if the catalog has no useful fit.
Show its label, group and description, and offer to add it or retain the specific
detail in notes only. Never create it until the user explicitly agrees.
Completion of the notes authorizes saving supported selections.

Before running the notes publisher, retain a scoped selection plan with evidence
and fixed imported trade IDs in an OS-temporary task directory; the notes
publisher deletes the verified pack. Retain this plan on checklist failure.
Use the frozen imported IDs and API records thereafter; never return to TradingView. Read the live tag/group
catalog, each mapped trade and `GET /journal/:id/capture-review` before saving.
Do not use legacy `PUT tags` or the old verify-tags apply path: protected checklist
keys require the capture-review checkbox API, which can return 409 on legacy writes.

Use `PUT /journal/:id/capture-review` with `checklist_only:true`, a stable
`request_id`, and the freshly read `expected_revision`, `evidence_fingerprint`
and `trade_fingerprint`. Preserve the existing document; if absent, use the
frontend checkbox document shape (version 1, pack_id, source_id, blankAnswers,
empty references/observations/exceptions). Only update `answers.setup` and
`answers.confluences` for supported seeded choices; put selected custom keys in
`checklist_tags`. Read the owning frontend/backend implementation if its schema
has changed. Do not populate questionnaires, attach evidence for research, change
detailed review answers, or overwrite notes through this checkbox operation.
On a revision conflict, reread and reconcile; do not force an overwrite.

Independently read back exact checklist selections, unchanged notes, RR and
execution facts for every imported trade. Report completion only after both notes
publication and checklist verification pass. Preserve imported broker IDs,
fills, quantities, P/L, outcomes, screenshots, native RR and daily resources.
Remove temporary plans after success; retain failure recovery. A pending catalog proposal does not block the capture.

Use one checklist review per original imported trade; whole-trade capture does
not split financial rows or create entry attachments. Existing pending packs
keep their sealed evidence. A workflow edit alone does not apply selections to
today or any historical trade. On an authorized continuation, use the frozen
pack and server APIs only, with the same default review unless the user requests
notes only/no checklist. Do not rewrite the sealed pack or access TradingView.

## 5. Annotation rules and early screenshots

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

The helper uses the same fail-closed position-isolation checks as backtest
capture. It temporarily hides other Long/Short tools, verifies the current
tool and every generated fill callout/leader are visible, and requires actual
redraw rather than treating a timeout as success. It compares in-memory PNG
hashes against a tools-hidden control, a multi-tool control when present, and
previous accepted trade images. Repeated frames get at most three attempts;
invalid, stale or duplicate images remain unresolved, never day-image fallbacks.
Only an accepted PNG is written to the run directory. It restores prior tool
visibility and attempts removal of every generated mark, independently checks
none remain, and stops remaining captures on screenshot/restoration/cleanup
failure. Retain recovery state and coordinate a new capture window; never seal,
publish or announce successful release from a partial/failed run. New packs also
reject identical images assigned to different trades; existing sealed packs are
not rewritten. These checks apply to ordinary, batch and legacy screenshot
passes that use this helper, and do not change RR, annotations or notes rules.

View each final PNG before accepting it: exactly one matched position tool,
every required fill callout and leader, no other trade's temporary marks, no
free-form commentary, and readable entry/exit context. Distinct hashes and
successful read-back do not prove rendered correctness. Do not set review flags
or claim TradingView is released without this check and restoration verification.

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
   imported option price (for example `BUY 2 @ $0.95`). Use 12-point white text,
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
