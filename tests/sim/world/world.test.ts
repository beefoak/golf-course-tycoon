import { World } from '../../../src/sim/world/world';
import { slopeAt, elevationAt } from '../../../src/sim/world/slope';
import { Surface, Feature, isBlockingFeature, isPlayableSurface } from '../../../src/sim/world/tiles';

test('world idx/inBounds', () => {
  const w = new World(100);
  expect(w.idx(3, 2)).toBe(203); expect(w.inBounds(-1, 0)).toBe(false); expect(w.inBounds(99, 99)).toBe(true); expect(w.inBounds(100, 0)).toBe(false);
  expect(w.chunksPerSide).toBe(2);
});
test('dirty chunks are collected once', () => {
  const w = new World(100); w.markDirty(0, 0); w.markDirty(1, 1); w.markDirty(60, 10);
  expect(w.takeDirtyChunks().sort()).toEqual([0, 1]); expect(w.takeDirtyChunks()).toEqual([]);
});
test('slope points downhill', () => {
  const w = new World(10); for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) w.elevation[w.idx(x, y)] = x * 0.2;
  const s = slopeAt(w, 5, 5); expect(s.gradient).toBeCloseTo(0.1, 3); expect(s.dir.x).toBeLessThan(0);
});
test('flat slope has zero gradient', () => {
  const w = new World(10); expect(slopeAt(w, 5, 5).gradient).toBe(0);
});
test('elevationAt interpolates', () => {
  const w = new World(10); w.elevation[w.idx(2, 2)] = 0; w.elevation[w.idx(3, 2)] = 1;
  expect(elevationAt(w, 2.5, 2)).toBeCloseTo(0.5);
});
test('tile classification', () => {
  expect(isBlockingFeature(Feature.Rock)).toBe(true); expect(isBlockingFeature(Feature.SpecimenTree)).toBe(false);
  expect(isPlayableSurface(Surface.Fairway)).toBe(true); expect(isPlayableSurface(Surface.Water)).toBe(false);
});
