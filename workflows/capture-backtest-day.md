# Capture backtest day

## Fast, safe execution

Read TradingView state once for date, ticker, timeframe, indicators, and original
view. Then create a unique audit directory before ingestion:

```sh
node workflows/verify-tags.mjs snapshot YYYY-MM-DD backtest-captures/YYYY-MM-DD-HHMMSS
```

The helper batches records, live catalog/groups, daily notes/resources, and
bounded parallel recovery-image reads into `before.json`. Do not ingest unless
snapshot succeeds; preserve its recovery files if later steps fail. Run TradingView's
`capture_backtest_day`, resolving its skipped positions, ambiguous notes, and
duplicates. Its numbered text notes map to chronological trades, `DAY:` text maps
to the daily note, and unresolved assignments must remain reported rather than
guessed. Next batch the post-capture state and create a prefilled manifest:

```sh
node workflows/verify-tags.mjs prepare YYYY-MM-DD /absolute/run/directory
```

Use `review-context.json` for a compact review packet: dated trades, notes,
resources, every active checklist group's full tag meanings and selection mode,
and any saved legacy tags. Keep the complete catalog in `current.json` as the
source of truth. View each saved image individually; a compact packet is not a
substitute for chart inspection. Use `review.template.json`; do not refetch the
catalog, full record list, or chart state unless something changes. Inspect saved
evidence first and request only missing, bounded Pine/drawing/OHLC evidence. This
workflow covers all dated records, including unchanged trades. Invocation permits
its capture/tag/resource updates, not broker orders, commits, or deployment.

## Evidence review

Actually view every chart image and read every trade note, daily note, and chart
text. Downloads are not inspection. Match each record to entry time and drawing.
Charts must show enough pre-entry history, entry, zones, and relevant levels. A
1m image cannot prove a 2m trigger. If an image is absent, retry
`GET /backtest/:id/image`; the MCP missing-image flag was incorrect in the
2026-09-21 reference run.

When evidence is missing, use matching-date TradingView Pine boxes/lines/labels
(filtered to the relevant study), manual drawing metadata, or bounded OHLC bars.
Never use today's levels for historical trades. Avoid moving replay or changing
indicators; restore any altered view.

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

## Dated videos from both channels

Check both [Trade with Neto](https://www.youtube.com/@TradeWithNeto) and
[Kay Capitals](https://www.youtube.com/@KayCapitals/videos) independently on every
capture. The tool's automatic Neto title-prefix lookup is preliminary; it does
not check Kay or prove recording/publication dates.

- Search the channel for the chart date, including Neto's YYMMDD session title.
  Also inspect chronological Videos and Live listings where available. An empty
  title search alone is insufficient, especially for Kay's undated titles.
  Use nearby uploads' exact dates to bracket the target day, checking candidates
  within that window. Stop when the relevant date window is covered; never
  substitute a nearby day or a similarly titled video.
- Open candidates, verify the owner channel, and expand the description for the
  exact public release date. A matching recording/session date explicitly shown
  in the description, video, or live-start metadata also qualifies even if release
  occurred later. Distinguish recording date from publication date in the audit.
  Don't infer a recording date from price resemblance, "today", relative upload
  age, or a date mentioned without recording/session context.
- Verify discovered candidate URLs with the metadata helper first; browser
  playback and repeated description expansion are unnecessary when exact dates
  and channel identity are already verified. For one URL, run
  `node workflows/video-date.mjs YYYY-MM-DD neto|kay HTTPS_WATCH_URL /absolute/run/video-result.json`.
  The helper verifies channel/video identity and exact publication/live-start
  dates; save its output in the capture audit. An undated prerecorded video can
  require manual recording-date evidence. Private upload metadata alone is not
  public release. Use the date shown by YouTube for publication, and the Pacific
  chart-session date for a timestamped live recording.
- For several candidates across both channels, write a JSON array of
  `{"channel":"neto|kay","url":"HTTPS_WATCH_URL"}` objects and run
  `node workflows/video-date.mjs YYYY-MM-DD --batch /absolute/run/candidates.json /absolute/run/video-results.json`.
  It bounds parallel reads to four and downloads each canonical video once per
  invocation. Inspect every result: partial failures remain `unavailable`, not
  no-match. Candidate verification does not replace channel date-window coverage.
  Run independent two-channel discovery alongside chart review when practical;
  reuse same-run evidence, not stale no-match findings from previous captures.
- Record each channel as `found`, `checked_no_match`, or `unavailable`, with
  searched surfaces, date-window coverage and candidate evidence. A properly
  checked no-match for either or both is expected and does not block completion
  or require a link from the user. A blocked page, failed lookup, unverified date
  or search stopped before covering the window is unavailable/incomplete, not
  evidence that no video exists. Report that limitation accurately.

Save all verified relevant dated videos from both channels in `daily_resources`,
labelled by channel and deduplicated by canonical video ID. Preserve unrelated
and previously verified resources. Read the latest resources before merging,
update `PUT /backtest/daily-notes/YYYY-MM-DD` without sending an empty `notes`
field, and independently read back from `GET /backtest/daily-notes` or the dated
trade records. Verify exact attached URLs and unchanged notes; a lookup result
is not attachment proof. If neither channel matches, no resource write is needed.

Report trade count, verified tags, each channel's video result, and specific
unresolved chart evidence. No-video days are complete when both checks are
adequate; never claim required tagging or found-resource verification complete
while it remains unresolved. API base defaults to
`http://100.125.89.9:5555`; set `TRADING_API_URL` if live verification finds a
different endpoint.
