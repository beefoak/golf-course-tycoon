import { Vec2 } from '../../core/geom';
import { Rng } from '../../core/rng';
import { TILE_M } from '../../core/units';
import { Hole, TEE_ORDER, TeeBox } from '../course/course';
import type { Game } from '../game';
import { Feature, Surface } from '../world/tiles';
import { ClubSpec, clubSet, driverCarry, longerThan } from './clubs';
import { Golfer } from './golfer';
import { LIE_EFFECT, Lie, lieAt } from './lie';

/** Handicap → preferred tee, shifted by ego (challenge) and age, then snapped to an existing tee. */
export function chooseTee(golfer: Golfer, hole: Hole): TeeBox {
  if (hole.teeBoxes.length === 0) throw new Error(`${hole.name} has no tee boxes`);
  const h = golfer.handicap;
  let want = h <= 5 ? 0 : h <= 12 ? 1 : h <= 22 ? 2 : 3;
  if (golfer.traits.challenge > 0.8) want -= 1;
  if (golfer.age >= 60 && golfer.traits.challenge < 0.3) want += 1;
  want = Math.max(0, Math.min(3, want));
  let best = hole.teeBoxes[0]!, bestD = Infinity;
  for (const t of hole.teeBoxes) {
    const k = TEE_ORDER.indexOf(t.kind);
    // ties go to the more forward tee
    const d = Math.abs(k - want) - (k > want ? 0.1 : 0);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

const BASE_ROLL = { low: 0.18, mid: 0.1, high: 0.04 } as const;
/** Cup-relative position for the hole (tile centre). */
export const center = (p: Vec2): Vec2 => ({ x: p.x + 0.5, y: p.y + 0.5 });

type Hazard = 'water' | 'ob' | 'unplayable' | 'bunker' | 'trees' | null;

function hazardAt(g: Game, p: Vec2): Hazard {
  const w = g.world;
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (!w.inBounds(x, y) || !g.parcels.tileOwned(x, y)) return 'ob';
  const i = w.idx(x, y);
  const f = w.feature[i] as Feature;
  if (f === Feature.Road || f === Feature.Neighbor) return 'ob';
  const s = w.surface[i] as Surface;
  if (s === Surface.Water || (f === Feature.Creek && s !== Surface.Path)) return 'water';
  if (f === Feature.Rock) return 'unplayable';
  if (s === Surface.Bunker) return 'bunker';
  if (w.treeSpecies[i]) return 'trees';
  return null;
}

/** Expected strokes to hole out from a point, given the lie there (a cheap strokes-gained style model). */
export function expectedStrokes(g: Game, p: Vec2, pin: Vec2, golfer: Golfer): number {
  const dM = Math.hypot(p.x - pin.x, p.y - pin.y) * TILE_M;
  const lie = lieAt(g.world, p);
  if (lie === 'green') return 1 + Math.min(1.3, 0.1 * dM * (1 + 0.02 * Math.max(0, golfer.handicap)) ** 0.5);
  const reach = 0.85 * driverCarry(golfer.handicap, golfer.age);
  const lieExtra: Partial<Record<Lie, number>> = { rough: 0.2, firstCut: 0.05, deepRough: 0.5, native: 0.45, bunker: 0.4, waste: 0.15, trees: 0.6 };
  return 2.1 + 0.02 * Math.max(0, golfer.handicap) + dM / reach + (lieExtra[lie] ?? 0);
}

/** Polyline from the ball along the remaining route waypoints to the pin. */
function remainingLine(ball: Vec2, hole: Hole, pin: Vec2): Vec2[] {
  const gc = center(hole.greenCenter);
  const dBall = Math.hypot(ball.x - gc.x, ball.y - gc.y);
  const ahead = hole.route.slice(1, -1).map(center).filter(w => Math.hypot(w.x - gc.x, w.y - gc.y) < dBall - 5);
  return [ball, ...ahead, pin];
}

function pointAlongLine(line: Vec2[], distTiles: number): Vec2 {
  let left = distTiles;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg && seg > 0) return { x: a.x + ((b.x - a.x) * left) / seg, y: a.y + ((b.y - a.y) * left) / seg };
    left -= seg;
  }
  return { ...line[line.length - 1]! };
}

/** Clubs the golfer may use from this lie (no putter off the green). */
export function allowedClubs(golfer: Golfer, lie: Lie, distToPinM: number): ClubSpec[] {
  const bag = clubSet(golfer.handicap, golfer.age).filter(c => c.id !== 'P');
  if (lie === 'bunker' && distToPinM < 45) return bag.filter(c => c.id === 'SW' || c.id === 'LW');
  const max = LIE_EFFECT[lie].maxClub;
  return max ? bag.filter(c => !longerThan(c.id, max)) : bag;
}

const SPREAD = [-1.2, 0, 1.2];
const W = [0.25, 0.5, 0.25];

/**
 * Pick a club and carry target. Candidates: each club's full carry along the remaining route and
 * straight at the pin, plus partial shots at the pin. Each is scored by a 3×3 sample of its
 * dispersion: expected strokes after the shot, with hazard outcomes weighted by risk aversion.
 */
export function planShot(g: Game, golfer: Golfer, ball: Vec2, lie: Lie, hole: Hole, pin: Vec2, _rng?: Rng): { club: ClubSpec; target: Vec2 } {
  const distPinT = Math.hypot(pin.x - ball.x, pin.y - ball.y);
  const distPinM = distPinT * TILE_M;
  const clubs = allowedClubs(golfer, lie, distPinM);
  const eff = LIE_EFFECT[lie];
  const line = remainingLine(ball, hole, pin);
  const riskWeight = 1.5 - 0.5 * golfer.traits.challenge;
  const here = expectedStrokes(g, ball, pin, golfer);

  const cands: { club: ClubSpec; target: Vec2 }[] = [];
  let partialAdded = 0;
  for (let k = clubs.length - 1; k >= 0; k--) {
    const club = clubs[k]!;
    const carryT = (club.carryM * eff.distMult) / TILE_M;
    const rollT = (club.carryM * eff.distMult * BASE_ROLL[club.launch]) / TILE_M;
    if (carryT + rollT >= distPinT - 1 && partialAdded < 2) {
      // partial at the pin, landing short by the expected roll
      const want = Math.max(0.5, distPinT - Math.min(rollT, distPinT * 0.5));
      cands.push({ club, target: { x: ball.x + ((pin.x - ball.x) * want) / distPinT, y: ball.y + ((pin.y - ball.y) * want) / distPinT } });
      partialAdded++;
    }
    if (carryT < distPinT) {
      cands.push({ club, target: pointAlongLine(line, carryT) });
      cands.push({ club, target: { x: ball.x + ((pin.x - ball.x) * carryT) / distPinT, y: ball.y + ((pin.y - ball.y) * carryT) / distPinT } });
    }
  }
  if (cands.length === 0) cands.push({ club: clubs[clubs.length - 1]!, target: pin });

  let best = cands[0]!, bestScore = Infinity;
  for (const c of cands) {
    const s = scoreCandidate(g, golfer, ball, c.club, c.target, eff, pin, riskWeight, here);
    if (s < bestScore) { bestScore = s; best = c; }
  }
  return best;
}

function scoreCandidate(g: Game, golfer: Golfer, ball: Vec2, club: ClubSpec, target: Vec2, eff: { distMult: number; angleMult: number }, pin: Vec2, riskWeight: number, here: number): number {
  const dx = target.x - ball.x, dy = target.y - ball.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return Infinity;
  const aim = Math.atan2(dy, dx);
  const sdA = (club.sdAngleDeg * eff.angleMult * Math.PI) / 180;
  const sdD = club.sdDistPct;
  const rollT = (dist * TILE_M * BASE_ROLL[club.launch]) / TILE_M;
  let clean = 0, hazard = 0;
  for (let a = 0; a < 3; a++) for (let d = 0; d < 3; d++) {
    const w = W[a]! * W[d]!;
    const ang = aim + SPREAD[a]! * sdA;
    const len = dist * (1 + SPREAD[d]! * sdD);
    const land = { x: ball.x + Math.cos(ang) * len, y: ball.y + Math.sin(ang) * len };
    let hz = hazardAt(g, land);
    let final = land;
    if (!hz) {
      // check the roll-out for water/OB
      for (const f of [0.5, 1]) {
        const p = { x: land.x + Math.cos(ang) * rollT * f, y: land.y + Math.sin(ang) * rollT * f };
        const h2 = hazardAt(g, p);
        if (h2 === 'water' || h2 === 'ob') { hz = h2; break; }
        if (h2 === 'bunker' || h2 === 'trees') { final = p; break; }
        final = p;
      }
    }
    const after = expectedStrokes(g, final, pin, golfer);
    switch (hz) {
      case 'water': hazard += w * (1 + expectedStrokes(g, land, pin, golfer) + 0.3); break;
      case 'ob': hazard += w * (2 + here); break;
      case 'unplayable': hazard += w * (1 + after); break;
      default: clean += w * after;
    }
  }
  return 1 + clean + riskWeight * hazard;
}
