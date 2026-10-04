---
name: capture-journal
description: Enrich all already-imported journal trades for the visible TradingView day with annotated trade charts, transaction quantities, notes and evidence-based journal tags, then verify persistence. Use for capture journal or capture journal day.
---

# Capture Journal

This local skill always operates in `/Users/utsav/Projects/tradingview-mcp`, even
when invoked elsewhere. Read and follow the complete, maintained workflow at
[capture-journal.md](/Users/utsav/Projects/tradingview-mcp/workflows/capture-journal.md),
run its helpers from that project, and keep its audit artifacts there.

Use the available trading and TradingView MCP tools. Ingestion is not completion:
finish every required annotation, note/tag/resource update, and independent
read-back. Invocation authorizes only the workflow's scoped app/chart mutations,
not broker orders, commits, deployment, or unrelated history.

## Approved annotation rules

Start the long/short position tool on the trade's stored `entry_candle` in Pacific
time, using that candle's HIGH for a Call or LOW for a Put. On the current
1-minute imports this is the candle before the first fill. Use the stored field
as the source of truth; do not shift BUY/SELL markers off their actual fill
candles, and do not add seconds to their note text.

Extend the position tool horizontally through the candle containing the final
closing transaction that returns the position to flat. Its right edge must never
stop at an earlier MFE candle.

Every journal position tool must use a fixed $0.50 underlying stop. Its target
price must be the maximum favorable excursion reached between the first actual
fill candle and the final closing fill, inclusive: the lowest LOW for a Put
(`short_position`) or the highest HIGH for a Call (`long_position`). This rule
applies to wins, losses, and break-even trades; it is what makes the displayed
tool useful for reading the trade's realized risk-to-reward potential. Never
use the option premium as a chart price, and never replace the MFE target price
with the exit price when price traveled farther in the trade's direction. Record the
MFE candle and price separately from the final-exit right edge in the review
manifest and validate the $0.50 stop before capturing the PNG.
TradingView position levels use tick counts, not dollar distances. Convert using
the underlying tick size, validate the read-back stop/target prices, and visually
confirm both position bands reach those levels before accepting the screenshot.

Use **16-point, white text** in content-sized green BUY and red SELL callouts.
Each line is `BUY|SELL quantity @ $price` with two decimal places and no added
timestamp, for example `BUY 2 @ $0.97`. Keep every imported fill represented.

Connect each note to its actual fill candle with a short diagonal leader into
nearby whitespace. Start just beyond the high or low wick. The full leader must
clear candle bodies and wicks; vertical leaders through candles fail review.
Reserve space around all fill anchors before placing any note, including later
fills. No note or another leader may hide an anchor. Check the full rendered
text bounds extending right/down from its placement point, not a centered box.
Keep notes above the position tool in visual order, with no overlap or clipping.

Preserve the original timeframe and zoom. Adjust annotation placement until the
position bands, every note, every leader, and every anchor are clearly readable.
Inspect each final PNG before accepting it; automatic placement and successful
property read-back do not establish that the layout is clear.

Use `workflows/journal-annotate.mjs` after the snapshot for the mechanical
chart annotations. Review and adjust its PNG drafts before journal apply; its
automatic layout is not proof that every label is visually clear.

If the workflow or required services are unavailable, name the dependency rather
than creating substitute records or claiming completion. This skill is local to
this Mac and does not provision remote or web environments.
