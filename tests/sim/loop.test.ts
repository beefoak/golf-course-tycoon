import { Game } from '../../src/sim/game';
import { GameLoop, MAX_TICKS_PER_FRAME } from '../../src/sim/loop';

const small = () => Game.create({ seed: 1, terrain: 'parkland', difficulty: 'normal', size: 100 });

test('GameLoop runs ticks proportional to speed', () => {
  const g = small(); const L = new GameLoop(g);
  L.speed = 1; expect(L.advance(750)).toBe(10);
  L.speed = 4; expect(L.advance(750)).toBe(40);
  L.speed = 0; expect(L.advance(750)).toBe(0);
  expect(g.clock.tick).toBe(50);
});
test('fractional time accumulates', () => {
  const L = new GameLoop(small()); L.speed = 1;
  expect(L.advance(50)).toBe(0); expect(L.advance(50)).toBe(1);
});
test('caps ticks per frame and drops the backlog', () => {
  const L = new GameLoop(small()); L.speed = 8;
  expect(L.advance(60_000)).toBe(MAX_TICKS_PER_FRAME); expect(MAX_TICKS_PER_FRAME).toBe(200);
  expect(L.advance(0)).toBe(0);
});
