import { Result, fail, ok } from '../../core/result';
import type { Game, System } from '../game';
import { Golfer } from '../golfers/golfer';
import { Group } from '../golfers/groups';
import { pushThought } from '../golfers/roundEffects';
import { THOUGHT_MOOD } from '../golfers/thoughts';
import { registerSaveable } from '../saveRegistry';
import { isWorking } from '../staff/staff';

/** Food & drink takings per course; prices are one multiplier on the house menu. */
export interface FnbState {
  courseId: number;
  /** 0.5..2: menu prices relative to the usual */
  priceMult: number;
  today: { covers: number; drinks: number; revenue: number; slow: number };
  yesterday: FnbState['today'];
  /** absolute hour and the restaurant covers served in it (for queues) */
  hour: number;
  hourCovers: number;
}

export const COST_OF_GOODS = 0.32;
const SEGMENT_SPEND = { budget: 0.7, mid: 1, premium: 1.4 } as const;
export const TURN_CHECK = 9;
export const DRINK_PRICE = 4;
export const RESTAURANT_CHECK = 30;
/** Restaurant covers an hour: a base, plus each F&B staffer on shift. */
export const BASE_COVERS = 6;
export const COVERS_PER_STAFF = 12;
/** A drink station within this many tiles (60 m) of a green sells drinks to groups finishing that hole. */
export const DRINK_STATION_REACH = 30;

const emptyDay = (): FnbState['today'] => ({ covers: 0, drinks: 0, revenue: 0, slow: 0 });

export function fnbOf(g: Game, courseId: number): FnbState {
  let s = g.fnb.get(courseId);
  if (!s) { s = { courseId, priceMult: 1, today: emptyDay(), yesterday: emptyDay(), hour: -1, hourCovers: 0 }; g.fnb.set(courseId, s); }
  return s;
}

function has(g: Game, kind: string, courseId: number): boolean {
  return g.buildings.some(b => (b.kind as string) === kind && b.courseId === courseId);
}
function hash01(a: number, b: number, c: number): number {
  return ((Math.imul(a ^ Math.imul(b + c * 7919, 0x9e3779b1), 0x85ebca6b) >>> 8) & 0xffff) / 65536;
}
/** Dearer menus sell less. */
function priceEffect(mult: number): number {
  return Math.min(2, Math.pow(1 / Math.max(0.3, mult), 1.3));
}

function sell(g: Game, s: FnbState, amount: number): void {
  const a = Math.round(amount * 100) / 100;
  g.ledger.earn(a, 'fnb', g.day, s.courseId);
  g.ledger.charge(a * COST_OF_GOODS, 'supplies', g.day, s.courseId);
  s.today.revenue += a;
}

/**
 * Snacks on the course after each hole: the halfway house serves at the turn (after the 9th hole of
 * a round of 10+ holes), and drink stations near a green sell its stock to groups passing by.
 */
export function fnbAfterHole(g: Game, grp: Group, holeId: number): void {
  if (!has(g, 'halfwayHouse', grp.courseId)) return;
  const s = fnbOf(g, grp.courseId);
  // holeIdx still points at the hole just finished when holeComplete fires
  const k = grp.holeOrder[grp.holeIdx] === holeId ? grp.holeIdx : grp.holeOrder.indexOf(holeId);
  const atTurn = k === 8 && grp.holeOrder.length >= 10;
  const hole = g.courses.hole(holeId);
  const station = !atTurn && !!hole && g.structures.some(st => st.kind === 'drinkStation' && Math.hypot(st.at.x - hole.greenCenter.x, st.at.y - hole.greenCenter.y) <= DRINK_STATION_REACH);
  if (!atTurn && !station) return;
  for (const id of grp.golferIds) {
    const gf = g.golfers.all.get(id);
    if (!gf) continue;
    const p = (atTurn ? 0.5 : 0.2) * (0.4 + gf.traits.food) * SEGMENT_SPEND[gf.segment] * priceEffect(s.priceMult);
    if (hash01(id, g.day * 40 + k, 3) >= Math.min(0.95, p)) continue;
    const amt = (atTurn ? TURN_CHECK * SEGMENT_SPEND[gf.segment] : DRINK_PRICE) * s.priceMult;
    sell(g, s, amt);
    s.today.drinks++;
    gf.totalSpend += amt;
  }
}

/** How well the kitchen cooks: the best chef on shift (none: reheated sandwiches). */
function kitchen(g: Game, courseId: number): number {
  const chefs = g.staff.all.filter(x => x.role === 'chef' && x.courseId === courseId && isWorking(g, x));
  return chefs.length ? 0.7 + 0.6 * Math.max(...chefs.map(c => (c.skills.cooking ?? 0) / 100)) : 0.5;
}
export function coversPerHour(g: Game, courseId: number): number {
  return BASE_COVERS + COVERS_PER_STAFF * g.staff.all.filter(x => x.role === 'fnbStaff' && x.courseId === courseId && isWorking(g, x)).length;
}

/** After the round: lunch or a drink at the restaurant/bar. A packed hour means slow service. */
export function restaurantVisit(g: Game, courseId: number, gf: Golfer, groupId = 0): boolean {
  if (!has(g, 'restaurant', courseId)) return false;
  const s = fnbOf(g, courseId);
  const p = 0.35 * (0.4 + gf.traits.food) * SEGMENT_SPEND[gf.segment] * priceEffect(s.priceMult) * kitchen(g, courseId);
  if (hash01(gf.id, g.day, 11) >= Math.min(0.9, p)) return false;
  const hour = Math.floor(g.clock.absMinute / 60);
  if (s.hour !== hour) { s.hour = hour; s.hourCovers = 0; }
  s.hourCovers++;
  s.today.covers++;
  const amt = RESTAURANT_CHECK * SEGMENT_SPEND[gf.segment] * s.priceMult;
  sell(g, s, amt);
  gf.totalSpend += amt;
  if (s.hourCovers > coversPerHour(g, courseId)) {
    s.today.slow++;
    const list = g.roundThoughts.get(groupId) ?? [];
    pushThought(g, { golferId: gf.id, day: g.day, minute: g.clock.minuteOfDay, key: 'slowService', mood: THOUGHT_MOOD.slowService }, list);
  }
  return true;
}

export const fnbSystem: System = {
  name: 'fnb',
  onDay(g) {
    for (const s of g.fnb.values()) { s.yesterday = s.today; s.today = emptyDay(); }
  },
};

export function attachFnb(g: Game): void {
  g.registerSystem(fnbSystem);
  g.events.on('holeComplete', ({ groupId, holeId }) => {
    const grp = g.groups.find(x => x.id === groupId);
    if (grp) fnbAfterHole(g, grp, holeId);
  });
  g.events.on('roundComplete', ({ groupId }) => {
    const grp = g.groups.find(x => x.id === groupId);
    if (!grp) return;
    for (const id of grp.golferIds) { const gf = g.golfers.all.get(id); if (gf) restaurantVisit(g, grp.courseId, gf); }
  });
}

export function setMenuPrices(g: Game, courseId: number, mult: number): Result {
  if (!(mult >= 0.5 && mult <= 2)) return fail('Menu prices can be 50%–200% of normal');
  fnbOf(g, courseId).priceMult = Math.round(mult * 100) / 100;
  return ok(undefined);
}

registerSaveable({
  key: 'fnb',
  save: g => [...g.fnb],
  load: (g, d) => { g.fnb = new Map(d as [number, FnbState][]); },
});
