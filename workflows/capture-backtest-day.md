# Capture backtest day

## Fast, safe execution

Read TradingView state once to identify the chart date, ticker and timeframe.
Ask the user to keep the chart unchanged only for the brief capture phase. Do
not start app snapshots or tag review yet. From this project,
freeze into a new, unique audit directory:

```sh
node workflows/backtest-freeze.mjs freeze YYYY-MM-DD backtest-captures/YYYY-MM-DD-HHMMSS
```

The helper captures `annotated-start.png` before cleaning assigned notes. It
saves original drawing text/geometry, notes, loaded OHLCV and Pine graphics into
`recovery.json` before any note removal. It then captures the clean `day.png` and
isolated `position-N.png` images, restores position visibility, durably writes
`frozen.json` and `chart-evidence.json`, finalizes note cleanup, and writes the
checksum-bound `chart-ready.json`. A failed phase must not release the chart or
claim capture success. Numbered text notes map to chronological trades, `DAY:`
text maps to the daily note, and ambiguous assignments/skipped positions remain
reported rather than guessed.

Immediately after a successful result with `chart_released: true`, send:
"Chart evidence secured—you can move on in TradingView now. Saving and review
continue from the captured material." This means the local evidence is safe,
not that ingestion or tag review has finished. There is no promise of
zero delay: all required live-chart evidence must finish before release.

From this point, NEVER read/mutate the live chart, move replay, restore the old
view, or invoke Undo. Do not call `capture_backtest_day` to publish or retry: it
would capture the user's next chart. Take the app's pre-ingestion recovery
snapshot in the SAME frozen directory, then publish the frozen bundle:

```sh
node workflows/verify-tags.mjs snapshot YYYY-MM-DD /absolute/run/directory
node workflows/backtest-freeze.mjs publish /absolute/run/directory
```

The snapshot batches records, live catalog/groups, daily notes/resources, and
bounded parallel recovery-image reads into `before.json`; do not publish unless
it succeeds. Publishing validates the ready marker, bundle checksum and snapshot
date, then sends saved images/notes with the frozen idempotency key. Retain all
recovery files on failure and retry publishing the SAME bundle/key, not a new
chart capture. Rejected/duplicate trades with removed notes produce
`note_recovery_required`; report this and retain the original notes locally.
Restoration after release requires explicit user direction, never automatic
Undo over new chart work. Resolve skipped positions, ambiguous notes and
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
saved app trade image; read every trade note, daily note, and chart
text. Downloads are not inspection. Match each record to entry time and drawing.
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
