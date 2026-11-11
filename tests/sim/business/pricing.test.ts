import { Game } from '../../../src/sim/game';
import { DYNAMIC_LIMIT, adjustDynamic, bandAt, isWeekend, priceFor, pricingOf } from '../../../src/sim/business/pricing';
import { scheduleDay } from '../../../src/sim/golfers/demand';
import { generateCandidates } from '../../../src/sim/staff/market';
import { addClubhouse, threeHoleCourse } from '../golfers/courseFixture';

function setup() {
  const fx = threeHoleCourse();
  addClubhouse(fx.g, fx.course);
  fx.g.dispatch({ t: 'setGreenFee', courseId: fx.course.id, holes: 3, fee: 30 });
  return fx;
}
function hireManager(g: Game, courseId: number) {
  const c = generateCandidates(g, 'generalManager')[0]!;
  const r = g.dispatch({ t: 'hireStaff', candidateId: c.candidateId, courseId });
  if (!r.ok) throw new Error(r.reason);
}

test('twilight is cheaper than peak; off-peak sits between; weekends cost more', () => {
  const { g, course } = setup();
  expect(bandAt(8 * 60)).toBe('peak');
  expect(bandAt(13 * 60)).toBe('offPeak');
  expect(bandAt(18 * 60)).toBe('twilight');
  const weekday = [1, 2, 3, 4, 5, 6, 7].find(d => !isWeekend(d))!;
  const weekend = [1, 2, 3, 4, 5, 6, 7].find(d => isWeekend(d))!;
  const peak = priceFor(g, course, weekday, 8 * 60, 3);
  const off = priceFor(g, course, weekday, 13 * 60, 3);
  const twi = priceFor(g, course, weekday, 18 * 60, 3);
  expect(twi).toBeLessThan(off);
  expect(off).toBeLessThan(peak);
  expect(priceFor(g, course, weekend, 8 * 60, 3)).toBeGreaterThan(peak);
  // booked groups pay the band they tee off in
  scheduleDay(g);
  const groups = g.groups.filter(x => x.day === g.day);
  expect(groups.length).toBeGreaterThan(0);
  for (const grp of groups) expect(grp.feePerGolfer).toBe(priceFor(g, course, g.day, grp.teeTime, 3));
});

test('bands can be set, within limits', () => {
  const { g, course } = setup();
  expect(g.dispatch({ t: 'setPricing', courseId: course.id, patch: { bands: { peak: 1.2, offPeak: 1, twilight: 0.5 } } }).ok).toBe(true);
  expect(priceFor(g, course, 1, 18 * 60, 3)).toBe(Math.round(30 * 0.5 * 1));
  expect(g.dispatch({ t: 'setPricing', courseId: course.id, patch: { weekendMult: 5 } }).ok).toBe(false);
});

test('dynamic pricing needs a general manager, and raises prices when the tee sheet is full', () => {
  const { g, course } = setup();
  expect(g.dispatch({ t: 'setPricing', courseId: course.id, patch: { dynamic: true } }).ok).toBe(false);
  hireManager(g, course.id);
  expect(g.dispatch({ t: 'setPricing', courseId: course.id, patch: { dynamic: true } }).ok).toBe(true);
  const before = priceFor(g, course, g.day, 8 * 60, 3);
  const p = pricingOf(g, course.id);
  p.fill = [1, 1, 1, 1, 1, 1, 1];
  for (let w = 0; w < 10; w++) adjustDynamic(g, course.id);
  expect(priceFor(g, course, g.day, 8 * 60, 3)).toBeGreaterThan(before);
  expect(p.dynamicMult).toBeLessThanOrEqual(1 + DYNAMIC_LIMIT);
  // an empty sheet brings them back down, but never below −25%
  p.fill = [0, 0, 0, 0, 0, 0, 0];
  for (let w = 0; w < 30; w++) adjustDynamic(g, course.id);
  expect(p.dynamicMult).toBeCloseTo(1 - DYNAMIC_LIMIT, 5);
});

test('the day\'s bookings record how full the tee sheet is', () => {
  const { g, course } = setup();
  scheduleDay(g);
  const fill = pricingOf(g, course.id).fill!;
  expect(fill.length).toBe(1);
  expect(fill[0]).toBeGreaterThan(0);
  expect(fill[0]).toBeLessThanOrEqual(1);
});
