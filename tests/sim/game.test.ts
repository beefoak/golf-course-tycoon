import { Game } from '../../src/sim/game';
import { EventBus } from '../../src/core/events';
import { TICKS_PER_MIN, DAY_START_MIN, DAY_END_MIN } from '../../src/sim/clock';

const small = (difficulty: 'easy' | 'normal' | 'hard' | 'sandbox' = 'normal') => Game.create({ seed: 1, terrain: 'parkland', difficulty, size: 100 });
const TICKS_PER_DAY = (DAY_END_MIN - DAY_START_MIN) * TICKS_PER_MIN;

test('EventBus on/emit/off', () => {
  const b = new EventBus<{ a: number }>(); const got: number[] = [];
  const off = b.on('a', v => got.push(v)); b.emit('a', 1); off(); b.emit('a', 2); expect(got).toEqual([1]);
});
test('Game.create gives starting cash by difficulty', () => {
  expect(small('hard').ledger.cash).toBe(1_500_000);
  expect(small('normal').ledger.cash).toBe(3_000_000);
  expect(small('easy').ledger.cash).toBe(5_000_000);
  expect(small('sandbox').ledger.unlimited).toBe(true);
});
test('world and parcels match the size', () => {
  const g = small(); expect(g.world.size).toBe(100); expect(g.parcels.perSide).toBe(2);
});
test('dispatch buyParcel', () => {
  const g = small(); const before = g.ledger.cash;
  expect(g.dispatch({ t: 'buyParcel', px: 0, py: 0 }).ok).toBe(true);
  expect(g.ledger.cash).toBe(before - g.parcels.priceAt(0, 0)); expect(g.parcels.isOwned(0, 0)).toBe(true);
});
test('dispatch sellParcel', () => {
  const g = small(); g.dispatch({ t: 'buyParcel', px: 0, py: 0 });
  expect(g.dispatch({ t: 'sellParcel', px: 0, py: 0 }).ok).toBe(true); expect(g.parcels.isOwned(0, 0)).toBe(false);
});
test('systems fire onDay once per day in registration order', () => {
  const g = small(); const log: string[] = [];
  g.registerSystem({ name: 'a', onDay: () => log.push('a') });
  g.registerSystem({ name: 'b', onDay: () => log.push('b') });
  for (let i = 0; i < TICKS_PER_DAY; i++) g.tick();
  expect(log).toEqual(['a', 'b']); expect(g.clock.day).toBe(2);
});
test('onMinute fires each game minute and day event is emitted', () => {
  const g = small(); let minutes = 0, days = 0;
  g.registerSystem({ name: 'm', onMinute: () => minutes++ }); g.events.on('day', () => days++);
  for (let i = 0; i < TICKS_PER_MIN * 30; i++) g.tick();
  expect(minutes).toBe(30); expect(days).toBe(0);
});
test('notify emits notification event', () => {
  const g = small(); const got: string[] = []; g.events.on('notify', n => got.push(n.text));
  g.notify('warn', 'hello'); expect(got).toEqual(['hello']);
});
test('determinism: two games same seed + same commands + 5000 ticks → equal state', () => {
  const run = () => {
    const g = small(); g.registerSystem({ name: 'r', onTick: gg => { if (gg.rng.next() < 0.01) gg.ledger.earn(1, 'other', gg.clock.day); } });
    g.dispatch({ t: 'buyParcel', px: 1, py: 1 }); for (let i = 0; i < 5000; i++) g.tick(); return g;
  };
  const a = run(), b = run(); expect(a.ledger.cash).toBe(b.ledger.cash); expect(a.rng.getState()).toBe(b.rng.getState());
});
