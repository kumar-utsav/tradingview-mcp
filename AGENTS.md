# TradingView MCP — Codex Instructions

99 tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).

## Decision Tree — Which Tool When

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for current symbol

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100)
- `quote_get` → single latest price snapshot

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"
- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15")
- `chart_set_visible_range` → zoom to exact date range (unix timestamps)

### "Work on Pine Script"
1. `pine_set_source` → inject code into editor
2. `pine_smart_compile` → compile with auto-detection + error check
3. `pine_get_errors` → read compilation errors
4. `pine_get_console` → read log.info() output
5. `pine_get_source` → read current code back (WARNING: can be very large for complex scripts)
6. `pine_save` → save to TradingView cloud
7. `pine_new` → create blank indicator/strategy/library
8. `pine_open` → load a saved script by name

### "Practice trading with replay"
1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance one bar
3. `replay_autoplay` → auto-advance (set speed with `speed` param in ms)
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime
7. `replay_to_session_cutoff` → replay to a date and stop at the 6:30 AM or 9:00 AM Pacific cutoff (cutoff candle included) — aligns replay with Pacific capture dates

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"` or `"get_ohlcv"`

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
- `draw_list` → see what's drawn
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all

### "Manage alerts"
- `alert_create` → set price alert (condition: "crossing", "greater_than", "less_than")
- `alert_list` → view active alerts
- `alert_delete` → remove alerts

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `layout_switch` → load a saved layout by name
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` → take a screenshot (regions: "full", "chart", "strategy_tester")

### "TradingView isn't running"
- `tv_launch` → auto-detect and launch TradingView with CDP on Mac/Win/Linux
- `tv_health_check` → verify connection is working

### "Check my strategy / backtest results"
- `data_get_strategy_results` → Strategy Tester performance metrics (auto-opens the panel, auto-unhides hidden strategies)
- `data_get_trades` → trade list from Strategy Tester
- `data_get_equity` → equity curve from Strategy Tester

### "Monitor zones in the background (zero-token)"
- `strategy_monitor_start` → start break-and-retest monitoring (zones default to manual chart rectangles; session/blackouts configurable)
- `strategy_monitor_events` with `after_id` → read only new compact events without resending chart history
- `strategy_monitor_status` → running state + compact per-zone state
- `strategy_monitor_snapshot` → one-shot evaluation of current rectangle zones (1-minute chart by default)
- `strategy_monitor_stop` → stop the monitor

### "Manage tabs, panes and layouts"
- `tab_list` / `tab_new` / `tab_switch` / `tab_close` → chart tabs (a new tab can open a saved layout)
- `pane_list` / `pane_set_layout` (single, 2h, 2v, 4, 6, 8) / `pane_focus` / `pane_set_symbol` → multi-pane grids
- `layout_list` / `layout_new` / `layout_switch` → saved layouts

### "Watchlist and symbols"
- `watchlist_get` / `watchlist_add` / `watchlist_add_bulk` / `watchlist_remove` → manage the watchlist
- `symbol_search` → find symbols by keyword (type filter: stock, futures, crypto, forex)
- `symbol_info` → metadata for the current symbol (exchange, type, description)

### "Manage indicators"
- `indicator_search` → search the Indicators dialog (built-ins, community scripts, My scripts)
- `indicator_add` → add by name, works for strategies and community scripts (returns the new entity_id)
- `indicator_set_inputs` → change indicator settings (length, source, etc.)
- `indicator_toggle_visibility` → show/hide a study

### "Interact with the UI"
- `ui_find_element` / `ui_click` / `ui_hover` → locate and act on elements (by text, aria-label, data-name)
- `ui_type_text` / `ui_keyboard` → type into the focused input / press keys or shortcuts
- `ui_scroll` / `ui_mouse_click` → scroll the chart or page / click exact coordinates
- `ui_evaluate` → run JavaScript in the TradingView page (advanced)

### "Advanced drawing control"
- `draw_get_properties` → read properties and points of a drawing
- `draw_set_tooltip` / `draw_cleanup_tooltips` → attach or clean up hover-only tooltips
- `draw_set_visual_order` → bring_to_front / send_to_back

### "More Pine tools"
- `pine_compile` → compile/add the current script; `pine_smart_compile` → also auto-detects the compile button and reports study changes
- `pine_list_scripts` → list saved scripts
- `pine_analyze` → offline static analysis without compiling or a chart connection
- `pine_check` → compile-check via TradingView's server API without the chart open

### "Diagnostics and extras"
- `tv_discover` → report which TradingView API paths are available
- `tv_ui_state` → which panels are open, button visibility/enabled state
- `tv_update` → git fast-forward update of this MCP server (refuses dirty/diverged trees; restart required after)
- `depth_get` → order book / DOM (Depth of Market) data
- `chart_get_visible_range` → visible date range + bars on screen

### "Capture my trading day"
- `capture_backtest_day` / `capture_backtest_batch` / `capture_journal_call_trade` / `capture_journal_put_trade` / `capture_journal_call_miss` / `capture_journal_put_miss` → personal capture workflows — never invoke ad hoc, see "Personal capture workflows" below

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)
| Tool | Typical Output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 bytes (returns file path, not image data) |

## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Architecture

```
Codex ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`

## Personal capture workflows

When the user says "capture backtest day" (including dictation variants), use
`skills/capture-backtest-day/SKILL.md` and complete the chart, notes, checklist,
tag verification in `workflows/capture-backtest-day.md`. The
default is capture-first: capture all trades/screenshots/evidence locally,
restore and release TradingView, then wait for numbered notes in chat without
server writes. Do not extract or delete chart commentary as notes. On
continuation, assemble notes with the saved trade-number/source-ID mapping,
save and verify from that pack without accessing TradingView again. Require
notes or explicit NO NOTE for every captured trade; never guess missing notes.
Preserve existing pending legacy captures in their original mode. The
user authorized this tagging workflow on 2026-09-21. The manually reviewed
reference is `tag-audit-2026-09-21/`; current catalog definitions take precedence.

When the user says "capture journal" or "capture journal day", use
`skills/capture-journal/SKILL.md` and process all already-imported journal trades
for the visible chart day under `workflows/capture-journal.md`. The user selected
all imported trades for that day on 2026-09-23. Preserve imported IDs, fills,
P/L, outcomes and existing notes. By default, annotate/screenshot each trade
once, cache native RR and dated evidence in a Desktop capture pack, remove its
temporary marks, and restore/verify the user's chart before releasing TradingView.
Pause for numbered notes in chat or the pack file, without journal writes. On
continuation, process the saved pack and fresh server catalog, save and verify
charts/notes/tags/RR/resources **without TradingView access**. Do not restore the
old chart after release. Changed trades require a coordinated new capture window.
Use the legacy retained-chart notes mode only when explicitly requested or when
resuming an already-existing pending capture. The dated reference is
`journal-workflow-2026-09-23/`; load the current catalog for each capture.

These two personal skills are linked from `/Users/utsav/.agents/skills/`, so
requests can originate in any local Codex project. Resolve their relative
commands and run artifacts from `/Users/utsav/Projects/tradingview-mcp`.

## Temporary work and cleanup

Keep disposable audits, preview servers, ad hoc validation scripts, debug
screenshots, and trial captures in the operating system's temporary directory,
outside this checkout. Do not leave them as local project changes.

After verification completes, stop temporary preview processes and remove the
task's disposable files, superseded drafts, and temporary worktrees. Retain
useful code and skill changes, meaningful regression tests and their fixtures,
requested final artifacts, and completed capture records. Preserve recovery
files while work is incomplete or a saved result remains unverified.

Review changes individually during cleanup; never reset the checkout or discard
useful work merely to make Git status clean. Cleanup does not authorize a
commit, push, or deployment.

## Structured capture review v1

New captures default to `questionnaire_version: 1` following user pilot and
rollout approval on 2026-10-16. Run the read-only readiness check before chart
access; use `journal-pack.mjs create-review` or `backtest-freeze.mjs freeze-review`. Follow
`workflows/capture-review.md` for both personal capture workflows. Its conditional
questions and optional exception bullets supersede mandatory prose notes for
that version only. Existing pending packs retain their original mode. The version-1 instructions supersede legacy mandatory-note rules for new packs. Do not deploy, migrate live catalogs or
backfill history as part of capture. Shared structured fields own their generated
tags; preserve capture-first and zero chart access after release.
