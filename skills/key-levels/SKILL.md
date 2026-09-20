---
name: key-levels
description: Analyze any live TradingView symbol and timeframe, then draw a fresh two-sided map of major structural levels, profit-taking levels, and tightly bounded zones. Use when the user asks the AI to identify, refresh, or draw key levels from price action; do not use when the user supplies exact prices and only wants them plotted.
---

# Key-Level Drawing

Create a readable map that supports profit-taking whether price moves up or down. Analyze the active ticker and timeframe; never assume SPY, equities, a 15-minute chart, or a fixed dollar increment.

## Analyze Fresh Context

1. Call `chart_get_state` once and record the active symbol and timeframe.
2. Read the current quote, symbol metadata when needed, recent OHLCV, existing drawings, and a chart screenshot. Use individual bars because price-action structure is required.
3. Treat every new trading date or user-requested refresh as a fresh analysis. Do not carry prior prices forward merely because they worked earlier.
4. Use the active timeframe as the primary structure. If it does not provide credible targets in both directions, briefly inspect a meaningfully higher timeframe and restore the original timeframe before drawing.
5. Prefer repeated swing highs/lows, support-resistance flips, consolidation boundaries, displacement origins, and reactions supported by volume or higher-timeframe confluence.

Never delete unknown drawings. Remove only drawings created by the preceding key-level run when their entity IDs are known. Do not use `draw_clear` when user drawings may be present.

## Calibrate Price Units and Spacing

Determine the instrument's tick or pip convention from symbol metadata and market convention. If the user's meaning of "pip" is ambiguous and would materially change the map, ask; otherwise state the convention used.

- Honor spacing and zone-width preferences the user supplied for the active instrument or setup.
- Do not transfer a raw dollar distance from one ticker or timeframe to another.
- When no configuration exists, infer a practical spacing band from the active timeframe's volatility, visible range, and density of meaningful reaction prices. It must allow useful scale-outs without clutter.
- Keep adjacent line prices or zone centers within the selected spacing band when possible. Do not leave gaps above its maximum; prefer genuine intermediate structure and use a clearly identified projected target only when structure is absent.
- Treat candidates as a possible zone only when their separation is small relative to the selected spacing band. As a default, the entire zone should be no wider than roughly one-third of the normal center-to-center gap.

For a setup where the user specifies 70-100 pips between targets and 10-30 pips for clustering, apply those values in the active instrument's confirmed pip convention rather than interpreting them as universal dollar amounts.

## Choose Lines and Zones

Include both:

- **Major structural levels:** the strongest multi-touch or multi-timeframe areas.
- **Intermediate profit-taking levels:** useful scale-out references between major structures.

Apply these rules in order:

1. When two or more comparably meaningful reaction prices fit within the calibrated zone-width limit, replace them with one rectangle spanning the cluster.
2. If one price clearly dominates and nearby evidence is weaker, draw the dominant price as a line.
3. If candidates are closer than the minimum spacing but do not qualify for a zone, keep only the stronger candidate.
4. Never widen a zone merely to absorb another level that falls outside the zone-width limit.
5. Do not manufacture a dense, evenly spaced ladder when price-action evidence exists. Projected levels are a fallback for directional coverage and must be distinguished from proven structure.

The number of drawings is an outcome of these rules, not a target.

## Draw Consistently

- Major support: thicker green line or green zone.
- Major resistance: thicker red line or red zone.
- Intermediate downside target: thinner teal line or zone.
- Intermediate upside target: thinner orange line or zone.
- Use transparent zone fills so candles remain readable.
- Extend rectangles into future bars so they remain usable during subsequent price movement.

Use `draw_shape` with `horizontal_line` for precise levels and `rectangle` for qualifying clusters. Preserve the active chart timeframe.

## Verify and Report

After drawing:

1. Use `draw_list` to confirm the expected line and rectangle count.
2. Capture and visually inspect the chart.
3. Correct overlaps, excessive density, opaque fills, missing directional coverage, or spacing violations before reporting completion.
4. Report the active symbol and timeframe, nearest upside and downside targets, the unit and spacing convention used, major versus intermediate targets, and any projected levels.

## Incorporate User Feedback

The user has explicitly requested that useful feedback after a level-drawing run update this skill.

- Update this `SKILL.md` when feedback expresses a durable decision rule, calibration rule, styling convention, or recurring correction that improves future runs.
- Generalize the underlying rule instead of recording a single date, ticker price, timeframe outcome, or isolated mistake.
- Do not update the skill for one-off chart instructions, temporary exceptions, or feedback that conflicts with a newer explicit preference.
- Keep the skill concise: revise or replace an existing rule instead of accumulating overlapping instructions.
- Tell the user briefly what reusable rule changed.
