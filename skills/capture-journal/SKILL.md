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

## Position-tool rules

Every journal position tool must use a fixed $0.50 underlying stop. Its far
endpoint must be the maximum favorable excursion reached between the first
entry candle and the final closing fill, inclusive: the lowest LOW for a Put
(`short_position`) or the highest HIGH for a Call (`long_position`). This rule
applies to wins, losses, and break-even trades; it is what makes the displayed
tool useful for reading the trade's realized risk-to-reward potential. Never
use the option premium as a chart price, and never stop the tool merely at the
final exit when price traveled farther in the trade's direction. Record the
MFE candle and price in the review manifest and validate the $0.50 stop before
capturing the PNG.

Transaction notes remain compact and content-sized: green BUY and red SELL
callouts, each anchored to its fill candle with a short leader line into nearby
whitespace, with no overlap or clipping.

Use `workflows/journal-annotate.mjs` after the snapshot for the mechanical
chart annotations. Review and adjust its PNG drafts before journal apply; its
automatic layout is not proof that every label is visually clear.

If the workflow or required services are unavailable, name the dependency rather
than creating substitute records or claiming completion. This skill is local to
this Mac and does not provision remote or web environments.
