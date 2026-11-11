import { Ledger } from '../../../src/sim/economy/ledger';

test('ledger totals by category and day range', () => {
  const l = new Ledger(1000);
  expect(l.spend(100, 'land', 1)).toBe(true); l.earn(50, 'greenFees', 2); l.earn(25, 'greenFees', 3);
  const t = l.totals(1, 2); expect(t.land.out).toBe(100); expect(t.greenFees.in).toBe(50);
  expect(l.totals(1, 3).greenFees.in).toBe(75); expect(l.cash).toBe(975);
});
test('spend refuses when unaffordable', () => {
  const l = new Ledger(10); expect(l.spend(11, 'land', 1)).toBe(false); expect(l.cash).toBe(10); expect(l.tx.length).toBe(0);
});
test('transactions are merged per day, category and course', () => {
  const l = new Ledger(1000); l.earn(10, 'greenFees', 1, 1); l.earn(5, 'greenFees', 1, 1); l.earn(5, 'greenFees', 1, 2);
  expect(l.tx.length).toBe(2); expect(l.totals(1, 1, 1).greenFees.in).toBe(15);
});
test('amounts are integer dollars', () => {
  const l = new Ledger(1000); l.spend(10.6, 'other', 1); expect(l.cash).toBe(989);
});
test('sandbox ledger always affords', () => {
  const l = new Ledger(Infinity); expect(l.unlimited).toBe(true); expect(l.canAfford(1e12)).toBe(true); expect(l.spend(1e9, 'land', 1)).toBe(true);
});
