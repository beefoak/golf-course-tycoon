import { Vec2 } from '../core/geom';
import { slopeAt } from '../sim/world/slope';
import { World } from '../sim/world/world';

const STRENGTH = 3;

/** Brightness multiplier (0.6..1.25) for directional hill shading; sun comes from `sunDir`. */
export function hillshade(w: World, x: number, y: number, sunDir: Vec2 = { x: -1, y: -1 }): number {
  const s = slopeAt(w, x, y);
  if (s.gradient === 0) return 1;
  // rise direction = -downhill; brighter when the slope rises away from the sun (faces it)
  const dzdx = -s.dir.x * s.gradient, dzdy = -s.dir.y * s.gradient;
  const l = Math.hypot(sunDir.x, sunDir.y) || 1;
  const v = 1 + STRENGTH * (dzdx * (-sunDir.x / l) + dzdy * (-sunDir.y / l));
  return Math.max(0.6, Math.min(1.25, v));
}
