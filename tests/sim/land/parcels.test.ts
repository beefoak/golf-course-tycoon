import { ParcelGrid, SELL_BACK_RATE } from '../../../src/sim/land/parcels';
import { Ledger } from '../../../src/sim/economy/ledger';
import { generateWorld } from '../../../src/sim/world/mapgen';
import { Rng } from '../../../src/core/rng';

test('buy deducts price and marks owned', () => {
  const l = new Ledger(100_000); const g = new ParcelGrid(20); g.price[0] = 40_000;
  expect(g.buy(0, 0, l, 1).ok).toBe(true); expect(l.cash).toBe(60_000); expect(g.tileOwned(10, 10)).toBe(true);
  expect(g.tileOwned(60, 10)).toBe(false);
});
test('buy fails without funds and changes nothing', () => {
  const l = new Ledger(10_000); const g = new ParcelGrid(20); g.price[0] = 40_000;
  const r = g.buy(0, 0, l, 1); expect(r.ok).toBe(false); expect(l.cash).toBe(10_000); expect(g.isOwned(0, 0)).toBe(false);
});
test('cannot buy twice; sell refunds 70%', () => {
  const l = new Ledger(100_000); const g = new ParcelGrid(20); g.price[0] = 40_000;
  g.buy(0, 0, l, 1); expect(g.buy(0, 0, l, 1).ok).toBe(false); expect(l.cash).toBe(60_000);
  expect(SELL_BACK_RATE).toBe(0.7);
  expect(g.sell(0, 0, l, 2).ok).toBe(true); expect(l.cash).toBe(88_000); expect(g.isOwned(0, 0)).toBe(false);
});
test('cannot sell unowned parcel or out of range', () => {
  const l = new Ledger(100_000); const g = new ParcelGrid(20);
  expect(g.sell(0, 0, l, 1).ok).toBe(false); expect(g.buy(-1, 0, l, 1).ok).toBe(false); expect(g.buy(20, 0, l, 1).ok).toBe(false);
  expect(g.tileOwned(-5, 3)).toBe(false);
});
test('sell refused with reason when blockedReason given', () => {
  const l = new Ledger(100_000); const g = new ParcelGrid(20); g.price[0] = 40_000; g.buy(0, 0, l, 1);
  const r = g.sell(0, 0, l, 1, 'hole 3 is on this parcel'); expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toContain('hole 3'); expect(g.isOwned(0, 0)).toBe(true);
});
test('prices within bounds for generated map and rounded to $1,000', () => {
  const w = generateWorld(1, 'parkland', 1000); const g = ParcelGrid.fromWorld(w, new Rng(1));
  for (const p of g.price) { expect(p).toBeGreaterThanOrEqual(20_000); expect(p).toBeLessThanOrEqual(150_000); expect(p % 1000).toBe(0); }
  expect(new Set(g.price).size).toBeGreaterThan(5);
});
test('parcels next to the road are adjacent', () => {
  const w = generateWorld(1, 'parkland', 1000); const g = ParcelGrid.fromWorld(w, new Rng(1));
  expect(g.adjacentToRoad(w, 5, 19)).toBe(true); expect(g.adjacentToRoad(w, 5, 5)).toBe(false);
});
