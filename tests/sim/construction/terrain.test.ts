import { planTerrain } from '../../../src/sim/construction/terrain';
import { commitPlan, brushTiles } from '../../../src/sim/construction/paint';
import { slopeAt } from '../../../src/sim/world/slope';
import { Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

test('lower adds to stockpile and costs cut', () => {
  const g = newOwnedGame(); const p = planTerrain(g, [{ x: 25, y: 25 }], { op: 'lower', amountM: 1 });
  expect(p.stockpileDelta).toBeCloseTo(4); expect(p.cost).toBeCloseTo(24);
  commitPlan(g, p, 'earthworks'); expect(g.world.elevation[g.world.idx(25, 25)]).toBeCloseTo(9); expect(g.soilStockpileM3).toBeCloseTo(4);
});
test('raise uses stockpile before importing', () => {
  const g = newOwnedGame(); g.soilStockpileM3 = 2; const p = planTerrain(g, [{ x: 25, y: 25 }], { op: 'raise', amountM: 1 });
  expect(p.cost).toBeCloseTo(2 * 4 + 2 * 22); expect(p.stockpileDelta).toBeCloseTo(-2);
});
test('raise with falloff: centre rises most', () => {
  const g = newOwnedGame(); commitPlan(g, planTerrain(g, brushTiles(25, 25, 4), { op: 'raise', amountM: 2 }), 'earthworks');
  const e = (x: number) => g.world.elevation[g.world.idx(x, 25)]!;
  expect(e(25)).toBeCloseTo(12); expect(e(28)).toBeGreaterThan(10); expect(e(28)).toBeLessThan(e(25)); expect(e(31)).toBe(10);
});
test('flatten moves all tiles to target', () => {
  const g = newOwnedGame(); for (let x = 20; x < 30; x++) g.world.elevation[g.world.idx(x, 25)] = x - 15;
  const tiles = Array.from({ length: 10 }, (_, k) => ({ x: 20 + k, y: 25 }));
  commitPlan(g, planTerrain(g, tiles, { op: 'flatten', targetM: 8 }), 'earthworks');
  for (const t of tiles) expect(g.world.elevation[g.world.idx(t.x, t.y)]).toBeCloseTo(8);
});
test('smooth reduces max gradient', () => {
  const g = newOwnedGame(); for (let y = 15; y < 35; y++) for (let x = 15; x < 35; x++) g.world.elevation[g.world.idx(x, y)] = x >= 25 ? 14 : 10;
  const maxGrad = () => { let m = 0; for (let y = 21; y < 29; y++) for (let x = 21; x < 29; x++) m = Math.max(m, slopeAt(g.world, x, y).gradient); return m; };
  const before = maxGrad(); commitPlan(g, planTerrain(g, brushTiles(25, 25, 6, 'square'), { op: 'smooth', strength: 1 }), 'earthworks');
  expect(maxGrad()).toBeLessThan(before);
});
test('slopeLine produces linear profile along line', () => {
  const g = newOwnedGame(); const tiles = brushTiles(30, 25, 12, 'square');
  commitPlan(g, planTerrain(g, tiles, { op: 'slopeLine', from: { x: 20, y: 25 }, to: { x: 40, y: 25 }, fromM: 10, toM: 14, widthTiles: 4 }), 'earthworks');
  expect(g.world.elevation[g.world.idx(20, 25)]).toBeCloseTo(10); expect(g.world.elevation[g.world.idx(30, 25)]).toBeCloseTo(12);
  expect(g.world.elevation[g.world.idx(40, 25)]).toBeCloseTo(14); expect(g.world.elevation[g.world.idx(30, 35)]).toBe(10);
});
test('water tiles are skipped', () => {
  const g = newOwnedGame(); g.world.surface[g.world.idx(25, 25)] = Surface.Water;
  const p = planTerrain(g, [{ x: 25, y: 25 }], { op: 'raise', amountM: 1 }); expect(p.changes.length).toBe(0); expect(p.reasons.join()).toMatch(/water/);
});
test('dispatch terrain command', () => {
  const g = newOwnedGame(); expect(g.dispatch({ t: 'terrain', tiles: [{ x: 25, y: 25 }], op: { op: 'lower', amountM: 0.5 } }).ok).toBe(true);
  expect(g.world.elevation[g.world.idx(25, 25)]).toBeCloseTo(9.5);
});
