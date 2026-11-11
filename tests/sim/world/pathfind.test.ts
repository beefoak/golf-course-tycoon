import { commitPlan } from '../../../src/sim/construction/plan';
import { planBridge, planPath } from '../../../src/sim/construction/paths';
import { findPath, tileCost } from '../../../src/sim/world/pathfind';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

function pondGame() {
  const g = newOwnedGame({ size: 100, parcels: [[0, 0], [1, 0], [0, 1], [1, 1]] });
  // a pond wall across the map from x=0..79 at y=40..49, open on the east side
  for (let y = 40; y < 50; y++) for (let x = 0; x < 80; x++) g.world.surface[g.world.idx(x, y)] = Surface.Water;
  return g;
}

test('a walking path goes around a pond', () => {
  const g = pondGame();
  const p = findPath(g, { x: 20.5, y: 20.5 }, { x: 20.5, y: 70.5 }, 'walk')!;
  expect(p).not.toBeNull();
  expect(Math.max(...p.map(q => q.x))).toBeGreaterThanOrEqual(79);
  for (const q of p) expect(g.world.surface[g.world.idx(Math.floor(q.x), Math.floor(q.y))]).not.toBe(Surface.Water);
});

test('the path uses a bridge when one exists', () => {
  const g = pondGame();
  const tiles = []; for (let y = 40; y < 50; y++) for (let x = 19; x <= 21; x++) tiles.push({ x, y });
  expect(commitPlan(g, planBridge(g, tiles), 'construction').ok).toBe(true);
  const p = findPath(g, { x: 20.5, y: 20.5 }, { x: 20.5, y: 70.5 }, 'walk')!;
  expect(Math.max(...p.map(q => q.x))).toBeLessThan(30);
});

test('carts never cross greens or tees', () => {
  const g = newOwnedGame({ size: 100, parcels: [[0, 0], [1, 0], [0, 1], [1, 1]] });
  for (let y = 0; y < 90; y++) for (let x = 45; x < 55; x++) g.world.surface[g.world.idx(x, y)] = y < 45 ? Surface.Green : Surface.Tee;
  const p = findPath(g, { x: 30.5, y: 30.5 }, { x: 70.5, y: 30.5 }, 'cart')!;
  expect(p).not.toBeNull();
  // sample along every segment
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!, b = p[i]!, steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
    for (let k = 0; k <= steps; k++) {
      const x = Math.floor(a.x + ((b.x - a.x) * k) / steps), y = Math.floor(a.y + ((b.y - a.y) * k) / steps);
      expect(Number.isFinite(tileCost(g, x, y, 'cart'))).toBe(true);
    }
  }
  expect(Math.max(...p.map(q => q.y))).toBeGreaterThanOrEqual(90);
});

test('no path into a rock enclosure', () => {
  const g = newOwnedGame();
  for (let y = 20; y <= 30; y++) for (let x = 20; x <= 30; x++) if (x === 20 || x === 30 || y === 20 || y === 30) g.world.feature[g.world.idx(x, y)] = Feature.Rock;
  expect(findPath(g, { x: 5.5, y: 5.5 }, { x: 25.5, y: 25.5 }, 'walk')).toBeNull();
});

test('paths are preferred over rough', () => {
  const g = newOwnedGame();
  const tiles = []; for (let x = 5; x <= 95; x++) tiles.push({ x, y: 10 });
  commitPlan(g, planPath(g, tiles, 'asphalt'), 'construction');
  const p = findPath(g, { x: 5.5, y: 12.5 }, { x: 94.5, y: 12.5 }, 'walk')!;
  expect(p.some(q => Math.floor(q.y) === 10)).toBe(true);
});
