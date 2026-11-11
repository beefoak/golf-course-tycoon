import { Result, fail, ok } from '../../core/result';
import type { Game, System } from '../game';
import { Golfer } from '../golfers/golfer';
import { Group } from '../golfers/groups';
import { pushThought } from '../golfers/roundEffects';
import { THOUGHT_MOOD } from '../golfers/thoughts';
import { registerSaveable } from '../saveRegistry';
import { holeTiles } from '../turf/turf';
import { BUILDING_DEFS } from './buildings';

export interface CartFleet { courseId: number; count: number; condition: number; feePerRider: number; today: { riders: number; revenue: number } }

export const CART_PRICE = 6_000;
/** Carts that fit without a cart barn (parked by the clubhouse). */
export const CARTS_WITHOUT_BARN = 10;
export const DEFAULT_CART_FEE = 20;
/** Average turf moisture above which carts keep to the paths. */
export const CART_PATH_ONLY_MOISTURE = 80;
/** Carts on paths only crawl along at this share of their speed. */
export const CART_PATH_ONLY_SPEED = 0.55;
export const RANGE_BUCKET = 8;
/** A warm-up on the range plays like a handicap this much lower for the round. */
export const WARMUP_HANDICAP = 0.5;

export function fleetOf(g: Game, courseId: number): CartFleet {
  let f = g.carts.get(courseId);
  if (!f) { f = { courseId, count: 0, condition: 100, feePerRider: DEFAULT_CART_FEE, today: { riders: 0, revenue: 0 } }; g.carts.set(courseId, f); }
  return f;
}

export function cartCapacity(g: Game, courseId: number): number {
  const barns = g.buildings.filter(b => b.kind === 'cartBarn' && b.courseId === courseId).length;
  return CARTS_WITHOUT_BARN + barns * BUILDING_DEFS.cartBarn.capacity!;
}

export function buyCarts(g: Game, courseId: number, n: number): Result {
  if (!g.buildings.some(b => b.kind === 'clubhouse' && b.courseId === courseId)) return fail('Carts need a clubhouse');
  if (!(Number.isInteger(n) && n > 0)) return fail('Buy at least one cart');
  const f = fleetOf(g, courseId);
  if (f.count + n > cartCapacity(g, courseId)) return fail(f.count + n > CARTS_WITHOUT_BARN && !g.buildings.some(b => b.kind === 'cartBarn' && b.courseId === courseId) ? `More than ${CARTS_WITHOUT_BARN} carts need a cart barn` : 'The cart barn is full');
  if (!g.ledger.spend(CART_PRICE * n, 'equipment', g.day, courseId)) return fail('Not enough money');
  // new carts lift the fleet's average condition
  f.condition = (f.condition * f.count + 100 * n) / (f.count + n);
  f.count += n;
  return ok(undefined);
}

export function setCartFee(g: Game, courseId: number, fee: number): Result {
  if (!(fee >= 0 && fee <= 200)) return fail('Cart fee must be $0–$200');
  fleetOf(g, courseId).feePerRider = Math.round(fee);
  return ok(undefined);
}

/** Wet turf: carts on the paths only. */
export function cartPathOnly(g: Game, courseId: number): boolean {
  return g.cartPathOnly.has(courseId);
}
function updateCartPathOnly(g: Game): void {
  g.cartPathOnly.clear();
  const wet = g.weather.kind === 'rain' || g.weather.kind === 'storm';
  for (const c of g.courses.list) {
    let sum = 0, n = 0;
    for (const h of c.holes) {
      const t = holeTiles(g, h.id).turf;
      for (let k = 0; k < t.length; k += 7) { sum += g.world.moisture[t[k]!]!; n++; }
    }
    if (wet || (n && sum / n > CART_PATH_ONLY_MOISTURE)) g.cartPathOnly.add(c.id);
  }
}

function hash01(a: number, b: number, c: number): number {
  return ((Math.imul(a ^ Math.imul(b + c * 7919, 0x9e3779b1), 0x85ebca6b) >>> 8) & 0xffff) / 65536;
}

/** Walking between holes (green → next tee), in tiles. */
export function walkBetweenHoles(g: Game, holeOrder: number[]): number {
  let d = 0;
  for (let k = 0; k + 1 < holeOrder.length; k++) {
    const a = g.courses.hole(holeOrder[k]!), b = g.courses.hole(holeOrder[k + 1]!);
    const t = b?.teeBoxes[0];
    if (a && t) d += Math.hypot(t.center.x - a.greenCenter.x, t.center.y - a.greenCenter.y);
  }
  return d;
}

/** One golfer's wish for a cart (0..1): older, wealthier and longer walks ride; a dear fee walks. */
export function cartWish(g: Game, gf: Golfer, walkTiles: number, fee: number): number {
  let p = 0.12 + (gf.age >= 60 ? 0.35 : gf.age >= 45 ? 0.15 : 0) + (gf.segment === 'premium' ? 0.2 : gf.segment === 'mid' ? 0.08 : 0);
  p += Math.min(0.35, walkTiles / 800);
  p -= 0.1 * gf.traits.pace;
  p *= Math.min(1.5, Math.pow(DEFAULT_CART_FEE / Math.max(5, fee), 0.7));
  return Math.max(0, Math.min(0.95, p));
}

/** At tee-off: the group takes carts if they want them and enough are free (two riders a cart). */
export function chooseCarts(g: Game, grp: Group): boolean {
  const f = fleetOf(g, grp.courseId);
  if (!f.count) return false;
  const inUse = g.groups.filter(x => x !== grp && x.courseId === grp.courseId && x.usesCart && x.started && x.phase !== 'done')
    .reduce((s, x) => s + Math.ceil(x.golferIds.length / 2), 0);
  const need = Math.ceil(grp.golferIds.length / 2);
  if (f.count - inUse < need) return false;
  const walk = walkBetweenHoles(g, grp.holeOrder);
  const members = grp.golferIds.map(id => g.golfers.all.get(id)).filter((x): x is Golfer => !!x);
  if (!members.length) return false;
  const wish = members.reduce((s, m) => s + cartWish(g, m, walk, f.feePerRider), 0) / members.length * (0.6 + 0.4 * f.condition / 100);
  if (hash01(grp.id, g.day, 5) >= wish) return false;
  grp.usesCart = true;
  for (const m of members) {
    g.ledger.earn(f.feePerRider, 'carts', g.day, grp.courseId);
    m.totalSpend += f.feePerRider;
    f.today.riders++;
    f.today.revenue += f.feePerRider;
  }
  if (cartPathOnly(g, grp.courseId)) {
    const list = g.roundThoughts.get(grp.id) ?? [];
    g.roundThoughts.set(grp.id, list);
    for (const m of members) pushThought(g, { golferId: m.id, day: g.day, minute: g.clock.minuteOfDay, key: 'cartPathOnly', mood: THOUGHT_MOOD.cartPathOnly }, list);
  }
  return true;
}

/** Before tee-off: a bucket of balls on the range for those who like to warm up. */
export function rangeWarmup(g: Game, grp: Group): void {
  if (!g.buildings.some(b => b.kind === 'range' && b.courseId === grp.courseId)) return;
  const fee = g.rangeBucket.get(grp.courseId) ?? RANGE_BUCKET;
  const warm: number[] = [];
  const list = g.roundThoughts.get(grp.id) ?? [];
  g.roundThoughts.set(grp.id, list);
  for (const id of grp.golferIds) {
    const gf = g.golfers.all.get(id);
    if (!gf) continue;
    const p = Math.max(0.05, 0.55 - 0.35 * gf.traits.pace) * Math.min(1.5, Math.pow(RANGE_BUCKET / Math.max(1, fee), 0.8));
    if (hash01(id, g.day, 21) >= p) continue;
    warm.push(id);
    g.ledger.earn(fee, 'range', g.day, grp.courseId);
    gf.totalSpend += fee;
    pushThought(g, { golferId: id, day: g.day, minute: g.clock.minuteOfDay, key: 'warmedUp', mood: THOUGHT_MOOD.warmedUp }, list);
  }
  if (warm.length) grp.warm = warm;
}

/** The golfer as they play today: a range warm-up sharpens them a little. */
export function playingGolfer(grp: Group, gf: Golfer): Golfer {
  return grp.warm?.includes(gf.id) ? { ...gf, handicap: Math.max(0, gf.handicap - WARMUP_HANDICAP) } : gf;
}

export const cartSystem: System = {
  name: 'carts',
  onDay(g) {
    updateCartPathOnly(g);
    for (const f of g.carts.values()) {
      // a day's use wears the fleet; attendants clean, charge and fix
      const used = f.today.riders / 2;
      f.condition = Math.max(0, f.condition - used * 0.4 / Math.max(1, f.count));
      const att = g.staff.all.filter(s => s.role === 'cartAttendant' && s.courseId === f.courseId);
      for (const a of att) f.condition = Math.min(100, f.condition + 3 * a.speed * (0.5 + (a.skills.service ?? 0) / 100));
      f.today = { riders: 0, revenue: 0 };
    }
  },
  onMinute(g) {
    if (g.clock.minuteOfDay % 60 === 0) updateCartPathOnly(g);
  },
};

export function attachCarts(g: Game): void {
  g.registerSystem(cartSystem);
  g.events.on('roundStart', ({ groupId }) => {
    const grp = g.groups.find(x => x.id === groupId);
    if (!grp) return;
    rangeWarmup(g, grp);
    chooseCarts(g, grp);
  });
}

registerSaveable({
  key: 'carts',
  save: g => ({ fleets: [...g.carts], bucket: [...g.rangeBucket] }),
  load: (g, d) => {
    const s = d as { fleets: [number, CartFleet][]; bucket?: [number, number][] };
    g.carts = new Map(s.fleets);
    g.rangeBucket = new Map(s.bucket ?? []);
  },
});

