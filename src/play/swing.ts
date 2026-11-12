import { Vec2 } from '../core/geom';
import { Rng } from '../core/rng';
import { TILE_M } from '../core/units';
import type { Game } from '../sim/game';
import { BallOutcome, rollBall, rollFriction } from '../sim/golfers/ballPhysics';
import { ClubSpec } from '../sim/golfers/clubs';
import { LIE_EFFECT, Lie } from '../sim/golfers/lie';
import { WIND_PUSH } from '../sim/golfers/shot';
import { slopeAt } from '../sim/world/slope';

export type MeterPhase = 'idle' | 'power' | 'accuracy' | 'done';

/** Half-width of the accuracy zone on the meter (in meter units). */
export const ACCURACY_ZONE = 0.12;
export const METER_MAX = 1.1;
/** Biggest hook/slice from a fully missed accuracy press (degrees). */
export const MAX_CURVE_DEG = 14;

/**
 * Three-click swing meter. press() starts the sweep; the marker runs 0 → 1.1 in 1 s and back.
 * The first press locks power; the marker keeps falling and the second press locks accuracy as
 * it passes the zone at 0 (early = positive/hook, late = negative/slice). No second press: a full miss.
 */
export class SwingMeter {
  phase: MeterPhase = 'idle';
  /** marker position */
  t = 0;
  power = 0;
  accuracy = 0;
  private dir = 1;
  /** >1 for harder clubs (the marker moves faster) */
  constructor(public speed = 1) {}

  press(): void {
    if (this.phase === 'idle') { this.phase = 'power'; this.t = 0; this.dir = 1; }
    else if (this.phase === 'power') { this.power = this.t; this.phase = 'accuracy'; this.dir = -1; }
    else if (this.phase === 'accuracy') { this.accuracy = Math.max(-1, Math.min(1, this.t / ACCURACY_ZONE)); this.phase = 'done'; }
  }
  update(dtMs: number): void {
    if (this.phase !== 'power' && this.phase !== 'accuracy') return;
    this.t += this.dir * (METER_MAX / 1000) * dtMs * this.speed;
    if (this.phase === 'power') {
      if (this.t >= METER_MAX) { this.t = METER_MAX; this.dir = -1; }
      if (this.t <= 0 && this.dir < 0) { this.power = 0.05; this.phase = 'accuracy'; this.t = 0; }
    } else if (this.t <= -ACCURACY_ZONE) { this.t = -ACCURACY_ZONE; this.accuracy = -1; this.phase = 'done'; }
  }
  /** For tests and replays: a meter already locked at these values. */
  static locked(power: number, accuracy: number): SwingMeter {
    const m = new SwingMeter();
    m.power = power; m.accuracy = accuracy; m.phase = 'done';
    return m;
  }
}

export interface PlayState {
  /** the player's skill as a handicap (0–30): sets dispersion */
  handicap: number;
  pos: Vec2;
  lie: Lie;
  wind: Vec2;
  rng: Rng;
}

/**
 * A full swing played by the player. The meter's accuracy scales dispersion (a perfect press gives
 * 30% of the usual spread) and its error bends the ball (hook/slice); power past 100% adds
 * distance and doubles the error.
 */
export function playerShot(g: Game, s: PlayState, aim: Vec2, club: ClubSpec, meter: SwingMeter): BallOutcome & { landing: Vec2; carryM: number } {
  const eff = LIE_EFFECT[s.lie];
  const over = Math.max(0, meter.power - 1);
  const errScale = (0.3 + 0.7 * Math.abs(meter.accuracy)) * (over > 0 ? 2 : 1);
  const sdAngle = (2 + 0.22 * s.handicap) * eff.angleMult;
  const sdDist = (0.04 + 0.006 * s.handicap) * eff.distMult ** -0.5;
  const dx = aim.x - s.pos.x, dy = aim.y - s.pos.y;
  const baseCarry = club.carryM * eff.distMult * Math.min(1, meter.power) * (1 + over);
  let carry = baseCarry * (1 + s.rng.normal(0, sdDist * errScale));
  carry = Math.max(1, carry);
  const curve = meter.accuracy * MAX_CURVE_DEG * (over > 0 ? 2 : 1);
  const angle = Math.atan2(dy, dx) + (curve + s.rng.normal(0, sdAngle * errScale)) * Math.PI / 180;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const tiles = carry / TILE_M;
  const landing = {
    x: s.pos.x + dir.x * tiles + (s.wind.x * carry * WIND_PUSH) / TILE_M,
    y: s.pos.y + dir.y * tiles + (s.wind.y * carry * WIND_PUSH) / TILE_M,
  };
  const out = rollBall(g, landing, dir, carry, club.launch, s.rng);
  return { ...out, landing, carryM: carry };
}

/** Fastest putt the meter gives at full power (m/s): about 25 m on a Stimp-10 flat green. */
export const MAX_PUTT_SPEED = 5;
const G = 9.81;
const CUP_M = 0.054;

/**
 * A putt rolled for real: friction from the green's speed, gravity pulling it down the slopes,
 * and the cup catching a ball that reaches it slowly enough.
 */
export function rollPutt(g: Game, from: Vec2, aim: Vec2, power: number, pin: Vec2): { final: Vec2; holed: boolean; path: Vec2[] } {
  const w = g.world;
  let x = from.x * TILE_M, y = from.y * TILE_M;
  const d = Math.hypot(aim.x - from.x, aim.y - from.y) || 1;
  let vx = (aim.x - from.x) / d * MAX_PUTT_SPEED * Math.max(0, Math.min(1.1, power));
  let vy = (aim.y - from.y) / d * MAX_PUTT_SPEED * Math.max(0, Math.min(1.1, power));
  const px = pin.x * TILE_M, py = pin.y * TILE_M;
  const path: Vec2[] = [{ ...from }];
  const dt = 0.01;
  for (let k = 0; k < 3000; k++) {
    const tx = x / TILE_M, ty = y / TILE_M;
    if (!w.inBounds(Math.floor(tx), Math.floor(ty))) break;
    let v = Math.hypot(vx, vy);
    if (Math.hypot(x - px, y - py) < CUP_M && v < 1.6) return { final: { ...pin }, holed: true, path };
    const fr = rollFriction(g, w.idx(Math.floor(tx), Math.floor(ty))) * G;
    const sl = slopeAt(w, tx, ty);
    if (v < 0.02) {
      // stopped: it stays unless the slope is steeper than the turf can hold
      if (sl.gradient * 5 / 7 * G <= fr) break;
      vx = sl.dir.x * 0.03; vy = sl.dir.y * 0.03; v = 0.03;
    }
    // gravity down the slope (a rolling ball feels 5/7 of it)
    const ax = -fr * vx / v + G * sl.gradient * sl.dir.x * 5 / 7;
    const ay = -fr * vy / v + G * sl.gradient * sl.dir.y * 5 / 7;
    const nvx = vx + ax * dt, nvy = vy + ay * dt;
    // friction can bring the ball to rest but never push it backwards
    if (nvx * vx + nvy * vy < 0) { vx = 0; vy = 0; continue; }
    vx = nvx; vy = nvy;
    x += vx * dt; y += vy * dt;
    if (k % 10 === 0) path.push({ x: x / TILE_M, y: y / TILE_M });
  }
  const final = { x: x / TILE_M, y: y / TILE_M };
  path.push(final);
  return { final, holed: false, path };
}
