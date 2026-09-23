import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/drawing.js';

export function registerDrawingTools(server) {
  const referenceLevelSchema = z.object({
    label: z.string().min(1).describe('Short Key Levels indicator label, such as PDC or ATH'),
    price: z.number().describe('Current price of the reference level'),
  });

  server.tool('draw_shape', 'Draw a shape/line on the chart', {
    shape: z.string().describe('Shape type: horizontal_line, vertical_line, trend_line, rectangle, text'),
    point: z.object({ time: z.coerce.number(), price: z.coerce.number() }).describe('{ time: unix_timestamp, price: number }'),
    point2: z.object({ time: z.coerce.number(), price: z.coerce.number() }).optional().describe('Second point for two-point shapes (trend_line, rectangle)'),
    overrides: z.string().optional().describe('JSON string of style overrides (e.g., \'{"linecolor": "#ff0000", "linewidth": 2}\')'),
    text: z.string().optional().describe('Text content for text shapes'),
    tooltip: z.string().optional().describe('Hover-only tooltip text for the drawing'),
    tooltip_tolerance: z.number().nonnegative().optional().describe('Optional price distance around the line or zone that activates its tooltip'),
    reference_levels: z.array(referenceLevelSchema).optional().describe('Fixed Key Levels indicator values to test for tooltip confluence'),
    dynamic_session_levels: z.boolean().optional().describe('Recalculate PMH/PML, Open, High/Low, 5MH/5ML, and 15MH/15ML from live chart bars whenever the tooltip opens'),
  }, async (args) => {
    try { return jsonResult(await core.drawShape(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_set_tooltip', 'Attach or replace a hover-only tooltip on an existing drawing', {
    entity_id: z.string().describe('Entity ID of the drawing (from draw_list)'),
    tooltip: z.string().min(1).describe('Tooltip text to show while the crosshair hovers near the drawing'),
    lower_price: z.number().optional().describe('Optional lower activation price; defaults to the drawing points'),
    upper_price: z.number().optional().describe('Optional upper activation price; defaults to the drawing points'),
    tooltip_tolerance: z.number().nonnegative().optional().describe('Optional price distance around the line or zone that activates its tooltip'),
    reference_levels: z.array(referenceLevelSchema).optional().describe('Fixed Key Levels indicator values to test for tooltip confluence'),
    dynamic_session_levels: z.boolean().optional().describe('Recalculate PMH/PML, Open, High/Low, 5MH/5ML, and 15MH/15ML from live chart bars whenever the tooltip opens'),
  }, async (args) => {
    try { return jsonResult(await core.setTooltip(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_list', 'List all shapes/drawings on the chart', {}, async () => {
    try { return jsonResult(await core.listDrawings()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_clear', 'Remove all drawings from the chart', {}, async () => {
    try { return jsonResult(await core.clearAll()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_remove_one', 'Remove a specific drawing by entity ID', {
    entity_id: z.string().describe('Entity ID of the drawing to remove (from draw_list)'),
  }, async ({ entity_id }) => {
    try { return jsonResult(await core.removeOne({ entity_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_get_properties', 'Get properties and points of a specific drawing', {
    entity_id: z.string().describe('Entity ID of the drawing (from draw_list)'),
  }, async ({ entity_id }) => {
    try { return jsonResult(await core.getProperties({ entity_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
