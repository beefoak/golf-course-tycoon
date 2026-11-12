import { Vec2 } from '../../core/geom';
import { Rng } from '../../core/rng';
import { TILE_M } from '../../core/units';
import type { Game } from '../game';
import { BallOutcome, rollBall } from './ballPhysics';
import { ClubSpec } from './clubs';
import { Golfer } from './golfer';
import { LIE_EFFECT, Lie } from './lie';

export interface ShotInput {
  from: Vec2;
  target: Vec2;
  club: ClubSpec;
  lie: Lie;
  golfer: Golfer;
  /** m/s, x/y in map axes */
  wind: Vec2;
}

export type ShotOutcome = BallOutcome & { landing: Vec2; mishit: boolean; carryM: number };

export const WIND_PUSH = 0.012;

/** Share of the wind's push a golfer allows for by aiming off (good players read it better). */
export function windAllowance(handicap: number): number {
  return Math.max(0.3, Math.min(0.85, 0.85 - 0.018 * handicap));
}

export function mishitChance(handicap: number): number {
  // like the clubs' spread, the rate climbs more slowly past 15
  const h = Math.min(handicap, 15) + 0.5 * Math.max(0, handicap - 15);
  return Math.max(0, 0.01 + 0.006 * h);
}

/**
 * One full or partial swing: the golfer aims at `target` (carry point), errors come from the
 * club's dispersion scaled by the lie, a mishit loses 30–60% of the distance and doubles the
 * angle error, then wind pushes the landing (less the part the golfer aimed off for) and the ball rolls out.
 */
export function simulateShot(g: Game, s: ShotInput, rng: Rng): ShotOutcome {
  const eff = LIE_EFFECT[s.lie];
  const dx = s.target.x - s.from.x, dy = s.target.y - s.from.y;
  const wantM = Math.hypot(dx, dy) * TILE_M;
  const maxM = s.club.carryM * eff.distMult;
  const intended = Math.min(wantM, maxM);
  const mishit = rng.chance(mishitChance(s.golfer.handicap));
  // partial swings are a little more precise in distance than full ones
  const partial = maxM > 0 ? intended / maxM : 1;
  let carry = intended * (1 + rng.normal(0, s.club.sdDistPct * eff.distMult ** -0.5 * (0.6 + 0.4 * partial)));
  let angleErr = rng.normal(0, s.club.sdAngleDeg * eff.angleMult) * (Math.PI / 180);
  if (mishit) { carry *= rng.range(0.4, 0.7); angleErr *= 2; }
  carry = Math.max(1, carry);
  const aim = Math.atan2(dy, dx) + angleErr;
  const dir = { x: Math.cos(aim), y: Math.sin(aim) };
  const carryTiles = carry / TILE_M;
  // the golfer aims off for the push they expect on the intended carry; the real push follows the real carry
  const allow = windAllowance(s.golfer.handicap) * intended;
  const landing = {
    x: s.from.x + dir.x * carryTiles + (s.wind.x * (carry - allow) * WIND_PUSH) / TILE_M,
    y: s.from.y + dir.y * carryTiles + (s.wind.y * (carry - allow) * WIND_PUSH) / TILE_M,
  };
  const out = rollBall(g, landing, dir, carry, s.club.launch, rng);
  return { ...out, landing, mishit, carryM: carry };
}
