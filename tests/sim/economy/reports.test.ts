import { TX_CATEGORIES } from '../../../src/sim/economy/ledger';
import { cashFlowSeries, costByDepartment, incomeStatement, perHoleEconomics, statementFor } from '../../../src/sim/economy/reports';
import { blockCourse } from '../staff/blockFixture';
import { generateCandidates } from '../../../src/sim/staff/market';
import { addClubhouse, threeHoleCourse } from '../golfers/courseFixture';
import { Game } from '../../../src/sim/game';

function runDays(g: Game, days: number) {
  const end = g.day + days;
  while (g.day < end) g.tick();
}

test('the income statement adds up to the ledger, and the cash series follows the cash', () => {
  const { g, course } = threeHoleCourse();
  addClubhouse(g, course);
  const startDay = g.day;
  // the fixture's own spending (holes, clubhouse) is already in the ledger
  const before = statementFor(g, null, 0, g.day).cashChange;
  const startCash = g.ledger.cash;
  runDays(g, 6);
  const s = statementFor(g, null, 0, g.day);
  const t = g.ledger.totals(0, g.day);
  const net = TX_CATEGORIES.reduce((a, c) => a + t[c].in - t[c].out, 0);
  expect(s.cashChange).toBe(net);
  expect(s.cashChange - before).toBe(g.ledger.cash - startCash);
  expect(s.totalRevenue).toBeGreaterThan(0);
  expect(s.totalRevenue - s.totalOperating - s.capital + s.financing).toBe(s.cashChange);
  const today = incomeStatement(g, null, 'day');
  expect(today.from).toBe(g.day);
  // one closing balance per finished day, each equal to the cash after that day's ledger rows
  const series = cashFlowSeries(g, 30);
  expect(series.length).toBe(g.day - startDay);
  const closeOf = (d: number) => startCash - before + statementFor(g, null, 0, d).cashChange;
  expect(series[series.length - 1]).toBe(closeOf(g.day - 1));
});

test('maintenance cost lands on the hole whose tiles were worked', () => {
  const { g, courseId, holeIds } = blockCourse(2);
  const c = generateCandidates(g, 'greenkeeper')[0]!;
  const hired = g.dispatch({ t: 'hireStaff', candidateId: c.candidateId, courseId });
  if (!hired.ok) throw new Error(hired.reason);
  const keeper = hired.value as { id: number };
  // only hole 1 gets work today
  g.workOrders.all = [];
  g.workOrders.plannedDay = { [courseId]: g.day };
  const hole = g.courses.hole(holeIds[0]!)!;
  const w = g.world;
  const tiles: number[] = [];
  for (let k = 0; k < w.size * w.size && tiles.length < 40; k++) if (w.holeId[k] === hole.id) tiles.push(k);
  expect(tiles.length).toBeGreaterThan(0);
  g.workOrders.all.push({ id: 1, courseId, practice: 'fertilize', surface: w.surface[tiles[0]!]!, holeId: hole.id, tiles, zone: null, priority: 1, due: g.day, laborHours: 1, status: 'assigned', urgent: false, assignedTo: keeper.id, progress: 0 });
  runDays(g, 1);
  const eco = perHoleEconomics(g, courseId);
  const one = eco.find(e => e.holeId === holeIds[0])!;
  const two = eco.find(e => e.holeId === holeIds[1])!;
  expect(one.labour).toBeGreaterThan(0);
  expect(one.supplies).toBeGreaterThan(0);
  expect(one.maintenanceCost).toBeCloseTo(one.labour + one.supplies, 5);
  expect(two.maintenanceCost).toBe(0);
  // wages show up under the maintenance department
  expect(costByDepartment(g, 0, g.day, courseId).maintenance).toBeGreaterThan(0);
});

test('green fees are shared equally across the holes a round plays', () => {
  const { g, course, holes } = threeHoleCourse();
  addClubhouse(g, course);
  runDays(g, 3);
  const eco = perHoleEconomics(g, course.id);
  const fees = g.ledger.totals(0, g.day, course.id).greenFees.in;
  const shared = eco.reduce((s, e) => s + e.revenueShare, 0);
  expect(fees).toBeGreaterThan(0);
  expect(Math.abs(shared - fees)).toBeLessThan(holes.length * 3);
  expect(eco[0]!.roundsPlayed).toBe(eco[2]!.roundsPlayed);
});
