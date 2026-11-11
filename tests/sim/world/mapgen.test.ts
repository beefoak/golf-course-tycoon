import { generateWorld } from '../../../src/sim/world/mapgen';
import { TERRAINS } from '../../../src/sim/world/terrainTypes';
import { World } from '../../../src/sim/world/world';
import { Surface, Feature } from '../../../src/sim/world/tiles';

const count = (w: World, pred: (i: number) => boolean) => { let c = 0; for (let i = 0; i < w.size * w.size; i++) if (pred(i)) c++; return c; };
const range = (w: World) => { let lo = Infinity, hi = -Infinity; for (const v of w.elevation) { if (v < lo) lo = v; if (v > hi) hi = v; } return hi - lo; };

test('same seed → identical world', () => {
  const a = generateWorld(11, 'parkland', 200), b = generateWorld(11, 'parkland', 200);
  expect(a.elevation).toEqual(b.elevation); expect(a.feature).toEqual(b.feature); expect(a.surface).toEqual(b.surface); expect(a.treeSpecies).toEqual(b.treeSpecies);
});
test('different seeds differ', () => {
  expect(generateWorld(1, 'parkland', 200).elevation).not.toEqual(generateWorld(2, 'parkland', 200).elevation);
});
test('has road on south edge and some rocks, water, trees', () => {
  const w = generateWorld(3, 'parkland', 200);
  expect(w.feature[w.idx(100, 199)]).toBe(Feature.Road);
  expect(count(w, i => w.feature[i] === Feature.Rock)).toBeGreaterThan(0);
  expect(count(w, i => w.surface[i] === Surface.Water)).toBeGreaterThan(0);
  expect(count(w, i => w.treeSpecies[i] !== 0)).toBeGreaterThan(0);
});
test('mountain is steeper than links', () => {
  expect(range(generateWorld(4, 'mountain', 200))).toBeGreaterThan(range(generateWorld(4, 'links', 200)));
});
test('desert natural ground is waste', () => {
  expect(TERRAINS.desert.naturalSurface).toBe(Surface.Waste);
  const w = generateWorld(6, 'desert', 200);
  expect(count(w, i => w.surface[i] === Surface.Waste)).toBeGreaterThan(200 * 200 * 0.5);
});
test('creeks are continuous water with Creek feature and reach a map edge', () => {
  const w = generateWorld(7, 'parkland', 200);
  let start = -1; for (let i = 0; i < w.size * w.size; i++) if (w.feature[i] === Feature.Creek) { start = i; break; }
  expect(start).toBeGreaterThanOrEqual(0);
  const seen = new Uint8Array(w.size * w.size); const stack = [start]; seen[start] = 1; let reachesEdge = false;
  while (stack.length) {
    const i = stack.pop()!; const x = i % w.size, y = Math.floor(i / w.size);
    expect(w.surface[i]).toBe(Surface.Water);
    if (x === 0 || y === 0 || x === w.size - 1 || y >= w.size - 4) reachesEdge = true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy; if (!w.inBounds(nx, ny)) continue; const j = w.idx(nx, ny);
      if (!seen[j] && w.feature[j] === Feature.Creek) { seen[j] = 1; stack.push(j); }
    }
  }
  expect(reachesEdge).toBe(true);
});
test('defaults: natural grass mown at 100 mm', () => {
  const w = generateWorld(8, 'parkland', 100);
  const i = w.idx(50, 50); expect(w.mowHeight[i]).toBe(1000); expect(w.health[i]).toBe(70); expect(w.moisture[i]).toBe(50);
});
test('full-size generation under 3s', () => {
  const t = performance.now(); generateWorld(5, 'parkland'); expect(performance.now() - t).toBeLessThan(3000);
});
