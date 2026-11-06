---
name: capture-backtest-day
description: Capture TradingView backtest trades and screenshots, release the chart, collect concise notes, select supported existing checklist items, then save and verify. Use for capture backtest, capture backtest day, dictation variants, and pending capture continuation.
---

# Capture Backtest Day

For captures and saved-pack continuations, follow the shared
[chat-title step](/Users/utsav/Projects/tradingview-mcp/workflows/capture-chat-title.md)
once the trading date and ticker are known.

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


Create new capture runs under `/Users/utsav/Projects/tradingview-mcp/captures/backtest/YYYY-MM-DD-run-id/`.
Never create capture folders, screenshots, notes or audit files on the Desktop.
Keep unfinished packs for recovery; delete completed packs only after API verification.

Operate in `/Users/utsav/Projects/tradingview-mcp`. Read and follow
[the maintained workflow](/Users/utsav/Projects/tradingview-mcp/workflows/capture-backtest-day.md).

For MES/MNQ costs, follow the maintained workflow's **MES and MNQ simulated
fees** section: apply and verify modeled per-contract fees in the trading app
from captured transactions, preserve the unchanged TradingView report, and
verify saved net P/L. TradingView commission settings are not a prerequisite.
Existing sealed packs require an explicit amendment rather than a silent rewrite.

User update, 2026-10-25: after collecting notes, automatically review the existing
checklist against the supplied notes, reconciled fills and frozen charts. Reuse
supported existing categories so later filtering groups comparable trades.
Keep the exact reason in concise notes: for example, select `Poor execution`
and write that entry and stop/exit orders were not updated after new candles
formed. Do not create a separate item for each execution mistake. Propose a new
item only when no existing category fits usefully, and discuss it with the user
before creation. Preserve unrelated existing selections; do not infer an add's
setup from its parent. Follow the maintained workflow's checklist-only API save
and read-back procedure. This supersedes the 2026-10-19 ban on backtest checklist
selection; questionnaires and research comparisons remain excluded. An explicit
notes-only/no-checklist request still skips selection. Journal uses the same checklist behavior as of 2026-10-26.

Summarize each supplied trade note precisely, without headings; short bullets
are allowed. Preserve raw dictation locally. Never infer missing intentions,
stop changes, exit reasons or emotions. Add a short daily summary when requested
and supported by the notes. Preserve existing notes and daily resources.

Secure immutable evidence and isolated screenshots first; visually inspect each
image and verify restoration before releasing TradingView. After release, never
access or restore the live chart. Resume from the saved pack. Futures replay
first reconciles actual fills into FIFO flat-to-flat positions, then saves one
reviewable trade per opening fill, including each add. Partial exits stay with
their allocated opening fill. Link related entries with position_source_id and
position_summary; never count an additional parent row. Each entry requires
its own uniquely mapped long/short tool and isolated image. Never publish replay fills through drawing ingestion. Require the
fill-aware backend. Save with the original idempotency key and independently
verify notes, images, execution facts and preserved tags through APIs.

Do not search for videos, open the trading app for screen checks, export CSV
backups, run restore tests, deploy, migrate or backfill during capture. Retain
recovery on failure; do not claim success until read-back passes.

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
