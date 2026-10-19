# Structured journal and backtest capture, version 1

This reference is shared by both skills. The executable question registry and research policy live in `/Users/utsav/Projects/trading/frontend/src/utils/captureReview.js`; do not maintain separate question lists. It exports 30 conditional topics, five prompts, fields, answer states, generated tag definitions, calculations and the query contract.

## Rollout and compatibility

The user approved the read-only pilot and rollout on 2026-10-16. Version 1 is enabled for future captures in both workflows. Existing packs use their recorded mode; never convert them silently or backfill history. For new Journal packs use `journal-pack.mjs create-review CONFIG NEW_PACK`; for new Backtest packs use `backtest-freeze.mjs freeze-review DATE NEW_PACK`. Batch captures may mark unsupported user decisions unknown instead of requesting dictation when the user explicitly waives questions. Catalog installation and deployment remain separate from routine capture.

For an explicitly selected v1 pack, check readiness **before any chart access**:

```sh
node --env-file=.env workflows/capture-review.mjs preflight journal
# Use preflight backtest for that workflow.
```

Require `ready:true`. The check is read-only and verifies the reviewed schema and complete versioned catalog. Missing dependencies leave TradingView free and do not authorize a deployment, catalog recreation or a silent legacy fallback. `journal-pack.mjs create-review CONFIG NEW_PACK` is an explicit v1 convenience command; `create` keeps its compatibility behavior. Use version 1 for new captures. Compatibility commands and existing pending packs retain their legacy behavior.


## 1. Secure evidence and release the chart

Keep the existing annotation, view, zoom, screenshot isolation, native-tool RR, identity and restoration checks. The journal MFE tool geometry is unchanged. Its displayed RR remains in Details; it is not realized journal R or the research target.

Cache the available candles once per underlying/session, including timestamps, timeframe, tick size, source identity, zone/drawing geometry, indicator evidence and explicit coverage boundaries/gaps. Include `session:{open,close}` in Unix seconds, with the dated exchange-session source; normal SPY hours are an unverified fallback that cannot produce research results. Confirm dated regular-session boundaries from an authoritative calendar/cached evidence, or record an explicitly approved, sourced `references.session:{open,close,approved:true,source}` after release. Without confirmed boundaries the comparison is unavailable; the actual trade still saves. Keep full raw evidence. Candidate retest candles and protective swings can be proposed from these cached bars; record their timestamps, extremes and confirmation/availability times. Static drawings do not establish historical availability. Missing activation evidence remains unavailable.

Read only candles already available. Never advance replay, wait for future candles or change approved geometry/zoom to fill a 30-minute window. Save the actual trade even if research is incomplete. Review each screenshot visually, restore and verify chart state, then release TradingView. Stage one makes no app writes.

Journal: add `questionnaire_version:1` to the normal `journal-pack.mjs create` config. Backtest:

```sh
node workflows/backtest-freeze.mjs freeze-review YYYY-MM-DD /absolute/new/pack
```

The pack includes `review-input.json` with immutable trade numbers/source IDs, five prompts and missing answer envelopes. Raw evidence and screenshots stay sealed. Tell the user TradingView is free. Show the trade mapping and ask only the relevant prompts.

## 2. Collect answers without accessing TradingView

User update, 2026-10-17: backtests omit the emotions prompt and explicitly mark
emotion fields skipped. Journal reviews retain all five prompts. Derive the
remaining four backtest prompts from the same shared registry.

Use five conversational prompts from the registry: entry, risk, management, emotions and exceptions. Extract supplied ordinary dictation; do not ask it twice. Confluences/obstacles belong with entry; missing exact references needed for a comparison get a conditional follow-up. Do not ask all 30 questions per trade.

Each answer is `known`, `missing`, `skipped`, `not_applicable` or `conflicting`, with `source: observed|reported|derived`. Observed facts need evidence references. Missing/skipped/conflicting states need a reason. Never infer emotions, intention, seconds-level timing, chart activation or absence from silence. Preserve disagreements, including recorded outcomes versus reported results, and exclude affected comparisons until resolved.

### Trade notes and Review checklist items

For each trade with user notes/dictation, write a concise plain-text
`document.note_summary` covering the supplied setup/entry, stop rationale, adds,
partial exits, final exit and exceptions. Include corrections and meaningful
reasons for not adding. Do not invent missing details or substitute chart
inference for the user's account. Preserve reported/recorded conflicts explicitly.
The backend saves this summary into the existing Trade Notes editor atomically
with the review/checklist. Preserve original notes; update only the capture-owned
summary block. Raw dictation stays in the pack. Use per-trade `no_note:true` only
when the user supplies no note or explicitly declines, never to discard supplied
dictation. New inputs require a summary or that explicit choice before assembly;
existing sealed packs retain their recorded input.

When the user says "tags," they mean selectable checklist items in the trade's
Review section. Fetch the current catalog and review every applicable group
against their notes, choosing existing items first. Select only supported facts;
unknown is not No, and a reported break/retest does not establish displacement
or a candle-close confirmation. Structured selections own their generated tags;
use the capture-review endpoint for them.

The user authorizes creating a new checklist item for a meaningful, reusable
concept in their notes only when no existing equivalent exists. Use the existing
catalog and most appropriate group, with a clear label and description. Avoid
duplicates and prices/times as tags. Never invent a versioned-question key through
generic tag routes. This permission supersedes the catalog-creation restriction
for ordinary checklist items only; it does not authorize schema migrations,
historical backfills or changing shared-question semantics. Save ordinary
checklist selections through the editable checklist save contract
(`checklist_tags` on the capture-review request when available), preserving the
full fresh selection, structured answers and concurrent edits. Use the existing
tag path only for non-owned legacy selections. Refresh the review baseline
before saving the note summary; checkbox-only autosave must preserve it. Verify any
new item is visible and selected in Review. No new item is needed when existing
questions capture the concept.

For later notes/corrections on a saved trade, retain the original sealed pack,
store an amendment with the trade mapping/raw text, read current fingerprints,
and update its summary and supported checklist answers with a fresh stable
request ID. Independently verify Notes and Review. Amendments use no TradingView.

Keep original dictation in `raw_dictation` in the input. Use at most three short exception bullets per trade (300 characters each); preserve existing notes. Store prices, times, quantities and distances as measurements, not tag text. Store each obstacle and its behavior together under one linked ID. Management events include planned targets/partial quantities and actual decisions as separate rows with provenance.

Partial answers stay resumable in `review-input.json`; do not assemble until coverage is complete or explicitly skipped/unknown and the user instructs finishing. A complete answer set plus “finish/continue” authorizes saving without another routine confirmation. Set `user_finished:true` only for that instruction.

```sh
node workflows/capture-review.mjs assemble /absolute/pack /absolute/pack/review-input.json
node --env-file=.env workflows/capture-review.mjs publish /absolute/pack
```

Use the normal repository ingestion environment for publishing; do not print credentials. Assembly preserves the exact source input and seals structured answers/evidence. Publish uses fresh app baselines, native RR/screenshots, immutable source IDs, and stable request IDs. It never reads or mutates TradingView after release. Failed attempts retain recovery, progress and exact request payloads; retry the same pack without rebasing onto concurrent edits. Backup export includes all distinct evidence payloads referenced by current and historical revisions. Changed fills, charts or evidence require coordination, never an automatic recapture.

## 3. Shared storage and tags

The backend routes are identical for journal/backtest: GET `/:page/:id/capture-review`, PUT the same route, GET `/:page/capture-review/registry`, POST `/:page/capture-review/query` with explicit selected `trade_ids` and `filter`. PUT requires `expected_revision`, `trade_fingerprint`, `evidence_fingerprint` (null for a new review), stable `request_id`, `document`, and optionally cached `evidence`.

The backend recomputes research, hashes shared session evidence, atomically saves review/revision plus generated `capture_v1__…` tags, the supplied trade-note summary and owned rich-text exception bullets. Legacy tags/notes remain intact. A stale update returns 409. Do not work around catalog errors with generic tag writes. Definitions are installed only by the explicit additive catalog installer after the database migration; do not restore the CSV's old catalog.

The shared Checklist component owns new selections. Generic checkbox/tag writes cannot change projected tags. App lists, declarative filters, reports and MCP use the shared matcher/statistics. Included tags default ALL; exclude ANY. Old MCP callers retain their historical semantics. Linked obstacle/scenario conditions must match the same row. Missing is not No. Each trade counts once. Stale/conflicting evidence is excluded from affected research; counts remain visible.

## 4. Research policy

Freeze the approved original retest candle, confirmed protective swing, extra barrier and next opposing zone before the original eligible trigger. Require exact candle timestamp/high/low and completed-candle availability. The objective is the next zone's near edge. Compare original one-tick break and first subsequent extra-barrier one-tick break against fixed $0.50, original retest extreme plus one tick, and already-confirmed structure extreme plus one tick. Fixed stops follow each scenario's entry; all structural references and target remain frozen.

All six scenarios share 30 minutes from the original trigger, censored at RTH close, and equal cash risk. Use each risk distance for normalized underlying R. Never infer option dollars/returns. Opening gaps fill at available open for entry/stops and conservatively at target for target fills. Pre-entry stop touches do not stop a scenario. OHLC entry/stop/target ordering ambiguity remains unresolved. Missing references/geometry/gaps are unavailable or incomplete, never false losses/wins. Record later post-stop target reach separately. SPY near-stop threshold starts at $0.05, adjustable in the versioned policy. Pairs require comparable resolved results and report exclusions.

Label results research within captured setups. Skipped opportunities are outside this dataset. Keep journal P/L, legacy modeled outcomes, research R and native chart RR distinct. Realized journal R requires documented initial cash risk.

## 5. Completion and recovery

User update, 2026-10-18: routine captures finish through the trading MCP and APIs. Do not open the trading app for screen checks, export CSV backups, or run backup/restore tests as part of capture. These require a separate user request. This supersedes the former visible-checklist and backup verification requirements for both capture workflows.

Publish independently reads back the saved review, exact note summary and generated checklist tags, and verifies the source-to-record mapping, screenshots and execution facts through the existing capture save path. It records `status: complete` in `structured-save-result.json` and `structured-complete.json`. Preserve raw dictation, frozen evidence, retry requests and scoped pre-save recovery snapshots; these are capture recovery files, not a backup export/restore exercise. Missing or conflicting details stay explicit. A save/read-back failure remains incomplete and resumable.

Preserve completed packs and useful tests; remove only task-owned temporary audits/servers after verification. Deployment and historical rewriting remain separate actions.
