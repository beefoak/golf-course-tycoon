import { Vec2 } from '../../core/geom';
import { PRICE_MAX, PRICE_MIN } from '../land/parcels';
import { DAYS_PER_SEASON } from '../clock';
import type { Game, System } from '../game';
import { GOLFER_TYPES, GolferType, SEGMENTS, Segment } from '../golfers/golfer';
import { registerSaveable } from '../saveRegistry';
import { maybeReview } from './reviews';
import { aestheticsScore, conditionScore, paceScore, valueScore } from './scores';

export interface Reputation {
  /** 0..5 stars */
  overall: number;
  bySegment: Record<Segment, number>;
  byType: Record<GolferType, number>;
  scores: { condition: number; aesthetics: number; pace: number; value: number };
  reviews: number;
  day: number;
}

export interface RepState {
  /** specimen trees felled and the like: aesthetic points lost, fading with time */
  penalties: { courseId: number; day: number; points: number; at: Vec2 }[];
  cache: [number, Reputation][];
}
export function newRepState(): RepState { return { penalties: [], cache: [] }; }

export const HALF_LIFE_DAYS = 60;
/** Reviews' weight against the course's own scores: the scores count as this many reviews. */
export const SCORE_WEIGHT = 6;
export const SPECIMEN_POINTS = 8;
/** Land values move by this much per star above/below 2.5, each month. */
export const LAND_FEEDBACK = 0.04;
export const LAND_REACH_PARCELS = 3;

/** The course's own scores as stars (0..5). */
function scoreStars(s: Reputation['scores']): number {
  return (0.35 * s.condition + 0.25 * s.aesthetics + 0.2 * s.pace + 0.2 * s.value) / 20;
}

export function computeReputation(g: Game, courseId: number): Reputation {
  const scores = { condition: conditionScore(g, courseId), aesthetics: aestheticsScore(g, courseId), pace: paceScore(g, courseId), value: valueScore(g, courseId) };
  const base = scoreStars(scores);
  const acc = { all: [0, 0], seg: new Map<Segment, number[]>(), type: new Map<GolferType, number[]>() };
  let n = 0;
  for (const r of g.reviews) {
    if (r.courseId !== courseId) continue;
    const w = Math.pow(0.5, (g.day - r.day) / HALF_LIFE_DAYS);
    acc.all[0]! += r.stars * w; acc.all[1]! += w;
    const s = acc.seg.get(r.segment) ?? [0, 0]; s[0]! += r.stars * w; s[1]! += w; acc.seg.set(r.segment, s);
    const t = acc.type.get(r.type) ?? [0, 0]; t[0]! += r.stars * w; t[1]! += w; acc.type.set(r.type, t);
    n++;
  }
  const blend = (sum: number, wt: number, prior: number) => Math.round(((sum + SCORE_WEIGHT * prior) / (wt + SCORE_WEIGHT)) * 100) / 100;
  const overall = blend(acc.all[0]!, acc.all[1]!, base);
  const bySegment = {} as Record<Segment, number>;
  for (const s of SEGMENTS) {
    // value looks different to each segment
    const own = scoreStars({ ...scores, value: valueScore(g, courseId, s) });
    const a = acc.seg.get(s) ?? [0, 0];
    bySegment[s] = blend(a[0]!, a[1]!, (own + overall) / 2);
  }
  const byType = {} as Record<GolferType, number>;
  for (const t of GOLFER_TYPES) { const a = acc.type.get(t) ?? [0, 0]; byType[t] = blend(a[0]!, a[1]!, overall); }
  return { overall, bySegment, byType, scores, reviews: n, day: g.day };
}

/** The course's reputation (worked out once a day; on demand the first time). */
export function reputation(g: Game, courseId: number): Reputation {
  const c = g.reputation.get(courseId);
  if (c && c.day === g.day) return c;
  const r = computeReputation(g, courseId);
  g.reputation.set(courseId, r);
  return r;
}

/** Turn pending events (specimen trees felled) into reputation penalties on the course they were near. */
export function drainEvents(g: Game): void {
  for (const e of g.pendingReputationEvents.splice(0)) {
    if (e.kind !== 'specimenRemoved') continue;
    const w = g.world;
    const i = w.inBounds(e.at.x, e.at.y) ? w.idx(e.at.x, e.at.y) : -1;
    let courseId = i >= 0 ? w.courseId[i]! : 0;
    if (!courseId) {
      // nearest course by hole green
      let best = Infinity;
      for (const c of g.courses.list) for (const h of c.holes) {
        const d = Math.hypot(h.greenCenter.x - e.at.x, h.greenCenter.y - e.at.y);
        if (d < best) { best = d; courseId = c.id; }
      }
    }
    if (courseId) g.repState.penalties.push({ courseId, day: g.day, points: SPECIMEN_POINTS, at: { ...e.at } });
  }
  g.repState.penalties = g.repState.penalties.filter(p => g.day - p.day < HALF_LIFE_DAYS * 6);
}

/** Monthly: a well-regarded course lifts the price of the land around it (and a poor one drags it down). */
export function landValueFeedback(g: Game, overall: number): void {
  const p = g.parcels;
  const n = p.perSide;
  const mult = 1 + LAND_FEEDBACK * (overall - 2.5);
  const cap = PRICE_MAX * 1.5;
  for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
    const k = py * n + px;
    if (p.owner[k]) continue;
    let near = false;
    for (let dy = -LAND_REACH_PARCELS; dy <= LAND_REACH_PARCELS && !near; dy++) for (let dx = -LAND_REACH_PARCELS; dx <= LAND_REACH_PARCELS && !near; dx++) {
      if (p.isOwned(px + dx, py + dy)) near = true;
    }
    if (!near) continue;
    p.price[k] = Math.round(Math.max(PRICE_MIN, Math.min(cap, p.priceAt(px, py) * mult)) / 1000) * 1000;
  }
}

export const reputationSystem: System = {
  name: 'reputation',
  onDay(g) {
    drainEvents(g);
    let sum = 0, n = 0;
    for (const c of g.courses.list) {
      if (!c.holes.some(h => h.state === 'open')) continue;
      const r = computeReputation(g, c.id);
      g.reputation.set(c.id, r);
      sum += r.overall; n++;
    }
    if (n && (g.day - 1) % DAYS_PER_SEASON === 0 && g.day > 1) landValueFeedback(g, sum / n);
  },
};

export function attachReputation(g: Game): void {
  g.registerSystem(reputationSystem);
  // registered after the round effects: satisfaction is known by now
  g.events.on('roundComplete', ({ groupId }) => {
    const grp = g.groups.find(x => x.id === groupId);
    if (!grp) return;
    for (const id of grp.golferIds) {
      const gf = g.golfers.all.get(id);
      if (!gf || gf.lastSatisfaction === undefined) continue;
      const mine = g.thoughts.filter(t => t.golferId === id && t.day === g.day);
      maybeReview(g, gf, grp.courseId, gf.lastSatisfaction, mine);
    }
  });
}

registerSaveable({
  key: 'reputation',
  save: g => ({ ...g.repState, cache: [...g.reputation], reviews: g.reviews }),
  load: (g, d) => {
    const s = d as RepState & { reviews?: Game['reviews'] };
    g.repState = { penalties: s.penalties ?? [], cache: [] };
    g.reputation = new Map(s.cache ?? []);
    g.reviews = s.reviews ?? [];
  },
});
