import { Rng, hashString } from '../../core/rng';
import type { Game } from '../game';
import { FIRST_NAMES, LAST_NAMES } from '../golfers/names';
import { ROLES, RoleId, SKILLS, SkillId, StaffTrait, TRAITS, marketWage } from './roles';
import { Candidate, skillAvg } from './staff';

/** Job-market quality multiplier (reputation, Task 40; 1.0 until then). */
/** Better-regarded clubs attract better candidates: 2.5 stars is ordinary. */
export const marketHooks = {
  quality: (g: Game): number => {
    const r = [...g.reputation.values()];
    const stars = r.length ? r.reduce((s, x) => s + x.overall, 0) / r.length : 2.5;
    return 0.85 + 0.06 * stars;
  },
};

export function marketWeek(g: Game): number {
  return Math.floor((g.day - 1) / 7);
}

/**
 * This week's candidates for a role. The pool is a pure function of (seed, role, week), so it
 * refreshes weekly, needs no saving, and hiring someone only removes them.
 */
export function generateCandidates(g: Game, role: RoleId, count = 5): Candidate[] {
  const week = marketWeek(g);
  const rng = new Rng(hashString(`${g.seed}:${role}:${week}`));
  const q = marketHooks.quality(g);
  const spec = ROLES[role];
  const out: Candidate[] = [];
  for (let k = 0; k < count; k++) {
    const level = Math.max(5, Math.min(95, rng.normal(45 * q, 18)));
    const skills: Partial<Record<SkillId, number>> = {};
    for (const s of spec.skills) skills[s] = Math.round(Math.max(1, Math.min(100, level + rng.normal(0, 10))));
    // a little breadth outside the role
    const extra = rng.pick(SKILLS);
    if (skills[extra] === undefined) skills[extra] = Math.round(Math.max(1, Math.min(60, rng.normal(25, 12))));
    const traits: StaffTrait[] = [];
    for (const t of TRAITS) if (rng.chance(0.12) && !(t === 'careless' && traits.includes('perfectionist')) && !(t === 'perfectionist' && traits.includes('careless'))) traits.push(t);
    const c: Candidate = {
      candidateId: `${week}-${role}-${k}`,
      name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
      role, skills, traits,
      speed: Math.round(Math.max(0.6, Math.min(1.4, rng.normal(1, 0.15)) + (traits.includes('fast') ? 0.15 : 0)) * 100) / 100,
      reliability: Math.round(Math.max(0.4, Math.min(1, rng.normal(0.8, 0.12))) * 100) / 100,
      morale: Math.round(rng.range(55, 80)),
      wagePerDay: 0,
      shift: { ...spec.shift, startMin: spec.shift.startMin - (traits.includes('earlyRiser') ? 30 : 0) },
    };
    // better people ask for more
    c.wagePerDay = Math.round(marketWage(role, skillAvg(c)) * rng.range(0.92, 1.12));
    out.push(c);
  }
  return out.filter(c => !g.staff.hiredCandidates.has(c.candidateId));
}

export function findCandidate(g: Game, candidateId: string): Candidate | null {
  const [, role] = candidateId.split('-') as [string, RoleId];
  if (!ROLES[role]) return null;
  return generateCandidates(g, role).find(c => c.candidateId === candidateId) ?? null;
}
