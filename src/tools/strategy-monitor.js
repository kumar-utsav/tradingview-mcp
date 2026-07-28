import { z } from 'zod';
import { jsonResult } from './_format.js';
import {
  monitorStrategy,
  normalizeStrategyMonitorConfig,
  strategyMonitorService,
} from '../core/strategy-monitor.js';

const configSchema = z.object({
  symbol: z.string().nullable().optional(),
  timezone: z.string().optional(),
  session: z.object({
    start: z.string(),
    end: z.string(),
  }).optional(),
  blackouts: z.array(z.union([
    z.string(),
    z.object({
      start: z.string(),
      end: z.string(),
      label: z.string().optional(),
    }),
  ])).optional(),
  zonesFromDrawings: z.boolean().optional(),
  requireOneMinuteChart: z.boolean().optional(),
  allowActiveRetestEntry: z.boolean().optional(),
  zones: z.array(z.object({
    id: z.string().optional(),
    label: z.string().optional(),
    low: z.number(),
    high: z.number(),
    direction: z.enum(['long', 'short', 'both']).optional(),
    source: z.string().optional(),
  })).optional(),
}).optional();

export function registerStrategyMonitorTools(server) {
  server.tool('strategy_monitor_snapshot',
    'Evaluate current manual rectangle zones with the zero-token break-and-retest engine and return its current state. Requires a 1-minute chart by default.',
    {
      config: configSchema.describe('Optional monitor configuration. Manual chart rectangles are loaded by default.'),
      history: z.coerce.number().optional().describe('Bars used to seed state (default 100)'),
    },
    async ({ config, history }) => {
      try {
        return jsonResult(await monitorStrategy({
          config: normalizeStrategyMonitorConfig(config || {}),
          history,
          once: true,
        }));
      } catch (error) {
        return jsonResult({ success: false, error: error.message }, true);
      }
    });

  server.tool('strategy_monitor_start',
    'Start background zero-token monitoring of break-and-retest rules. Use strategy_monitor_events to read compact events without sending chart history to the model.',
    {
      config: configSchema.describe('Optional monitor configuration. Manual chart rectangles are loaded by default.'),
      interval: z.coerce.number().optional().describe('Polling interval in milliseconds (default 500, minimum 100)'),
      history: z.coerce.number().optional().describe('Bars used to seed state (default 100)'),
    },
    async ({ config, interval, history }) => {
      try {
        return jsonResult(await strategyMonitorService.start({
          config: normalizeStrategyMonitorConfig(config || {}),
          interval,
          history,
        }));
      } catch (error) {
        return jsonResult({ success: false, error: error.message }, true);
      }
    });

  server.tool('strategy_monitor_status',
    'Return whether the zero-token strategy monitor is running and the compact state of each zone.',
    {},
    async () => jsonResult(strategyMonitorService.status()));

  server.tool('strategy_monitor_events',
    'Read compact strategy events generated locally. Pass after_id from the previous response to avoid repeating events and tokens.',
    {
      after_id: z.coerce.number().optional().describe('Only return events with IDs greater than this value'),
      limit: z.coerce.number().optional().describe('Maximum events to return (default 100, max 500)'),
      clear: z.coerce.boolean().optional().describe('Remove returned events from the in-memory buffer'),
    },
    async ({ after_id, limit, clear }) =>
      jsonResult(strategyMonitorService.getEvents({ afterId: after_id, limit, clear })));

  server.tool('strategy_monitor_stop',
    'Stop the background zero-token strategy monitor.',
    {},
    async () => {
      try {
        return jsonResult(await strategyMonitorService.stop());
      } catch (error) {
        return jsonResult({ success: false, error: error.message }, true);
      }
    });
}
