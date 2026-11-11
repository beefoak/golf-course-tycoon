import { Game } from '../../../src/sim/game';
import { generateCandidates } from '../../../src/sim/staff/market';
import { moraleSystem } from '../../../src/sim/staff/morale';
import { marketWage } from '../../../src/sim/staff/roles';
import { Staff, skillAvg } from '../../../src/sim/staff/staff';

function withKeeper(seed: number): { g: Game; s: Staff } {
  const g = Game.create({ seed, terrain: 'parkland', difficulty: 'normal', size: 50 });
  const c = generateCandidates(g, 'greenkeeper').find(x => !x.traits.includes('loyal'))!;
  const r = g.dispatch({ t: 'hireStaff', candidateId: c.candidateId, courseId: 1 });
  if (!r.ok) throw new Error(r.reason);
  return { g, s: r.value as Staff };
}
const days = (g: Game, n: number) => { for (let k = 0; k < n; k++) { moraleSystem.onDay!(g); g.clock.day++; } };

test('low wage and long hours lower morale over a week', () => {
  const fair = withKeeper(1), squeezed = withKeeper(1);
  fair.s.morale = squeezed.s.morale = 65;
  fair.s.wagePerDay = marketWage('greenkeeper', skillAvg(fair.s));
  squeezed.s.wagePerDay = Math.round(fair.s.wagePerDay * 0.6);
  squeezed.s.shift = { startMin: 300, endMin: 300 + 13 * 60 };
  days(fair.g, 7); days(squeezed.g, 7);
  expect(squeezed.s.morale).toBeLessThan(fair.s.morale - 15);
  expect(squeezed.s.morale).toBeLessThan(50);
});

test('morale below 25 leads to resignation within 30 days in ≥ 90% of 200 trials', () => {
  let quit = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const { g, s } = withKeeper(seed);
    s.morale = 15;
    s.wagePerDay = Math.round(marketWage('greenkeeper', skillAvg(s)) * 0.5);
    s.shift = { startMin: 300, endMin: 300 + 12 * 60 };
    days(g, 30);
    if (!g.staff.all.length) quit++;
  }
  expect(quit / 200).toBeGreaterThanOrEqual(0.9);
});

test('happy, fairly paid staff do not quit', () => {
  let quit = 0;
  for (let seed = 1; seed <= 50; seed++) {
    const { g, s } = withKeeper(seed);
    s.morale = 70;
    s.wagePerDay = marketWage('greenkeeper', skillAvg(s));
    days(g, 30);
    if (!g.staff.all.length) quit++;
  }
  expect(quit).toBe(0);
});
