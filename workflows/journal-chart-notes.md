# Optional live-chart notes handoff

Use this only when the user explicitly asks to leave annotations on the chart
for notes, or when resuming an already-created `stage.json` without
`mode: capture_first`. New captures default to the saved capture pack. Follow
the shared annotation, RR, catalog, video and save rules in
[capture-journal.md](capture-journal.md). This mode occupies TradingView twice;
do not silently choose it when the user expects the chart to be released.

## Two stages and the notes handoff

### Stage one: leave every trade annotated on the chart

Complete sections 1-2 for the chosen day, then create the section 3 annotations
with the TradingView MCP and retain them. The screenshot helper in section 3
removes drawings; do not run it as the stage-one handoff. Use its exported
`planAnnotation`/position-level utilities when useful for computing geometry,
but create the retained tools and labels with MCP drawing tools and verify their
properties and appearance. No journal write helper or API mutation runs here.

Freeze trade order by first actual fill time, then imported ID, excluding Miss.
Give each trade a visible identity label such as `Trade 1 | ID 2923`, separate
from its transaction callouts. These numbers also route the user's subsequent
notes. Do not add invented trading commentary or empty user-note placeholders.
Use separate lanes and adjust placements across the entire day, so notes,
leaders, and anchors from neighboring trades remain clear. Leave every trade's
position tool and fill marks in place; do not remove one before drawing the
next. Use matching panes for different underlyings and preserve original zoom
and timeframe. Horizontal panning may be needed to inspect all trades.

Maintain `stage.json` in the pending run directory with `phase: awaiting_notes`,
the fixed date and snapshot path, the original pane/symbol/timeframe/range,
ordered `{number, trade_id}` pairs, every generated drawing ID grouped by trade
and pane, existing user-note drawing IDs/text, annotation results, and unresolved
rows. Record drawing IDs as they are created so interrupted preparation can be
repaired without duplicates. Exclude all generated IDs (including trade identity
labels) from user-note extraction. Preserve pre-existing drawings and user edits.

Inspect the full annotated chart and each trade; save a handoff screenshot and
record every skip. Read each retained tool's native RR using
`readPositionRR(entityId)` from `workflows/journal-annotate.mjs` (or read its
visible label), and store its `position_rr` evidence in the annotation results.
End with the date, annotated count, number-to-ID mapping, and
any unfinished trade. Tell the user to add notes numbered `1:`, `2:`, etc., then
say **continue**. Keep the chart annotations and pending run files intact while
waiting. Do not assess missing user commentary as a failure or claim journal
saving is complete. A repeated start for this pending day reuses/repairs existing
drawings instead of creating another set.

### Stage two: read the new notes, save, and verify

An explicit continuation resumes the pending date and frozen mapping. Locate
`stage.json` from this conversation; never silently substitute the chart's new
visible date or renumber trades. If pending state is unavailable, recover the
mapping from the recorded IDs/chart labels before mutating anything. If more
than one pending day could match, ask which one to resume.

Read current user-note drawings and chart context first, using the chart-text
rules below and the frozen numbering. Save their source IDs and text before
removing any stage-one drawings. User notes may have been added or edited during
the pause: re-read them now, rather than using stage-one text or screenshots.
Unresolved note mappings remain unresolved; do not guess or shift other numbers.

Take a fresh snapshot in a new run directory and reload the catalog, groups,
notes/resources, and imported records. Compare IDs and fills with the stage-one
snapshot. Preserve current notes/tags and use the fresh snapshot as the save
baseline, while keeping the original mapping. Re-annotate a changed trade before
saving it. Newly imported trades need their own annotations and note mapping;
report them explicitly rather than assigning an existing ordinal to another ID.

Read, map, preserve and analyze all the user's notes before capturing any final
PNG. Follow the chart-text procedure below to remove the captured commentary
drawings, then remove the recorded stage-one generated drawings and use section
3 to capture each final trade separately. Commentary belongs in the app's Notes
section only and must not appear in screenshots. Preserve all other user
drawings. Finish sections 4-5 using the preserved notes and chart evidence
together. Dry-run, apply, and verify saved
charts, note text, tag keys/checklist selections, immutable fills/P&L/outcomes,
and relevant daily resources. A continuation authorizes this save; do not add
another routine confirmation step.

Mark the pending stage complete only after read-back succeeds. Restore the
original chart view and remove disposable drafts, previews and superseded
snapshots. Keep completed capture records and requested final artifacts; preserve
recovery files on failures, including the removed notes' exact source text,
points and styles. Do not restore successfully captured commentary onto the
chart after completion; preserve unrelated user drawings.

