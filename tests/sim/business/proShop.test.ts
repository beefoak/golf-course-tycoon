import { Rng } from '../../../src/core/rng';
import { Game } from '../../../src/sim/game';
import { BAY_RATE_PER_HOUR, LESSON_FEE, giveLesson, proShopOf, proShopSystem, shopVisit, simulatorHours } from '../../../src/sim/business/proShop';
import { Golfer } from '../../../src/sim/golfers/golfer';
import { generateCandidates } from '../../../src/sim/staff/market';
import { RoleId } from '../../../src/sim/staff/roles';
import { Staff } from '../../../src/sim/staff/staff';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { threeHoleCourse } from '../golfers/courseFixture';

function withShop() {
  const fx = threeHoleCourse();
  const { g, course } = fx;
  const w = g.world;
  for (let x = 0; x < w.size; x++) { const i = w.idx(x, w.size - 1); w.feature[i] = Feature.Road; w.surface[i] = Surface.Path; }
  for (const [kind, origin] of [['clubhouse', { x: 10, y: 289 }], ['proShop', { x: 2, y: 290 }]] as const) {
    const r = g.dispatch({ t: 'placeBuilding', kind, courseId: course.id, origin });
    if (!r.ok) throw new Error(r.reason);
  }
  return { g, courseId: course.id };
}
function golfers(g: Game, n: number, gear = 0.8): Golfer[] {
  const rng = new Rng(9);
  return Array.from({ length: n }, () => { const p = g.golfers.spawn(rng); p.traits.gear = gear; p.segment = 'premium'; p.lastSatisfaction = 80; return p; });
}
function hire(g: Game, role: RoleId, courseId: number): Staff {
  const c = generateCandidates(g, role)[0]!;
  const r = g.dispatch({ t: 'hireStaff', candidateId: c.candidateId, courseId });
  if (!r.ok) throw new Error(r.reason);
  return r.value as Staff;
}

test('sales take stock off the shelf and add pro shop revenue', () => {
  const { g, courseId } = withShop();
  const shop = proShopOf(g, courseId)!;
  const before = shop.stock.map(l => l.qty);
  const cash = g.ledger.cash;
  let bought = 0;
  for (const p of golfers(g, 200)) bought += shopVisit(g, courseId, p, 'after').bought.length;
  expect(bought).toBeGreaterThan(20);
  const sold = shop.stock.reduce((s, l, k) => s + (before[k]! - l.qty), 0);
  expect(sold).toBe(bought);
  expect(g.ledger.cash).toBeGreaterThan(cash);
  expect(g.ledger.tx.filter(t => t.cat === 'proShop').reduce((s, t) => s + t.in, 0)).toBe(shop.today.revenue - shop.today.lessons * LESSON_FEE);
});

test('a stockout loses the sale and leaves an emptyShelves thought; reorder refills overnight', () => {
  const { g, courseId } = withShop();
  const shop = proShopOf(g, courseId)!;
  const balls = shop.stock.find(l => l.cat === 'balls')!;
  balls.qty = 0;
  let lost = 0;
  const thoughts: string[] = [];
  g.events.on('thought', t => thoughts.push(t.key));
  for (const p of golfers(g, 200)) lost += shopVisit(g, courseId, p, 'after').lost.filter(c => c === 'balls').length;
  expect(lost).toBeGreaterThan(5);
  expect(thoughts.filter(k => k === 'emptyShelves').length).toBeGreaterThan(5);
  expect(balls.qty).toBe(0);
  const cash = g.ledger.cash;
  proShopSystem.onDay!(g);
  expect(balls.qty).toBe(balls.reorderQty);
  expect(cash - g.ledger.cash).toBeGreaterThanOrEqual(balls.wholesale * balls.reorderQty);
});

test('a higher markup sells less', () => {
  const run = (retail: number) => {
    const { g, courseId } = withShop();
    const line = proShopOf(g, courseId)!.stock.find(l => l.cat === 'balls')!;
    line.retail = retail; line.qty = 10_000;
    let n = 0;
    for (const p of golfers(g, 400)) n += shopVisit(g, courseId, p, 'after').bought.filter(c => c === 'balls').length;
    return n;
  };
  expect(run(60)).toBeLessThan(run(25));
});

test('simulator bays earn more on rainy days than sunny ones', () => {
  const { g, courseId } = withShop();
  g.ledger.cash = 10_000_000;
  expect(g.dispatch({ t: 'setSimulatorBays', courseId, bays: 2 }).ok).toBe(true);
  const shop = proShopOf(g, courseId)!;
  g.weather.kind = 'sunny';
  const sunny = simulatorHours(g, shop);
  g.weather.kind = 'rain';
  const rainy = simulatorHours(g, shop);
  expect(rainy).toBeGreaterThan(sunny);
  const cash = g.ledger.cash;
  proShopSystem.onDay!(g);
  const earned = g.ledger.tx.filter(t => t.cat === 'simulator').reduce((s, t) => s + t.in, 0);
  expect(earned).toBe(rainy * BAY_RATE_PER_HOUR);
  expect(g.ledger.cash).toBeGreaterThan(cash - 1_000_000);
});

test('lessons from the head pro earn $80 and lower a repeat student’s handicap', () => {
  const { g, courseId } = withShop();
  hire(g, 'headPro', courseId);
  g.clock.minuteOfDay = 600; // pro on shift
  const [student] = golfers(g, 1);
  student!.handicap = 18;
  for (let d = 0; d < 5; d++) { expect(giveLesson(g, courseId, student!)).toBe(true); proShopOf(g, courseId)!.today.lessons = 0; }
  expect(student!.handicap).toBeCloseTo(17.5, 5);
  expect(g.ledger.tx.filter(t => t.cat === 'lessons').reduce((s, t) => s + t.in, 0)).toBe(5 * LESSON_FEE);
});

test('fitting needs a head pro', () => {
  const { g, courseId } = withShop();
  expect(g.dispatch({ t: 'buyProShopAddon', courseId, addon: 'fitting' }).ok).toBe(false);
  hire(g, 'headPro', courseId);
  expect(g.dispatch({ t: 'buyProShopAddon', courseId, addon: 'fitting' }).ok).toBe(true);
});
