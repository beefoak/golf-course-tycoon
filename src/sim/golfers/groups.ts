import { Vec2 } from '../../core/geom';
import { Rng } from '../../core/rng';
import { TILE_M } from '../../core/units';
import { TICKS_PER_MIN } from '../clock';
import type { Game, System } from '../game';
import { findPath } from '../world/pathfind';
import { Surface } from '../world/tiles';
import { addWear } from '../turf/turf';
import { CART_PATH_ONLY_SPEED, playingGolfer } from '../business/carts';
import { firstTeeAllowed, stormActive } from '../turf/weather';
import { center } from './ai';
import { Golfer } from './golfer';
import { HolePlay, HoleResult, ShotRecord, isPutt, nextTarget, pickUp, playStroke, startHole } from './hole';
import { Lie } from './lie';

export type GroupPhase = 'toTee' | 'teeing' | 'walkingToBall' | 'addressing' | 'putting' | 'holedOut' | 'toNextTee' | 'toClubhouse' | 'done';

export interface BallState { pos: Vec2; lie: Lie; strokes: number; holed: boolean; pickedUp: boolean }

export interface Group {
  id: number;
  courseId: number;
  golferIds: number[];
  /** game day of the round */
  day: number;
  /** minute of day */
  teeTime: number;
  holeOrder: number[];
  holeIdx: number;
  phase: GroupPhase;
  started: boolean;
  pos: Vec2;
  /** this hole's ball per golfer */
  balls: Map<number, HolePlay>;
  scores: Map<number, HoleResult[]>;
  usesCart: boolean;
  waitingMin: number;
  /** walking path (tile coords) still to cover */
  path: Vec2[];
  /** seconds left on the current swing/putt routine */
  busySec: number;
  /** golfer currently playing */
  current: number | null;
  lastShot: { golferId: number; rec: ShotRecord; absMinute: number } | null;
  startAbsMin: number;
  /** green fee each golfer pays when the round starts (0 = comped/test) */
  feePerGolfer: number;
  /** waitingMin when the current hole started (per-hole waiting = waitingMin - this) */
  holeWaitStart: number;
  /** absolute minute the current hole started */
  holeStartAbsMin: number;
  rng: Rng;
  /** shot target planned for the ball about to be played, reused while waiting on the group ahead */
  planned?: { golferId: number; strokes: number; target: Vec2 } | null;
  /** golfers who warmed up on the range before the round */
  warm?: number[];
}

export const WALK_MPS = 1.3;
export const CART_MPS = 4;
export const SEC_PER_TICK = 60 / TICKS_PER_MIN;
export const SHOT_SEC = 45;
export const PUTT_SEC = 30;
/** extra clearance (m) beyond the target distance before hitting into the group ahead */
export const CLEARANCE_M = 30;

export function createGroup(g: Game, courseId: number, golferIds: number[], day: number, teeTime: number, holeOrder?: number[], usesCart = false): Group {
  const course = g.courses.get(courseId);
  if (!course) throw new Error(`No course ${courseId}`);
  const order = holeOrder ?? course.holes.filter(h => h.state === 'open').sort((a, b) => a.number - b.number).map(h => h.id);
  const id = g.nextGroupId++;
  const grp: Group = {
    id, courseId, golferIds: [...golferIds], day, teeTime, holeOrder: order, holeIdx: 0, phase: 'toTee', started: false,
    pos: { x: 0, y: 0 }, balls: new Map(), scores: new Map(golferIds.map(gid => [gid, []])), usesCart, waitingMin: 0,
    path: [], busySec: 0, current: null, lastShot: null, startAbsMin: 0, feePerGolfer: 0, holeWaitStart: 0, holeStartAbsMin: 0, rng: g.rng.fork(`group${id}`),
  };
  g.groups.push(grp);
  return grp;
}

/** Footfall heat (2×2-tile cells) from groups walking; feeds the traffic overlay. */
function footstep(g: Game, p: Vec2): void {
  const side = Math.ceil(g.world.size / 2);
  const cx = Math.floor(p.x / 2), cy = Math.floor(p.y / 2);
  if (cx < 0 || cy < 0 || cx >= side || cy >= side) return;
  if (g.footfall.length !== side * side) g.footfall = new Uint16Array(side * side);
  const i = cy * side + cx;
  if (g.footfall[i]! < 65535) g.footfall[i]!++;
}

/** Feet compact greens; carts scuff turf when they leave the path. */
function trample(g: Game, grp: Group): void {
  const w = g.world;
  const x = Math.floor(grp.pos.x), y = Math.floor(grp.pos.y);
  if (!w.inBounds(x, y)) return;
  const s = w.surface[w.idx(x, y)] as Surface;
  if (s === Surface.Green) addWear(g, x, y, 1);
  else if (grp.usesCart && s !== Surface.Path) addWear(g, x, y, 2);
}

const golferOf = (g: Game, id: number): Golfer => {
  const x = g.golfers.all.get(id);
  if (!x) throw new Error(`No golfer ${id}`);
  return x;
};

export function currentHoleId(grp: Group): number | null {
  return grp.holeOrder[grp.holeIdx] ?? null;
}

/** Groups physically playing a hole (walking to the next tee counts for the next hole). */
export function countGroupsOnHole(g: Game, holeId: number): number {
  let n = 0;
  for (const grp of g.groups) {
    if (!grp.started || grp.phase === 'done' || grp.phase === 'toClubhouse') continue;
    if (currentHoleId(grp) === holeId) n++;
  }
  return n;
}

/** Skip holes in the group's order that closed (or vanished) since booking; false when none are left. */
function skipClosedHoles(g: Game, grp: Group): boolean {
  while (grp.holeIdx < grp.holeOrder.length && g.courses.hole(grp.holeOrder[grp.holeIdx]!)?.state !== 'open') grp.holeIdx++;
  return grp.holeIdx < grp.holeOrder.length;
}

function startHoleFor(g: Game, grp: Group): void {
  const hole = g.courses.hole(currentHoleId(grp)!)!;
  grp.holeWaitStart = grp.waitingMin;
  grp.holeStartAbsMin = g.clock.absMinute;
  grp.balls = new Map(grp.golferIds.map(id => [id, startHole(g, golferOf(g, id), hole)]));
}

function walkTo(g: Game, grp: Group, to: Vec2): void {
  const p = findPath(g, grp.pos, to, grp.usesCart ? 'cart' : 'walk') ?? findPath(g, grp.pos, to, 'walk');
  grp.path = p ? p.slice(1) : [{ ...to }];
}

function advance(g: Game, grp: Group): void {
  if (grp.path.length) { footstep(g, grp.pos); trample(g, grp); }
  const cart = CART_MPS * (g.cartPathOnly.has(grp.courseId) ? CART_PATH_ONLY_SPEED : 1);
  let left = ((grp.usesCart ? cart : WALK_MPS) * SEC_PER_TICK) / TILE_M;
  while (left > 0 && grp.path.length) {
    const t = grp.path[0]!;
    const d = Math.hypot(t.x - grp.pos.x, t.y - grp.pos.y);
    if (d <= left) { grp.pos = { ...t }; grp.path.shift(); left -= d; }
    else { grp.pos = { x: grp.pos.x + ((t.x - grp.pos.x) * left) / d, y: grp.pos.y + ((t.y - grp.pos.y) * left) / d }; left = 0; }
  }
}

function nextToPlay(grp: Group): HolePlay | null {
  let best: HolePlay | null = null, bestD = -1;
  for (const id of grp.golferIds) {
    const b = grp.balls.get(id)!;
    if (b.done) continue;
    const d = Math.hypot(b.pin.x - b.pos.x, b.pin.y - b.pos.y);
    if (d > bestD) { bestD = d; best = b; }
  }
  return best;
}

function finishHole(g: Game, grp: Group): void {
  const holeId = currentHoleId(grp)!;
  const results: { golferId: number; result: HoleResult }[] = [];
  for (const id of grp.golferIds) {
    const b = grp.balls.get(id)!;
    grp.scores.get(id)!.push(b.result);
    results.push({ golferId: id, result: b.result });
  }
  g.events.emit('holeComplete', { groupId: grp.id, holeId, results });
  grp.holeIdx++;
  if (skipClosedHoles(g, grp)) {
    startHoleFor(g, grp);
    grp.phase = 'toNextTee';
  } else {
    grp.balls = new Map();
    const ch = g.courses.get(grp.courseId)?.clubhouse;
    if (ch) { grp.phase = 'toClubhouse'; walkTo(g, grp, center(ch)); }
    else endRound(g, grp);
  }
}

function endRound(g: Game, grp: Group): void {
  grp.phase = 'done';
  grp.path = [];
  g.events.emit('roundComplete', { groupId: grp.id });
}

/** The nearest earlier group on the same hole, if it is inside this shot's danger zone. */
function blockedByGroupAhead(g: Game, grp: Group, from: Vec2, target: Vec2): boolean {
  const holeId = currentHoleId(grp);
  const reach = Math.hypot(target.x - from.x, target.y - from.y) + CLEARANCE_M / TILE_M;
  for (const o of g.groups) {
    if (o === grp || !o.started || o.phase === 'done' || o.phase === 'toClubhouse') continue;
    if (currentHoleId(o) !== holeId) continue;
    const earlier = o.day < grp.day || (o.day === grp.day && (o.teeTime < grp.teeTime || (o.teeTime === grp.teeTime && o.id < grp.id)));
    if (!earlier) continue;
    if (Math.hypot(o.pos.x - from.x, o.pos.y - from.y) <= reach) return true;
  }
  return false;
}

function tickGroup(g: Game, grp: Group): void {
  if (grp.phase === 'done') return;
  if (!grp.started) {
    if (g.day < grp.day || (g.day === grp.day && g.clock.minuteOfDay < grp.teeTime)) return;
    // frost delays the first tee; nobody tees off into a storm
    if (g.clock.minuteOfDay < firstTeeAllowed(g) || stormActive(g)) return;
    grp.started = true;
    grp.startAbsMin = g.clock.absMinute;
    g.events.emit('roundStart', { groupId: grp.id });
    if (!skipClosedHoles(g, grp)) { endRound(g, grp); return; }
    startHoleFor(g, grp);
    const course = g.courses.get(grp.courseId)!;
    const first = nextToPlay(grp)!;
    grp.pos = course.clubhouse ? center(course.clubhouse) : { ...first.pos };
    grp.phase = 'toTee';
    walkTo(g, grp, first.pos);
    return;
  }
  // lightning: everyone off the course until it passes
  if (stormActive(g)) { grp.waitingMin += 1 / TICKS_PER_MIN; return; }
  if (grp.busySec > 0) {
    grp.busySec -= SEC_PER_TICK;
    if (grp.busySec > 0) return;
    const b = grp.balls.get(grp.current!)!;
    const hole = g.courses.hole(b.holeId)!;
    const rec = playStroke(g, playingGolfer(grp, golferOf(g, b.golferId)), hole, b, grp.rng, g.weather.wind);
    grp.lastShot = { golferId: b.golferId, rec, absMinute: g.clock.absMinute };
    grp.current = null;
    return;
  }
  if (grp.path.length) { advance(g, grp); return; }
  if (grp.phase === 'toClubhouse') { endRound(g, grp); return; }

  const b = nextToPlay(grp);
  if (!b) { grp.phase = 'holedOut'; finishHole(g, grp); return; }
  if (Math.hypot(b.pos.x - grp.pos.x, b.pos.y - grp.pos.y) > 3) {
    grp.phase = b.strokes === 0 ? (grp.holeIdx === 0 ? 'toTee' : 'toNextTee') : 'walkingToBall';
    walkTo(g, grp, b.pos);
    advance(g, grp);
    return;
  }
  const hole = g.courses.hole(b.holeId)!;
  const golfer = golferOf(g, b.golferId);
  const putting = isPutt(g, b);
  if (!putting) {
    let pl = grp.planned;
    if (!pl || pl.golferId !== b.golferId || pl.strokes !== b.strokes) {
      pl = grp.planned = { golferId: b.golferId, strokes: b.strokes, target: nextTarget(g, golfer, hole, b)! };
    }
    const target = pl.target;
    if (blockedByGroupAhead(g, grp, b.pos, target)) { grp.waitingMin += 1 / TICKS_PER_MIN; return; }
  }
  grp.current = b.golferId;
  grp.planned = null;
  grp.phase = putting ? 'putting' : b.strokes === 0 ? 'teeing' : 'addressing';
  // the starter and marshal hurry things along
  grp.busySec = (putting ? PUTT_SEC : SHOT_SEC) * (g.pacePush.get(grp.courseId) ?? 1);
}

/** Headless finish (e.g. the day ended with the group still out): play out every remaining stroke. */
export function finishRoundHeadless(g: Game, grp: Group): void {
  if (grp.phase === 'done') return;
  if (grp.phase === 'toClubhouse') { endRound(g, grp); return; }
  if (!grp.started) {
    grp.started = true; grp.startAbsMin = g.clock.absMinute; g.events.emit('roundStart', { groupId: grp.id });
    if (!skipClosedHoles(g, grp)) { endRound(g, grp); return; }
    startHoleFor(g, grp);
  }
  while ((grp.phase as GroupPhase) !== 'done') {
    for (const id of grp.golferIds) {
      const b = grp.balls.get(id);
      if (!b) continue;
      const hole = g.courses.hole(b.holeId);
      if (!hole) { pickUp(b); continue; }
      let guard = 0;
      const gf = playingGolfer(grp, golferOf(g, id));
      while (!b.done && guard++ < 40) playStroke(g, gf, hole, b, grp.rng, g.weather.wind);
      pickUp(b);
    }
    grp.busySec = 0; grp.current = null; grp.path = [];
    finishHole(g, grp);
    if ((grp.phase as GroupPhase) === 'toClubhouse') endRound(g, grp);
  }
}

export const groupSystem: System = {
  name: 'groups',
  onTick(g) {
    for (const grp of g.groups) tickGroup(g, grp);
    if (g.groups.some(x => x.phase === 'done')) g.groups = g.groups.filter(x => x.phase !== 'done');
  },
  onDay(g) {
    // nobody plays through the night: anyone still out finishes headless
    for (const grp of g.groups) if (grp.day < g.day) finishRoundHeadless(g, grp);
    g.groups = g.groups.filter(x => x.phase !== 'done');
  },
};
