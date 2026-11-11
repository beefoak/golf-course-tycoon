export type TxCategory =
  | 'land' | 'construction' | 'earthworks' | 'wages' | 'equipment' | 'water' | 'supplies'
  | 'greenFees' | 'proShop' | 'fnb' | 'carts' | 'range' | 'lessons' | 'simulator' | 'memberships' | 'events'
  | 'loan' | 'interest' | 'tax' | 'utilities' | 'insurance' | 'other';

export const TX_CATEGORIES: TxCategory[] = [
  'land', 'construction', 'earthworks', 'wages', 'equipment', 'water', 'supplies',
  'greenFees', 'proShop', 'fnb', 'carts', 'range', 'lessons', 'simulator', 'memberships', 'events',
  'loan', 'interest', 'tax', 'utilities', 'insurance', 'other',
];

/** Daily rollup: one row per (day, category, course). amount: +in / -out. */
export interface Transaction {
  day: number;
  cat: TxCategory;
  courseId: number;
  in: number;
  out: number;
}

export class Ledger {
  cash: number;
  readonly unlimited: boolean;
  readonly tx: Transaction[] = [];
  private index = new Map<string, Transaction>();

  constructor(startCash: number) {
    this.unlimited = startCash === Infinity;
    this.cash = this.unlimited ? 0 : Math.round(startCash);
  }
  canAfford(amt: number): boolean {
    return this.unlimited || this.cash >= Math.round(amt);
  }
  spend(amt: number, cat: TxCategory, day: number, courseId = 0): boolean {
    const a = Math.round(amt);
    if (!this.canAfford(a)) return false;
    if (a === 0) return true;
    this.cash -= a;
    this.row(day, cat, courseId).out += a;
    return true;
  }
  /** Unconditional charge (wages, upkeep) — may take cash negative. */
  charge(amt: number, cat: TxCategory, day: number, courseId = 0): void {
    const a = Math.round(amt);
    if (a === 0) return;
    this.cash -= a;
    this.row(day, cat, courseId).out += a;
  }
  earn(amt: number, cat: TxCategory, day: number, courseId = 0): void {
    const a = Math.round(amt);
    if (a === 0) return;
    this.cash += a;
    this.row(day, cat, courseId).in += a;
  }
  totals(fromDay: number, toDay: number, courseId?: number): Record<TxCategory, { in: number; out: number }> {
    const out = {} as Record<TxCategory, { in: number; out: number }>;
    for (const c of TX_CATEGORIES) out[c] = { in: 0, out: 0 };
    for (const t of this.tx) {
      if (t.day < fromDay || t.day > toDay) continue;
      if (courseId !== undefined && t.courseId !== courseId) continue;
      out[t.cat].in += t.in;
      out[t.cat].out += t.out;
    }
    return out;
  }
  /** Rebuild the merge index after loading. */
  restore(cash: number, tx: Transaction[]): void {
    this.cash = cash;
    this.tx.length = 0;
    this.index.clear();
    for (const t of tx) {
      this.tx.push(t);
      this.index.set(`${t.day}|${t.cat}|${t.courseId}`, t);
    }
  }
  private row(day: number, cat: TxCategory, courseId: number): Transaction {
    const key = `${day}|${cat}|${courseId}`;
    let r = this.index.get(key);
    if (!r) {
      r = { day, cat, courseId, in: 0, out: 0 };
      this.index.set(key, r);
      this.tx.push(r);
    }
    return r;
  }
}
