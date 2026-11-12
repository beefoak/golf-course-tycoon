import { runHeadless } from '../../tools/headless';

test('the headless runner plays 30 days on a 200-size map and returns a summary', () => {
  const s = runHeadless({ seed: 1, days: 30, size: 200, holes: 3 });
  for (const k of ['seed', 'terrain', 'days', 'holesBuilt', 'holesOpen', 'buildFailures', 'loansTaken', 'debt', 'startCash', 'buildCost', 'cash', 'minCash', 'rounds', 'roundsPerDay', 'profitByYear', 'lastYear', 'scoreByBand', 'courseRating', 'slope', 'reputation', 'staffShortfallHours', 'turfHealth', 'msPerDay'])
    expect(s).toHaveProperty(k);
  expect(s.days).toBe(30);
  expect(s.holesBuilt).toBeGreaterThan(0);
  expect(s.buildCost).toBeGreaterThan(0);
  expect(Object.keys(s.scoreByBand)).toEqual(['0-9', '10-19', '20+']);
  expect(s.profitByYear.length).toBe(1);
}, 120_000);
