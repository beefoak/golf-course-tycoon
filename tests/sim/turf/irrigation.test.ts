import { Game } from '../../../src/sim/game';
import { Grass } from '../../../src/sim/turf/grasses';
import { PIPE_COST_PER_TILE, PUMP_TIERS, SPRINKLER_COST, SPRINKLER_M3_PER_MIN, WATER_COST_PER_M3, connectedSprinklers, coverage, waterAtNight } from '../../../src/sim/turf/irrigation';
import { Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';
import { deserialize, serialize } from '../../../src/sim/save';

/** 100×50 owned strip of grassed fairway on course 1, moisture 20. */
function field(): Game {
  const g = newOwnedGame();
  const w = g.world;
  for (let y = 0; y < 50; y++) for (let x = 0; x < 100; x++) {
    const i = w.idx(x, y);
    w.surface[i] = Surface.Fairway; w.grass[i] = Grass.Ryegrass; w.courseId[i] = 1; w.moisture[i] = 20;
  }
  return g;
}
const line = (x0: number, x1: number, y: number) => Array.from({ length: x1 - x0 + 1 }, (_, k) => ({ x: x0 + k, y }));
const m = (g: Game, x: number, y: number) => g.world.moisture[g.world.idx(x, y)]!;

test('placing costs: pump tier, sprinkler, pipe per tile', () => {
  const g = field();
  let cash = g.ledger.cash;
  expect(g.dispatch({ t: 'placePump', at: { x: 5, y: 5 }, tier: 1 }).ok).toBe(true);
  expect(cash - g.ledger.cash).toBe(PUMP_TIERS[1].cost);
  cash = g.ledger.cash;
  expect(g.dispatch({ t: 'placePipe', tiles: line(7, 26, 5) }).ok).toBe(true);
  expect(cash - g.ledger.cash).toBe(20 * PIPE_COST_PER_TILE);
  cash = g.ledger.cash;
  expect(g.dispatch({ t: 'placePipe', tiles: line(20, 30, 5) }).ok).toBe(true); // only the 4 new tiles are charged
  expect(cash - g.ledger.cash).toBe(4 * PIPE_COST_PER_TILE);
  cash = g.ledger.cash;
  expect(g.dispatch({ t: 'placeSprinkler', at: { x: 25, y: 6 }, zone: 1 }).ok).toBe(true);
  expect(cash - g.ledger.cash).toBe(SPRINKLER_COST);
  // pump house is a 3×3 building
  expect(g.world.surface[g.world.idx(5, 5)]).toBe(Surface.Building);
  expect(g.dispatch({ t: 'placeSprinkler', at: { x: 5, y: 5 }, zone: 1 }).ok).toBe(false);
});

test('an unconnected sprinkler waters nothing', () => {
  const g = field();
  g.dispatch({ t: 'placePump', at: { x: 5, y: 5 }, tier: 1 });
  g.dispatch({ t: 'placeSprinkler', at: { x: 60, y: 25 }, zone: 1 });
  expect(connectedSprinklers(g).size).toBe(0);
  waterAtNight(g);
  expect(m(g, 60, 25)).toBe(20);
  expect(g.irrigation.lastNight.m3).toBe(0);
});

test('scheduled zones raise moisture inside the radius only, and water is charged', () => {
  const g = field();
  g.dispatch({ t: 'placePump', at: { x: 5, y: 5 }, tier: 1 });
  g.dispatch({ t: 'placePipe', tiles: [...line(7, 40, 5), ...Array.from({ length: 20 }, (_, k) => ({ x: 40, y: 5 + k }))] });
  g.dispatch({ t: 'placeSprinkler', at: { x: 40, y: 25 }, zone: 2 });
  g.dispatch({ t: 'setIrrigationSchedule', schedule: [{ zone: 2, minutes: 20 }] });
  expect(connectedSprinklers(g).size).toBe(1);
  const cash = g.ledger.cash;
  waterAtNight(g);
  expect(m(g, 40, 25)).toBe(50);
  expect(m(g, 47, 25)).toBe(50); // inside 9 tiles
  expect(m(g, 50, 25)).toBe(20); // outside
  const m3 = 20 * SPRINKLER_M3_PER_MIN;
  expect(g.irrigation.lastNight.m3).toBeCloseTo(m3);
  expect(cash - g.ledger.cash).toBe(Math.round(m3 * WATER_COST_PER_M3));
  expect(g.ledger.totals(g.day, g.day).water.out).toBe(Math.round(m3 * WATER_COST_PER_M3));
});

test('pump capacity limits the volume', () => {
  const g = field();
  g.dispatch({ t: 'placePump', at: { x: 5, y: 5 }, tier: 1 }); // 400 m³/night
  g.dispatch({ t: 'placePipe', tiles: line(7, 95, 5) });
  for (let x = 10; x <= 90; x += 10) g.dispatch({ t: 'placeSprinkler', at: { x, y: 6 }, zone: 1 });
  // 9 heads × 120 min × 0.4 = 432 m³ wanted
  g.dispatch({ t: 'setIrrigationSchedule', schedule: [{ zone: 1, minutes: 120 }] });
  waterAtNight(g);
  expect(g.irrigation.lastNight.m3).toBe(400);
  expect(g.irrigation.lastNight.limited).toBe(true);
  // drought halves it
  g.irrigation.droughtUntilDay = g.day + 3;
  waterAtNight(g);
  expect(g.irrigation.lastNight.m3).toBe(200);
});

test('coverage counts course turf inside working, connected heads', () => {
  const g = field(); // 5000 turf tiles
  g.dispatch({ t: 'placePump', at: { x: 5, y: 45 }, tier: 1 });
  g.dispatch({ t: 'placePipe', tiles: line(7, 60, 44) });
  expect(coverage(g, 1)).toBe(0);
  const r = g.dispatch({ t: 'placeSprinkler', at: { x: 50, y: 25 }, zone: 1 }); // not connected
  expect(r.ok).toBe(true);
  expect(coverage(g, 1)).toBe(0);
  g.dispatch({ t: 'placeSprinkler', at: { x: 50, y: 43 }, zone: 1 }); // touches the pipe
  // circle r=9 clipped by the map bottom edge (y ≤ 49): count directly
  let inCircle = 0;
  for (let y = 34; y <= 49; y++) for (let x = 41; x <= 59; x++) if ((x - 50) ** 2 + (y - 43) ** 2 <= 81) inCircle++;
  // the pump house took 9 turf tiles; none are inside this circle
  expect(coverage(g, 1)).toBeCloseTo(inCircle / (5000 - 9), 5);
  g.irrigation.sprinklers[1]!.broken = true;
  expect(coverage(g, 1)).toBe(0);
  expect(g.dispatch({ t: 'repairSprinkler', id: g.irrigation.sprinklers[1]!.id }).ok).toBe(true);
  expect(coverage(g, 1)).toBeGreaterThan(0);
});

test('watering runs every night and survives save/load', () => {
  const g = field();
  g.dispatch({ t: 'placePump', at: { x: 5, y: 5 }, tier: 2 });
  g.dispatch({ t: 'placePipe', tiles: line(7, 30, 5) });
  g.dispatch({ t: 'placeSprinkler', at: { x: 30, y: 6 }, zone: 1 });
  const r = deserialize(serialize(g));
  expect(r.ok).toBe(true);
  const g2 = (r as { ok: true; value: Game }).value;
  expect(g2.irrigation.sprinklers.length).toBe(1);
  expect(connectedSprinklers(g2).size).toBe(1);
  const day = g2.day;
  while (g2.day === day) g2.tick();
  expect(g2.irrigation.lastNight.m3).toBeGreaterThan(0);
  expect(g2.irrigation.rng.getState()).toBe((() => { const d = g.day; while (g.day === d) g.tick(); return g.irrigation.rng.getState(); })());
});
