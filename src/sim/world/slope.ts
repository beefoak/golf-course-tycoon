import { Vec2 } from '../../core/geom';
import { TILE_M } from '../../core/units';
import { World } from './world';

function elev(w: World, x: number, y: number): number {
  const cx = x < 0 ? 0 : x >= w.size ? w.size - 1 : x;
  const cy = y < 0 ? 0 : y >= w.size ? w.size - 1 : y;
  return w.elevation[cy * w.size + cx]!;
}
/** Bilinear elevation in metres at fractional tile coords. */
export function elevationAt(w: World, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const a = elev(w, x0, y0), b = elev(w, x0 + 1, y0), c = elev(w, x0, y0 + 1), d = elev(w, x0 + 1, y0 + 1);
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}
/** Gradient (rise/run) and downhill unit direction at a tile, via central differences. */
export function slopeAt(w: World, x: number, y: number): { gradient: number; dir: Vec2 } {
  const xi = Math.round(x), yi = Math.round(y);
  const dx = (elev(w, xi + 1, yi) - elev(w, xi - 1, yi)) / (2 * TILE_M);
  const dy = (elev(w, xi, yi + 1) - elev(w, xi, yi - 1)) / (2 * TILE_M);
  const g = Math.hypot(dx, dy);
  if (g === 0) return { gradient: 0, dir: { x: 0, y: 0 } };
  return { gradient: g, dir: { x: -dx / g, y: -dy / g } };
}
