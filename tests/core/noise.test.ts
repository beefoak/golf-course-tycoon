import { createNoise2D, fbm } from '../../src/core/noise';
import { Rng } from '../../src/core/rng';

test('noise is deterministic and bounded', () => {
  const n1 = createNoise2D(new Rng(5)), n2 = createNoise2D(new Rng(5));
  for (let i = 0; i < 200; i++) {
    const v = n1(i * 0.37, i * 0.11);
    expect(v).toBe(n2(i * 0.37, i * 0.11));
    expect(Math.abs(v)).toBeLessThanOrEqual(1);
  }
});
test('different seeds give different noise', () => {
  const a = createNoise2D(new Rng(1)), b = createNoise2D(new Rng(2));
  let diff = 0; for (let i = 0; i < 50; i++) if (a(i * 0.3, 1.7) !== b(i * 0.3, 1.7)) diff++;
  expect(diff).toBeGreaterThan(40);
});
test('noise varies smoothly', () => {
  const n = createNoise2D(new Rng(3));
  expect(Math.abs(n(10, 10) - n(10.01, 10))).toBeLessThan(0.05);
});
test('fbm is bounded', () => {
  const n = createNoise2D(new Rng(4));
  for (let i = 0; i < 100; i++) expect(Math.abs(fbm(n, i * 0.1, i * 0.2, 5))).toBeLessThanOrEqual(1);
});
