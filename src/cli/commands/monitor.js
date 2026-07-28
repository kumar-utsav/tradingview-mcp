import { register } from '../router.js';
import { monitorStrategy, readStrategyMonitorConfig } from '../../core/strategy-monitor.js';

register('monitor', {
  description: 'Zero-token live strategy monitoring',
  subcommands: new Map([
    ['strategy', {
      description: 'Monitor manual rectangle zones for break-and-retest events',
      options: {
        config: { type: 'string', short: 'c', description: 'Path to a strategy monitor JSON config' },
        interval: { type: 'string', short: 'i', description: 'Polling interval in ms (default 500, minimum 100)' },
        history: { type: 'string', short: 'n', description: 'Closed bars used to seed state (default 100)' },
        once: { type: 'boolean', description: 'Return one snapshot instead of monitoring continuously' },
      },
      handler: async opts => {
        const config = readStrategyMonitorConfig(opts.config);
        const result = await monitorStrategy({
          config,
          interval: opts.interval ? Number(opts.interval) : undefined,
          history: opts.history ? Number(opts.history) : undefined,
          once: Boolean(opts.once),
        });
        if (!opts.once) process.exit(0);
        return result;
      },
    }],
  ]),
});
