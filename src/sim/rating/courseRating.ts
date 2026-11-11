import { Rng } from '../../core/rng';
import { Hole, TeeKind } from '../course/course';
import { holePar } from '../course/yardage';
import type { Game, System } from '../game';
import { generateGolfer } from '../golfers/generate';
import { Golfer } from '../golfers/golfer';
import { simulateHole } from '../golfers/hole';
import { registerSaveable } from '../saveRegistry';

export const SCRATCH = 0;
export const BOGEY = 20;
export const SLOPE_MIN = 55;
export const SLOPE_MAX = 155;
/** Stats-based stroke index needs this many rounds' worth of hole scores. */
export const SI_MIN_ROUNDS = 100;
/** Samples per hole for the weekly in-game rating (tests and tools can ask for more). */
export const WEEKLY_SAMPLES = 30;

export interface CourseRatingInfo {
  courseRating: number;
  slope: number;
  tee: TeeKind;
  day: number;
  /** open hole ids when rated: a change triggers a re-rate */
  holes: string;
  /** holeId → stroke index */
  strokeIndex: Record<number, number>;
}

function seedOf(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) h = Math.imul(h ^ (x | 0), 0x01000193);
  return h >>> 0;
}

function ratingGolfer(handicap: number): Golfer {
  const gf = generateGolfer(new Rng(handicap + 7), -1 - handicap, { type: 'regular', segment: 'mid' });
  gf.handicap = handicap;
  // a standard player for the rating: average habits
  for (const k of Object.keys(gf.traits) as (keyof Golfer['traits'])[]) gf.traits[k] = 0.5;
  return gf;
}

/** The hole as played from one tee set (falling back to the nearest set the hole has). */
function fromTee(hole: Hole, tee: TeeKind): Hole {
  const order: TeeKind[] = ['championship', 'back', 'middle', 'forward'];
  const want = order.indexOf(tee);
  const box = hole.teeBoxes.slice().sort((a, b) => Math.abs(order.indexOf(a.kind) - want) - Math.abs(order.indexOf(b.kind) - want))[0];
  return box ? { ...hole, teeBoxes: [box] } : hole;
}

/** Run simulations without leaving divots, wear or raked-up bunkers behind. */
function headless<T>(g: Game, fn: () => T): T {
  const wear = g.world.wear.slice(), health = g.world.health.slice();
  try { return fn(); } finally { g.world.wear.set(wear); g.world.health.set(health); }
}

/** Mean strokes for a golfer on a hole (simulated with its own seeded dice). */
function meanScore(g: Game, gf: Golfer, hole: Hole, samples: number): number {
  const rng = new Rng(seedOf(g.seed, hole.id, gf.handicap, samples));
  let total = 0;
  for (let k = 0; k < samples; k++) total += simulateHole(g, gf, hole, rng).strokes;
  return total / samples;
}

function openHoles(g: Game, courseId: number): Hole[] {
  return (g.courses.get(courseId)?.holes ?? []).filter(h => h.state === 'open' && h.teeBoxes.length).sort((a, b) => a.number - b.number);
}

/**
 * Simplified USGA-style rating: a scratch and a bogey golfer play every open hole; the course
 * rating is the scratch score over 18 holes and the slope is how much harder it plays for bogey golfers.
 */
export function rateCourse(g: Game, courseId: number, tee: TeeKind = 'middle', samples = 200): { courseRating: number; slope: number; bogeyRating: number; bogeyVsPar: Map<number, number> } {
  const holes = openHoles(g, courseId);
  if (!holes.length) return { courseRating: 0, slope: 113, bogeyRating: 0, bogeyVsPar: new Map() };
  const scratch = ratingGolfer(SCRATCH), bogey = ratingGolfer(BOGEY);
  return headless(g, () => {
    let s = 0, b = 0;
    const bogeyVsPar = new Map<number, number>();
    for (const h of holes) {
      const hole = fromTee(h, tee);
      s += meanScore(g, scratch, hole, samples);
      const bm = meanScore(g, bogey, hole, samples);
      b += bm;
      bogeyVsPar.set(h.id, bm - holePar(h));
    }
    const scale = 18 / holes.length;
    const courseRating = Math.round(s * scale * 10) / 10;
    const bogeyRating = Math.round(b * scale * 10) / 10;
    const slope = Math.max(SLOPE_MIN, Math.min(SLOPE_MAX, Math.round(113 * (bogeyRating - courseRating) / 17.5)));
    return { courseRating, slope, bogeyRating, bogeyVsPar };
  });
}

/** How much harder than par each hole plays for a bogey golfer: from real scores once there are enough, else simulated. */
export function holeDifficulty(g: Game, courseId: number, samples = 60, simulated?: Map<number, number>): Map<number, number> {
  const holes = openHoles(g, courseId);
  const out = new Map<number, number>();
  const st = g.stats.get(courseId);
  const rounds = st ? Math.min(...holes.map(h => st.playedCount(h.id))) : 0;
  if (st && holes.length && rounds >= SI_MIN_ROUNDS) {
    for (const h of holes) out.set(h.id, st.holeAverage(h.id) - holePar(h));
    return out;
  }
  if (simulated) return simulated;
  const bogey = ratingGolfer(BOGEY);
  headless(g, () => { for (const h of holes) out.set(h.id, meanScore(g, bogey, fromTee(h, 'middle'), samples) - holePar(h)); });
  return out;
}

/**
 * Stroke index 1..N (1 = hardest). Odd indexes go to the front nine and even to the back, the
 * standard allocation; holes with a manual index keep it and the rest share what's left.
 */
export function computeStrokeIndex(g: Game, courseId: number, difficulty = holeDifficulty(g, courseId)): Map<number, number> {
  const holes = openHoles(g, courseId);
  const out = new Map<number, number>();
  const n = holes.length;
  const taken = new Set<number>();
  for (const h of holes) if (h.strokeIndex !== null && h.strokeIndex >= 1 && h.strokeIndex <= n && !taken.has(h.strokeIndex)) { out.set(h.id, h.strokeIndex); taken.add(h.strokeIndex); }
  const free = Array.from({ length: n }, (_, k) => k + 1).filter(k => !taken.has(k));
  const auto = holes.filter(h => !out.has(h.id)).sort((a, b) => (difficulty.get(b.id) ?? 0) - (difficulty.get(a.id) ?? 0) || a.number - b.number);
  const split = n > 9;
  const front = auto.filter(h => !split || h.number <= 9), back = split ? auto.filter(h => h.number > 9) : [];
  if (!split) { front.forEach((h, k) => out.set(h.id, free[k]!)); return out; }
  // hardest front-nine hole takes the lowest odd number, hardest back-nine hole the lowest even, …
  const odd = free.filter(k => k % 2 === 1), even = free.filter(k => k % 2 === 0);
  const give = (list: Hole[], mine: number[], other: number[]) => {
    for (const h of list) { const k = mine.length ? mine.shift()! : other.shift()!; out.set(h.id, k); }
  };
  // whichever side has fewer numbers of its parity borrows the other's leftovers, hardest first
  if (front.length - odd.length <= back.length - even.length) { give(front, odd, even); give(back, even, odd); }
  else { give(back, even, odd); give(front, odd, even); }
  return out;
}

export function ratingOf(g: Game, courseId: number): CourseRatingInfo | undefined {
  return g.ratings.get(courseId);
}

export function refreshRating(g: Game, courseId: number, samples = WEEKLY_SAMPLES): CourseRatingInfo | undefined {
  const holes = openHoles(g, courseId);
  if (!holes.length) { g.ratings.delete(courseId); return undefined; }
  const r = rateCourse(g, courseId, 'middle', samples);
  const si = computeStrokeIndex(g, courseId, holeDifficulty(g, courseId, samples, r.bogeyVsPar));
  const info: CourseRatingInfo = { courseRating: r.courseRating, slope: r.slope, tee: 'middle', day: g.day, holes: holes.map(h => h.id).join(','), strokeIndex: Object.fromEntries(si) };
  g.ratings.set(courseId, info);
  return info;
}

/** Weekly, and whenever the set of open holes changes. */
export const ratingSystem: System = {
  name: 'rating',
  onDay(g) {
    for (const c of g.courses.list) {
      const now = openHoles(g, c.id).map(h => h.id).join(',');
      const cur = g.ratings.get(c.id);
      if (!now) { g.ratings.delete(c.id); continue; }
      if (!cur || cur.holes !== now || g.day - cur.day >= 7) refreshRating(g, c.id);
    }
  },
};

registerSaveable({
  key: 'ratings',
  save: g => [...g.ratings],
  load: (g, d) => { g.ratings = new Map(d as [number, CourseRatingInfo][]); },
});
