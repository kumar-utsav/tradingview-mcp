# Capture backtest day

User update, 2026-10-17: omit the emotions prompt in backtest reviews and mark
those answers skipped. Regular journal reviews retain the emotions prompt.
The four backtest prompts are entry, risk, management and exceptions; this
supersedes five-prompt references below for backtest only.

**New captures use structured review v1**, approved on 2026-10-16. Before
accessing TradingView, run `node --env-file=.env workflows/capture-review.mjs preflight backtest`
and require `ready:true`. Follow [capture-review.md](capture-review.md) for the
conditional questions, optional exception bullets and save flow. Use
`backtest-freeze.mjs freeze-review DATE NEW_PACK` to select v1 explicitly.
It supersedes the prose-note handoff and legacy tagging below; chart safeguards
remain unchanged. Existing pending packs keep their recorded version.

## Futures Replay Trading: fills and grouped trades

When the chart is futures and the user executed Replay Trading orders, use
`freeze-review` (automatically routes futures) or explicitly:

```sh
node --env-file=.env workflows/backtest-freeze.mjs freeze-replay-review YYYY-MM-DD NEW_PACK
```

This starts with a **local capture phase**. It reads the active chart's
`_replayApi.replayStrategyFacade().reportData()` and `filledOrders`, not
`replay_status.position`/`realized_pnl` (which can be null despite a populated
Replay Trading report), broker orders, or Strategy Tester results. Replay must
be paused. Never advance, stop, restart, clear or trade to obtain data.

Capture three separate layers:

1. One review trade per flat-to-flat position episode, with signed position
   after each fill; additions and partial exits stay inside that trade. Reversals
   split closing/opening quantities while retaining the original order ID.
2. Every unique filled order with source ID, timestamp, sequence, side, size,
   price, type and comment. Same-time fills retain replay sequence, not UI sort.
3. Every matched entry/exit lot and its recorded P/L/commission, independently
   reconciled to FIFO fills, symbol point value, position and report totals.

Group the complete available report before selecting the Pacific entry date.
Preserve other-date coverage, open positions and report truncation as limits;
do not infer a flat start at midnight. This implementation completes captures
only for closed positions, same account/symbol currency and fully reconcilable
FIFO reports. Unsupported reports retain recovery and fail without success.

The helper secures `replay-raw.json`, the original full screenshot,
`recovery.json`, loaded chart evidence and per-study Pine graphics. It maps each
trade to one unique position drawing by direction and time overlap, records
that mapping as derived evidence, and uses the existing screenshot isolation
and restoration checks. Drawings need to span the first actual fill; ambiguous,
missing or reused drawings fail rather than fabricate a match. The complete
entry-to-exit interval must already be visible. After viewing all isolated
images, record a local visual-review receipt and release TradingView. From that
point continue exclusively from the pack.

`ledger.json`, `report.md` and `frozen.json` preserve actual fills, weighted
prices, contracts entered, peak size, matched lots and gross/net replay P/L.
The checksum-bound ready marker seals evidence and screenshots. One campaign
counts once in win/loss statistics, regardless of matched-row count. Native
planned RR and drawing geometry remain separate: position-tool distances use
the symbol tick size, not a universal `/100`. Current geometry cannot prove
initial stops, stop changes, intended targets or initial cash risk. Realized R
stays null without documented initial cash risk. Do not infer emotions or
management intention from order comments. Zero recorded commission is the
replay configuration, not proof of realistic trading costs.

Collect the same five shared prompts in the saved `review-input.json`; preserve
dictation and supplied intent. Local `capture-review.mjs assemble` works with
this sealed pack after the user finishes. The SPY fixed-stop research comparison
is unavailable for futures until a validated instrument policy exists.

**Publish only after backend capability verification.** The registry must report
`ready:true` and `capabilities.replay_fills:true` after migration
`019_replay_backtest_executions.sql` is installed. Run the normal structured
`assemble` and `publish` commands; the publisher takes the app recovery snapshot,
sends the sealed source report and isolated screenshots to
`/ingestion/backtest/replay`, verifies actual fills/lots/P&L by source ID, then
saves and independently reads back the structured reviews. It uses the original
idempotency key and persists exact retry requests. Retries return unchanged
records; changed execution facts require an explicit correction instead of
overwriting history. No chart access occurs after release.

The backend independently derives flat-to-flat episodes from the source report,
stores immutable `replay_execution` JSON with instrument metadata, fills, matched
lots and raw source orders, and keeps planned stop/target/RR unset. App records
use Long/Short direction. The Transactions tab shows actual exposure changes and
expandable matched lots. Dedicated replay P/L, fill-count and peak-size filters
never apply option multipliers or invent facts for legacy drawings. CSV backup
includes the JSON, review evidence and revisions. Verify the visible Checklist,
Transactions tab, filter/statistics and isolated backup round trip before
marking a deployed capture complete.

If capability verification fails, report “local evidence secured; app save
pending deployment,” never “saved/complete.” Legacy ingestion rejects replay
packs. Do not turn fills into journal broker records, Call/Put records, prose
notes or unrelated tags. Deployment and live database migration are separate
from capture; never improvise them during a routine capture.

## Legacy compatibility instructions and unchanged chart safeguards


## Stage 1: capture all trades, then wait for chat notes

Read TradingView state once to identify the chart date, ticker and timeframe.
Ask the user to keep the chart unchanged only for the brief capture phase. Do
not start app snapshots or tag review yet. From this project,
freeze into a new, unique audit directory:

```sh
node workflows/backtest-freeze.mjs freeze-chat YYYY-MM-DD backtest-captures/YYYY-MM-DD-HHMMSS
```

The helper captures `annotated-start.png` first, then freezes structural drawing
geometry, loaded OHLCV and Pine graphics in `recovery.json`. It captures `day.png`
and isolated `position-N.png` images, restores position visibility, and durably
writes `frozen.json`, `chart-evidence.json`, `pending-notes.json` and the
checksum-bound `chart-ready.json`. It does not extract, assign or delete chart
commentary; captured notes start empty. Existing commentary may be visible in
images but must not be read as user notes. Structural zone/level labels remain
usable evidence. A failed phase must not release the chart or claim success.
Report skipped positions rather than silently declaring all trades captured.

Isolation must fail closed: verify position visibility, wait for actual redraw,
and compare each image with a tools-hidden control, earlier trade images, and
the original day image when it had multiple visible tools. The helper retries
repeated frames at most three times, restores visibility, and stops without
sealing a successful pack if checks fail. Never substitute the day image.

Before announcing release, actually view every local `position-N.png`. Each must
show only its mapped Long/Short tool, with entry, relevant price action and zones
visible. Distinct bytes and API visibility checks alone are not visual proof.
If any image still shows multiple tools, the wrong trade or no tool, report the
failed capture and retain recovery files; do not publish, accept it as a fallback,
or claim successful capture. A retry after release requires a new coordinated
chart window; do not touch the user's new chart work.

After a successful result with `chart_released: true` and this image check, send:
"All captured trade evidence is secured—you can move on in TradingView now.
Nothing has been saved to the server yet. Send your numbered notes below."
Present the fixed numbered list from `pending-notes.json`, including direction,
ticker and entry/exit times (use the frozen Pacific times; do not reinterpret
already formatted candle times).
Ask for `1: ...`, `2: ...`, optional `DAY: ...`, and explicit `N: NO NOTE` for any
trade intentionally without notes. Then END THE TURN and wait. Do not perform
ingestion or tag writes before receiving complete notes. There is no promise of
zero delay: all required live-chart evidence must finish before release.

## Stage 2: assemble chat notes and save from the pack

On continuation, locate the matching pending run and confirm its date and
numbered mapping. If multiple runs could match, ask which one. New chart work
does not invalidate a captured pack. An explicit new capture uses a new pack;
never overwrite an earlier pending run. Preserve partial chat notes and ask only
for missing or ambiguous numbers. Silence is not NO NOTE. Do not substitute
chart commentary or invent note text. A note-only follow-up resumes the pending
capture; it does not authorize capturing today's newly visible chart.

From release onward, NEVER read/mutate the live chart, move replay, restore the old
view, or invoke Undo. Do not call `capture_backtest_day` to publish or retry: it
would capture the user's next chart. Once all captured trades have explicit
notes or NO NOTE, create a local `notes-input.json` using the exact source IDs
from `pending-notes.json` and the user's verbatim text:

```json
{
  "date": "YYYY-MM-DD",
  "trades": [
    {"number": 1, "source_id": "exact-frozen-source-id", "text": "User's notes"},
    {"number": 2, "source_id": "another-frozen-source-id", "no_note": true}
  ],
  "daily": "Optional DAY note from chat"
}
```

Do not invent a daily note when none was supplied. The assembler requires exact
date, unique mapped numbers, full coverage, and nonempty notes or explicit
`no_note: true`. It seals `chat-notes.json`, `assembled.json` and
`notes-ready.json` without accessing TradingView or the server. Only notes and
the daily note may change; screenshots, trade facts and the retry key stay fixed.
Assemble only after notes are complete. Sealed files are immutable; preserve
them on errors and inspect a partial seal before retrying, never overwrite it
or silently recapture. Before publication, any requested note revision needs
an explicitly coordinated replacement assembly; never reuse a published key
with changed notes.

Take the app's pre-ingestion recovery snapshot in the SAME frozen directory,
then publish the assembled bundle:

```sh
node workflows/backtest-freeze.mjs assemble /absolute/run/directory /absolute/run/directory/notes-input.json
node workflows/verify-tags.mjs snapshot YYYY-MM-DD /absolute/run/directory
node workflows/backtest-freeze.mjs publish /absolute/run/directory
```

The snapshot batches records, live catalog/groups, daily notes/resources, and
bounded parallel recovery-image reads into `before.json`; do not publish unless
it succeeds. Publishing validates the ready marker, bundle checksum and snapshot
date and complete sealed chat notes, then sends saved images/notes with the
original idempotency key. Retain all
recovery files on failure and retry publishing the SAME bundle/key, not a new
chart capture. Rejected/duplicate trades can produce
`note_recovery_required`; report this and retain the chat notes locally.
Restoration after release requires explicit user direction, never automatic
Undo over new chart work. Existing pending legacy `freeze` chart-notes runs may
finish in their original mode; all new runs use `freeze-chat`. Resolve skipped
positions, ambiguous notes and
duplicates without guessing. Next create the post-capture review manifest:

```sh
node workflows/verify-tags.mjs prepare YYYY-MM-DD /absolute/run/directory
```

Use `review-context.json` for a compact review packet: dated trades, notes,
resources, every active checklist group's full tag meanings and selection mode,
and any saved legacy tags. Keep the complete catalog in `current.json` as the
source of truth. View each saved image individually; a compact packet is not a
substitute for chart inspection. Use `review.template.json`; do not refetch the
catalog, full record list, or chart state unless something changes. Inspect saved
evidence first, using only the frozen chart evidence after release. This
workflow covers all dated records, including unchanged trades. Invocation permits
its capture/tag updates, not broker orders, commits, or deployment.

## Evidence review

Actually view `annotated-start.png`, `day.png`, each `position-N.png`, and every
saved app trade image; read every supplied chat trade note and daily note, and
structural chart labels. Do not read chart commentary as trade/daily notes.
Downloads are not inspection. Match each record to entry time and drawing.
Charts must show enough pre-entry history, entry, zones, and relevant levels. A
1m image cannot prove a 2m trigger. If an image is absent, retry
`GET /backtest/:id/image`; the MCP missing-image flag was incorrect in the
2026-09-21 reference run.

Use `chart-evidence.json` for frozen Pine boxes/lines/labels, original manual
drawing metadata and bars. Bars are arrays of Unix seconds, open, high, low,
close, volume, bounded to 5,000 loaded bars from the target day and latest loaded
earlier date. `previous_loaded_date` is not proof of a complete previous session;
check `bars_truncated`, `history_note`, and unavailable graphics. Missing history,
hidden studies, absent timeframes and cross-market evidence stay unknown. Never
use today's levels or the user's new chart for historical trades. If further
live evidence is essential, ask for a separate targeted capture; do not silently
reacquire the chart after release.

Use current catalog meanings, descriptions, and selection modes—not keywords or
an arbitrary tag count. `BnR` shorthand alone proves no required evidence item.
Review every active checklist group with supported
selection(s) or an explicit unknown/not-applicable reason. Record evidence for
each selected tag. Preserve corrections and flag conflicts; never silently
replace the manually reviewed baseline.

Apply these reviewed invariants:

- Setup validity is independent of P/L: a valid loss and invalid winner are both
  possible. Invalid requires a specific issue; otherwise use unclear.
- Continuation requires established directional structure; reversal requires a
  failure/change of control. Primary location is the one thesis-driving zone.
- Confluence requires the entry candle touching an active level/zone. Nearby
  obstacles, indicator pivot boxes, SPY images, or profit do not prove manual
  confluence, SPX alignment, displacement, or setup quality. Attribute unverified
  SPX statements to notes.
- Live displacement means an independent candle closed wholly beyond the entire
  zone before retest. Weak displacement can coexist with a valid close.
- Pullback/retest needs leave-and-return; a wick alone proves none of failure,
  hold, or trigger confirmation. Do not use future-confirmed pivots.
- Determine market regime pre-entry; later action cannot rewrite it. Record
  opposing momentum, obstacle room, congestion, and premature entry from evidence.
- Attempt count/reentry is per same zone and thesis. Hypothetical reentries and
  later “worked” behavior are not the actual setup or maintained outcome.
- Zone origin/tests, trigger mode, HTF/cross-market alignment each need their own
  evidence. Count visits, not overlapping candles; empty groups are not negatives.
- Known reference-image limits remain evidence limits: records 44-45 have menu
  overlays; many session labels are hidden. Retain supported user tags rather
  than claiming unseen pixel evidence.

## Save, verify, and finish

Complete `review.template.json` as `review.json`. Keep `expected_tags` and
`expected_notes` unchanged, set `chart_reviewed` only after inspection, fill every
active `group_review`, and supply concrete evidence for every final tag.
If the captured day has no records, report it and stop instead of inventing a
manifest.

```sh
node workflows/verify-tags.mjs validate /absolute/run/review.json /absolute/run/current.json
node workflows/verify-tags.mjs /absolute/run/review.json --apply
```

Validate the plan locally first, using the fresh prepared snapshot; this avoids
four redundant network reads from the old live dry-run. Offline validation
reports `live_verified: false` and must never be presented as a save or current
server verification. Apply still reloads live records/catalog, validates the
whole plan, rechecks each changed trade immediately before writing, and reads
exact notes/tags back independently. The legacy live dry-run remains available
by omitting `validate` and `--apply`. The helper rejects stale notes/tags, unknown/duplicate keys,
single-select conflicts, contradictory ranges, invalid-without-issue, and
incomplete group review. It writes only `tags`, rechecks for concurrent edits,
then independently reads exact tags and notes back. Save command outputs in the
run directory automatically; HTTP success alone is not verification. Serialize
chart changes, writes, and concurrent-edit checks; parallelize independent
read-only checks only.

## Resources and completion

Do not search for, verify, or attach videos from YouTube channels during capture.
The frozen publisher performs no automatic video lookup. Do not invoke legacy
capture helpers that automatically look up videos; publish the frozen bundle.
Preserve existing daily resources unchanged; do not clear them or send an empty
resources list. Missing videos and skipped video searches do not block completion.

Report trade count, verified charts/notes/tags and specific unresolved chart
evidence. API base defaults to `http://100.125.89.9:5555`; set `TRADING_API_URL`
if live verification finds a different endpoint.
