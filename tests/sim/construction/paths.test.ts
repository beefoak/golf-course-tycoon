import { planPath, planBridge, placeStructure, PATH_COST, STRUCTURE_COST } from '../../../src/sim/construction/paths';
import { commitPlan } from '../../../src/sim/construction/paint';
import { isWalkable, Feature, Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

test('path tiers cost per tile', () => {
  const g = newOwnedGame(); expect(PATH_COST).toEqual({ gravel: 20, asphalt: 45, concrete: 70 });
  const p = planPath(g, [{ x: 10, y: 10 }, { x: 11, y: 10 }], 'asphalt'); expect(p.cost).toBe(90);
  commitPlan(g, p, 'construction'); expect(g.world.surface[g.world.idx(10, 10)]).toBe(Surface.Path);
});
test('paths cannot cross water', () => {
  const g = newOwnedGame(); g.world.surface[g.world.idx(10, 10)] = Surface.Water;
  expect(planPath(g, [{ x: 10, y: 10 }], 'gravel').changes.length).toBe(0);
});
test('a bridge over a creek is walkable', () => {
  const g = newOwnedGame(); const i = g.world.idx(10, 10); g.world.surface[i] = Surface.Water; g.world.feature[i] = Feature.Creek;
  expect(isWalkable(g.world, 10, 10)).toBe(false);
  const p = planBridge(g, [{ x: 10, y: 10 }]); expect(p.cost).toBe(600); commitPlan(g, p, 'construction');
  expect(isWalkable(g.world, 10, 10)).toBe(true); expect(g.world.feature[i]).toBe(Feature.Creek);
});
test('bridge refused on dry land and unowned land', () => {
  const g = newOwnedGame(); expect(planBridge(g, [{ x: 12, y: 12 }]).changes.length).toBe(0);
  const i = g.world.idx(60, 80); g.world.surface[i] = Surface.Water; expect(planBridge(g, [{ x: 60, y: 80 }]).changes.length).toBe(0);
});
test('walkability rules', () => {
  const g = newOwnedGame(); g.world.feature[g.world.idx(5, 5)] = Feature.Rock;
  expect(isWalkable(g.world, 5, 5)).toBe(false); expect(isWalkable(g.world, 6, 5)).toBe(true); expect(isWalkable(g.world, -1, 5)).toBe(false);
});
test('structures cost money and are stored', () => {
  const g = newOwnedGame(); const before = g.ledger.cash;
  expect(placeStructure(g, 'restroom', { x: 20, y: 20 }).ok).toBe(true); expect(g.ledger.cash).toBe(before - STRUCTURE_COST.restroom);
  expect(g.structures.length).toBe(1); expect(placeStructure(g, 'bench', { x: 80, y: 80 }).ok).toBe(false);
  expect(g.dispatch({ t: 'placeStructure', kind: 'ballWasher', at: { x: 21, y: 21 } }).ok).toBe(true);
});
