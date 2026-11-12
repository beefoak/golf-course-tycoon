import { brushTiles, planSurfacePaint, commitPlan, editableTile } from '../../../src/sim/construction/paint';
import { COSTS } from '../../../src/sim/construction/costs';
import { Surface, Feature } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

test('brushTiles circle radius 2 has 13 tiles, square has 25', () => {
  expect(brushTiles(10, 10, 2).length).toBe(13); expect(brushTiles(10, 10, 2, 'square').length).toBe(25);
  expect(brushTiles(10, 10, 0)).toEqual([{ x: 10, y: 10 }]);
});
test('fairway costs $14 per tile, greens $180', () => { expect(COSTS.surface[Surface.Fairway]).toBe(14); expect(COSTS.surface[Surface.Green]).toBe(180); });
test('paint charges per tile and sets surface', () => {
  const g = newOwnedGame(); const p = planSurfacePaint(g, brushTiles(25, 25, 2), Surface.Fairway);
  expect(p.changes.length).toBe(13); expect(p.cost).toBe(13 * COSTS.surface[Surface.Fairway]);
  const before = g.ledger.cash; expect(commitPlan(g, p, 'construction').ok).toBe(true);
  expect(g.world.surface[g.world.idx(25, 25)]).toBe(Surface.Fairway); expect(g.ledger.cash).toBe(before - 13 * COSTS.surface[Surface.Fairway]);
});
test('painting the same surface again costs nothing', () => {
  const g = newOwnedGame(); commitPlan(g, planSurfacePaint(g, brushTiles(25, 25, 1), Surface.Rough), 'construction');
  const p = planSurfacePaint(g, brushTiles(25, 25, 1), Surface.Rough); expect(p.changes.length).toBe(0); expect(p.cost).toBe(0);
});
test('clips to map bounds and skips unowned tiles', () => {
  const g = newOwnedGame(); const p = planSurfacePaint(g, brushTiles(0, 0, 5), Surface.Rough);
  expect(p.changes.every(c => c.i >= 0 && c.i < 100 * 100)).toBe(true); expect(p.changes.length).toBeGreaterThan(0);
  const q = planSurfacePaint(g, brushTiles(99, 99, 3), Surface.Rough); expect(q.changes.length).toBe(0); expect(q.skipped).toBeGreaterThan(0);
  expect(q.reasons.some(r => /own/.test(r))).toBe(true);
});
test('refuses whole plan when unaffordable', () => {
  const g = newOwnedGame(); g.ledger.cash = 100; const p = planSurfacePaint(g, brushTiles(25, 25, 4), Surface.Green);
  const snapshot = g.world.surface.slice(); const r = commitPlan(g, p, 'construction'); expect(r.ok).toBe(false);
  expect(g.world.surface).toEqual(snapshot); expect(g.ledger.cash).toBe(100);
});
test('rock tiles are skipped with a reason', () => {
  const g = newOwnedGame(); g.world.feature[g.world.idx(25, 25)] = Feature.Rock;
  const p = planSurfacePaint(g, [{ x: 25, y: 25 }, { x: 26, y: 25 }], Surface.Fairway);
  expect(p.changes.length).toBe(1); expect(p.skipped).toBe(1); expect(p.reasons.join()).toMatch(/rock/i);
  expect(editableTile(g, 25, 25)).toMatch(/rock/i); expect(editableTile(g, 26, 25)).toBeNull();
});
test('commit marks chunks dirty', () => {
  const g = newOwnedGame(); g.world.takeDirtyChunks();
  commitPlan(g, planSurfacePaint(g, [{ x: 60, y: 10 }], Surface.Tee), 'construction'); expect(g.world.takeDirtyChunks()).toEqual([1]);
});
test('dispatch paint command', () => {
  const g = newOwnedGame(); expect(g.dispatch({ t: 'paint', tiles: brushTiles(30, 30, 1), surface: Surface.Bunker }).ok).toBe(true);
  expect(g.world.surface[g.world.idx(30, 30)]).toBe(Surface.Bunker);
});
test('painting over trees removes them and charges removal', () => {
  const g = newOwnedGame(); g.world.treeSpecies[g.world.idx(25, 25)] = 1;
  const p = planSurfacePaint(g, [{ x: 25, y: 25 }], Surface.Fairway); expect(p.cost).toBe(COSTS.surface[Surface.Fairway] + COSTS.treeRemove);
  commitPlan(g, p, 'construction'); expect(g.world.treeSpecies[g.world.idx(25, 25)]).toBe(0);
});
