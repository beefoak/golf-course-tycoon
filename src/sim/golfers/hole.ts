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
import { addWear } from '../turf/turf';
import { bunkerEntry } from '../turf/practices';
import { Lie, lieAt } from './lie';
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

/** One golfer's progress on one hole (the group system steps this stroke by stroke). */
export interface HolePlay {
  golferId: number;
  holeId: number;
  pin: Vec2;
  par: number;
  max: number;
  stimp: number;
  /** current ball position (tile coords) */
  pos: Vec2;
  lie: Lie;
  strokes: number;
  holed: boolean;
  pickedUp: boolean;
  done: boolean;
  result: HoleResult;
}

export function startHole(g: Game, golfer: Golfer, hole: Hole): HolePlay {
  const tee = chooseTee(golfer, hole);
  const par = holePar(hole);
  const pos = center(tee.center);
  return {
    golferId: golfer.id, holeId: hole.id,
    pin: center(hole.pins[hole.activePin] ?? hole.greenCenter),
    par, max: MAX_STROKES(par), stimp: greenStimp(g, hole.id),
    pos, lie: lieAt(g.world, pos), strokes: 0, holed: false, pickedUp: false, done: false,
    result: { holeId: hole.id, tee: tee.kind, strokes: 0, putts: 0, shots: [], pickedUp: false, penalties: 0, gir: false, fairwayHit: par >= 4 ? false : null },
  };
}

/** Is the next stroke a putt? */
export function isPutt(g: Game, p: HolePlay): boolean {
  const lie = lieAt(g.world, p.pos);
  return lie === 'green' || (lie === 'fringe' && Math.hypot(p.pin.x - p.pos.x, p.pin.y - p.pos.y) * TILE_M < 8);
}

/** Where the golfer will aim the next full shot (for the play-through spacing rule); null for a putt. */
export function nextTarget(g: Game, golfer: Golfer, hole: Hole, p: HolePlay): Vec2 | null {
  if (isPutt(g, p)) return null;
  return planShot(g, golfer, p.pos, lieAt(g.world, p.pos), hole, p.pin).target;
}

/**
 * Play one stroke (a swing or a putt) with penalties and drops, updating the HolePlay.
 * Ends the hole when holed, or picks up at double par.
 */
export function playStroke(g: Game, golfer: Golfer, hole: Hole, p: HolePlay, rng: Rng, wind: Vec2 = { x: 0, y: 0 }): ShotRecord {
  const r = p.result;
  let rec: ShotRecord;
  if (isPutt(g, p)) {
    if (r.putts === 0 && p.strokes <= p.par - 2 && lieAt(g.world, p.pos) === 'green') r.gir = true;
    addWear(g, p.pos.x, p.pos.y, 1);
    const pt = putt(g, p.pos, p.pin, golfer, p.stimp, rng);
    p.strokes++; r.putts++;
    rec = { from: p.pos, landing: pt.final, final: pt.final, club: 'P', result: 'ok', penalty: 0, next: pt.final };
    if (pt.holed) p.holed = true;
  } else {
    const lie = lieAt(g.world, p.pos);
    // divots: full shots off tees and fairways scar the turf
    if (lie === 'tee' || lie === 'fairway') addWear(g, p.pos.x, p.pos.y, 4);
    const plan = planShot(g, golfer, p.pos, lie, hole, p.pin, rng);
    const out = simulateShot(g, { from: p.pos, target: plan.target, club: plan.club, lie, golfer, wind }, rng);
    p.strokes++;
    let penalty = 0;
    let next = out.final;
    switch (out.result) {
      case 'water': penalty = 1; next = waterDrop(g, out.hazardEntry ?? out.final, p.pos); break;
      case 'ob':
      case 'lost': penalty = 1; next = p.pos; break;
      case 'unplayable': penalty = 1; next = unplayableDrop(g, out.final, p.pin, p.pos); break;
      default: break;
    }
    if (p.strokes === 1 && r.fairwayHit === false && out.result === 'ok') r.fairwayHit = lieAt(g.world, next) === 'fairway';
    if (out.result === 'ok' && Math.hypot(next.x - p.pin.x, next.y - p.pin.y) * TILE_M < 0.06) p.holed = true;
    r.penalties += penalty;
    p.strokes += penalty;
    rec = { from: p.pos, landing: out.landing, final: out.final, club: plan.club.id, result: out.result, penalty, next };
    if (out.result === 'ok') bunkerEntry(g, next.x, next.y);
  }
  r.shots.push(rec);
  p.pos = rec.next;
  p.lie = lieAt(g.world, p.pos);
  if (p.holed) p.done = true;
  else if (p.strokes >= p.max) { p.done = true; p.pickedUp = true; p.strokes = p.max; }
  r.strokes = p.strokes;
  r.pickedUp = p.pickedUp;
  return rec;
}

/** Pick up immediately (e.g. the day ends): the hole scores double par. */
export function pickUp(p: HolePlay): void {
  if (p.done) return;
  p.done = true; p.pickedUp = true; p.strokes = p.max;
  p.result.strokes = p.max; p.result.pickedUp = true;
}

/**
 * Play a whole hole headless: tee choice, shot planning, simulated shots and putts, penalties
 * (water: +1 and drop back on the line; OB/lost: stroke and distance; unplayable: +1 and a
 * 2-club-length drop or replay), and the double-par pickup.
 */
export function simulateHole(g: Game, golfer: Golfer, hole: Hole, rng: Rng, wind: Vec2 = { x: 0, y: 0 }): HoleResult {
  const p = startHole(g, golfer, hole);
  while (!p.done) playStroke(g, golfer, hole, p, rng, wind);
  return p.result;
}
