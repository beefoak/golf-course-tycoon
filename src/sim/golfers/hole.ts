import { Vec2 } from '../../core/geom';
import { Rng } from '../../core/rng';
import { TILE_M } from '../../core/units';
import { Hole, TeeKind } from '../course/course';
import { holePar } from '../course/yardage';
import type { Game } from '../game';
import { Feature, Surface, isWalkable } from '../world/tiles';
import { center, chooseTee, planShot } from './ai';
import { BallOutcome } from './ballPhysics';
import { ClubId } from './clubs';
import { Golfer } from './golfer';
import { greenStimp } from './greenSpeed';
import { lieAt } from './lie';
import { putt } from './putting';
import { simulateShot } from './shot';

/** Double par pickup. */
export const MAX_STROKES = (par: number): number => par * 2;

export interface ShotRecord {
  from: Vec2;
  landing: Vec2;
  final: Vec2;
  club: ClubId;
  result: BallOutcome['result'];
  /** penalty strokes this shot added */
  penalty: number;
  /** the ball's resting place after any drop (where the next shot is played from) */
  next: Vec2;
}

export interface HoleResult {
  holeId: number;
  tee: TeeKind;
  strokes: number;
  putts: number;
  shots: ShotRecord[];
  pickedUp: boolean;
  penalties: number;
  gir: boolean;
  fairwayHit: boolean | null;
}

function playable(g: Game, p: Vec2): boolean {
  const w = g.world;
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (!w.inBounds(x, y) || !g.parcels.tileOwned(x, y)) return false;
  const i = w.idx(x, y);
  const s = w.surface[i] as Surface;
  if (s === Surface.Water || s === Surface.Building || s === Surface.Bunker) return false;
  const f = w.feature[i] as Feature;
  return f !== Feature.Rock && f !== Feature.Creek && isWalkable(w, x, y);
}

/** Water drop: walk back from the entry point toward where the shot came from until on dry, playable ground. */
function waterDrop(g: Game, entry: Vec2, from: Vec2): Vec2 {
  const d = Math.hypot(from.x - entry.x, from.y - entry.y);
  if (d < 1e-6) return from;
  const ux = (from.x - entry.x) / d, uy = (from.y - entry.y) / d;
  for (let t = 0.5; t <= d; t += 0.5) {
    const p = { x: entry.x + ux * t, y: entry.y + uy * t };
    if (playable(g, p)) return p;
  }
  return from;
}

/** Unplayable: drop within two club lengths (~1 tile), not nearer the hole, on playable ground. */
function unplayableDrop(g: Game, spot: Vec2, pin: Vec2, from: Vec2): Vec2 {
  const d0 = Math.hypot(spot.x - pin.x, spot.y - pin.y);
  for (const r of [0.6, 1.0]) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const p = { x: spot.x + Math.cos(a) * r, y: spot.y + Math.sin(a) * r };
      if (Math.hypot(p.x - pin.x, p.y - pin.y) >= d0 && playable(g, p)) return p;
    }
  }
  return from;
}

/**
 * Play a whole hole headless: tee choice, shot planning, simulated shots and putts, penalties
 * (water: +1 and drop back on the line; OB/lost: stroke and distance; unplayable: +1 and a
 * 2-club-length drop or replay), and the double-par pickup.
 */
export function simulateHole(g: Game, golfer: Golfer, hole: Hole, rng: Rng, wind: Vec2 = { x: 0, y: 0 }): HoleResult {
  const tee = chooseTee(golfer, hole);
  const pinTile = hole.pins[hole.activePin] ?? hole.greenCenter;
  const pin = center(pinTile);
  const par = holePar(hole);
  const max = MAX_STROKES(par);
  const stimp = greenStimp(g, hole.id);
  let ball = center(tee.center);
  let strokes = 0, putts = 0, penalties = 0;
  let holed = false;
  let gir = false;
  let fairwayHit: boolean | null = par >= 4 ? false : null;
  const shots: ShotRecord[] = [];

  while (strokes < max) {
    const lie = lieAt(g.world, ball);
    const distM = Math.hypot(pin.x - ball.x, pin.y - ball.y) * TILE_M;
    if (lie === 'green' || (lie === 'fringe' && distM < 8)) {
      if (putts === 0 && strokes <= par - 2 && lie === 'green') gir = true;
      const r = putt(g, ball, pin, golfer, stimp, rng);
      strokes++; putts++;
      shots.push({ from: ball, landing: r.final, final: r.final, club: 'P', result: 'ok', penalty: 0, next: r.final });
      ball = r.final;
      if (r.holed) { holed = true; break; }
      continue;
    }
    const plan = planShot(g, golfer, ball, lie, hole, pin, rng);
    const out = simulateShot(g, { from: ball, target: plan.target, club: plan.club, lie, golfer, wind }, rng);
    strokes++;
    let penalty = 0;
    let next = out.final;
    switch (out.result) {
      case 'water': penalty = 1; next = waterDrop(g, out.hazardEntry ?? out.final, ball); break;
      case 'ob':
      case 'lost': penalty = 1; next = ball; break;
      case 'unplayable': penalty = 1; next = unplayableDrop(g, out.final, pin, ball); break;
      default: break;
    }
    if (strokes === 1 && fairwayHit === false && out.result === 'ok') fairwayHit = lieAt(g.world, next) === 'fairway';
    // a holed approach (ball finishing in the cup)
    if (out.result === 'ok' && Math.hypot(next.x - pin.x, next.y - pin.y) * TILE_M < 0.06) holed = true;
    penalties += penalty;
    strokes += penalty;
    shots.push({ from: ball, landing: out.landing, final: out.final, club: plan.club.id, result: out.result, penalty, next });
    ball = next;
    if (holed) break;
  }
  const pickedUp = !holed;
  if (pickedUp) strokes = max;
  return { holeId: hole.id, tee: tee.kind, strokes, putts, shots, pickedUp, penalties, gir, fairwayHit };
}
