import { planBunker, planDigWater, planFillWater, planTrees, planRemoveTrees, computeStakes, SAND } from '../../../src/sim/construction/hazards';
import { commitPlan, brushTiles } from '../../../src/sim/construction/paint';
import { COSTS } from '../../../src/sim/construction/costs';
import { commitPenHole } from '../../../src/sim/course/pen';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

test('bunker lowers terrain and charges sand × multiplier plus earthworks', () => {
  const g = newOwnedGame(); const p = planBunker(g, [{ x: 25, y: 25 }], 'premium');
  expect(p.cost).toBeCloseTo(250 * SAND.premium.costMult + 0.6 * 4 * COSTS.cutPerM3);
  commitPlan(g, p, 'construction'); const i = g.world.idx(25, 25);
  expect(g.world.surface[i]).toBe(Surface.Bunker); expect(g.world.elevation[i]).toBeCloseTo(9.4); expect(g.soilStockpileM3).toBeCloseTo(2.4);
});
test('re-bunkering an existing bunker costs nothing', () => {
  const g = newOwnedGame(); commitPlan(g, planBunker(g, [{ x: 25, y: 25 }], 'standard'), 'construction');
  expect(planBunker(g, [{ x: 25, y: 25 }], 'standard').changes.length).toBe(0);
});
test('water dig charges dig + liner and makes water', () => {
  const g = newOwnedGame(); const p = planDigWater(g, [{ x: 25, y: 25 }, { x: 26, y: 25 }]);
  expect(p.cost).toBeCloseTo(2 * (1.5 * 4 * COSTS.digWaterPerM3 + COSTS.pondLinerPerTile));
  commitPlan(g, p, 'construction'); expect(g.world.surface[g.world.idx(25, 25)]).toBe(Surface.Water); expect(g.world.elevation[g.world.idx(25, 25)]).toBeCloseTo(8.5);
});
test('filling a pond restores grade and is expensive', () => {
  const g = newOwnedGame(); commitPlan(g, planDigWater(g, [{ x: 25, y: 25 }]), 'construction');
  const p = planFillWater(g, [{ x: 25, y: 25 }]); expect(p.cost).toBeCloseTo(1.5 * 4 * COSTS.fillWaterPerM3);
  commitPlan(g, p, 'construction'); expect(g.world.surface[g.world.idx(25, 25)]).toBe(Surface.Natural); expect(g.world.elevation[g.world.idx(25, 25)]).toBeCloseTo(10);
});
test('filling a creek is refused', () => {
  const g = newOwnedGame(); const i = g.world.idx(25, 25); g.world.surface[i] = Surface.Water; g.world.feature[i] = Feature.Creek;
  const p = planFillWater(g, [{ x: 25, y: 25 }]); expect(p.changes.length).toBe(0); expect(p.reasons.join()).toMatch(/creek/);
});
test('plant trees with density 1 plants every free tile; skips greens', () => {
  const g = newOwnedGame(); g.world.surface[g.world.idx(25, 25)] = Surface.Green;
  const p = planTrees(g, brushTiles(25, 25, 1), 1, 1); expect(p.changes.length).toBe(4); expect(p.cost).toBe(4 * COSTS.treePlantDefault);
});
test('removing a specimen tree costs more and queues a reputation event', () => {
  const g = newOwnedGame(); const i = g.world.idx(25, 25); g.world.feature[i] = Feature.SpecimenTree; g.world.treeSpecies[i] = 1;
  g.world.treeSpecies[g.world.idx(26, 25)] = 2;
  const p = planRemoveTrees(g, [{ x: 25, y: 25 }, { x: 26, y: 25 }]); expect(p.cost).toBe(COSTS.specimenRemove + COSTS.treeRemove);
  expect(g.pendingReputationEvents.length).toBe(0); commitPlan(g, p, 'construction');
  expect(g.pendingReputationEvents).toEqual([{ kind: 'specimenRemoved', at: { x: 25, y: 25 } }]);
  expect(g.world.feature[i]).toBe(Feature.None); expect(g.world.treeSpecies[i]).toBe(0);
});
test('stakes: OB beside unowned land, red beside a lateral pond, yellow across the line', () => {
  const g = newOwnedGame({ size: 200, parcels: [[0, 0], [0, 1], [0, 2], [0, 3]] }); const c = g.courses.create('Main');
  const r = commitPenHole(g, { courseId: c.id, route: [{ x: 30, y: 10 }, { x: 30, y: 190 }], fairwayWidthYd: 35, roughWidthYd: 15, greenRadiusYd: 14 });
  expect(r.ok).toBe(true); if (!r.ok) return; const h = r.value;
  for (let y = 90; y < 100; y++) for (let x = 5; x < 10; x++) g.world.surface[g.world.idx(x, y)] = Surface.Water; // lateral, left
  for (let y = 140; y < 144; y++) for (let x = 24; x < 37; x++) g.world.surface[g.world.idx(x, y)] = Surface.Water; // crossing
  const s = computeStakes(g, h);
  expect(s.ob.length).toBeGreaterThan(0); expect(s.ob.every(p => p.x >= 45)).toBe(true);
  expect(s.red.some(p => p.x < 12 && p.y >= 88 && p.y <= 101)).toBe(true);
  expect(s.yellow.some(p => p.y >= 138 && p.y <= 145)).toBe(true);
});
test('dispatch commands for hazards', () => {
  const g = newOwnedGame();
  expect(g.dispatch({ t: 'bunker', tiles: [{ x: 20, y: 20 }], sand: 'standard' }).ok).toBe(true);
  expect(g.dispatch({ t: 'digWater', tiles: [{ x: 30, y: 30 }] }).ok).toBe(true);
  expect(g.dispatch({ t: 'plantTrees', tiles: [{ x: 40, y: 40 }], species: 1, density: 1 }).ok).toBe(true);
  expect(g.dispatch({ t: 'removeTrees', tiles: [{ x: 40, y: 40 }] }).ok).toBe(true);
  expect(g.dispatch({ t: 'fillWater', tiles: [{ x: 30, y: 30 }] }).ok).toBe(true);
});
