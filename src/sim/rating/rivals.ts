import { Rng } from '../../core/rng';
import { DAYS_PER_SEASON } from '../clock';
import { Course } from '../course/course';
import type { Game, System } from '../game';
import { avgFeePer18 } from '../golfers/demand';
import { SEGMENTS, Segment } from '../golfers/golfer';
import { registerSaveable } from '../saveRegistry';
import { reputation } from './reputation';
import { conditionScore } from './scores';

export type RivalStyle = 'municipal' | 'resort' | 'private' | 'links';
export interface Rival {
  id: number;
  name: string;
  holes: 9 | 18 | 27;
  /** 0..5 stars */
  reputation: number;
  /** 0..100 */
  condition: number;
  /** green fee for 18 holes */
  fee: number;
  style: RivalStyle;
  /** stars a month the rival is drifting by */
  trend: number;
  /** closed for renovation (partly) until this day */
  renovatingUntil?: number;
}

const NAMES_A = ['Oak', 'Heather', 'Willow', 'Pine', 'Eagle', 'Fox', 'Stone', 'Kings', 'Meadow', 'River', 'Cedar', 'Hawk', 'Lark', 'Briar'];
const NAMES_B = ['Hollow', 'Ridge', 'Park', 'Downs', 'Valley', 'Heath', 'Brook', 'Glen', 'Point', 'Crossing', 'Bluff', 'Dunes'];
const SUFFIX: Record<RivalStyle, string[]> = { municipal: ['Municipal', 'Public Links', 'Golf Course'], resort: ['Resort', 'Golf Resort'], private: ['Country Club', 'Golf Club'], links: ['Links', 'Golf Links'] };
const STYLE_FEE: Record<RivalStyle, [number, number]> = { municipal: [22, 40], resort: [70, 140], private: [90, 180], links: [45, 95] };
const STYLE_REP: Record<RivalStyle, [number, number]> = { municipal: [1.6, 3], resort: [2.6, 4.2], private: [3, 4.4], links: [2.4, 4] };

/** How much each segment minds the price, and how much they care about the stars. */
const PRICE_SENS: Record<Segment, number> = { budget: 1.6, mid: 0.9, premium: 0.35 };
const REP_SENS: Record<Segment, number> = { budget: 0.8, mid: 1, premium: 1.4 };
/** Share of the region's golfers in each segment. */
export const SEGMENT_SHARE: Record<Segment, number> = { budget: 0.35, mid: 0.45, premium: 0.2 };
/** Regulars stick with what they know. */
export const LOYALTY_BONUS = 0.25;
/** A neutral course: what the demand model is calibrated against. */
const NEUTRAL = { reputation: 2.5, fee: 40, holes: 18 };

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 3–6 rivals, the same for the same seed. */
export function generateRivals(seed: number): Rival[] {
  const rng = new Rng(hashString(`${seed}:rivals`));
  const n = 3 + Math.floor(rng.next() * 4);
  const used = new Set<string>();
  const out: Rival[] = [];
  for (let k = 0; k < n; k++) {
    const style = rng.pick(['municipal', 'municipal', 'resort', 'private', 'links'] as RivalStyle[]);
    let name = '';
    for (let t = 0; t < 10 && (!name || used.has(name)); t++) name = `${rng.pick(NAMES_A)} ${rng.pick(NAMES_B)} ${rng.pick(SUFFIX[style])}`;
    used.add(name);
    const [f0, f1] = STYLE_FEE[style], [r0, r1] = STYLE_REP[style];
    out.push({
      id: k + 1, name, style,
      holes: rng.pick(style === 'municipal' ? [9, 18, 18] as const : style === 'resort' ? [18, 27] as const : [18] as const),
      reputation: Math.round(rng.range(r0, r1) * 10) / 10,
      condition: Math.round(rng.range(50, 92)),
      fee: Math.round(rng.range(f0, f1)),
      trend: Math.round(rng.range(-0.08, 0.08) * 100) / 100,
    });
  }
  return out;
}

export function rivalsOf(g: Game): Rival[] {
  if (!g.rivals) g.rivals = generateRivals(g.seed);
  return g.rivals;
}

function capacity(holes: number, renovating: boolean): number {
  return (holes / 18) * (renovating ? 0.3 : 1);
}
function utility(seg: Segment, stars: number, fee: number, bonus = 0): number {
  return REP_SENS[seg] * stars - PRICE_SENS[seg] * fee / 40 + bonus;
}

/** The share of a segment's golfers who pick this course over everyone else's (logit, weighted by size). */
export function segmentShare(g: Game, course: Course, seg: Segment, neutralRivals = false): number {
  const rep = reputation(g, course.id);
  const open = course.holes.filter(h => h.state === 'open').length;
  const mine = Math.exp(utility(seg, rep.bySegment[seg], avgFeePer18(g, course), LOYALTY_BONUS)) * capacity(Math.max(1, open), false);
  let others = 0;
  for (const r of rivalsOf(g)) {
    const reno = (r.renovatingUntil ?? 0) > g.day;
    others += neutralRivals
      ? Math.exp(utility(seg, NEUTRAL.reputation, NEUTRAL.fee)) * capacity(r.holes, false)
      : Math.exp(utility(seg, r.reputation, r.fee)) * capacity(r.holes, reno);
  }
  // the player's other courses compete too
  for (const c of g.courses.list) {
    if (c.id === course.id || !c.holes.some(h => h.state === 'open')) continue;
    const rc = reputation(g, c.id);
    others += Math.exp(utility(seg, rc.bySegment[seg], avgFeePer18(g, c), LOYALTY_BONUS)) * capacity(c.holes.filter(h => h.state === 'open').length, false);
  }
  return mine / (mine + others);
}

/** How rivals change a segment's demand against a field of ordinary rivals (1 = no effect). */
export function rivalFactor(g: Game, course: Course, seg: Segment): number {
  if (!rivalsOf(g).length) return 1;
  const actual = segmentShare(g, course, seg), neutral = segmentShare(g, course, seg, true);
  return Math.max(0.3, Math.min(1.8, actual / Math.max(1e-6, neutral)));
}

/** All segments together, weighted by how many of each live in the region. */
export function competitionFactor(g: Game, course: Course): number {
  return SEGMENTS.reduce((s, seg) => s + SEGMENT_SHARE[seg] * rivalFactor(g, course, seg), 0);
}

export interface RankRow { name: string; score: number; isPlayer: boolean; reputation: number; holes: number; fee: number }

/** The region's courses by score: reputation first, then condition, with a little for size. */
export function regionalRanking(g: Game): RankRow[] {
  const rows: RankRow[] = rivalsOf(g).map(r => ({ name: r.name, isPlayer: false, reputation: r.reputation, holes: r.holes, fee: r.fee, score: Math.round((r.reputation * 18 + r.condition * 0.12 + (r.holes >= 18 ? 4 : 0)) * 10) / 10 }));
  for (const c of g.courses.list) {
    const open = c.holes.filter(h => h.state === 'open').length;
    if (!open) continue;
    const rep = reputation(g, c.id);
    rows.push({ name: c.name, isPlayer: true, reputation: rep.overall, holes: open, fee: Math.round(avgFeePer18(g, c)), score: Math.round((rep.overall * 18 + conditionScore(g, c.id) * 0.12 + (open >= 18 ? 4 : 0)) * 10) / 10 });
  }
  return rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** Monthly drift: trends, fee tweaks, and the odd renovation. */
export function driftRivals(g: Game): void {
  const rng = new Rng(hashString(`${g.seed}:drift:${g.day}`));
  for (const r of rivalsOf(g)) {
    if (r.renovatingUntil !== undefined && r.renovatingUntil <= g.day) {
      delete r.renovatingUntil;
      r.reputation = Math.min(4.8, r.reputation + 0.3);
      r.condition = Math.min(95, r.condition + 10);
      g.notify('info', `${r.name} has reopened after its renovation`);
    }
    r.reputation = Math.round(Math.max(1, Math.min(4.8, r.reputation + r.trend + rng.normal(0, 0.05))) * 100) / 100;
    r.condition = Math.round(Math.max(35, Math.min(95, r.condition + rng.normal(0, 3))));
    if (rng.chance(0.25)) r.fee = Math.max(10, Math.round(r.fee * rng.range(0.93, 1.08)));
    if (rng.chance(0.15)) r.trend = Math.round(Math.max(-0.1, Math.min(0.1, r.trend + rng.normal(0, 0.03))) * 100) / 100;
    if (r.renovatingUntil === undefined && (r.condition < 55 || r.reputation < 2) && rng.chance(0.3)) {
      r.renovatingUntil = g.day + DAYS_PER_SEASON;
      g.notify('info', `${r.name} is closing for a season of renovations`);
    }
  }
}

export const rivalSystem: System = {
  name: 'rivals',
  onDay(g) {
    rivalsOf(g);
    if (g.day > 1 && (g.day - 1) % DAYS_PER_SEASON === 0) driftRivals(g);
  },
};

registerSaveable({
  key: 'rivals',
  save: g => rivalsOf(g),
  load: (g, d) => { g.rivals = d as Rival[]; },
});
