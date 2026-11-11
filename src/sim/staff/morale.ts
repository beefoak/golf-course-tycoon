import type { Game, System } from '../game';
import { marketWage } from './roles';
import { Staff, shiftHours, skillAvg } from './staff';

/** Morale inputs owned by later systems (equipment Task 30, staff room Task 30, workload Task 31). */
export const moraleHooks = {
  equipment: (_g: Game, _s: Staff): number => 0,
  staffRoom: (_g: Game, _s: Staff): number => 0,
};

export const QUIT_BELOW = 25;

/** One day's morale change for a staff member. */
export function moraleDelta(g: Game, s: Staff): number {
  let d = 0;
  const market = marketWage(s.role, skillAvg(s));
  d += Math.max(-6, Math.min(4, (s.wagePerDay / Math.max(1, market) - 1) * 25));
  const hours = shiftHours(s);
  if (hours > 9) d -= (hours - 9) * 1.5;
  if (s.fatigue > 70) d -= 2;
  d += moraleHooks.equipment(g, s);
  d += moraleHooks.staffRoom(g, s);
  if (g.staff.all.some(o => o !== s && o.courseId === s.courseId && o.traits.includes('mentor'))) d += 1;
  if (s.traits.includes('grumpy')) d -= 0.5;
  // people settle back toward content over time
  d += (60 - s.morale) * 0.05;
  return d;
}

/** Daily chance of handing in notice. */
export function quitChance(s: Staff): number {
  if (s.morale >= QUIT_BELOW) return 0;
  const p = 0.05 + (0.1 * (QUIT_BELOW - s.morale)) / QUIT_BELOW;
  return s.traits.includes('loyal') ? p / 2 : p;
}

/** Share of work done badly (skipped tiles, scalping) from low morale and carelessness. */
export function errorRate(s: Staff): number {
  let e = s.morale < 50 ? (50 - s.morale) / 100 : 0;
  if (s.traits.includes('careless')) e += 0.1;
  if (s.traits.includes('perfectionist')) e *= 0.5;
  return Math.min(0.8, e);
}

export const moraleSystem: System = {
  name: 'morale',
  onDay(g) {
    const quits: Staff[] = [];
    for (const s of g.staff.all) {
      g.ledger.charge(s.wagePerDay, 'wages', g.day, s.courseId);
      s.morale = Math.max(0, Math.min(100, Math.round((s.morale + moraleDelta(g, s)) * 10) / 10));
      s.fatigue = Math.max(0, s.fatigue - 40);
      if (g.staffRng.chance(quitChance(s))) quits.push(s);
    }
    for (const s of quits) {
      g.staff.remove(g, s.id);
      g.notify('bad', `${s.name} (${s.role}) has quit — morale was ${Math.round(s.morale)}`);
    }
    if (g.staff.all.length) g.events.emit('cash', { cash: g.ledger.cash });
  },
};
