import { runScoring } from '../../tools/scoring';

test('the scoring harness plays fixed handicaps over the scripted holes', () => {
  const r = runScoring({ seed: 1, terrain: 'parkland', rounds: 3, size: 200, holes: 3, handicaps: [0, 24], calm: true });
  expect(r.holes).toBeGreaterThan(0);
  expect(r.rows.map(x => x.handicap)).toEqual([0, 24]);
  for (const row of r.rows) expect(Object.keys(row)).toEqual(['handicap', 'avgOverPar18', 'target', 'pickUpRate', 'penaltiesPer18', 'puttsPer18', 'why']);
  // a 24 handicap shoots more than a scratch player
  expect(r.rows[1]!.avgOverPar18).toBeGreaterThan(r.rows[0]!.avgOverPar18);
});
