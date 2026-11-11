import { Game } from '../../../src/sim/game';
import { addClubhouse, threeHoleCourse } from './courseFixture';

function runDays(g: Game, days: number) {
  const end = g.day + days;
  while (g.day < end) g.tick();
}
function count(g: Game) {
  const c = { rounds: 0, started: 0 };
  g.events.on('roundComplete', () => c.rounds++);
  g.events.on('roundStart', () => c.started++);
  return c;
}

test('no golfers arrive without a clubhouse', () => {
  const { g } = threeHoleCourse();
  const c = count(g);
  runDays(g, 2);
  expect(c.started).toBe(0);
  expect(g.ledger.totals(0, 99).greenFees.in).toBe(0);
});

test('with a clubhouse and 3 open holes, golfers play and pay', () => {
  const { g, course } = threeHoleCourse();
  addClubhouse(g, course);
  const c = count(g);
  runDays(g, 5);
  expect(c.rounds).toBeGreaterThan(0);
  expect(g.ledger.totals(0, 99).greenFees.in).toBeGreaterThan(0);
  const visited = [...g.golfers.all.values()].filter(x => x.visits > 0);
  expect(visited.length).toBeGreaterThan(0);
});

test('doubling the fee reduces golfers over 20 days', () => {
  const play = (feePerHole: number) => {
    const { g, course } = threeHoleCourse();
    addClubhouse(g, course);
    g.dispatch({ t: 'setGreenFee', courseId: course.id, holes: 3, fee: feePerHole * 3 });
    let golfers = 0;
    g.events.on('roundStart', ({ groupId }) => { golfers += g.groups.find(x => x.id === groupId)?.golferIds.length ?? 0; });
    runDays(g, 20);
    return golfers;
  };
  // both runs share the seeded weather, so only the price differs
  expect(play(16)).toBeLessThan(play(8));
});
