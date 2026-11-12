import { DAYS_PER_YEAR } from '../clock';
import type { Game, System } from '../game';
import { statementFor } from '../economy/reports';
import { registerSaveable } from '../saveRegistry';
import { reputation } from './reputation';
import { regionalRanking } from './rivals';
import { UnlockKey, unlock } from './unlocks';

export type MilestoneKey = 'open9' | 'open18' | 'reputation4' | 'clubChampionship' | 'profitableYear2' | 'allFourTees' | 'firstMember' | 'regionalTop3';

export interface MilestoneDef { label: string; grant: number; unlocks: UnlockKey[] }
export const MILESTONES: Record<MilestoneKey, MilestoneDef> = {
  open9: { label: 'Nine holes open', grant: 50_000, unlocks: [] },
  open18: { label: 'A full eighteen', grant: 150_000, unlocks: ['premiumSand', 'multiCourse'] },
  reputation4: { label: 'Four-star reputation', grant: 100_000, unlocks: ['lodging', 'equipmentTier3'] },
  clubChampionship: { label: 'First club championship', grant: 25_000, unlocks: [] },
  profitableYear2: { label: 'In the black in year two', grant: 100_000, unlocks: [] },
  allFourTees: { label: 'Every hole with all four tees', grant: 30_000, unlocks: [] },
  firstMember: { label: 'Your first member', grant: 10_000, unlocks: [] },
  regionalTop3: { label: 'Regional top three', grant: 200_000, unlocks: ['exoticGrass'] },
};
export const MILESTONE_KEYS = Object.keys(MILESTONES) as MilestoneKey[];

/** Has the milestone been reached (and when)? */
export function milestoneDay(g: Game, key: MilestoneKey): number | undefined {
  return g.milestones[key];
}

/** Reach a milestone: once only, with its grant and unlocks. */
export function award(g: Game, key: MilestoneKey): boolean {
  if (g.milestones[key] !== undefined) return false;
  g.milestones[key] = g.day;
  const def = MILESTONES[key];
  if (def.grant && !g.ledger.unlimited) g.ledger.earn(def.grant, 'other', g.day);
  g.notify('info', `Milestone: ${def.label}${def.grant ? ` — a $${def.grant.toLocaleString()} grant` : ''}`);
  g.events.emit('milestone', { key });
  for (const u of def.unlocks) unlock(g, u);
  // pro tour events need both the stars and the standing
  if (g.milestones.reputation4 !== undefined && g.milestones.regionalTop3 !== undefined) unlock(g, 'proTour');
  return true;
}

function openCount(g: Game): number {
  return Math.max(0, ...g.courses.list.map(c => c.holes.filter(h => h.state === 'open').length));
}

export function checkMilestones(g: Game): void {
  const open = openCount(g);
  if (open >= 9) award(g, 'open9');
  if (open >= 18) award(g, 'open18');
  const playing = g.courses.list.filter(c => c.holes.some(h => h.state === 'open'));
  if (playing.some(c => reputation(g, c.id).overall >= 4)) award(g, 'reputation4');
  if (playing.some(c => {
    const holes = c.holes.filter(h => h.state === 'open');
    return holes.length >= 9 && holes.every(h => new Set(h.teeBoxes.map(t => t.kind)).size >= 4);
  })) award(g, 'allFourTees');
  if ([...g.memberships.values()].some(m => m.members.length > 0)) award(g, 'firstMember');
  if (playing.length) {
    const top = regionalRanking(g).slice(0, 3);
    if (top.some(r => r.isPlayer)) award(g, 'regionalTop3');
  }
  // year two's books close on the first day of year three
  if (g.day === DAYS_PER_YEAR * 2 + 1 && statementFor(g, null, DAYS_PER_YEAR + 1, DAYS_PER_YEAR * 2).operatingProfit > 0) award(g, 'profitableYear2');
}

export const milestoneSystem: System = {
  name: 'milestones',
  onDay(g) { checkMilestones(g); },
};

registerSaveable({
  key: 'milestones',
  save: g => ({ milestones: g.milestones, unlocks: g.unlocks }),
  load: (g, d) => {
    const s = d as { milestones: Game['milestones']; unlocks: Game['unlocks'] };
    g.milestones = s.milestones ?? {};
    g.unlocks = s.unlocks ?? [];
  },
});
