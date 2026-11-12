import { HOLE_COLLATERAL, LOAN_RATE, LOAN_TERMS, MISSED_LIMIT, buildingValue, checkSolvency, loanLimit, loanSystem, payLoans } from '../../../src/sim/economy/loans';
import { INSURANCE_PER_HOLE, landValue, recurringSystem } from '../../../src/sim/economy/finance';
import { DAYS_PER_YEAR } from '../../../src/sim/clock';
import { addClubhouse, threeHoleCourse } from '../golfers/courseFixture';
import { newOwnedGame } from '../../helpers';

test('the bank lends up to half the land, buildings and open holes, less what is owed', () => {
  const { g, course } = threeHoleCourse();
  for (const h of course.holes) h.state = 'closed';
  const land = landValue(g);
  expect(land).toBeGreaterThan(0);
  expect(loanLimit(g)).toBe(Math.floor(land * 0.5 / 1000) * 1000);
  addClubhouse(g, course);
  expect(buildingValue(g)).toBe(250_000);
  const limit = loanLimit(g);
  expect(limit).toBe(Math.floor((land + 250_000) * 0.5 / 1000) * 1000);
  expect(g.dispatch({ t: 'takeLoan', amount: limit + 1000, termDays: LOAN_TERMS[0]! }).ok).toBe(false);
  const cash = g.ledger.cash;
  expect(g.dispatch({ t: 'takeLoan', amount: 100_000, termDays: LOAN_TERMS[0]! }).ok).toBe(true);
  expect(g.ledger.cash).toBe(cash + 100_000);
  expect(loanLimit(g)).toBe(Math.floor((limit - 100_000) / 1000) * 1000);
  expect(g.finance.loans[0]!.ratePerYear).toBe(LOAN_RATE.normal);
  // open holes count as collateral
  course.holes[0]!.state = 'open';
  expect(loanLimit(g)).toBe(Math.floor((limit - 100_000 + HOLE_COLLATERAL * 0.5) / 1000) * 1000);
});

test('daily repayments amortise the loan to zero at the end of its term', () => {
  const { g } = threeHoleCourse();
  const term = LOAN_TERMS[0]!;
  const r = g.dispatch({ t: 'takeLoan', amount: 200_000, termDays: term });
  expect(r.ok).toBe(true);
  const loan = g.finance.loans[0]!;
  const start = g.day;
  let paid = 0;
  const cash0 = g.ledger.cash;
  for (let d = 1; d <= term; d++) {
    g.clock.day = start + d;
    payLoans(g);
    if (d === Math.floor(term / 2)) expect(loan.remaining).toBeGreaterThan(80_000);
  }
  paid = cash0 - g.ledger.cash;
  expect(g.finance.loans.length).toBe(0);
  expect(loan.remaining).toBe(0);
  // a year at 6% costs roughly 3% of the principal in interest on a level payment
  const interest = g.ledger.totals(0, start + term).interest.out;
  expect(paid).toBe(200_000 + interest);
  expect(interest).toBeGreaterThan(200_000 * 0.025);
  expect(interest).toBeLessThan(200_000 * 0.04);
});

test('repaying early clears the loan', () => {
  const { g } = threeHoleCourse();
  g.dispatch({ t: 'takeLoan', amount: 50_000, termDays: LOAN_TERMS[1]! });
  const id = g.finance.loans[0]!.id;
  expect(g.dispatch({ t: 'repayLoan', id, amount: 20_000 }).ok).toBe(true);
  expect(g.finance.loans[0]!.remaining).toBe(30_000);
  expect(g.dispatch({ t: 'repayLoan', id }).ok).toBe(true);
  expect(g.finance.loans.length).toBe(0);
});

test('three day-ends in the red while owing money end a career game; sandbox is exempt', () => {
  const { g } = threeHoleCourse();
  const over: string[] = [];
  g.events.on('gameOver', e => over.push(e.reason));
  g.dispatch({ t: 'takeLoan', amount: 10_000, termDays: LOAN_TERMS[0]! });
  g.ledger.cash = -5_000;
  for (let k = 1; k < MISSED_LIMIT; k++) { checkSolvency(g); expect(g.finance.missedPayments).toBe(k); }
  expect(over.length).toBe(0);
  // a good day resets the count
  g.ledger.cash = 1_000; checkSolvency(g);
  expect(g.finance.missedPayments).toBe(0);
  g.ledger.cash = -5_000;
  for (let k = 0; k < MISSED_LIMIT; k++) checkSolvency(g);
  expect(over.length).toBe(1);
  expect(g.finance.gameOver).toMatch(/bank/);

  const sb = newOwnedGame({ size: 100 });
  (sb as { difficulty: string }).difficulty = 'sandbox';
  sb.finance.loans.push({ id: 1, principal: 1, ratePerYear: 0, termDays: DAYS_PER_YEAR, remaining: 1, dailyPayment: 0, takenDay: 1 });
  sb.ledger.cash = -1;
  for (let k = 0; k < 5; k++) checkSolvency(sb);
  expect(sb.finance.gameOver).toBeNull();
});

test('recurring costs: property tax on land and insurance per open hole', () => {
  const { g, course } = threeHoleCourse();
  recurringSystem.onDay!(g);
  const t = g.ledger.totals(g.day, g.day);
  expect(t.tax.out).toBe(Math.round(landValue(g) * 0.01 / DAYS_PER_YEAR));
  expect(t.insurance.out).toBe(course.holes.filter(h => h.state === 'open').length * INSURANCE_PER_HOLE);
  expect(loanSystem.name).toBe('loans');
});
