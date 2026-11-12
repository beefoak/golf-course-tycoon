import { DAYS_PER_YEAR } from '../clock';
import type { Game, System } from '../game';
import { registerSaveable } from '../saveRegistry';
import { Dept, ROLES } from '../staff/roles';
import type { Loan } from './loans';

/** One day's takings and upkeep for a hole (green fees split by holes played; work done on its tiles). */
export interface HoleDay { day: number; holeId: number; courseId: number; rounds: number; revenue: number; labour: number; supplies: number }

export interface FinanceState {
  loans: Loan[];
  nextLoanId: number;
  /** consecutive day-ends with cash below zero while owing money */
  missedPayments: number;
  gameOver: string | null;
  /** cash at the end of each day (newest last) */
  cashHistory: { day: number; cash: number }[];
  /** wages paid by department, per day */
  deptWages: { day: number; dept: Dept; courseId: number; amount: number }[];
  holeDays: HoleDay[];
}

export function newFinance(): FinanceState {
  return { loans: [], nextLoanId: 1, missedPayments: 0, gameOver: null, cashHistory: [], deptWages: [], holeDays: [] };
}

/** Logs are kept for two years. */
export const HISTORY_DAYS = DAYS_PER_YEAR * 2;
export const PROPERTY_TAX_PER_YEAR = 0.01;
export const INSURANCE_PER_HOLE = 25;

/** Supplies a practice uses per tile worked ($). */
export const SUPPLY_PER_TILE: Partial<Record<string, number>> = { fertilize: 0.35, topdress: 0.25, spray: 0.3, fixDivots: 0.05 };

export function holeDay(g: Game, courseId: number, holeId: number): HoleDay {
  const rows = g.finance.holeDays;
  for (let k = rows.length - 1; k >= 0 && rows[k]!.day === g.day; k--) if (rows[k]!.holeId === holeId) return rows[k]!;
  const r: HoleDay = { day: g.day, holeId, courseId, rounds: 0, revenue: 0, labour: 0, supplies: 0 };
  rows.push(r);
  return r;
}

/** Wages paid: logged by department for the reports. */
export function logWage(g: Game, role: keyof typeof ROLES, courseId: number, amount: number): void {
  const dept = ROLES[role].dept;
  const rows = g.finance.deptWages;
  for (let k = rows.length - 1; k >= 0 && rows[k]!.day === g.day; k--) {
    const r = rows[k]!;
    if (r.dept === dept && r.courseId === courseId) { r.amount += amount; return; }
  }
  rows.push({ day: g.day, dept, courseId, amount });
}

/** Work done on a hole's tiles: labour at the worker's hourly rate plus any supplies (charged now). */
export function logHoleWork(g: Game, courseId: number, holeId: number, labour: number, supplies: number): void {
  if (supplies > 0) g.ledger.charge(supplies, 'supplies', g.day, courseId);
  if (!holeId) return;
  const r = holeDay(g, courseId, holeId);
  r.labour += labour;
  r.supplies += supplies;
}

export function landValue(g: Game): number {
  const p = g.parcels;
  let v = 0;
  for (let k = 0; k < p.owner.length; k++) if (p.owner[k]) v += p.price[k]!;
  return v;
}

/** Property tax (1% of land value a year, charged daily) and insurance per open hole. */
export const recurringSystem: System = {
  name: 'recurring',
  onDay(g) {
    const tax = landValue(g) * PROPERTY_TAX_PER_YEAR / DAYS_PER_YEAR;
    if (tax > 0) g.ledger.charge(tax, 'tax', g.day);
    for (const c of g.courses.list) {
      const open = c.holes.filter(h => h.state === 'open').length;
      if (open) g.ledger.charge(open * INSURANCE_PER_HOLE, 'insurance', g.day, c.id);
    }
  },
};

/** Day end: note the cash and trim old logs. */
export function closeBooks(g: Game, day: number): void {
  const f = g.finance;
  f.cashHistory.push({ day, cash: g.ledger.cash });
  const cut = day - HISTORY_DAYS;
  if (f.cashHistory.length > HISTORY_DAYS) f.cashHistory.splice(0, f.cashHistory.length - HISTORY_DAYS);
  if (f.deptWages.length && f.deptWages[0]!.day < cut) f.deptWages = f.deptWages.filter(r => r.day >= cut);
  if (f.holeDays.length && f.holeDays[0]!.day < cut) f.holeDays = f.holeDays.filter(r => r.day >= cut);
}

export function attachFinance(g: Game): void {
  g.registerSystem(recurringSystem);
  // green fees are split equally across the holes the round covers
  g.events.on('roundStart', ({ groupId }) => {
    const grp = g.groups.find(x => x.id === groupId);
    if (!grp || !grp.holeOrder.length) return;
    const n = grp.golferIds.length;
    const share = (grp.feePerGolfer ?? 0) * n / grp.holeOrder.length;
    for (const id of grp.holeOrder) {
      const r = holeDay(g, grp.courseId, id);
      r.rounds += n;
      r.revenue += share;
    }
  });
}

registerSaveable({
  key: 'finance',
  save: g => g.finance,
  load: (g, d) => { g.finance = { ...newFinance(), ...(d as FinanceState) }; },
});
