import { Vec2 } from '../../core/geom';
import { Rng } from '../../core/rng';
import { TILE_M } from '../../core/units';
import type { Game } from '../game';
import { slopeAt } from '../world/slope';
import { Feature, Surface } from '../world/tiles';
import { ClubSpec } from './clubs';
import { greenStimp } from './greenSpeed';

export interface BallOutcome {
  final: Vec2;
  path: Vec2[];
  result: 'ok' | 'water' | 'ob' | 'lost' | 'unplayable';
  hazardEntry?: Vec2;
}

const BASE_ROLL: Record<ClubSpec['launch'], number> = { low: 0.18, mid: 0.1, high: 0.04 };
const G = 9.81;

/**
 * Rolling resistance as an equivalent gradient (deceleration / g). A green at Stimp 10 is ~0.055
 * (a ball leaving the stimpmeter at 1.83 m/s rolls 3.05 m).
 */
export function rollFriction(g: Game, i: number): number {
  const w = g.world;
  switch (w.surface[i] as Surface) {
    case Surface.Green: return 0.055 * (10 / greenStimp(g, w.holeId[i]!));
    case Surface.Fringe: return 0.09;
    case Surface.Tee:
    case Surface.Fairway: return 0.12 * (1.5 - w.firmness[i]! / 100);
    case Surface.FirstCut: return 0.2;
    case Surface.Path: return 0.08;
    case Surface.Rough:
    case Surface.Natural:
    case Surface.Waste: return 0.4;
    case Surface.Native: return 0.6;
    case Surface.DeepRough: return 0.8;
    default: return 0.4;
  }
}

/** Flat-ground roll multiplier on the landing surface (fraction of the base roll). */
function landingRollFactor(g: Game, i: number): number {
  const w = g.world;
  switch (w.surface[i] as Surface) {
    case Surface.Green: return greenStimp(g, w.holeId[i]!) / 10;
    case Surface.Tee:
    case Surface.Fairway:
    case Surface.Fringe: return Math.max(0.4, Math.min(1.6, w.firmness[i]! / 50));
    case Surface.FirstCut: return 0.6;
    case Surface.Path: return 1.5;
    case Surface.Bunker: return 0;
    case Surface.DeepRough: return 0.15;
    default: return 0.3;
  }
}

type Stop = BallOutcome['result'] | 'stop' | null;

/** What happens when the ball reaches this tile (null = keeps rolling). */
function tileEffect(g: Game, x: number, y: number): Stop {
  const w = g.world;
  if (!w.inBounds(x, y) || !g.parcels.tileOwned(x, y)) return 'ob';
  const i = w.idx(x, y);
  const f = w.feature[i] as Feature;
  if (f === Feature.Road || f === Feature.Neighbor) return 'ob';
  const s = w.surface[i] as Surface;
  if (s === Surface.Water || (f === Feature.Creek && s !== Surface.Path)) return 'water';
  if (f === Feature.Rock) return 'unplayable';
  if (s === Surface.Bunker || s === Surface.Building) return 'stop';
  if (w.treeSpecies[i]) return 'stop';
  return null;
}

function denseTrees(g: Game, x: number, y: number): boolean {
  const w = g.world;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && w.inBounds(x + dx, y + dy) && w.treeSpecies[w.idx(x + dx, y + dy)]) n++;
  }
  return n >= 3;
}

/**
 * Bounce-and-roll from a landing point (tile coords). The ball's initial roll speed comes from the
 * carry, launch and landing surface; it then decelerates by each tile's rolling resistance while
 * the slope accelerates it downhill, stepping until it stops or reaches water, OB or a rock.
 */
export function rollBall(g: Game, landing: Vec2, dir: Vec2, carryM: number, launch: ClubSpec['launch'], rng: Rng = g.rng): BallOutcome {
  const w = g.world;
  const lx = Math.floor(landing.x), ly = Math.floor(landing.y);
  const path: Vec2[] = [{ ...landing }];
  const land = tileEffect(g, lx, ly);
  if (land === 'water') return { final: { ...landing }, path, result: 'water', hazardEntry: { ...landing } };
  if (land === 'ob' || land === 'unplayable') return { final: { ...landing }, path, result: land };
  if (land === 'stop') {
    const i = w.idx(lx, ly);
    if (w.treeSpecies[i]) {
      if (rng.chance(0.5)) return { final: { ...landing }, path, result: 'ok' };
      return denseTrees(g, lx, ly) ? { final: { ...landing }, path, result: 'lost' } : { final: { ...landing }, path, result: 'ok' };
    }
    return { final: { ...landing }, path, result: 'ok' };
  }

  const len = Math.hypot(dir.x, dir.y) || 1;
  const i0 = w.idx(lx, ly);
  const r0 = carryM * BASE_ROLL[launch] * landingRollFactor(g, i0); // metres on this surface, flat
  const mu0 = rollFriction(g, i0);
  const speed = Math.sqrt(2 * mu0 * G * r0);
  let vx = (dir.x / len) * speed, vy = (dir.y / len) * speed; // m/s
  let px = landing.x, py = landing.y; // tiles
  const dt = 0.05;
  let lastTile = i0;
  for (let step = 0; step < 4000; step++) {
    const sp = Math.hypot(vx, vy);
    const xi = Math.floor(px), yi = Math.floor(py);
    const i = w.idx(Math.max(0, Math.min(w.size - 1, xi)), Math.max(0, Math.min(w.size - 1, yi)));
    const mu = rollFriction(g, i);
    const sl = slopeAt(w, px - 0.5, py - 0.5);
    const ax = sl.dir.x * sl.gradient * G, ay = sl.dir.y * sl.gradient * G;
    if (sp < 0.03) {
      // at rest unless the slope beats static friction
      if (sl.gradient <= mu * 1.2) break;
    }
    const fx = sp > 1e-6 ? (-vx / sp) * mu * G : 0, fy = sp > 1e-6 ? (-vy / sp) * mu * G : 0;
    const nvx = vx + (ax + fx) * dt, nvy = vy + (ay + fy) * dt;
    // friction must not reverse the motion on its own
    if (sp > 1e-6 && nvx * vx + nvy * vy < 0 && sl.gradient <= mu) break;
    vx = nvx; vy = nvy;
    px += (vx * dt) / TILE_M; py += (vy * dt) / TILE_M;
    const nxi = Math.floor(px), nyi = Math.floor(py);
    const ni = w.inBounds(nxi, nyi) ? w.idx(nxi, nyi) : -1;
    if (ni !== lastTile) {
      lastTile = ni;
      path.push({ x: px, y: py });
      const e = tileEffect(g, nxi, nyi);
      if (e === 'water') return { final: { x: px, y: py }, path, result: 'water', hazardEntry: { x: px, y: py } };
      if (e === 'ob') return { final: { x: px, y: py }, path, result: 'ob' };
      if (e === 'unplayable') {
        // rolled into a rock: rests against it on the previous tile
        px -= (vx * dt) / TILE_M; py -= (vy * dt) / TILE_M;
        break;
      }
      if (e === 'stop') break;
    }
  }
  const final = { x: px, y: py };
  path.push(final);
  return { final, path, result: 'ok' };
}
