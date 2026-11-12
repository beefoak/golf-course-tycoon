import { competitionFactor, driftRivals, generateRivals, regionalRanking, rivalsOf, segmentShare } from '../../../src/sim/rating/rivals';
import { reputation } from '../../../src/sim/rating/reputation';
import { dailyDemand } from '../../../src/sim/golfers/demand';
import { addClubhouse, threeHoleCourse } from '../golfers/courseFixture';

function withRival(fee: number) {
  const { g, course } = threeHoleCourse();
  addClubhouse(g, course);
  const stars = reputation(g, course.id).overall;
  g.rivals = [{ id: 1, name: 'Fox Valley Municipal', holes: 18, reputation: stars, condition: 70, fee, style: 'municipal', trend: 0 }];
  return { g, course };
}

test('a cheaper rival with equal reputation pulls budget golfers away', () => {
  const dear = withRival(80), cheap = withRival(15);
  const share = (x: typeof dear, seg: 'budget' | 'premium') => segmentShare(x.g, x.course, seg);
  expect(share(cheap, 'budget')).toBeLessThan(share(dear, 'budget'));
  // budget golfers mind the price far more than premium ones do
  const drop = (seg: 'budget' | 'premium') => share(cheap, seg) / share(dear, seg);
  expect(drop('budget')).toBeLessThan(drop('premium'));
  expect(competitionFactor(cheap.g, cheap.course)).toBeLessThan(competitionFactor(dear.g, dear.course));
  expect(dailyDemand(cheap.g, cheap.course)).toBeLessThan(dailyDemand(dear.g, dear.course));
});

test('the ranking is ordered by score and includes the player', () => {
  const { g, course } = threeHoleCourse();
  addClubhouse(g, course);
  const rows = regionalRanking(g);
  expect(rows.some(r => r.isPlayer && r.name === course.name)).toBe(true);
  for (let k = 1; k < rows.length; k++) expect(rows[k - 1]!.score).toBeGreaterThanOrEqual(rows[k]!.score);
  // a rival made brilliant goes to the top
  rivalsOf(g)[0]!.reputation = 5; rivalsOf(g)[0]!.condition = 100;
  expect(regionalRanking(g)[0]!.name).toBe(rivalsOf(g)[0]!.name);
});

test('rivals are deterministic per seed, 3–6 of them, and drift deterministically', () => {
  expect(generateRivals(42)).toEqual(generateRivals(42));
  expect(generateRivals(42)).not.toEqual(generateRivals(43));
  for (let s = 1; s < 30; s++) { const n = generateRivals(s).length; expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(6); }
  const a = threeHoleCourse().g, b = threeHoleCourse().g;
  a.clock.day = 29; b.clock.day = 29;
  driftRivals(a); driftRivals(b);
  expect(rivalsOf(a)).toEqual(rivalsOf(b));
});
