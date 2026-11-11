import { tilesToYards, yardsToTiles, PARCEL_TILES, MAP_TILES, PARCELS_PER_SIDE, TILE_M } from '../../src/core/units';
import { dist, add, sub, scale, norm, fromAngle, angleOf, lerp } from '../../src/core/geom';
import { ok, fail } from '../../src/core/result';

test('constants', () => {
  expect(TILE_M).toBe(2); expect(PARCEL_TILES).toBe(50); expect(MAP_TILES).toBe(1000); expect(PARCELS_PER_SIDE).toBe(20);
});
test('tile/yard conversion', () => {
  expect(tilesToYards(50)).toBeCloseTo(109.36, 1);
  expect(yardsToTiles(tilesToYards(123))).toBeCloseTo(123, 6);
});
test('geom helpers', () => {
  expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
  expect(sub({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: -2, y: -2 });
  expect(scale({ x: 1, y: 2 }, 2)).toEqual({ x: 2, y: 4 });
  expect(norm({ x: 3, y: 4 }).x).toBeCloseTo(0.6);
  expect(norm({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  const v = fromAngle(angleOf({ x: 0, y: 1 }), 2); expect(v.x).toBeCloseTo(0); expect(v.y).toBeCloseTo(2);
  expect(lerp({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5)).toEqual({ x: 5, y: 0 });
});
test('result helpers', () => {
  expect(ok(3)).toEqual({ ok: true, value: 3 });
  expect(fail('no')).toEqual({ ok: false, reason: 'no' });
});
