import { DAYS_PER_YEAR } from '../../../src/sim/clock';
import { join, membershipSystem, membershipsOf } from '../../../src/sim/business/memberships';
import { scheduleDay, teeSheetFor } from '../../../src/sim/golfers/demand';
import { addClubhouse, spawnGolfers, threeHoleCourse } from '../golfers/courseFixture';

function setup(reserved = 4) {
  const fx = threeHoleCourse();
  addClubhouse(fx.g, fx.course);
  const r = fx.g.dispatch({ t: 'setMembershipTier', courseId: fx.course.id, index: 0, tier: { name: 'Full', annualFee: 1500, reservedSlotsPerDay: reserved, includedRounds: 'unlimited' } });
  if (!r.ok) throw new Error(r.reason);
  fx.g.weather.kind = 'sunny';
  return fx;
}
const membersIncome = (g: ReturnType<typeof setup>['g']) => g.ledger.tx.filter(t => t.cat === 'memberships').reduce((s, t) => s + t.in, 0);

test('members take the reserved tee times; the public cannot book them', () => {
  const { g, course } = setup(4);
  const ids = spawnGolfers(g, 40, 3);
  for (const id of ids) { g.golfers.all.get(id)!.traits.loyalty = 1; expect(join(g, course.id, id, 0).ok).toBe(true); }
  expect(membersIncome(g)).toBe(40 * 1500);
  // lots of public demand: free golf
  g.dispatch({ t: 'setGreenFee', courseId: course.id, holes: 3, fee: 0 });
  scheduleDay(g);
  const sheet = teeSheetFor(g, course.id);
  const held = sheet.reserved.get(g.day)!;
  expect(held.size).toBe(4);
  const today = g.groups.filter(x => x.day === g.day);
  const memberGroups = today.filter(x => x.members);
  expect(memberGroups.length).toBeGreaterThan(0);
  for (const grp of today) {
    if (held.has(grp.teeTime)) expect(grp.members).toBe(true);
    if (!grp.members) expect(grp.golferIds.some(id => ids.includes(id))).toBe(false);
  }
  // unlimited membership: members play for free
  for (const grp of memberGroups) expect(grp.feePerGolfer).toBe(0);
});

test('reserved times count only while a tier has members', () => {
  const { g, course } = setup(5);
  scheduleDay(g);
  expect(teeSheetFor(g, course.id).reserved.get(g.day)).toBeUndefined();
});

test('golfers who love the course and visit often sign up', () => {
  const { g, course } = setup();
  const ids = spawnGolfers(g, 60, 9);
  for (const id of ids) {
    const gf = g.golfers.all.get(id)!;
    gf.opinion[course.id] = 80; gf.visits = 12; gf.totalSpend = 12 * 60; gf.traits.loyalty = 0.9; gf.segment = 'premium';
  }
  const casual = spawnGolfers(g, 30, 10);
  for (const id of casual) { const gf = g.golfers.all.get(id)!; gf.opinion[course.id] = 40; gf.visits = 30; gf.totalSpend = 1000; }
  for (let d = 0; d < 30; d++) { membershipSystem.onDay!(g); g.clock.day++; }
  const members = membershipsOf(g, course.id).members.map(x => x.golferId);
  expect(members.length).toBeGreaterThan(5);
  expect(members.some(id => casual.includes(id))).toBe(false);
  expect(membersIncome(g)).toBe(members.length * 1500);
});

test('members renew each year only while their opinion stays above 20', () => {
  const { g, course } = setup();
  const [happy, sour] = spawnGolfers(g, 2, 4);
  join(g, course.id, happy!, 0);
  join(g, course.id, sour!, 0);
  g.golfers.all.get(happy!)!.opinion[course.id] = 35;
  g.golfers.all.get(sour!)!.opinion[course.id] = 10;
  const start = g.day;
  // no renewal mid-year
  g.clock.day = start + 50;
  membershipSystem.onDay!(g);
  expect(membershipsOf(g, course.id).members.length).toBe(2);
  expect(membersIncome(g)).toBe(3000);
  g.clock.day = start + DAYS_PER_YEAR;
  membershipSystem.onDay!(g);
  const left = membershipsOf(g, course.id).members.map(x => x.golferId);
  expect(left).toEqual([happy]);
  expect(membersIncome(g)).toBe(4500);
});

test('a tier with members cannot be deleted', () => {
  const { g, course } = setup();
  const [id] = spawnGolfers(g, 1, 2);
  join(g, course.id, id!, 0);
  expect(g.dispatch({ t: 'setMembershipTier', courseId: course.id, index: 0, tier: null }).ok).toBe(false);
});
