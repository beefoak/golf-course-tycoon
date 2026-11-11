import { Vec2, dist } from '../../core/geom';
import { Result, fail, ok } from '../../core/result';
import { tilesToYards, yardsToTiles } from '../../core/units';
import { commitPlan, EditPlan } from '../construction/plan';
import { planSurfaceMap } from '../construction/paint';
import type { Game } from '../game';
import { Feature, Surface } from '../world/tiles';
import { Hole } from './course';
import { routeLengthTiles } from './yardage';

export interface PenInput {
  courseId: number;
  /** 2–4 points: tee, up to 2 waypoints, green */
  route: Vec2[];
  fairwayWidthYd: number;
  roughWidthYd: number;
  greenRadiusYd: number;
}

export const PEN_DEFAULTS = { fairwayWidthYd: 35, roughWidthYd: 15, greenRadiusYd: 14 };

const TEE_LEN = 8, TEE_WID = 4;
const FIRST_CUT_TILES = 2;
const BUFFER_TILES = 15; // 30 m safety buffer between holes
const OOB_NEAR_TILES = 10; // 20 m
const LANDING_YD = [230, 460];

/** Distance from p to the polyline and the arc length of its projection. */
export function projectOnRoute(route: Vec2[], p: Vec2): { d: number; s: number } {
  let best = { d: Infinity, s: 0 };
  let acc = 0;
  for (let k = 1; k < route.length; k++) {
    const a = route[k - 1]!, b = route[k]!;
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
    const len = Math.sqrt(len2);
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
    if (d < best.d) best = { d, s: acc + len * t };
    acc += len;
  }
  return best;
}

/** Point at arc length s along the route. */
export function pointAlong(route: Vec2[], s: number): Vec2 {
  let acc = 0;
  for (let k = 1; k < route.length; k++) {
    const a = route[k - 1]!, b = route[k]!, len = dist(a, b);
    if (acc + len >= s) { const t = len === 0 ? 0 : (s - acc) / len; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
    acc += len;
  }
  return { ...route[route.length - 1]! };
}

export function planPenHole(g: Game, input: PenInput): { plan: EditPlan; draftHole: Omit<Hole, 'id' | 'number'>; warnings: string[]; region: number[] } {
  const w = g.world;
  const route = input.route.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  const tee = route[0]!, green = route[route.length - 1]!;
  const L = routeLengthTiles(route);
  const par3 = tilesToYards(L) <= 250;
  const fwHalf = yardsToTiles(input.fairwayWidthYd) / 2;
  const rough = yardsToTiles(input.roughWidthYd);
  const greenR = yardsToTiles(input.greenRadiusYd);
  const corridorHalf = fwHalf + FIRST_CUT_TILES + rough;
  const firstLeg = dist(route[0]!, route[1]!);
  const fwStart = firstLeg * 0.3;
  const fwEnd = L - greenR;

  // tee pad oriented along the first leg
  const dir = { x: (route[1]!.x - tee.x) / (firstLeg || 1), y: (route[1]!.y - tee.y) / (firstLeg || 1) };
  const inTee = (x: number, y: number) => {
    const rx = x - tee.x, ry = y - tee.y;
    const along = rx * dir.x + ry * dir.y, across = -rx * dir.y + ry * dir.x;
    return Math.abs(along) <= TEE_LEN / 2 && Math.abs(across) <= TEE_WID / 2;
  };

  const pad = Math.ceil(Math.max(corridorHalf, greenR + 4, TEE_LEN)) + 1;
  const xs = route.map(p => p.x), ys = route.map(p => p.y);
  const x0 = Math.max(0, Math.min(...xs) - pad), x1 = Math.min(w.size - 1, Math.max(...xs) + pad);
  const y0 = Math.max(0, Math.min(...ys) - pad), y1 = Math.min(w.size - 1, Math.max(...ys) + pad);

  const map = new Map<number, Surface>();
  const warnings = new Set<string>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = { x, y };
      const dg = dist(p, green);
      const { d, s } = projectOnRoute(route, p);
      let surf: Surface | null = null;
      if (inTee(x, y)) surf = Surface.Tee;
      else if (dg <= greenR) surf = Surface.Green;
      else if (dg <= greenR + 1) surf = Surface.Fringe;
      else if (!par3 && s >= fwStart && s <= fwEnd && d <= fwHalf) surf = Surface.Fairway;
      else if (dg <= greenR + 3) surf = Surface.FirstCut;
      else if (!par3 && s >= fwStart && s <= fwEnd && d <= fwHalf + FIRST_CUT_TILES) surf = Surface.FirstCut;
      else if (d <= corridorHalf && s > 0 && s < L) surf = Surface.Rough;
      if (surf === null) continue;
      const i = w.idx(x, y);
      if (d <= fwHalf || dg <= greenR) {
        if (w.feature[i] === Feature.Rock) warnings.add('crosses rock');
        if (w.feature[i] === Feature.Creek && w.surface[i] !== Surface.Path) warnings.add('crosses creek');
      }
      map.set(i, surf);
    }
  }

  // overlap with other holes' safety buffer
  for (const i of map.keys()) {
    const x = i % w.size, y = Math.floor(i / w.size);
    for (let dy = -BUFFER_TILES; dy <= BUFFER_TILES; dy += 3) {
      for (let dx = -BUFFER_TILES; dx <= BUFFER_TILES; dx += 3) {
        const nx = x + dx, ny = y + dy;
        if (!w.inBounds(nx, ny)) continue;
        const other = w.holeId[w.idx(nx, ny)]!;
        if (other) { const oh = g.courses.hole(other); warnings.add(`overlaps ${oh?.name ?? 'another hole'} corridor`); }
      }
    }
    if (warnings.size > 6) break;
  }

  // landing zones near out-of-bounds
  if (!par3) {
    for (const yd of LANDING_YD) {
      const s = yardsToTiles(yd);
      if (s >= L - greenR) continue;
      const lz = pointAlong(route, s);
      outer: for (let dy = -OOB_NEAR_TILES; dy <= OOB_NEAR_TILES; dy++) {
        for (let dx = -OOB_NEAR_TILES; dx <= OOB_NEAR_TILES; dx++) {
          if (dx * dx + dy * dy > OOB_NEAR_TILES * OOB_NEAR_TILES) continue;
          const x = Math.round(lz.x + dx), y = Math.round(lz.y + dy);
          const out = !w.inBounds(x, y) || !g.parcels.tileOwned(x, y) || w.feature[w.idx(x, y)] === Feature.Road || w.feature[w.idx(x, y)] === Feature.Neighbor;
          if (out) { warnings.add('landing zone within 20 m of out-of-bounds'); break outer; }
        }
      }
    }
  }

  const plan = planSurfaceMap(g, map);
  const r = greenR * 0.45;
  const pins = [{ x: 0, y: -r }, { x: r, y: 0 }, { x: 0, y: r }, { x: -r, y: 0 }].map(o => ({ x: Math.round(green.x + o.x), y: Math.round(green.y + o.y) }));
  const draftHole: Omit<Hole, 'id' | 'number'> = {
    courseId: input.courseId, name: '', state: 'construction', route, teeBoxes: [{ kind: 'back', center: { ...tee }, marker: { ...tee } }],
    greenCenter: { ...green }, pins, activePin: 0, parOverride: null, strokeIndex: null, growInDaysLeft: 0,
    stakes: { ob: [], red: [], yellow: [] }, stakeOverrides: { add: [] }, editedSinceClose: false,
  };
  const region = [...map.keys()].filter(i => !g.world.holeId[i]);
  return { plan, draftHole, warnings: [...warnings], region };
}

export function commitPenHole(g: Game, input: PenInput): Result<Hole> {
  if (input.route.length < 2 || input.route.length > 4) return fail('Draw a tee, up to two waypoints and a green');
  if (!g.courses.get(input.courseId)) return fail('No such course');
  const { plan, draftHole, region } = planPenHole(g, input);
  const r = commitPlan(g, plan, 'construction');
  if (!r.ok) return r;
  const { name: _n, ...rest } = draftHole;
  const h = g.courses.addHole(input.courseId, rest);
  const skipped = new Set<number>();
  for (const i of region) {
    const x = i % g.world.size, y = Math.floor(i / g.world.size);
    if (!g.parcels.tileOwned(x, y)) { skipped.add(i); continue; }
    g.world.holeId[i] = h.id;
    g.world.courseId[i] = h.courseId;
  }
  // hole membership changed: let caches (paths, turf index) rebuild
  g.events.emit('edit', { tiles: region.filter(i => !skipped.has(i)) });
  // pins must sit on green; drop any that landed on a skipped tile
  h.pins = h.pins.filter(p => g.world.inBounds(p.x, p.y) && g.world.surface[g.world.idx(p.x, p.y)] === Surface.Green);
  return ok(h);
}
