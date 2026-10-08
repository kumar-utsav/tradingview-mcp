# Capture backtest day

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
