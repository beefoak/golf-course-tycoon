import { Result, fail, ok } from '../../core/result';
import { DAYS_PER_YEAR } from '../clock';
import { Course } from '../course/course';
import type { Game, System } from '../game';
import { Golfer } from '../golfers/golfer';
import { createGroup } from '../golfers/groups';
import { TeeSheet, roundHoles, roundOptions } from '../golfers/teeSheet';
import { registerSaveable } from '../saveRegistry';
import { isClosedSeason, weatherDemandFactor } from '../turf/weather';
import { priceFor } from './pricing';

export interface MembershipTier {
  name: string;
  annualFee: number;
  /** tee times held for members each day while the tier has members */
  reservedSlotsPerDay: number;
  includedRounds: 'unlimited' | number;
}
export interface Member { golferId: number; tier: number; joinDay: number; roundsThisYear: number }
export interface Memberships { courseId: number; tiers: MembershipTier[]; members: Member[] }

/** Golfers who like the place this much, and have been this often, may join. */
export const JOIN_OPINION = 50;
export const JOIN_VISITS = 5;
/** A member renews each year only if their opinion is still above this. */
export const RENEW_OPINION = 20;
/** Members' tee times start at 07:00. */
export const MEMBER_TEE_FROM = 7 * 60;
export const MAX_TIERS = 4;
const SEGMENT_JOIN = { budget: 0.4, mid: 1, premium: 1.6 } as const;

function hash01(a: number, b: number, c: number): number {
  return ((Math.imul(a ^ Math.imul(b + c * 7919, 0x9e3779b1), 0x85ebca6b) >>> 8) & 0xffff) / 65536;
}

export function membershipsOf(g: Game, courseId: number): Memberships {
  let m = g.memberships.get(courseId);
  if (!m) { m = { courseId, tiers: [], members: [] }; g.memberships.set(courseId, m); }
  return m;
}
export function memberOf(g: Game, courseId: number, golferId: number): Member | undefined {
  return g.memberships.get(courseId)?.members.find(x => x.golferId === golferId);
}

/** Tee times held for members today: each tier with members holds its share. */
export function reservedSlots(g: Game, courseId: number): number {
  const m = g.memberships.get(courseId);
  if (!m) return 0;
  return m.tiers.reduce((s, t, i) => s + (m.members.some(x => x.tier === i) ? t.reservedSlotsPerDay : 0), 0);
}

/** One golfer's daily chance of signing up for a tier (0 unless they qualify). */
export function joinChance(g: Game, courseId: number, gf: Golfer, tier: MembershipTier): number {
  if ((gf.opinion[courseId] ?? 0) <= JOIN_OPINION || gf.visits <= JOIN_VISITS) return 0;
  // what a year of their usual golf would cost them against the membership fee
  const yearly = (gf.totalSpend / Math.max(1, gf.visits)) * 30;
  const value = Math.min(2, Math.pow(yearly / Math.max(100, tier.annualFee), 0.8));
  return Math.min(0.2, 0.03 * (0.3 + gf.traits.loyalty) * SEGMENT_JOIN[gf.segment] * value * (1 + ((gf.opinion[courseId] ?? 0) - JOIN_OPINION) / 50));
}

/** A golfer joins: the year's fee is booked today. */
export function join(g: Game, courseId: number, golferId: number, tier: number): Result {
  const m = membershipsOf(g, courseId);
  const t = m.tiers[tier];
  if (!t) return fail('No such membership tier');
  if (memberOf(g, courseId, golferId)) return fail('Already a member');
  m.members.push({ golferId, tier, joinDay: g.day, roundsThisYear: 0 });
  g.ledger.earn(t.annualFee, 'memberships', g.day, courseId);
  const gf = g.golfers.all.get(golferId);
  if (gf) gf.totalSpend += t.annualFee;
  return ok(undefined);
}

/** Anniversaries: happy members pay again, the rest let it lapse. */
function renewals(g: Game, m: Memberships): void {
  const keep: Member[] = [];
  let lapsed = 0;
  for (const x of m.members) {
    const t = m.tiers[x.tier];
    const due = g.day > x.joinDay && (g.day - x.joinDay) % DAYS_PER_YEAR === 0;
    if (!t) { lapsed++; continue; }
    if (!due) { keep.push(x); continue; }
    const gf = g.golfers.all.get(x.golferId);
    if (gf && (gf.opinion[m.courseId] ?? 0) > RENEW_OPINION) {
      g.ledger.earn(t.annualFee, 'memberships', g.day, m.courseId);
      gf.totalSpend += t.annualFee;
      x.roundsThisYear = 0;
      keep.push(x);
    } else lapsed++;
  }
  m.members = keep;
  if (lapsed) g.notify('info', `${lapsed} member${lapsed > 1 ? 's' : ''} didn't renew`);
}

function signUps(g: Game, m: Memberships): void {
  if (!m.tiers.length) return;
  let joined = 0;
  for (const gf of g.golfers.all.values()) {
    if (memberOf(g, m.courseId, gf.id)) continue;
    // each candidate looks at the tier that suits them best
    let best = -1, bestP = 0;
    m.tiers.forEach((t, i) => { const p = joinChance(g, m.courseId, gf, t); if (p > bestP) { bestP = p; best = i; } });
    if (best < 0 || hash01(gf.id, g.day, 31) >= bestP) continue;
    if (join(g, m.courseId, gf.id, best).ok) joined++;
  }
  if (joined) g.notify('info', `${joined} new member${joined > 1 ? 's' : ''} joined`);
}

/**
 * Morning bookings for members: hold the reserved tee times, then members who fancy a game today
 * take them (spilling into public times if the held ones run out). Returns the golfer ids booked.
 */
export function bookMembers(g: Game, course: Course, sheet: TeeSheet): Set<number> {
  const playing = new Set<number>();
  const m = g.memberships.get(course.id);
  const opts = roundOptions(course);
  if (!opts.length) { sheet.reserved.delete(g.day); return playing; }
  const len = opts[opts.length - 1]!;
  const held = sheet.reserve(g.day, reservedSlots(g, course.id), MEMBER_TEE_FROM, len);
  if (!m?.members.length) return playing;
  const want = 0.3 * (isClosedSeason(g) ? 0 : weatherDemandFactor(g.weather));
  const today = m.members.filter(x => {
    const gf = g.golfers.all.get(x.golferId);
    return gf && gf.lastVisitDay !== g.day && hash01(x.golferId, g.day, 41) < want * (0.6 + 0.8 * gf.traits.loyalty);
  });
  for (let k = 0; k < today.length; k += 4) {
    const four = today.slice(k, k + 4);
    const minute = held.find(t => sheet.isFree(g.day, t, len, true)) ?? sheet.nearestFree(g.day, MEMBER_TEE_FROM, len, true);
    if (minute === null) break;
    const grp = createGroup(g, course.id, four.map(x => x.golferId), g.day, minute, roundHoles(course, len));
    // included rounds are free; beyond them members pay the going rate
    const tier = (x: Member) => m.tiers[x.tier];
    const free = four.every(x => { const t = tier(x); return t && (t.includedRounds === 'unlimited' || x.roundsThisYear < t.includedRounds); });
    grp.feePerGolfer = free ? 0 : priceFor(g, course, g.day, minute, len);
    grp.members = true;
    for (const x of four) { x.roundsThisYear++; playing.add(x.golferId); }
    sheet.book(g.day, minute, grp.id, len, four.length, true);
  }
  return playing;
}

export const membershipSystem: System = {
  name: 'memberships',
  onDay(g) {
    for (const m of g.memberships.values()) { renewals(g, m); signUps(g, m); }
  },
};

export function setMembershipTier(g: Game, courseId: number, index: number, tier: MembershipTier | null): Result {
  if (!g.courses.get(courseId)) return fail('No such course');
  const m = membershipsOf(g, courseId);
  if (!Number.isInteger(index) || index < 0 || index > m.tiers.length || index >= MAX_TIERS) return fail(`Up to ${MAX_TIERS} membership tiers`);
  if (tier === null) {
    if (index >= m.tiers.length) return fail('No such membership tier');
    if (m.members.some(x => x.tier === index)) return fail('That tier still has members');
    m.tiers.splice(index, 1);
    for (const x of m.members) if (x.tier > index) x.tier--;
    return ok(undefined);
  }
  if (!tier.name.trim()) return fail('Name the tier');
  if (!(tier.annualFee >= 0 && tier.annualFee <= 100_000)) return fail('Annual fee must be $0–$100,000');
  if (!(Number.isInteger(tier.reservedSlotsPerDay) && tier.reservedSlotsPerDay >= 0 && tier.reservedSlotsPerDay <= 30)) return fail('Reserve 0–30 tee times a day');
  if (tier.includedRounds !== 'unlimited' && !(Number.isInteger(tier.includedRounds) && tier.includedRounds >= 0)) return fail('Included rounds must be a whole number or unlimited');
  m.tiers[index] = { ...tier, name: tier.name.trim().slice(0, 30) };
  return ok(undefined);
}

registerSaveable({
  key: 'memberships',
  save: g => [...g.memberships],
  load: (g, d) => { g.memberships = new Map(d as [number, Memberships][]); },
});
