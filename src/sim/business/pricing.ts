import { Result, fail, ok } from '../../core/result';
import { DAYS_PER_SEASON, DAYS_PER_YEAR, DAY_END_MIN, Season } from '../clock';
import { Course } from '../course/course';
import type { Game, System } from '../game';

/**
 * Green fee pricing for a course. `greenFee` is the base (peak, weekday) fee by round length;
 * the bands, weekend and season multipliers scale it, and dynamic pricing (run by a general
 * manager) nudges it weekly toward a full-but-not-packed tee sheet.
 * Cart fees and range buckets live with the carts (see carts.ts).
 */
export interface Pricing {
  /** fee per golfer by round length (holes) at peak on a weekday */
  greenFee: Record<number, number>;
  /** time-of-day multipliers of the base fee */
  bands?: { peak: number; offPeak: number; twilight: number };
  weekendMult?: number;
  seasonMult?: Partial<Record<Season, number>>;
  dynamic?: boolean;
  /** 0.75..1.25: the general manager's current adjustment */
  dynamicMult?: number;
  /** tee-sheet fill (0..1) for recent days, newest last */
  fill?: number[];
}

export const DEFAULT_FEE_PER_HOLE = 4;
export const DEFAULT_BANDS = { peak: 1, offPeak: 0.85, twilight: 0.6 };
export const DEFAULT_WEEKEND = 1.15;
export const DEFAULT_SEASON: Record<Season, number> = { spring: 1, summer: 1.1, autumn: 0.95, winter: 0.8 };
export const PEAK_START = 7 * 60;
export const PEAK_END = 11 * 60;
/** Twilight starts this long before sunset. */
export const TWILIGHT_BEFORE_SUNSET = 4 * 60;
export const SUNSET = DAY_END_MIN;
export const FILL_TARGET = 0.85;
export const DYNAMIC_LIMIT = 0.25;
/** Share of tee times in each band (roughly how golfers book), for demand's average price. */
const BAND_MIX = { peak: 0.55, offPeak: 0.3, twilight: 0.15 };

export type Band = 'peak' | 'offPeak' | 'twilight';

export function greenFee(p: Pricing | undefined, holes: number): number {
  return p?.greenFee[holes] ?? DEFAULT_FEE_PER_HOLE * holes;
}
export function bandAt(minute: number): Band {
  if (minute >= SUNSET - TWILIGHT_BEFORE_SUNSET) return 'twilight';
  return minute >= PEAK_START && minute < PEAK_END ? 'peak' : 'offPeak';
}
/** Days 6 and 7 of each week are the weekend. */
export function isWeekend(day: number): boolean {
  return (day - 1) % 7 >= 5;
}
export function seasonOf(day: number): Season {
  return (['spring', 'summer', 'autumn', 'winter'] as const)[Math.floor(((day - 1) % DAYS_PER_YEAR) / DAYS_PER_SEASON)]!;
}

function dayMult(p: Pricing | undefined, day: number): number {
  const wk = isWeekend(day) ? p?.weekendMult ?? DEFAULT_WEEKEND : 1;
  const season = p?.seasonMult?.[seasonOf(day)] ?? DEFAULT_SEASON[seasonOf(day)];
  return wk * season * (p?.dynamicMult ?? 1);
}

/** What one golfer pays for a round of `holes` teeing off at `minute` on `day`. */
export function priceFor(g: Game, course: Course, day: number, minute: number, holes: number): number {
  const p = g.pricing.get(course.id);
  const band = (p?.bands ?? DEFAULT_BANDS)[bandAt(minute)];
  return Math.round(greenFee(p, holes) * band * dayMult(p, day));
}

/** Today's average fee for a round of `holes`, weighting the bands by how golfers book. */
export function averagePrice(g: Game, course: Course, day: number, holes: number): number {
  const p = g.pricing.get(course.id);
  const b = p?.bands ?? DEFAULT_BANDS;
  const mix = BAND_MIX.peak * b.peak + BAND_MIX.offPeak * b.offPeak + BAND_MIX.twilight * b.twilight;
  return greenFee(p, holes) * mix * dayMult(p, day);
}

export function pricingOf(g: Game, courseId: number): Pricing {
  let p = g.pricing.get(courseId);
  if (!p) { p = { greenFee: {} }; g.pricing.set(courseId, p); }
  return p;
}

/** Called once a day after booking: how full the tee sheet is. */
export function recordFill(g: Game, courseId: number, fill: number): void {
  const p = pricingOf(g, courseId);
  p.fill = [...(p.fill ?? []), Math.max(0, Math.min(1, fill))].slice(-7);
}

export function hasManager(g: Game, courseId: number): boolean {
  return g.staff.all.some(s => s.role === 'generalManager' && s.courseId === courseId);
}

/** Weekly: the general manager moves prices toward an 85% full tee sheet, within ±25%. */
export function adjustDynamic(g: Game, courseId: number): void {
  const p = g.pricing.get(courseId);
  if (!p?.dynamic || !p.fill?.length || !hasManager(g, courseId)) return;
  const fill = p.fill.reduce((s, x) => s + x, 0) / p.fill.length;
  const step = Math.max(-0.1, Math.min(0.1, (fill - FILL_TARGET) * 0.6));
  const m = (p.dynamicMult ?? 1) * (1 + step);
  p.dynamicMult = Math.round(Math.max(1 - DYNAMIC_LIMIT, Math.min(1 + DYNAMIC_LIMIT, m)) * 1000) / 1000;
}

export const pricingSystem: System = {
  name: 'pricing',
  onDay(g) {
    if ((g.day - 1) % 7 !== 0) return;
    for (const c of g.courses.list) adjustDynamic(g, c.id);
  },
};

export interface PricingPatch {
  bands?: { peak: number; offPeak: number; twilight: number };
  weekendMult?: number;
  seasonMult?: Partial<Record<Season, number>>;
  dynamic?: boolean;
}

export function setPricing(g: Game, courseId: number, patch: PricingPatch): Result<Pricing> {
  if (!g.courses.get(courseId)) return fail('No such course');
  const inRange = (x: unknown) => typeof x === 'number' && x >= 0.3 && x <= 2;
  if (patch.bands && !Object.values(patch.bands).every(inRange)) return fail('Band prices must be 30%–200% of the base fee');
  if (patch.weekendMult !== undefined && !inRange(patch.weekendMult)) return fail('Weekend price must be 30%–200%');
  if (patch.seasonMult && !Object.values(patch.seasonMult).every(inRange)) return fail('Season prices must be 30%–200%');
  if (patch.dynamic && !hasManager(g, courseId)) return fail('Dynamic pricing needs a general manager');
  const p = pricingOf(g, courseId);
  if (patch.bands) p.bands = { ...patch.bands };
  if (patch.weekendMult !== undefined) p.weekendMult = patch.weekendMult;
  if (patch.seasonMult) p.seasonMult = { ...p.seasonMult, ...patch.seasonMult };
  if (patch.dynamic !== undefined) { p.dynamic = patch.dynamic; if (!p.dynamic) p.dynamicMult = 1; }
  return ok(p);
}
