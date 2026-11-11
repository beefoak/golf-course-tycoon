import { hillshade } from '../../src/render/shading';
import { World } from '../../src/sim/world/world';

const make = (f: (x: number, y: number) => number) => {
  const w = new World(20); for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) w.elevation[w.idx(x, y)] = f(x, y); return w;
};
test('hillshade brighter on sun-facing slope', () => {
  const facingSun = hillshade(make((x, y) => (x + y) * 0.1), 10, 10);
  const flat = hillshade(make(() => 0), 10, 10);
  const away = hillshade(make((x, y) => -(x + y) * 0.1), 10, 10);
  expect(flat).toBeCloseTo(1); expect(facingSun).toBeGreaterThan(flat); expect(away).toBeLessThan(flat);
});
test('hillshade is clamped', () => {
  expect(hillshade(make((x, y) => (x + y) * 10), 10, 10)).toBeLessThanOrEqual(1.25);
  expect(hillshade(make((x, y) => -(x + y) * 10), 10, 10)).toBeGreaterThanOrEqual(0.6);
});
