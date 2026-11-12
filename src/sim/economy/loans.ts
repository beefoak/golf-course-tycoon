import { Result, fail, ok } from '../../core/result';
import { BUILDING_DEFS } from '../business/buildings';
import { DAYS_PER_YEAR } from '../clock';
import type { Difficulty } from '../difficulty';
import type { Game, System } from '../game';
import { closeBooks, landValue } from './finance';

export interface Loan {
  id: number;
  principal: number;
  ratePerYear: number;
  termDays: number;
  /** principal still owed */
  remaining: number;
  dailyPayment: number;
  takenDay: number;
}

/** The difficulty presets' rates (the game's own rate is g.opts.loanRate). */
export const LOAN_RATE: Record<Difficulty, number> = { easy: 0.04, normal: 0.06, hard: 0.09, sandbox: 0.06 };
/** Banks lend up to this share of what the land and buildings are worth. */
export const LOAN_TO_VALUE = 0.5;
export const LOAN_TERMS = [DAYS_PER_YEAR, DAYS_PER_YEAR * 3, DAYS_PER_YEAR * 5];
/** Day-ends in the red (while owing money) before the bank calls it in. */
export const MISSED_LIMIT = 3;
/** Career bankruptcy: this far in the red with nothing left to borrow. */
export const BANKRUPT_CASH = -250_000;

export function buildingValue(g: Game): number {
  let v = 0;
  for (const b of g.buildings) {
    const costs = BUILDING_DEFS[b.kind].cost;
    for (let t = 0; t < Math.min(b.tier, costs.length); t++) v += costs[t]!;
  }
  return v;
}
export function outstanding(g: Game): number {
  return g.finance.loans.reduce((s, l) => s + l.remaining, 0);
}
export function loanLimit(g: Game): number {
  return Math.max(0, Math.floor((LOAN_TO_VALUE * (landValue(g) + buildingValue(g)) - outstanding(g)) / 1000) * 1000);
}

/** Level daily payment that clears `principal` over `days` at `rate` a year. */
export function amortised(principal: number, ratePerYear: number, days: number): number {
  const r = ratePerYear / DAYS_PER_YEAR;
  if (r === 0) return principal / days;
  return principal * r / (1 - Math.pow(1 + r, -days));
}

export function takeLoan(g: Game, amount: number, termDays: number): Result<Loan> {
  if (!(Number.isFinite(amount) && amount >= 1000)) return fail('Borrow at least $1,000');
  if (!LOAN_TERMS.includes(termDays)) return fail('Pick a 1, 3 or 5 year term');
  const limit = loanLimit(g);
  if (amount > limit) return fail(`The bank will lend up to $${limit.toLocaleString()} (half the value of your land and buildings, less what you owe)`);
  const rate = g.opts.loanRate;
  const principal = Math.round(amount);
  const loan: Loan = { id: g.finance.nextLoanId++, principal, ratePerYear: rate, termDays, remaining: principal, dailyPayment: Math.round(amortised(principal, rate, termDays) * 100) / 100, takenDay: g.day };
  g.finance.loans.push(loan);
  g.ledger.earn(principal, 'loan', g.day);
  return ok(loan);
}

/** Pay a loan down early (all of it when `amount` is omitted). */
export function repayLoan(g: Game, id: number, amount?: number): Result {
  const l = g.finance.loans.find(x => x.id === id);
  if (!l) return fail('No such loan');
  const pay = Math.min(l.remaining, amount ?? l.remaining);
  if (!(pay > 0)) return fail('Nothing to repay');
  if (!g.ledger.spend(pay, 'loan', g.day)) return fail('Not enough money');
  l.remaining = Math.round((l.remaining - pay) * 100) / 100;
  if (l.remaining <= 0.5) g.finance.loans = g.finance.loans.filter(x => x !== l);
  else {
    // the same end date, smaller payments
    const left = Math.max(1, l.takenDay + l.termDays - g.day);
    l.dailyPayment = Math.round(amortised(l.remaining, l.ratePerYear, left) * 100) / 100;
  }
  return ok(undefined);
}

/** One day's payment on each loan: interest first, the rest pays down the principal. */
export function payLoans(g: Game): void {
  const f = g.finance;
  for (const l of f.loans) {
    const interest = l.remaining * l.ratePerYear / DAYS_PER_YEAR;
    const last = g.day >= l.takenDay + l.termDays;
    const principal = last ? l.remaining : Math.min(l.remaining, l.dailyPayment - interest);
    g.ledger.charge(interest, 'interest', g.day);
    g.ledger.charge(principal, 'loan', g.day);
    l.remaining = Math.max(0, l.remaining - principal);
  }
  f.loans = f.loans.filter(l => l.remaining > 0.005);
}

/** The bank's view at day end: in the red while owing money is a missed payment. */
export function checkSolvency(g: Game): void {
  const f = g.finance;
  if (g.ledger.unlimited) return;
  if (g.difficulty !== 'sandbox' && !f.gameOver && g.ledger.cash < BANKRUPT_CASH && loanLimit(g) < -g.ledger.cash) {
    f.gameOver = `Bankrupt: $${Math.round(-g.ledger.cash).toLocaleString()} in the red and the bank won't lend any more.`;
    g.notify('bad', f.gameOver);
    g.events.emit('gameOver', { reason: f.gameOver });
    return;
  }
  if (g.ledger.cash < 0 && f.loans.length) {
    f.missedPayments++;
    if (f.missedPayments >= MISSED_LIMIT && g.difficulty !== 'sandbox') {
      if (!f.gameOver) {
        f.gameOver = 'The bank has called in your loans after three missed payments.';
        g.notify('bad', f.gameOver);
        g.events.emit('gameOver', { reason: f.gameOver });
      }
    } else g.notify('bad', `Missed a loan payment (${f.missedPayments}/${MISSED_LIMIT}) — get cash above $0 before the bank loses patience`);
  } else f.missedPayments = 0;
}

export const loanSystem: System = {
  name: 'loans',
  onDay(g) {
    // registered last: the overnight bills are in, then the bank takes its payment and looks at the balance
    payLoans(g);
    checkSolvency(g);
  },
};

/** Registered first: yesterday's closing cash, before the overnight bills. */
export const booksSystem: System = {
  name: 'books',
  onDay(g) { closeBooks(g, g.day - 1); },
};
