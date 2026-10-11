import { register } from '../router.js';
import * as core from '../../core/replay.js';

register('replay', {
  description: 'Replay mode controls',
  subcommands: new Map([
    ['start', {
      description: 'Start replay mode',
      options: {
        date: { type: 'string', short: 'd', description: 'Start date (YYYY-MM-DD)' },
      },
      handler: (opts) => core.start({ date: opts.date }),
    }],
    ['cutoff', {
      description: 'Replay a date through the 6:30 AM or 9:00 AM Pacific candle',
      handler: (_opts, positionals) => {
        const [date, cutoff, ...extra] = positionals;
        if (!date || !cutoff || extra.length || !['open', 'morning'].includes(cutoff))
          throw new Error('Usage: tv replay cutoff YYYY-MM-DD open|morning (open=6:30 AM, morning=9:00 AM Pacific)');
        return core.startToCutoff({ date, cutoff });
      },
    }],
    ['step', {
      description: 'Advance one bar in replay',
      handler: () => core.step(),
    }],
    ['stop', {
      description: 'Stop replay and return to realtime',
      handler: () => core.stop(),
    }],
    ['status', {
      description: 'Get current replay state',
      handler: () => core.status(),
    }],
    ['autoplay', {
      description: 'Toggle autoplay in replay mode',
      options: {
        speed: { type: 'string', short: 's', description: 'Autoplay delay in ms (lower = faster)' },
      },
      handler: (opts) => core.autoplay({ speed: opts.speed ? Number(opts.speed) : undefined }),
    }],
    ['trade', {
      description: 'Execute a trade in replay mode (buy, sell, close)',
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Action required. Usage: tv replay trade buy');
        return core.trade({ action: positionals[0] });
      },
    }],
  ]),
});
