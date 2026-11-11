import { DAYS_PER_SEASON, DAYS_PER_YEAR } from '../clock';
import type { Game } from '../game';
import { Dept } from '../staff/roles';
import { TX_CATEGORIES, TxCategory } from './ledger';

export const REVENUE_CATS: TxCategory[] = ['greenFees', 'proShop', 'fnb', 'carts', 'range', 'lessons', 'simulator', 'memberships', 'events'];
export const OPERATING_CATS: TxCategory[] = ['wages', 'water', 'supplies', 'utilities', 'insurance', 'tax', 'interest', 'other'];
export const CAPITAL_CATS: TxCategory[] = ['land', 'construction', 'earthworks', 'equipment'];

export type Period = 'day' | 'month' | 'year';

/** Days covered by a period: today, this season (a "month" is one 28-day season) or this year; offset steps back. */
export function periodRange(g: Game, period: Period, offset = 0): { from: number; to: number } {
  const len = period === 'day' ? 1 : period === 'month' ? DAYS_PER_SEASON : DAYS_PER_YEAR;
  const start = Math.floor((g.day - 1) / len) * len + 1 - offset * len;
  return { from: start, to: Math.min(g.day, start + len - 1) };
}

export interface IncomeStatement {
  from: number;
  to: number;
  revenue: Partial<Record<TxCategory, number>>;
  operating: Partial<Record<TxCategory, number>>;
  totalRevenue: number;
  totalOperating: number;
  /** revenue less running costs */
  operatingProfit: number;
  /** land, construction and equipment, net of any sales */
  capital: number;
  /** loans drawn less repaid */
  financing: number;
  /** every dollar in less every dollar out: the change in cash */
  cashChange: number;
}

/** The ledger rolled up for a period, for one course or (null) the whole business. */
export function incomeStatement(g: Game, courseId: number | null, period: Period, offset = 0): IncomeStatement {
  const { from, to } = periodRange(g, period, offset);
  return statementFor(g, courseId, from, to);
}

export function statementFor(g: Game, courseId: number | null, from: number, to: number): IncomeStatement {
  const t = g.ledger.totals(from, to, courseId ?? undefined);
  const revenue: Partial<Record<TxCategory, number>> = {};
  const operating: Partial<Record<TxCategory, number>> = {};
  for (const c of REVENUE_CATS) if (t[c].in - t[c].out) revenue[c] = t[c].in - t[c].out;
  for (const c of OPERATING_CATS) if (t[c].out - t[c].in) operating[c] = t[c].out - t[c].in;
  const sum = (r: Partial<Record<TxCategory, number>>) => Object.values(r).reduce((s, x) => s + (x ?? 0), 0);
  const capital = CAPITAL_CATS.reduce((s, c) => s + t[c].out - t[c].in, 0);
  const financing = t.loan.in - t.loan.out;
  const cashChange = TX_CATEGORIES.reduce((s, c) => s + t[c].in - t[c].out, 0);
  const totalRevenue = sum(revenue), totalOperating = sum(operating);
  return { from, to, revenue, operating, totalRevenue, totalOperating, operatingProfit: totalRevenue - totalOperating, capital, financing, cashChange };
}

/** Closing cash for each of the last `days` days (oldest first). */
export function cashFlowSeries(g: Game, days: number): number[] {
  return g.finance.cashHistory.slice(-days).map(x => x.cash);
}

export function revenueBySource(g: Game, from: number, to: number, courseId?: number): Partial<Record<TxCategory, number>> {
  return statementFor(g, courseId ?? null, from, to).revenue;
}

/** Running costs by department: wages split by each role's department, plus the bills. */
export function costByDepartment(g: Game, from: number, to: number, courseId?: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of g.finance.deptWages) {
    if (r.day < from || r.day > to || (courseId !== undefined && r.courseId !== courseId)) continue;
    out[r.dept] = (out[r.dept] ?? 0) + r.amount;
  }
  const s = statementFor(g, courseId ?? null, from, to).operating;
  // anything the department log missed (severance and the like) stays in "wages"
  const logged = Object.values(out).reduce((a, b) => a + b, 0);
  if ((s.wages ?? 0) - logged > 0.5) out.wagesOther = (s.wages ?? 0) - logged;
  for (const c of OPERATING_CATS) if (c !== 'wages' && s[c]) out[c] = s[c]!;
  return out;
}
export const DEPT_LABEL: Record<Dept | string, string> = {
  maintenance: 'Maintenance staff', operations: 'Operations staff', proShop: 'Pro shop staff', hospitality: 'Food & drink staff', wagesOther: 'Other wages',
  water: 'Water', supplies: 'Supplies', utilities: 'Building upkeep', insurance: 'Insurance', tax: 'Property tax', interest: 'Loan interest', other: 'Other',
};

export interface HoleEconomics { holeId: number; number: number; roundsPlayed: number; revenueShare: number; maintenanceCost: number; labour: number; supplies: number }

/** Green fees and upkeep per hole over the last `days` days. */
export function perHoleEconomics(g: Game, courseId: number, days = DAYS_PER_SEASON): HoleEconomics[] {
  const course = g.courses.get(courseId);
  if (!course) return [];
  const from = g.day - days + 1;
  const by = new Map<number, HoleEconomics>();
  for (const h of course.holes) by.set(h.id, { holeId: h.id, number: h.number, roundsPlayed: 0, revenueShare: 0, maintenanceCost: 0, labour: 0, supplies: 0 });
  for (const r of g.finance.holeDays) {
    if (r.day < from || r.courseId !== courseId) continue;
    const e = by.get(r.holeId);
    if (!e) continue;
    e.roundsPlayed += r.rounds;
    e.revenueShare += r.revenue;
    e.labour += r.labour;
    e.supplies += r.supplies;
    e.maintenanceCost += r.labour + r.supplies;
  }
  return [...by.values()].sort((a, b) => a.number - b.number);
}
