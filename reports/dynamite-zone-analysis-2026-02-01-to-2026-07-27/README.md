# SPX 5-minute Dynamite Zone Study

## Scope

- Instrument: `SPCFD:SPX`, matching the live TradingView chart
- Chart timeframe: 5 minutes
- Requested period: February 1, 2026 through July 27, 2026
- Observed candles: February 2, 2026 at 09:30 ET through July 27, 2026 at 10:55 ET
- Coverage: 9,526 candles across 121 sessions
- Dynamite zone: every 50-point level, with a 2-point band on each side

## Candle-touch and reaction definitions

Every candle was tested against every historical $50 multiple. A candle-level
touch exists when its high/low range intersects the ±2 point band around that
level. Each touching candle and level pair is scored independently.

- `from_above`: price approached the zone from above. Favorable movement is an
  upward support bounce.
- `from_below`: price approached the zone from below. Favorable movement is a
  downward resistance rejection.
- A complete 30-minute reaction window requires six subsequent 5-minute
  candles in the same session.
- A dominant reaction means favorable excursion exceeded adverse excursion
  during that window.
- A heavy reaction is defined as at least 10 SPX points of favorable excursion
  within the complete 30-minute window.

If a consecutive touching candle opens inside the zone, it is recorded as
`continuation_in_zone` rather than forcing an unsupported approach direction.
Those rows still include raw upside and downside excursions over 5, 15, 30,
and 60 minutes, so every touching candle has a measurable subsequent reaction.
The files also retain a separate first-touch event analysis that consolidates
consecutive touches and prevents clustered candles from being double-counted.

## Headline result

Across all historical $50 levels, reactions from above and below were nearly
symmetrical. The dataset does not support a general rule that Dynamite Zones
are materially stronger as support or materially stronger as resistance.

The candle-by-candle scan found 2,143 touching candle/level observations:
1,396 with a directional approach and 747 continuation-in-zone observations.

| Approach | Touching candles | Complete 30m | Median favorable | Median adverse | Dominant reaction | 10+ point reaction |
|---|---:|---:|---:|---:|---:|---:|
| From above: support bounce | 697 | 644 | 9.57 | 8.00 | 56.5% | 46.7% |
| From below: resistance rejection | 699 | 658 | 8.57 | 7.37 | 56.4% | 44.7% |

The directional difference is negligible: 0.1 percentage points on dominant
reactions and 2.0 percentage points on 10-point reactions.

## Current nearby levels

The individual level mattered more than the overall approach direction.

| Level and approach | Complete 30m | Median favorable | Median adverse | Dominant reaction | 10+ point reaction | Median 30m close move |
|---|---:|---:|---:|---:|---:|---:|
| 7,350 from above | 63 | 15.73 | 8.25 | 69.8% | 61.9% | +7.48 |
| 7,350 from below | 38 | 8.13 | 7.90 | 50.0% | 39.5% | -1.46 |
| 7,400 from above | 62 | 11.60 | 7.91 | 61.3% | 53.2% | +4.26 |
| 7,400 from below | 58 | 7.98 | 9.60 | 50.0% | 37.9% | -0.54 |

For this sample, 7,350 behaved much better as support when approached from
above than as resistance when approached from below. The candle-by-candle
version also shows 7,400 performing better as support from above than as
resistance from below.

## Regime stability

The preferred direction changed by month:

- February and March favored rejections from below.
- April and May favored bounces from above.
- June was close to balanced.
- July through the observation cutoff was weaker in both directions.

This regime variation is another reason not to use the $50 multiple alone as
an entry signal. Approach direction, confirmation, and the behavior of the
specific level remain important.

## Multiples of 100 versus intervening 50s

Using first-touch events with complete 30-minute windows, multiples of 100 were
only slightly stronger in the aggregate:

| Family | Complete events | Dominant reaction | 10+ point reaction | Median favorable | Median adverse |
|---|---:|---:|---:|---:|---:|
| Multiples of 100 | 314 | 58.0% | 48.7% | 9.82 | 6.94 |
| Intervening 50s | 286 | 55.9% | 45.8% | 9.12 | 7.98 |

The overall differences were small. Approach direction produced the more useful
distinction:

- From below, multiples of 100 were stronger resistance: 62.5% dominant
  rejection versus 51.5% at intervening 50s. A 10-point rejection occurred
  53.0% versus 40.9%.
- From above, intervening 50s were stronger support: 59.7% dominant bounce
  versus 52.7% at multiples of 100. A 10-point bounce occurred 50.0% versus
  43.8%.

The every-touching-candle dataset showed the same directional pattern. Therefore
multiples of 100 should not receive a universal priority. They deserve extra
caution when approached from below as potential resistance; intervening 50s
deserve at least equal caution when approached from above as potential support.

## Files

- `spx-5m-all-candles.csv`: every observed candle, including touch and
  first-touch annotations
- `spx-5m-all-touch-reactions.csv`: every touching candle/level observation
  scored independently
- `spx-5m-all-touch-level-summary.csv`: candle-by-candle reaction summary for
  every historical $50 level and approach direction
- `spx-5m-touch-coverage-by-level.csv`: verification count of every touching
  candle at each $50 level, including continuation-in-zone candles
- `spx-5m-dynamite-events.csv`: one row per first-touch event, with 5-, 15-,
  30-, and 60-minute reaction measurements
- `spx-5m-monthly-summary.csv`: direction comparison by month
- `spx-5m-level-summary.csv`: direction comparison by individual $50 level
- `summary.json`: complete machine-readable definitions and summary metrics
- `hundreds-vs-fifties.json`: aggregate, directional, and individual-level
  comparison of multiples of 100 versus intervening 50s

The July 27 session is partial. Events without a complete forward reaction
window remain in the event file but are excluded from the corresponding
complete-window rate calculations.
