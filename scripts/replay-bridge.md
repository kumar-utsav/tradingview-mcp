# Trade replay helper

The Trading app on Ubuntu queues a replay request. This helper runs on the
computer running TradingView Desktop, polls the app over the existing private
network, and controls TradingView through loopback CDP. No inbound client port
is required. It never places orders or edits recorded trades.

## Run

TradingView must be running with CDP enabled (normally port 9222). Configure
`~/.config/tradingview-mcp/replay-bridge.json` with permissions `0600`:

```json
{
  "backendUrl": "http://100.125.89.9:5555",
  "token": "<same secret as the server TRADINGVIEW_REPLAY_TOKEN>"
}
```

Run `node scripts/replay-bridge.mjs` from this checkout. `REPLAY_BRIDGE_CONFIG`
can point to an alternate config file. Never put the secret in source control,
frontend code, or a URL. Use the private network or HTTPS for transport.

The installed macOS login service is
`~/Library/LaunchAgents/com.utsav.tradingview-replay.plist`. It starts at login
and restarts the helper if it exits. Logs are under
`~/.local/state/tradingview-mcp/`. After editing helper code, restart with:

```sh
launchctl kickstart -k gui/$(id -u)/com.utsav.tradingview-replay
```

## Behavior

- Journal and Backtest trade details expose **Replay trade**. The server reads
  the selected trade's execution metadata and uses its stored minute timeframe.
- Target is the next 15-minute boundary at or after entry, aligned forward to
  a real candle on that timeframe. A 7:20 entry on 2m opens the 7:30 candle;
  a 7:01 entry on 2m opens 7:16 because 7:15 is not a 2m candle.
- Execution timestamps take priority. Older date/time fields are interpreted
  as Pacific time, with daylight saving validation. Full stored contract
  symbols are preserved; bare known futures roots map to continuous symbols.
- The selected replay point is one bar after the target because TradingView
  excludes the selected bar. Success requires reading the exact target as
  the chart's final candle, with replay active and autoplay stopped.
- Requests are sequential and duplicate active requests for the same trade
  share one job. The helper refuses to reset sessions containing executions
  and asks for autoplay to be paused first.
- Queue state is intentionally temporary: queued jobs expire after 30 seconds,
  running jobs after 180 seconds, and results after 10 minutes. A backend restart
  discards the queue. Page navigation/reload can recover current job status
  while the backend remains running. Failed jobs never automatically replay.
- Supports exchange-qualified symbols and 1–30 minute charts when the account
  has replay data available. A closed market or missing historical candle
  returns a verification error instead of claiming a successful jump.

## Full saved trade annotations

Replay now reads the selected trade's saved fills and uses the shared journal
annotation planner and renderer. It briefly loads history through the final
exit, computes the full-trade bands, returns replay to the original target,
and places a long/short position tool and all BUY/SELL callouts in that final
viewport. Later exits remain annotated in future whitespace. No replay orders
are created and no captured images, trade notes, financial records or saved RR
are updated.

The helper verifies every fill anchor, position band, final-exit candle and
native tool RR before success. Labels retain the workflow's 12-point white text,
green/red backgrounds and nearby diagonal leaders. A consistent price scale
and trade-focused time range keep labels clear when replay rewinds. MES journal
contracts map to the continuous MES chart under the journal workflow rule.

Drawings remain on the live chart and are excluded from layout autosave. New
requests replace only this helper's drawings for that chart/symbol; user drawings
are preserved. The in-page ID registry survives helper restarts. Missing or
invalid execution fills produce an error rather than fabricated annotations.

## Validation

Server tests: `node --test backend/tests/tradingviewReplay.test.js` in the
Ubuntu app checkout. Live validation covered the actual August 12 MES 7:20
trade button, its 7:30 candle, and switching between MNQ 5m and MES 2m.
