import { Vec2 } from '../../core/geom';
import { Rng } from '../../core/rng';
import { TILE_M } from '../../core/units';
import type { Game } from '../game';
import { slopeAt } from '../world/slope';
import { Golfer } from './golfer';

export { greenStimp } from './greenSpeed';

/** Difficulty multiplier for a putt: handicap, green speed and slope at the cup. */
function puttDifficulty(golfer: Golfer, stimp: number, cupGradient: number): number {
  return (1.15 + 0.02 * Math.max(0, golfer.handicap)) * Math.sqrt(stimp / 10) * (1 + 8 * cupGradient);
}

/** Probability of holing a putt of d metres (tap-ins inside 0.6 m are near certain). */
export function makeProbability(d: number, golfer: Golfer, stimp: number, cupGradient: number): number {
  const p = Math.exp(-0.2 * Math.max(0, d - 0.6) * puttDifficulty(golfer, stimp, cupGradient));
  return Math.max(0, Math.min(0.99, p));
}

/**
 * One putt. A miss finishes past (60%) or short of the hole by |N(0.06d + 0.3, 0.15d)| metres
 * (longer on faster greens), along the line plus a break offset that grows with slope.
 */
export function putt(g: Game, from: Vec2, hole: Vec2, golfer: Golfer, stimp: number, rng: Rng): { final: Vec2; holed: boolean } {
  const dTiles = Math.hypot(hole.x - from.x, hole.y - from.y);
  const d = dTiles * TILE_M;
  const grad = slopeAt(g.world, hole.x, hole.y).gradient;
  if (d < 0.05 || rng.chance(makeProbability(d, golfer, stimp, grad))) return { final: { ...hole }, holed: true };
  const ux = dTiles > 1e-6 ? (hole.x - from.x) / dTiles : 1, uy = dTiles > 1e-6 ? (hole.y - from.y) / dTiles : 0;
  const leave = Math.max(0.15, Math.abs(rng.normal(0.06 * d + 0.3, 0.15 * d)) * Math.sqrt(stimp / 10));
  const along = (rng.chance(0.6) ? 1 : -1) * leave;
  const lateral = rng.normal(0, 0.04 * d * (1 + 10 * grad));
  return {
    final: { x: hole.x + (ux * along - uy * lateral) / TILE_M, y: hole.y + (uy * along + ux * lateral) / TILE_M },
    holed: false,
  };
}
