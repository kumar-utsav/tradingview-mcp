# Capture backtest day

## Fast, safe execution

Read TradingView state once for date, ticker, timeframe, indicators, and original
view. Then create a unique audit directory before ingestion:

```sh
node workflows/verify-tags.mjs snapshot YYYY-MM-DD backtest-captures/YYYY-MM-DD-HHMMSS
```

The helper batches records, live catalog/groups, daily notes/resources, and
parallel recovery-image reads into `before.json`. Run TradingView's
`capture_backtest_day`, resolving its skipped positions, ambiguous notes, and
duplicates. Its numbered text notes map to chronological trades, `DAY:` text maps
to the daily note, and unresolved assignments must remain reported rather than
guessed. Next batch the post-capture state and create a prefilled manifest:

```sh
node workflows/verify-tags.mjs prepare YYYY-MM-DD /absolute/run/directory
```

Use `current.json`, saved images, and `review.template.json`; do not refetch the
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
node workflows/verify-tags.mjs /absolute/run/review.json
node workflows/verify-tags.mjs /absolute/run/review.json --apply
```

Dry-run first. The helper rejects stale notes/tags, unknown/duplicate keys,
single-select conflicts, contradictory ranges, invalid-without-issue, and
incomplete group review. It writes only `tags`, rechecks for concurrent edits,
then independently reads exact tags and notes back. Save command outputs in the
run directory; HTTP success alone is not verification.

Confirm the exact dated video is persisted in `daily_resources`. A lookup result
is not attachment proof. Preserve other resources, update
`PUT /backtest/daily-notes/YYYY-MM-DD` without an empty `notes` field, and read it
back from the daily/trades endpoint. Report trade count, verified tags/video, and
specific unresolved evidence. Never claim completion while required tagging or
resource verification remains unresolved. API base defaults to
`http://100.125.89.9:5555`; set `TRADING_API_URL` if live verification finds a
different endpoint.
