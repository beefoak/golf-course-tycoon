import { MAX_PIN_SLOPE, greenTiles, pinnableTiles, pinDifficulty, planGreenShape, autoPins } from '../../../src/sim/course/green';
import { Surface } from '../../../src/sim/world/tiles';
import { dist } from '../../../src/core/geom';
import { newOwnedGame } from '../../helpers';

function greenGame(r = 8) {
  const g = newOwnedGame({ parcels: [[0, 0], [1, 0], [0, 1], [1, 1]] }); const c = g.courses.create('Main');
  const h = g.courses.addHole(c.id, { route: [{ x: 50, y: 10 }, { x: 50, y: 50 }], greenCenter: { x: 50, y: 50 } });
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const d = Math.hypot(x - 50, y - 50); const i = g.world.idx(x, y);
    if (d <= r) { g.world.surface[i] = Surface.Green; g.world.holeId[i] = h.id; }
    else if (d <= r + 1) { g.world.surface[i] = Surface.Fringe; g.world.holeId[i] = h.id; }
  }
  return { g, h };
}

test('MAX_PIN_SLOPE falls linearly from 0.03 at 8 to 0.015 at 13', () => {
  expect(MAX_PIN_SLOPE(8)).toBeCloseTo(0.03); expect(MAX_PIN_SLOPE(13)).toBeCloseTo(0.015); expect(MAX_PIN_SLOPE(10.5)).toBeCloseTo(0.0225);
  expect(MAX_PIN_SLOPE(20)).toBeCloseTo(0.015);
});
test('greenTiles flood-fills the green', () => {
  const { g, h } = greenGame(8); let n = 0; for (const s of g.world.surface) if (s === Surface.Green) n++;
  expect(greenTiles(g, h).length).toBe(n);
});
test('flat green is pinnable except a 2-tile edge band', () => {
  const { g, h } = greenGame(8); const set = new Set(pinnableTiles(g, h, 10));
  expect(set.has(g.world.idx(50, 50))).toBe(true);
  expect(set.has(g.world.idx(58, 50))).toBe(false); expect(set.has(g.world.idx(57, 50))).toBe(false);
  expect(set.has(g.world.idx(56, 50))).toBe(true);
});
test('tilting the green above the max slope leaves nothing pinnable', () => {
  const { g, h } = greenGame(8); for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) g.world.elevation[g.world.idx(x, y)] = x * 0.1;
  expect(pinnableTiles(g, h, 10).length).toBe(0);
});
test('higher stimp reduces the pinnable count', () => {
  const { g, h } = greenGame(8); for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) g.world.elevation[g.world.idx(x, y)] = x * 0.04;
  expect(pinnableTiles(g, h, 8).length).toBeGreaterThan(0); expect(pinnableTiles(g, h, 13).length).toBe(0);
});
test('pin difficulty rises with slope and edge proximity', () => {
  const { g, h } = greenGame(8);
  expect(pinDifficulty(g, h, { x: 56, y: 50 }, 10)).toBeGreaterThan(pinDifficulty(g, h, { x: 50, y: 50 }, 10));
});
test('autoPins returns spread-out pins on pinnable tiles', () => {
  const { g, h } = greenGame(20); const pins = autoPins(g, h, 10, 4); expect(pins.length).toBe(4);
  const ok = new Set(pinnableTiles(g, h, 10)); for (const p of pins) expect(ok.has(g.world.idx(p.x, p.y))).toBe(true);
  for (let a = 0; a < pins.length; a++) for (let b = a + 1; b < pins.length; b++) expect(dist(pins[a]!, pins[b]!)).toBeGreaterThanOrEqual(4);
});
test('shaping outside the green is skipped', () => {
  const { g, h } = greenGame(8);
  const p = planGreenShape(g, h, { op: 'raise', amountM: 0.3 }, [{ x: 50, y: 50 }, { x: 20, y: 20 }]);
  expect(p.changes.map(c => c.i)).toEqual([g.world.idx(50, 50)]); expect(p.reasons.join()).toMatch(/green/);
});
