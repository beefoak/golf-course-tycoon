import { Course } from '../course/course';
import { clubhouseOf } from '../business/buildings';
import type { Game, System } from '../game';
import { Golfer } from './golfer';
import { createGroup } from './groups';
import { TeeSheet, greenFee, roundHoles, roundOptions } from './teeSheet';

export const BASE_DEMAND = 30;

/** Placeholders for systems that arrive later (reputation Task 40, weather Task 26). */
export const demandHooks = {
  reputation: (_g: Game, _course: Course): number => 1,
  weather: (_g: Game): number => 1,
};

export function teeSheetFor(g: Game, courseId: number): TeeSheet {
  let t = g.teeSheets.get(courseId);
  if (!t) { t = new TeeSheet(); g.teeSheets.set(courseId, t); }
  return t;
}

/** Average fee per golfer scaled to 18 holes across the offered round lengths. */
export function avgFeePer18(g: Game, course: Course): number {
  const opts = roundOptions(course);
  if (!opts.length) return 0;
  const p = g.pricing.get(course.id);
  return opts.reduce((s, len) => s + (greenFee(p, len) * 18) / len, 0) / opts.length;
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
  const expected = BASE_DEMAND * demandHooks.reputation(g, course) * priceFactor(avgFeePer18(g, course)) * demandHooks.weather(g) * size;
  // the tee sheet caps it: one group of up to 4 per slot
  const opts = roundOptions(course);
  const sheet = teeSheetFor(g, course.id);
  const capacity = sheet.slots(g.day, Math.min(...opts)).length * 4;
  return Math.min(expected, capacity);
}

function pickGolfer(g: Game, course: Course, busy: Set<number>): Golfer {
  const rng = g.rng;
  const known: Golfer[] = [];
  for (const x of g.golfers.all.values()) {
    if (busy.has(x.id) || x.lastVisitDay === g.day) continue;
    if (x.visits > 0 && (x.opinion[course.id] ?? 0) > -30) known.push(x);
  }
  if (known.length && rng.chance(known.length / (known.length + 40))) {
    let total = 0;
    for (const k of known) total += 100 + (k.opinion[course.id] ?? 0);
    let r = rng.next() * total;
    for (const k of known) { r -= 100 + (k.opinion[course.id] ?? 0); if (r <= 0) return k; }
    return known[known.length - 1]!;
  }
  return g.golfers.spawn(rng);
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
    if (!opts.length || !clubhouseOf(g, course.id)) {
      if (course.holes.length) g.notify('warn', `${course.name} needs ${!clubhouseOf(g, course.id) ? 'a clubhouse' : 'an open hole'} before golfers will come`);
      continue;
    }
    const sheet = teeSheetFor(g, course.id);
    sheet.prune(g.day);
    const want = Math.round(dailyDemand(g, course) * g.rng.range(0.8, 1.2));
    const busy = new Set<number>();
    let left = want, turnedAway = 0;
    while (left > 0) {
      const leader = pickGolfer(g, course, busy);
      const size = Math.max(1, Math.min(4, left, 1 + Math.floor(leader.traits.social * 3.999)));
      const ids = [leader.id];
      busy.add(leader.id);
      while (ids.length < size) { const x = pickGolfer(g, course, busy); busy.add(x.id); ids.push(x.id); }
      left -= size;
      const len = opts.length > 1 && g.rng.chance(0.6) ? opts[opts.length - 1]! : opts[0]!;
      const minute = sheet.nearestFree(g.day, preferredMinute(g), len);
      if (minute === null) { turnedAway += size; continue; }
      const grp = createGroup(g, course.id, ids, g.day, minute, roundHoles(course, len));
      grp.feePerGolfer = greenFee(g.pricing.get(course.id), len);
      sheet.book(g.day, minute, grp.id, len, size);
      booked += size;
    }
    if (turnedAway) g.notify('info', `${course.name}: tee sheet full, ${turnedAway} golfers turned away`);
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
    if (!grp || !grp.feePerGolfer) return;
    for (const id of grp.golferIds) {
      const golfer = g.golfers.all.get(id);
      g.ledger.earn(grp.feePerGolfer, 'greenFees', g.day, grp.courseId);
      if (golfer) { golfer.visits++; golfer.totalSpend += grp.feePerGolfer; golfer.lastVisitDay = g.day; }
    }
    g.events.emit('cash', { cash: g.ledger.cash });
  });
}
