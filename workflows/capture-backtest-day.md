# Capture backtest day

For captures and saved-pack continuations, follow the shared
[chat-title step](capture-chat-title.md) once the trading date and ticker are known.

New run files belong under `/Users/utsav/Projects/tradingview-mcp/captures/backtest/YYYY-MM-DD-run-id/`.
Never create capture folders or files on the Desktop. Keep pending packs here
for recovery; put disposable audits/scripts in the OS temporary directory.

## Replay capture from transactions — user update 2026-10-22

New replay captures generate their own position tools from the paused replay
filled-order ledger. Manual position drawings are not required and are never
used to infer execution facts. This section supersedes older manual-tool
capture instructions below for new packs; sealed old packs remain
unchanged and resumable.

- Each opening fill, including each add, is a separate backtest trade with its
  own screenshot and FIFO-allocated partial/final exits. Keep shared position
  identity and summary; do not save an additional parent trade or duplicate P/L.
  Journal-style annotation rules apply independently to each entry, using its
  own outcome and exits. Preserve reconciled lots, costs, ticks and ingestion IDs.
- Use the shared journal annotation planner/renderer: anchor at the actual first
  fill price/candle, extend through the final closing candle, use the farthest
  favorable actual closing fill as the winning target, and the final closing
  fill as the losing stop. Winners keep the 20-tick display stop; losers keep
  the in-window MFE target. Zero-result trades use the final-exit target.
- Display conventions are not historical planned risk or realized R. Verify
  instrument tick size and read back exact bands and TradingView native RR.
- Show all fills with 12-point white BUY/SELL labels on green/red backgrounds
  and nearby diagonal leaders, using exact fill candles/prices. Reuse journal
  isolation, redraw, cleanup and visual acceptance rules. Preserve user drawings.
- Release TradingView after capture/restoration; collect only supplied notes,
  preserve existing checklist selections, save through dedicated replay-fill
  ingestion and independently verify images, native RR, notes and execution facts.
  Never publish these records through manual-drawing ingestion.

Replay transactions come from TradingView; journal transactions come from the
trading app. Both use the same generated chart annotations. No replay advance,
new trading, live recapture, publication or migration is implied by editing this
workflow. Legacy manual-drawing capture is only an explicitly requested fallback.


User update, 2026-10-25: capture trades/screenshots, collect concise notes,
automatically select supported existing checklist categories, then save and
verify. Reuse broad categories for filtering and put the precise reason in
notes. Do not create new catalog items without discussion and explicit approval.
Questionnaires and research comparisons remain excluded. An explicit notes-only
or no-checklist request skips checklist selection. Journal capture uses the same checklist behavior as of 2026-10-26.

## 1. Capture and release TradingView

### MES and MNQ simulated fees — user update 2026-11-05

Use **$0.73 USD per contract per side** for new MES and MNQ replay
backtests, including dated contracts and continuous symbols. This is the total
modeled transaction cost (commission plus other execution fees), not an
additional charge on top of replay commissions. The rate was verified against
all 38 imported MES journal trades (106 fills) and Webull's MNQ order-ticket
estimate for one contract without attached exits. Other instruments require
their own verified rate; do not generalize this rate to every micro future.

User correction, 2026-11-05: calculate these fees in the trading app from the
captured TradingView transactions. Preserve the original report unchanged;
TradingView commission configuration is not a capture prerequisite. The app's
modeled costs replace reported replay costs rather than adding a second charge.
Each saved closed FIFO lot must have
`commission = quantity × 2 × 0.73` and
`net_pnl = gross_pnl - commission`, rounded to cents. Sum lots once per opening
fill, including adds and allocated partial exits. Four contracts opened and
fully closed cost $5.84, regardless of the number of exit orders. Use the
fee-adjusted net result for saved outcomes; actual captured ticks stay based on
prices alone. Read back commissions and gross/net P/L with execution facts.

Require `modeled_replay_fees:true` in the app's capture-notes registry before
publishing a modeled-cost capture. New packs record a stable `fee_model` request;
the ingestion backend independently derives fees and saves the original report,
original execution and modeled-cost provenance. Verify fill fees, each lot,
entry/position totals and fee-adjusted outcomes through API read-back.
An older sealed pack requires an explicitly authorized `fee-amendment.json`
that identifies its unchanged original snapshot hash and stable fee model.
Keep historical records unchanged unless their amendment is explicitly requested.
Finish from the saved pack after chart release.

Run the read-only backend readiness check before chart access:
`node --input-type=module --env-file=.env -e "import {preflightNotes} from './workflows/capture-notes.mjs'; console.log(await preflightNotes('backtest'))"`.
Require ready:true. This checks service compatibility only; do not analyze or
write a checklist. Identify the active tab, symbol, timeframe and Pacific replay
date once. Replay must be paused. Ask the user to leave the chart unchanged for
the brief exclusive capture window.

For futures Replay Trading, run:

```sh
node --env-file=.env workflows/backtest-freeze.mjs freeze-replay-review YYYY-MM-DD NEW_PACK
```

This compatibility command secures actual filled orders, matched FIFO lots,
flat-to-flat positions, then one entry record per opening fill (including adds),
loaded candles, drawing mapping, Pine evidence, the original
screenshot and isolated trade images. New notes-only packs do not create questionnaires. Never advance, stop, clear or trade in replay to obtain
evidence. Related entries retain a shared position_source_id and position_summary;
only entry rows contribute to totals. Partial exits are allocated FIFO to their
opening fill. Capture each entry with its own uniquely mapped long/short tool,
not just the first tool of the whole position. Require
closed, fully reconciled trades; preserve open positions, truncation and other
dates as coverage limits. Drawing geometry cannot prove historical initial risk,
stop changes or realized R. Require unique drawing matches and visible complete
entry-to-exit intervals; fail rather than invent evidence.

For drawing-based backtests, run:

```sh
node workflows/backtest-freeze.mjs freeze-chat YYYY-MM-DD NEW_PACK
```

Use a unique durable directory under `/Users/utsav/Projects/tradingview-mcp/captures/backtest/`. Do not extract chart
commentary as user notes. Preserve structural drawings and original chart state.
Screenshot isolation must show only the mapped position tool; never substitute
a full-day or duplicate frame. View annotated-start.png, day.png and every
position-N.png. Verify entry, relevant price action and zones are visible. Record
a local visual-review.json receipt. Require chart_released:true and successful
restoration before telling the user TradingView is free. Stage one makes no app
writes. Report skipped positions or capture failures; retain recovery files.

## 2. Collect concise notes from the saved pack

Whenever showing capture results, including the notes handoff and final saved
results, show each retained trade's signed net P&L in its row, with currency and
two decimal places (for example, `+$320.41 USD` or `-$27.92 USD`). Each opening
fill/add has its own FIFO-allocated P&L. Include the retained-trade total once.
For modeled-fee captures, use the fee-adjusted net amount; before publication,
label it as expected net after modeled fees, then use API-verified net after
publication. Preserve the original replay report. If net P&L is unavailable,
show `unavailable` with the reason instead of substituting gross P&L.

Show fixed numbered trade mapping, Pacific entry/exit times and net P&L. Ask for numbered
notes or explicit NO NOTE, then wait. Ordinary dictation is sufficient; do not
require entry/risk/management questionnaires or emotion questions. Preserve raw
dictation. Summarize each trade accurately in a few concise bullets or sentences,
with no headings. Do not add chart-derived intentions or unreported exit reasons.
If requested, summarize supported day-level observations briefly, without headings.
Preserve earlier notes and resources. Resolve ambiguous trade mapping without
guessing. A complete note set and finish/continue instruction authorizes saving.

After release, use only the pack and trading APIs. Never read/mutate TradingView,
restore its old view, invoke Undo, or recapture the user's new chart. Missing
frozen evidence stays unknown. New evidence needs a separately coordinated window.

Write notes-input.json with date, user_finished:true, raw_dictation, trades
containing number/source_id/text (or no_note:true), and optional daily text.
Keep exact frozen source IDs. Never overwrite a sealed input on retry; later
corrections require an amendment and fresh baseline.

## 3. Save and independently verify

For replay-fill packs:

```sh
node --env-file=.env workflows/backtest-notes.mjs PACK PACK/notes-input.json
```

The helper validates sealed evidence, requires ready:true, replay_fills:true and
replay_entries:true for per-entry packs,
publishes the dedicated replay ingestion endpoint using the original idempotency
key, saves plain trade/daily notes, preserves existing tags/resources, and reads
back exact notes, screenshot bytes, actual transactions, matched lots and P/L.
It never calls the capture-review save endpoint or creates checklist items.
The notes-only baseline and sealed input remain in the pack for recovery/retry.

After the final API read-back succeeds, a completed pack under
`/Users/utsav/Projects/tradingview-mcp/captures/` (or a legacy Desktop pack) is deleted automatically. The trading app database is
the system of record; incomplete or failed packs remain on disk for recovery.

For drawing packs, use backtest-freeze.mjs assemble with mapped notes and optional
daily text, then the existing scoped snapshot and publish commands. Do not run
verify-tags prepare/review/apply. Independently read back source-to-record mapping,
images, exact notes and preserved tags/resources. Do not report complete on HTTP
success alone. Retain recovery and retry the same pack/key after a failure.

Do not search/attach YouTube resources, perform app screen checks, export CSV
backups, run restore tests, deploy or migrate. Preserve completed records in the
trading app; clean disposable local audits after verification.
Report verified trade count, each trade's net P&L, the retained-trade net total
and notes saved, plus any actual unresolved limits.


## 4. Review and save existing checklist selections

Unless the user explicitly requests no checklist, review all active groups in
the live backtest catalog using supplied notes, reconciled executions and already
inspected frozen charts. Select only supported existing items. Prefer reusable
categories over a new item for each variation: use `Poor execution` for orders
left unchanged after new candles, and state the exact order-management failure
in notes. A losing result alone does not establish poor execution. Do not infer
unreported emotions, intent, historical stops or an add's setup from its parent.
Preserve unrelated selections and resolve contradictions with the user's notes.
Suggest a new item only if the catalog has no useful fit; never create one until
the user agrees. Completion of the notes authorizes saving supported selections.

Before running the notes publisher, retain a scoped selection plan with evidence
and fixed source IDs in an OS-temporary task directory; the notes publisher deletes
the verified pack. Retain this plan on checklist failure. Use published IDs and
API records thereafter; never return to TradingView. Read the live tag/group
catalog, each mapped trade and `GET /backtest/:id/capture-review` before saving.
Do not use legacy `PUT tags` or the old verify-tags apply path: protected checklist
keys require the capture-review checkbox API, which can return 409 on legacy writes.

Use `PUT /backtest/:id/capture-review` with `checklist_only:true`, a stable
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
execution facts for every mapped entry. Report completion only after both notes
publication and checklist verification pass. Remove temporary plans after success;
retain failure recovery. A pending catalog proposal does not block the capture.


## Explicit conversion of an existing grouped capture

Only on the user's request, use the saved parent execution ledger and a separately
coordinated capture of missing entry tools. Preserve the old sealed pack. Create
an amendment with expected_execution/notes/tags for each selected parent and an
exact source-ID mapping of child notes and isolated images. The app helper
`backend/scripts/split_replay_entries.js` converts the original row into the first
entry and inserts only its adds, inside one transaction. It preserves original
execution/notes in the first entry's provenance, shares position identity/totals,
retains existing checklist selections on the original record, and refuses
concurrent changes. Existing multi-entry structured reviews require a coordinated
amendment rather than silently copying whole-position selections onto each add.
Never duplicate the parent alongside its entries. Verify every resulting image,
note, entry/exit allocation, fee and net P/L through APIs. Preserve daily notes.
Use the confirmed commission correction when screenshot recapture reports different
simulation costs; preserve both source snapshots and document the discrepancy.

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
in nearby whitespace: `BUY|SELL quantity @ $price`, white 16-point text on green
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
