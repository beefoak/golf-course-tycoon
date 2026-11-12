import { MILESTONES, checkMilestones } from '../../../src/sim/rating/milestones';
import { blockCourse } from '../staff/blockFixture';
import { threeHoleCourse } from '../golfers/courseFixture';

test('open9 fires once, with its grant', () => {
  const { g } = blockCourse(9);
  const seen: string[] = [];
  g.events.on('milestone', m => seen.push(m.key));
  const cash = g.ledger.cash;
  checkMilestones(g);
  expect(g.milestones.open9).toBe(g.day);
  expect(g.ledger.cash).toBe(cash + MILESTONES.open9.grant);
  g.clock.day++;
  checkMilestones(g);
  expect(seen.filter(k => k === 'open9').length).toBe(1);
  expect(g.milestones.open9).toBe(g.day - 1);
  expect(g.milestones.open18).toBeUndefined();
});

test('three holes is no milestone; eighteen unlocks a second course', () => {
  const small = threeHoleCourse();
  checkMilestones(small.g);
  expect(small.g.milestones.open9).toBeUndefined();
  const big = blockCourse(18);
  checkMilestones(big.g);
  expect(big.g.milestones.open18).toBeDefined();
  expect(big.g.unlocks).toContain('multiCourse');
});
