import fs from 'node:fs';
import path from 'node:path';

const REPORT_DIR = path.resolve('reports/dynamite-zone-analysis-2026-02-01-to-2026-07-27');

function parseCsv(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const columns = lines[0].split(',');
  return lines.slice(1).map((line) => Object.fromEntries(
    line.split(',').map((value, index) => [columns[index], value]),
  ));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function round(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize(rows) {
  const favorable = rows.map((row) => Number(row.favorable_30m_points));
  const adverse = rows.map((row) => Number(row.adverse_30m_points));
  const closeMove = rows.map((row) => Number(row.close_move_30m_points));
  const dominantCount = rows.filter((row) => row.dominant_30m_reaction === 'true').length;
  const hit = (threshold) => rows.filter(
    (row) => Number(row.favorable_30m_points) >= threshold,
  ).length;
  const pct = (count) => rows.length ? round((count / rows.length) * 100, 1) : null;

  return {
    complete_30m_observations: rows.length,
    dominant_reaction_rate_pct: pct(dominantCount),
    favorable_5pt_rate_pct: pct(hit(5)),
    favorable_10pt_rate_pct: pct(hit(10)),
    favorable_20pt_rate_pct: pct(hit(20)),
    average_favorable_points: round(average(favorable)),
    median_favorable_points: round(median(favorable)),
    average_adverse_points: round(average(adverse)),
    median_adverse_points: round(median(adverse)),
    median_favorable_minus_adverse_points: round(median(
      rows.map((row) => Number(row.favorable_30m_points) - Number(row.adverse_30m_points)),
    )),
    median_close_move_points: round(median(closeMove)),
  };
}

function twoProportionZ(rowsA, rowsB, predicate) {
  const successesA = rowsA.filter(predicate).length;
  const successesB = rowsB.filter(predicate).length;
  const rateA = successesA / rowsA.length;
  const rateB = successesB / rowsB.length;
  const pooled = (successesA + successesB) / (rowsA.length + rowsB.length);
  const standardError = Math.sqrt(
    pooled * (1 - pooled) * ((1 / rowsA.length) + (1 / rowsB.length)),
  );
  return {
    rate_difference_percentage_points: round((rateA - rateB) * 100, 1),
    z_score: round((rateA - rateB) / standardError, 2),
  };
}

function analyzeDataset(rows) {
  const eligible = rows.filter((row) => (
    (row.approach === 'from_above' || row.approach === 'from_below')
    && row.full_30m_window === 'true'
  ));
  const hundreds = eligible.filter((row) => Number(row.level) % 100 === 0);
  const fifties = eligible.filter((row) => Number(row.level) % 100 === 50);

  const directions = Object.fromEntries(
    ['from_above', 'from_below'].map((direction) => {
      const directionHundreds = hundreds.filter((row) => row.approach === direction);
      const directionFifties = fifties.filter((row) => row.approach === direction);
      return [
        direction,
        {
          hundreds: summarize(directionHundreds),
          fifties: summarize(directionFifties),
          difference_tests_hundreds_minus_fifties: {
            dominant_reaction: twoProportionZ(
              directionHundreds,
              directionFifties,
              (row) => row.dominant_30m_reaction === 'true',
            ),
            favorable_10pt_reaction: twoProportionZ(
              directionHundreds,
              directionFifties,
              (row) => Number(row.favorable_30m_points) >= 10,
            ),
          },
        },
      ];
    }),
  );

  const levelGroups = new Map();
  for (const row of eligible) {
    const level = Number(row.level);
    if (!levelGroups.has(level)) levelGroups.set(level, []);
    levelGroups.get(level).push(row);
  }

  const levels = [...levelGroups.entries()]
    .map(([level, levelRows]) => ({
      level,
      family: level % 100 === 0 ? 'hundred' : 'fifty',
      ...summarize(levelRows),
    }))
    .sort((a, b) => a.level - b.level);

  return {
    hundreds: summarize(hundreds),
    fifties: summarize(fifties),
    by_direction: directions,
    difference_tests_hundreds_minus_fifties: {
      dominant_reaction: twoProportionZ(
        hundreds,
        fifties,
        (row) => row.dominant_30m_reaction === 'true',
      ),
      favorable_10pt_reaction: twoProportionZ(
        hundreds,
        fifties,
        (row) => Number(row.favorable_30m_points) >= 10,
      ),
    },
    levels,
  };
}

const firstTouches = parseCsv(path.join(REPORT_DIR, 'spx-5m-dynamite-events.csv'));
const everyTouch = parseCsv(path.join(REPORT_DIR, 'spx-5m-all-touch-reactions.csv'));
const result = {
  methodology: {
    family_definition: {
      hundreds: 'SPX levels divisible by 100, such as 6,600, 7,200, and 7,400.',
      fifties: 'Intervening 50-point levels, such as 6,650, 7,250, and 7,350.',
    },
    eligibility: 'Directional touches with a complete same-session 30-minute reaction window.',
    primary_dataset: 'First-touch events, to reduce repeated counting of consecutive candles at the same level.',
    robustness_dataset: 'Every directional touching candle.',
  },
  first_touch_events: analyzeDataset(firstTouches),
  every_directional_touching_candle: analyzeDataset(everyTouch),
};

fs.writeFileSync(
  path.join(REPORT_DIR, 'hundreds-vs-fifties.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));
