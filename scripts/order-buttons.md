# TradingView order shortcuts

Start one local service for the broker/account connected to the active
TradingView Desktop chart. Supported destinations: Paper Trading, Replay Broker,
Webull, and TradeStation. Demo accounts simulate; live accounts submit real
orders immediately when a shortcut is pressed, without a confirmation ticket.
Real Webull/TradeStation order acceptance and execution remain unverified.

## Start

1. Run TradingView Desktop with local CDP enabled (default port 9222).
2. Connect the intended broker and account on the intended chart tab. For Replay,
   start the desired replay session first.
3. Double-click [Start TradingView Order Buttons.command](<Start TradingView Order Buttons.command>).
   Keep its terminal open. It prints the broker, account type, contract, and readiness.
4. Focus that chart, move the pointer to the desired price, and press a shortcut.

The launcher finds Node.js on PATH or under `~/.nvm/versions/node/`; set
`TV_ORDER_NODE` to override the executable. No login/reboot autostart is installed.
Stop with Control+C in its terminal. Starting another service automatically stops
the previous one, waits for outstanding acknowledgements, and replaces its handlers.
It does not cancel or modify existing broker orders.

The service pins the tab, broker, account, account type, and resolved contract.
Restart the same launcher after changing those or the replay session. If the
original tab is closed, it never attaches to a different tab automatically.
It restores lost key handlers and reconnects to the original tab when available.
The retained [Replay launcher](<Start Replay Order Buttons.command>) is a
Replay-only compatibility path still used by the existing Stream Deck button.
New Stream Deck launcher buttons should use the standard launcher.

## Stream Deck shortcuts

Use **System → Hotkey** for each order button. Control means ⌃, not Command ⌘.
Use **System → Open** with the standard `.command` file for one start-service button.

| Order | 4 contracts | 3 contracts | 2 contracts | 1 contract |
|---|---|---|---|---|
| Buy Limit | F13 | Shift+F13 | Control+F13 | Control+Shift+F13 |
| Buy Stop | F17 | Shift+F17 | Control+F17 | Control+Shift+F17 |
| Sell Limit | F18 | Shift+F18 | Control+F18 | Control+Shift+F18 |
| Sell Stop | F16 | Shift+F16 | Control+F16 | Control+Shift+F16 |

F14/F15 remain aliases for Buy Stop/Sell Limit. They did not reach TradingView
from this Mac's Stream Deck during diagnosis. F17/F18 passed CDP keyboard tests;
physical device delivery is a separate check. The handlers operate only in the
connected TradingView chart; Stream Deck hotkey actions themselves are not restricted
to TradingView unless its profile is configured that way.

## Order behavior

- Pointer Y determines the absolute price, rounded to the instrument tick size.
  Buy Limit/Sell Stop must be below the market; Sell Limit/Buy Stop above it.
  Marketable/already-triggered prices are rejected. Pending orders can fill later.
- Each press creates a separate DAY entry order, without TP/SL, OCO, ticket reuse,
  modification, or cancellation. Existing orders and positions are preserved.
- Requests are serialized with a maximum queue of 64; held-key repeats are ignored.
  Captured requests expire after five seconds. An uncertain submission outcome
  blocks further requests: inspect broker orders before restarting, never blindly retry.
- Replay uses historical broker quotes and its own order store. It does not advance
  bars or autoplay. A changed session or rewind rejects queued requests.
- No custom chart banners are shown. Details and errors appear in the terminal.

## CLI

```sh
node scripts/order-buttons.mjs serve --connected
node scripts/order-buttons.mjs status
node scripts/order-buttons.mjs serve --connected --sizes 10,7,3,1
```

Multiple visible matching charts require the intended tab to have focus or
`--target TARGET_ID`. Broker/instrument limits still apply to quantities.
For explicit-price local triggers, `order buy|sell limit|stop QUANTITY --price PRICE`
submits through the running service. Omitting `--price` captures the pointer and
requires TradingView focus. This is an execution command, not a validation command.

Optional dedicated CLI modes remain for diagnostics: `--paper`, `--replay`,
`--dry-run-webull`, `--dry-run-tradestation`, `--demo-tradestation`, and
`--live-webull`/`--live-tradestation` (the last two require `--enable-live-orders`).
Dry-run modes never submit. These are optional modes of the same service.

## Verification

```sh
npm run test:order-buttons
npm run lint
node scripts/check-order-buttons-broker.mjs
node scripts/check-order-buttons-broker.mjs --tradestation
```

Broker preflight checks all 16 combinations without submission or replacing the
running service. It requires the selected broker to be connected outside Replay.
It does not establish quote freshness, data entitlements, buying power, or live
broker acceptance. Adapter maximum quantity may be a placeholder.

The reusable simulator integration check is **opt-in** and creates simulated orders:

```sh
node scripts/check-order-buttons-simulator.mjs --paper-simulation
node scripts/check-order-buttons-simulator.mjs --replay-simulation
```

Run only on the matching Paper/Replay account with that service running (standard
connected mode is accepted). Pause Replay first. The check exercises keyboard
aliases, handler recovery and queued requests; preserves prior orders/positions
and replay time; and cancels only test-created IDs. Generated reports go into a
unique operating-system temporary directory, never into the checkout. Unit tests
use fixtures and do not connect to TradingView or submit real orders.
