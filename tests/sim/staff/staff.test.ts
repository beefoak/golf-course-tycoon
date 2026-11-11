import { Game } from '../../../src/sim/game';
import { generateCandidates } from '../../../src/sim/staff/market';
import { STARTER_CREW } from '../../../src/sim/staff/roles';
import { SEVERANCE_DAYS, TRAINING_COST, skillAvg } from '../../../src/sim/staff/staff';
import { deserialize, serialize } from '../../../src/sim/save';
import { newOwnedGame } from '../../helpers';

function hireFirst(g: Game, role: Parameters<typeof generateCandidates>[1], courseId = 1) {
  const c = generateCandidates(g, role)[0]!;
  return { c, r: g.dispatch({ t: 'hireStaff', candidateId: c.candidateId, courseId }) };
}
const nextDay = (g: Game) => { const d = g.day; while (g.day === d) g.tick(); };

test('candidates: weekly pool, better people ask more, deterministic', () => {
  const g = newOwnedGame();
  const a = generateCandidates(g, 'greenkeeper');
  expect(a.length).toBe(5);
  expect(generateCandidates(g, 'greenkeeper')).toEqual(a);
  // across 20 weekly pools, the more skilled half asks more on average
  let hi = 0, lo = 0;
  for (let w = 0; w < 20; w++) {
    g.clock.day = 1 + w * 7;
    const pool = [...generateCandidates(g, 'greenkeeper')].sort((x, y) => skillAvg(x) - skillAvg(y));
    lo += pool[0]!.wagePerDay + pool[1]!.wagePerDay;
    hi += pool[3]!.wagePerDay + pool[4]!.wagePerDay;
  }
  expect(hi).toBeGreaterThan(lo * 1.1);
  g.clock.day = 8;
  expect(generateCandidates(g, 'greenkeeper')[0]!.candidateId).not.toBe(a[0]!.candidateId);
});

test('hiring charges nothing up front but adds a daily wage', () => {
  const g = newOwnedGame();
  const cash = g.ledger.cash;
  const { c, r } = hireFirst(g, 'greenkeeper');
  expect(r.ok).toBe(true);
  expect(g.ledger.cash).toBe(cash);
  expect(generateCandidates(g, 'greenkeeper').some(x => x.candidateId === c.candidateId)).toBe(false);
  nextDay(g);
  expect(g.ledger.totals(0, g.day).wages.out).toBe(c.wagePerDay);
});

test(`a ${STARTER_CREW + 1}th greenkeeper needs a maintenance building`, () => {
  const g = newOwnedGame();
  for (let k = 0; k < STARTER_CREW; k++) {
    const c = generateCandidates(g, 'greenkeeper')[0]!;
    expect(g.dispatch({ t: 'hireStaff', candidateId: c.candidateId, courseId: 1 }).ok).toBe(true);
  }
  const r = hireFirst(g, 'greenkeeper').r;
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(/maintenance/);
  // roles that need a building say so
  const m = hireFirst(g, 'mechanic').r;
  expect(m.ok).toBe(false);
});

test('firing pays severance; training costs, takes days off and raises the skill', () => {
  const g = newOwnedGame();
  const s = (hireFirst(g, 'greenkeeper').r as { ok: true; value: { id: number; wagePerDay: number; skills: { mowing?: number } } }).value;
  const before = s.skills.mowing ?? 0;
  const cash = g.ledger.cash;
  expect(g.dispatch({ t: 'trainStaff', id: s.id, skill: 'mowing' }).ok).toBe(true);
  expect(cash - g.ledger.cash).toBe(TRAINING_COST);
  expect((s.skills.mowing ?? 0) - before).toBeGreaterThanOrEqual(Math.min(8, 100 - before));
  expect(g.dispatch({ t: 'trainStaff', id: s.id, skill: 'greens' }).ok).toBe(false); // already away
  const c2 = g.ledger.cash;
  expect(g.dispatch({ t: 'fireStaff', id: s.id }).ok).toBe(true);
  expect(c2 - g.ledger.cash).toBe(s.wagePerDay * SEVERANCE_DAYS);
  expect(g.staff.all.length).toBe(0);
});

test('staff survive save/load', () => {
  const g = newOwnedGame();
  hireFirst(g, 'superintendent');
  const r = deserialize(serialize(g));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.staff.all.map(s => s.name)).toEqual(g.staff.all.map(s => s.name));
    expect(generateCandidates(r.value, 'superintendent')).toEqual(generateCandidates(g, 'superintendent'));
  }
});
