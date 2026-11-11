import { Result, fail, ok } from '../../core/result';
import type { Game, System } from '../game';
import { Golfer } from '../golfers/golfer';
import { pushThought } from '../golfers/roundEffects';
import { THOUGHT_MOOD } from '../golfers/thoughts';
import { registerSaveable } from '../saveRegistry';
import { isWorking } from '../staff/staff';
import { isClosedSeason } from '../turf/weather';

export type ItemCategory = 'balls' | 'gloves' | 'apparel' | 'hats' | 'clubsBudget' | 'clubsPremium' | 'bags' | 'accessories';
export const ITEM_CATEGORIES: ItemCategory[] = ['balls', 'gloves', 'apparel', 'hats', 'clubsBudget', 'clubsPremium', 'bags', 'accessories'];
export const ITEM_LABEL: Record<ItemCategory, string> = {
  balls: 'Balls', gloves: 'Gloves', apparel: 'Apparel', hats: 'Hats', clubsBudget: 'Clubs (value)', clubsPremium: 'Clubs (premium)', bags: 'Bags', accessories: 'Accessories',
};

export interface StockLine { cat: ItemCategory; wholesale: number; retail: number; qty: number; reorderAt: number; reorderQty: number }
export type ProShopAddon = 'fitting' | 'simulator' | 'apparelLine';
export interface ProShop {
  courseId: number;
  stock: StockLine[];
  addons: ProShopAddon[];
  /** simulator bays (0..6) */
  bays: number;
  /** today's tallies for the panel */
  today: { sales: number; revenue: number; lost: number; lessons: number; fittings: number; simHours: number };
  yesterday: ProShop['today'];
}

/** Base chance a golfer buys from a category after a round, at a 2× markup. */
const BASE_CHANCE: Record<ItemCategory, number> = {
  balls: 0.22, gloves: 0.08, apparel: 0.06, hats: 0.07, clubsBudget: 0.012, clubsPremium: 0.006, bags: 0.008, accessories: 0.1,
};
const DEFAULT_STOCK: StockLine[] = [
  { cat: 'balls', wholesale: 15, retail: 30, qty: 120, reorderAt: 30, reorderQty: 120 },
  { cat: 'gloves', wholesale: 8, retail: 20, qty: 40, reorderAt: 10, reorderQty: 40 },
  { cat: 'apparel', wholesale: 25, retail: 60, qty: 30, reorderAt: 8, reorderQty: 30 },
  { cat: 'hats', wholesale: 8, retail: 25, qty: 30, reorderAt: 8, reorderQty: 30 },
  { cat: 'clubsBudget', wholesale: 150, retail: 300, qty: 6, reorderAt: 2, reorderQty: 6 },
  { cat: 'clubsPremium', wholesale: 400, retail: 750, qty: 3, reorderAt: 1, reorderQty: 3 },
  { cat: 'bags', wholesale: 80, retail: 180, qty: 5, reorderAt: 2, reorderQty: 5 },
  { cat: 'accessories', wholesale: 5, retail: 15, qty: 60, reorderAt: 15, reorderQty: 60 },
];
export const ADDON_COST: Record<ProShopAddon, number> = { fitting: 40_000, simulator: 45_000, apparelLine: 60_000 };
export const MAX_BAYS = 6;
export const BAY_RATE_PER_HOUR = 40;
export const FITTING_FEE = 120;
export const LESSON_FEE = 80;
export const LESSONS_PER_PRO = 6;
export const LESSON_HANDICAP_DROP = 0.1;
/** Own-label apparel costs this share of the usual wholesale price. */
export const APPAREL_LINE_COST = 0.75;

const emptyDay = (): ProShop['today'] => ({ sales: 0, revenue: 0, lost: 0, lessons: 0, fittings: 0, simHours: 0 });

export function proShopOf(g: Game, courseId: number): ProShop | null {
  if (!g.buildings.some(b => b.kind === 'proShop' && b.courseId === courseId)) return null;
  let s = g.proShops.get(courseId);
  if (!s) {
    s = { courseId, stock: DEFAULT_STOCK.map(l => ({ ...l })), addons: [], bays: 0, today: emptyDay(), yesterday: emptyDay() };
    g.proShops.set(courseId, s);
  }
  return s;
}

function hash01(a: number, b: number, c: number): number {
  return ((Math.imul(a ^ Math.imul(b + c * 7919, 0x9e3779b1), 0x85ebca6b) >>> 8) & 0xffff) / 65536;
}

/** How well the counter sells: best sales skill among shop staff on shift (no one: self-service). */
function salesFactor(g: Game, courseId: number): number {
  const on = g.staff.all.filter(s => (s.role === 'proShopStaff' || s.role === 'headPro') && s.courseId === courseId && isWorking(g, s));
  if (!on.length) return 0.6;
  return 0.8 + 0.4 * Math.max(...on.map(s => (s.skills.sales ?? 0) / 100));
}

const SEGMENT_SPEND = { budget: 0.6, mid: 1, premium: 1.6 } as const;

/** Chance one golfer buys from a line, given who they are and how the round went. */
export function buyChance(g: Game, shop: ProShop, line: StockLine, golfer: Golfer): number {
  const markup = line.retail / Math.max(0.01, effectiveWholesale(shop, line));
  const price = Math.min(2.5, Math.pow(2 / Math.max(1, markup), 1.5));
  const sat = golfer.lastSatisfaction ?? 60;
  let p = BASE_CHANCE[line.cat] * (0.5 + golfer.traits.gear) * SEGMENT_SPEND[golfer.segment] * (0.5 + sat / 100) * price * salesFactor(g, shop.courseId);
  if ((line.cat === 'clubsBudget' || line.cat === 'clubsPremium') && shop.addons.includes('fitting') && headProOn(g, shop.courseId)) p *= 1.6;
  return Math.min(0.9, p);
}

export function effectiveWholesale(shop: ProShop, line: StockLine): number {
  return shop.addons.includes('apparelLine') && (line.cat === 'apparel' || line.cat === 'hats') ? line.wholesale * APPAREL_LINE_COST : line.wholesale;
}

function headProOn(g: Game, courseId: number): boolean {
  return g.staff.all.some(s => s.role === 'headPro' && s.courseId === courseId && isWorking(g, s));
}

/**
 * One golfer browsing: `before` the round only balls are on their mind. Sales come off the shelf and
 * into proShop income; an empty shelf loses the sale and leaves an 'emptyShelves' thought (once).
 */
export function shopVisit(g: Game, courseId: number, golfer: Golfer, when: 'before' | 'after', groupId = 0): { bought: ItemCategory[]; lost: ItemCategory[] } {
  const shop = proShopOf(g, courseId);
  const out = { bought: [] as ItemCategory[], lost: [] as ItemCategory[] };
  if (!shop) return out;
  shop.stock.forEach((line, k) => {
    if (when === 'before' && line.cat !== 'balls') return;
    const roll = hash01(golfer.id, g.day * 4 + (when === 'before' ? 0 : 1), k);
    const p = when === 'before' ? buyChance(g, shop, line, golfer) * 0.5 : buyChance(g, shop, line, golfer);
    if (roll >= p) return;
    if (line.qty <= 0) { out.lost.push(line.cat); return; }
    line.qty--;
    g.ledger.earn(line.retail, 'proShop', g.day, courseId);
    golfer.totalSpend += line.retail;
    shop.today.sales++;
    shop.today.revenue += line.retail;
    out.bought.push(line.cat);
  });
  if (out.lost.length) {
    shop.today.lost += out.lost.length;
    const list = g.roundThoughts.get(groupId) ?? [];
    if (groupId) g.roundThoughts.set(groupId, list);
    if (!list.some(t => t.golferId === golfer.id && t.key === 'emptyShelves')) {
      pushThought(g, { golferId: golfer.id, day: g.day, minute: g.clock.minuteOfDay, key: 'emptyShelves', mood: THOUGHT_MOOD.emptyShelves }, list);
    }
  }
  // a club fitting with the head pro
  if (when === 'after' && shop.addons.includes('fitting') && headProOn(g, courseId) && golfer.traits.gear > 0.6 && hash01(golfer.id, g.day, 99) < 0.05) {
    g.ledger.earn(FITTING_FEE, 'proShop', g.day, courseId);
    shop.today.fittings++;
    shop.today.revenue += FITTING_FEE;
  }
  // a lesson: higher handicaps keen to improve, while the pros have slots
  if (when === 'after' && golfer.handicap > 8 && hash01(golfer.id, g.day, 7) < 0.04) giveLesson(g, courseId, golfer);
  return out;
}

/** The head pro gives a lesson: $80, and the student's handicap comes down a little. */
export function giveLesson(g: Game, courseId: number, golfer: Golfer): boolean {
  const shop = proShopOf(g, courseId);
  if (!shop) return false;
  const pros = g.staff.all.filter(s => s.role === 'headPro' && s.courseId === courseId && isWorking(g, s)).length;
  if (shop.today.lessons >= pros * LESSONS_PER_PRO) return false;
  shop.today.lessons++;
  shop.today.revenue += LESSON_FEE;
  g.ledger.earn(LESSON_FEE, 'lessons', g.day, courseId);
  golfer.handicap = Math.max(0, Math.round((golfer.handicap - LESSON_HANDICAP_DROP) * 10) / 10);
  return true;
}

/** Simulator hours sold today across all bays: busiest when it's wet, cold or the course is shut. */
export function simulatorHours(g: Game, shop: ProShop): number {
  if (!shop.addons.includes('simulator') || shop.bays <= 0) return 0;
  const k = g.weather.kind;
  const w = isClosedSeason(g) ? 2.5 : k === 'storm' ? 2.4 : k === 'rain' ? 2.2 : k === 'frost' ? 1.6 : k === 'heatwave' ? 1.3 : k === 'sunny' ? 0.8 : 1;
  return Math.min(12, 3 * w) * shop.bays;
}

/** Restock lines at or under their reorder point (charged at wholesale); sims earn for the day. */
export const proShopSystem: System = {
  name: 'proShop',
  onDay(g) {
    for (const shop of g.proShops.values()) {
      if (!g.buildings.some(b => b.kind === 'proShop' && b.courseId === shop.courseId)) continue;
      shop.yesterday = shop.today;
      shop.today = emptyDay();
      for (const line of shop.stock) {
        if (line.qty > line.reorderAt || line.reorderQty <= 0) continue;
        if (g.ledger.spend(effectiveWholesale(shop, line) * line.reorderQty, 'proShop', g.day, shop.courseId)) line.qty += line.reorderQty;
      }
      const hrs = simulatorHours(g, shop);
      if (hrs) {
        shop.today.simHours = hrs;
        shop.today.revenue += hrs * BAY_RATE_PER_HOUR;
        g.ledger.earn(hrs * BAY_RATE_PER_HOUR, 'simulator', g.day, shop.courseId);
      }
    }
  },
};

export function attachProShop(g: Game): void {
  g.registerSystem(proShopSystem);
  g.events.on('roundStart', ({ groupId }) => {
    const grp = g.groups.find(x => x.id === groupId);
    if (!grp) return;
    for (const id of grp.golferIds) { const gf = g.golfers.all.get(id); if (gf) shopVisit(g, grp.courseId, gf, 'before', groupId); }
  });
  g.events.on('roundComplete', ({ groupId }) => {
    const grp = g.groups.find(x => x.id === groupId);
    if (!grp) return;
    for (const id of grp.golferIds) { const gf = g.golfers.all.get(id); if (gf) shopVisit(g, grp.courseId, gf, 'after'); }
  });
}

// ---- commands ----

export function setStockLine(g: Game, courseId: number, cat: ItemCategory, patch: { retail?: number; reorderAt?: number; reorderQty?: number }): Result {
  const shop = proShopOf(g, courseId);
  if (!shop) return fail('Build a pro shop first');
  const line = shop.stock.find(l => l.cat === cat);
  if (!line) return fail('No such stock line');
  if (patch.retail !== undefined && !(patch.retail > 0 && patch.retail <= 5000)) return fail('Price must be $1–$5,000');
  if (patch.reorderAt !== undefined && !(patch.reorderAt >= 0 && patch.reorderAt <= 1000)) return fail('Reorder point must be 0–1,000');
  if (patch.reorderQty !== undefined && !(patch.reorderQty >= 0 && patch.reorderQty <= 1000)) return fail('Reorder quantity must be 0–1,000');
  Object.assign(line, patch);
  return ok(undefined);
}

export function orderStock(g: Game, courseId: number, cat: ItemCategory, qty: number): Result {
  const shop = proShopOf(g, courseId);
  if (!shop) return fail('Build a pro shop first');
  const line = shop.stock.find(l => l.cat === cat);
  if (!line) return fail('No such stock line');
  if (!(Number.isInteger(qty) && qty > 0 && qty <= 1000)) return fail('Order 1–1,000');
  if (!g.ledger.spend(effectiveWholesale(shop, line) * qty, 'proShop', g.day, courseId)) return fail('Not enough money');
  line.qty += qty;
  return ok(undefined);
}

export function buyAddon(g: Game, courseId: number, addon: ProShopAddon): Result {
  const shop = proShopOf(g, courseId);
  if (!shop) return fail('Build a pro shop first');
  if (addon === 'simulator') return setBays(g, courseId, shop.bays + 1);
  if (shop.addons.includes(addon)) return fail('Already done');
  if (addon === 'fitting' && !g.staff.all.some(s => s.role === 'headPro' && s.courseId === courseId)) return fail('Club fitting needs a head pro');
  if (!g.ledger.spend(ADDON_COST[addon], 'construction', g.day, courseId)) return fail('Not enough money');
  shop.addons.push(addon);
  return ok(undefined);
}

/** Add simulator bays ($45k each, up to 6). */
export function setBays(g: Game, courseId: number, bays: number): Result {
  const shop = proShopOf(g, courseId);
  if (!shop) return fail('Build a pro shop first');
  if (!(Number.isInteger(bays) && bays >= shop.bays && bays <= MAX_BAYS)) return fail(`Up to ${MAX_BAYS} bays (bays can't be removed)`);
  const add = bays - shop.bays;
  if (!add) return ok(undefined);
  if (!g.ledger.spend(ADDON_COST.simulator * add, 'construction', g.day, courseId)) return fail('Not enough money');
  shop.bays = bays;
  if (!shop.addons.includes('simulator')) shop.addons.push('simulator');
  return ok(undefined);
}

registerSaveable({
  key: 'proShops',
  save: g => [...g.proShops],
  load: (g, d) => { g.proShops = new Map(d as [number, ProShop][]); },
});
