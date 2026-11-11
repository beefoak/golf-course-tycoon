import { Rng } from '../../../src/core/rng';
import { rollBall } from '../../../src/sim/golfers/ballPhysics';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { Game } from '../../../src/sim/game';
import { newOwnedGame } from '../../helpers';

function fill(g: Game, s: Surface, x0 = 0, y0 = 0, x1 = 99, y1 = 49) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.world.surface[g.world.idx(x, y)] = s;
}

test('on a flat fairway the ball rolls along dir and stops', () => {
  const g = newOwnedGame();
  fill(g, Surface.Fairway);
  const o = rollBall(g, { x: 20.5, y: 25.5 }, { x: 1, y: 0 }, 200, 'mid', new Rng(1));
  expect(o.result).toBe('ok');
  expect(o.final.x).toBeGreaterThan(25);
  expect(o.final.x).toBeLessThan(40);
  expect(Math.abs(o.final.y - 25.5)).toBeLessThan(0.01);
});

test('a downhill green rolls further than an uphill one', () => {
  const g = newOwnedGame();
  fill(g, Surface.Green);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) g.world.elevation[g.world.idx(x, y)] = 10 - x * 0.04; // falls to the east
  const down = rollBall(g, { x: 50.5, y: 25.5 }, { x: 1, y: 0 }, 100, 'high', new Rng(1));
  const up = rollBall(g, { x: 50.5, y: 25.5 }, { x: -1, y: 0 }, 100, 'high', new Rng(1));
  expect(down.final.x - 50.5).toBeGreaterThan(50.5 - up.final.x);
});

test('a ball rolling across water ends in it, with the entry point', () => {
  const g = newOwnedGame();
  fill(g, Surface.Fairway);
  fill(g, Surface.Water, 25, 0, 30, 49);
  const o = rollBall(g, { x: 20.5, y: 25.5 }, { x: 1, y: 0 }, 220, 'mid', new Rng(1));
  expect(o.result).toBe('water');
  expect(o.hazardEntry!.x).toBeGreaterThanOrEqual(25);
  expect(o.hazardEntry!.x).toBeLessThan(26);
});

test('rolling onto unowned land is out of bounds', () => {
  const g = newOwnedGame(); // rows 0..49 owned
  fill(g, Surface.Fairway, 0, 0, 99, 99);
  const o = rollBall(g, { x: 20.5, y: 46.5 }, { x: 0, y: 1 }, 220, 'mid', new Rng(1));
  expect(o.result).toBe('ob');
  expect(o.final.y).toBeGreaterThanOrEqual(50);
});

test('landing on a rock is unplayable', () => {
  const g = newOwnedGame();
  fill(g, Surface.Fairway);
  g.world.feature[g.world.idx(20, 25)] = Feature.Rock;
  expect(rollBall(g, { x: 20.5, y: 25.5 }, { x: 1, y: 0 }, 200, 'mid', new Rng(1)).result).toBe('unplayable');
});

test('a bunker stops the ball', () => {
  const g = newOwnedGame();
  fill(g, Surface.Fairway);
  fill(g, Surface.Bunker, 24, 0, 27, 49);
  const o = rollBall(g, { x: 20.5, y: 25.5 }, { x: 1, y: 0 }, 220, 'mid', new Rng(1));
  expect(o.result).toBe('ok');
  expect(Math.floor(o.final.x)).toBe(24);
});
