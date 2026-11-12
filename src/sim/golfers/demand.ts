import { Course } from '../course/course';
import { clubhouseOf, maxGroupsPerDay } from '../business/buildings';
import type { Game, System } from '../game';
import { Golfer } from './golfer';
import { createGroup } from './groups';
import { TeeSheet, roundHoles, roundOptions } from './teeSheet';
import { averagePrice, priceFor, recordFill } from '../business/pricing';
import { bookMembers, reservedSlots } from '../business/memberships';
import { reputation } from '../rating/reputation';
import { competitionFactor, rivalFactor } from '../rating/rivals';
import { isClosedSeason, weatherDemandFactor } from '../turf/weather';

export const BASE_DEMAND = 30;

/** Demand multipliers: 2.5 stars is ordinary (×1), 5 stars brings 1.6× the golfers, 0 stars 0.4×. */
export const demandHooks = {
  reputation: (g: Game, course: Course): number => 0.4 + 0.24 * reputation(g, course.id).overall,
  weather: (g: Game): number => (isClosedSeason(g) ? 0 : weatherDemandFactor(g.weather)),
  /** rival courses: cheaper or better-liked neighbours take golfers away */
  competition: (g: Game, course: Course): number => competitionFactor(g, course),
};

export function teeSheetFor(g: Game, courseId: number): TeeSheet {
  let t = g.teeSheets.get(courseId);
  if (!t) { t = new TeeSheet(); g.teeSheets.set(courseId, t); }
  return t;
}

/** Today's average fee per golfer scaled to 18 holes across the offered round lengths and price bands. */
export function avgFeePer18(g: Game, course: Course): number {
  const opts = roundOptions(course);
  if (!opts.length) return 0;
  return opts.reduce((s, len) => s + (averagePrice(g, course, g.day, len) * 18) / len, 0) / opts.length;
}

export function priceFactor(feePer18: number): number {
  if (feePer18 <= 0) return 2.5;
  return Math.max(0.2, Math.min(2.5, (40 / feePer18) ** 0.8));
}

/** Expected golfers per day. */
export function dailyDemand(g: Game, course: Course): number {
  const open = course.holes.filter(h => h.state === 'open').length;
  if (!open || !clubhouseOf(g, course.id)) return 0;
  const size = Math.max(0.3, Math.min(2, open / 9));
  const expected = BASE_DEMAND * demandHooks.reputation(g, course) * priceFactor(avgFeePer18(g, course)) * demandHooks.weather(g) * size * demandHooks.competition(g, course);
  // the tee sheet caps it: one group of up to 4 per slot
  const opts = roundOptions(course);
  const sheet = teeSheetFor(g, course.id);
  const capacity = Math.max(0, sheet.slots(g.day, Math.min(...opts)).length - reservedSlots(g, course.id)) * 4;
  return Math.min(expected, capacity);
}

function pickGolfer(g: Game, course: Course, busy: Set<number>): Golfer {
  const members = new Set(g.memberships.get(course.id)?.members.map(x => x.golferId));
  const rng = g.rng;
  const known: Golfer[] = [];
  for (const x of g.golfers.all.values()) {
    if (busy.has(x.id) || x.lastVisitDay === g.day || members.has(x.id)) continue;
    if (x.visits > 0 && (x.opinion[course.id] ?? 0) > -30) known.push(x);
  }
  if (known.length && rng.chance(known.length / (known.length + 40))) {
    let total = 0;
    for (const k of known) total += 100 + (k.opinion[course.id] ?? 0);
    let r = rng.next() * total;
    for (const k of known) { r -= 100 + (k.opinion[course.id] ?? 0); if (r <= 0) return k; }
    return known[known.length - 1]!;
  }
  // newcomers hear what people like them say: segments and types that rate the course low come less
  const rep = reputation(g, course.id);
  let gf = g.golfers.spawn(rng);
  for (let tries = 0; tries < 2; tries++) {
    const rel = (rep.bySegment[gf.segment] + rep.byType[gf.type]) / 2 - rep.overall;
    // and segments the rivals win over come less
    const rival = rivalFactor(g, course, gf.segment) / Math.max(0.3, competitionFactor(g, course));
    if (rng.chance(Math.max(0.3, Math.min(1, (0.8 + 0.5 * rel) * rival)))) break;
    g.golfers.all.delete(gf.id);
    gf = g.golfers.spawn(rng);
  }
  return gf;
}

/** Preferred tee time: a morning peak with an afternoon shoulder. */
function preferredMinute(g: Game): number {
  return g.rng.chance(0.65) ? g.rng.normal(540, 90) : g.rng.normal(810, 120);
}

/** Book today's arrivals for every playable course. Returns the number of golfers booked. */
export function scheduleDay(g: Game): number {
  let booked = 0;
  for (const course of g.courses.list) {
    const opts = roundOptions(course);
    if (isClosedSeason(g)) continue;
    if (!opts.length || !clubhouseOf(g, course.id)) {
      if (course.holes.length) g.notify('warn', `${course.name} needs ${!clubhouseOf(g, course.id) ? 'a clubhouse' : 'an open hole'} before golfers will come`);
      continue;
    }
    const sheet = teeSheetFor(g, course.id);
    sheet.prune(g.day);
    const memberIds = bookMembers(g, course, sheet);
    booked += memberIds.size;
    const want = Math.round(dailyDemand(g, course) * g.rng.range(0.8, 1.2));
    const busy = new Set<number>(memberIds);
    let left = want, turnedAway = 0, noParking = 0;
    let cars = maxGroupsPerDay(g, course.id) - g.groups.filter(x => x.courseId === course.id && x.day === g.day).length;
    while (left > 0) {
      const leader = pickGolfer(g, course, busy);
      const size = Math.max(1, Math.min(4, left, 1 + Math.floor(leader.traits.social * 3.999)));
      const ids = [leader.id];
      busy.add(leader.id);
      while (ids.length < size) { const x = pickGolfer(g, course, busy); busy.add(x.id); ids.push(x.id); }
      left -= size;
      // one car per group: a full car park sends them home
      if (cars <= 0) { noParking += size; continue; }
      const len = opts.length > 1 && g.rng.chance(0.6) ? opts[opts.length - 1]! : opts[0]!;
      const minute = sheet.nearestFree(g.day, preferredMinute(g), len);
      if (minute === null) { turnedAway += size; continue; }
      const grp = createGroup(g, course.id, ids, g.day, minute, roundHoles(course, len));
      grp.feePerGolfer = priceFor(g, course, g.day, minute, len);
      sheet.book(g.day, minute, grp.id, len, size);
      booked += size;
      cars--;
    }
    // how full the sheet is today, for the general manager's dynamic pricing
    recordFill(g, course.id, (sheet.booked.get(g.day)?.size ?? 0) / Math.max(1, sheet.slots(g.day, opts[0]!).length));
    if (turnedAway) g.notify('info', `${course.name}: tee sheet full, ${turnedAway} golfers turned away`);
    if (noParking) {
      const lot = clubhouseOf(g, course.id);
      g.notify('warn', `${course.name}: car park full, ${noParking} golfers drove away — build more parking`, lot ? { ...lot.door } : undefined);
      g.events.emit('noParking', { courseId: course.id, golfers: noParking });
    }
  }
  return booked;
}

export const demandSystem: System = {
  name: 'demand',
  onDay(g) { scheduleDay(g); },
};

/** Green fees are paid when the round starts. */
export function attachDemand(g: Game): void {
  g.registerSystem(demandSystem);
  g.events.on('roundStart', ({ groupId }) => {
    const grp = g.groups.find(x => x.id === groupId);
    if (!grp) return;
    for (const id of grp.golferIds) {
      const golfer = g.golfers.all.get(id);
      if (grp.feePerGolfer) g.ledger.earn(grp.feePerGolfer, 'greenFees', g.day, grp.courseId);
      if (golfer) { golfer.visits++; golfer.totalSpend += grp.feePerGolfer; golfer.lastVisitDay = g.day; }
    }
    g.events.emit('cash', { cash: g.ledger.cash });
  });
}
