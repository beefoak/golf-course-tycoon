import { Vec2, dist } from '../../core/geom';
import { Result, fail, ok } from '../../core/result';
import { TILE_M, tilesToYards, yardsToTiles } from '../../core/units';
import { COSTS } from '../construction/costs';
import { commitPlan, EditPlan } from '../construction/plan';
import { lastStroke } from '../construction/undo';
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
  gradeGreen(g, plan, map, green, greenR);
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

/** Steepest tilt a new green is built with (rise per metre); real greens are 1–3%. */
export const MAX_GREEN_SLOPE = 0.02;
/** Tiles beyond the fringe over which the graded green blends back into the natural ground. */
const GREEN_BLEND_TILES = 6;

/**
 * Build the green on a gentle plane: the natural slope through the green centre, flattened to
 * MAX_GREEN_SLOPE, blended back into the ground around it. Charged as earthworks (cut or fill).
 */
function gradeGreen(g: Game, plan: EditPlan, map: Map<number, Surface>, c: Vec2, greenR: number): void {
  const w = g.world;
  const at = (x: number, y: number) => w.elevation[w.idx(Math.max(0, Math.min(w.size - 1, Math.round(x))), Math.max(0, Math.min(w.size - 1, Math.round(y))))]!;
  const R = Math.max(2, Math.round(greenR));
  const gx = (at(c.x + R, c.y) - at(c.x - R, c.y)) / (2 * R), gy = (at(c.x, c.y + R) - at(c.x, c.y - R)) / (2 * R);
  const tilt = Math.hypot(gx, gy) / TILE_M;
  const k = tilt > MAX_GREEN_SLOPE ? MAX_GREEN_SLOPE / tilt : 1;
  if (k === 1) return;
  const ce = at(c.x, c.y);
  const byI = new Map(plan.changes.map(ch => [ch.i, ch]));
  const outer = greenR + 1 + GREEN_BLEND_TILES;
  for (const i of map.keys()) {
    const x = i % w.size, y = Math.floor(i / w.size);
    const d = Math.hypot(x - c.x, y - c.y);
    if (d > outer) continue;
    const plane = ce + k * (gx * (x - c.x) + gy * (y - c.y));
    const t = d <= greenR + 1 ? 0 : (d - greenR - 1) / GREEN_BLEND_TILES;
    const e = w.elevation[i]!;
    const ne = Math.round((plane * (1 - t) + e * t) * 100) / 100;
    if (Math.abs(ne - e) < 0.01) continue;
    let ch = byI.get(i);
    if (!ch) { ch = { i }; plan.changes.push(ch); byI.set(i, ch); }
    ch.elevation = ne;
    plan.cost += Math.abs(ne - e) * TILE_M * TILE_M * COSTS.cutPerM3;
  }
}

export function commitPenHole(g: Game, input: PenInput): Result<Hole> {
  if (input.route.length < 2 || input.route.length > 4) return fail('Draw a tee, up to two waypoints and a green');
  if (!g.courses.get(input.courseId)) return fail('No such course');
  const { plan, draftHole, region } = planPenHole(g, input);
  const r = commitPlan(g, plan, 'construction');
  if (!r.ok) return r;
  const { name: _n, ...rest } = draftHole;
  // the stroke also covers the corridor tiles that only change hands (hole membership)
  const stroke = lastStroke(g);
  if (stroke) {
    const have = new Set(stroke.tiles.map(t => t.i));
    const w = g.world;
    for (const i of region) if (!have.has(i)) stroke.tiles.push({ i, surface: w.surface[i]!, elevation: w.elevation[i]!, treeSpecies: w.treeSpecies[i]!, treeAgeDays: w.treeAgeDays[i]!, feature: w.feature[i]!, firmness: w.firmness[i]!, grass: w.grass[i]!, health: w.health[i]!, holeId: w.holeId[i]!, courseId: w.courseId[i]! });
  }
  const h = g.courses.addHole(input.courseId, rest);
  if (stroke) {
    stroke.label = `${h.name} draft`;
    stroke.guard = gg => (gg.courses.hole(h.id)?.state === 'construction' ? null : `${h.name} has been seeded: close and edit it instead`);
    stroke.extra = gg => gg.courses.removeHole(h.id);
  }
  const skipped = new Set<number>();
  for (const i of region) {
    const x = i % g.world.size, y = Math.floor(i / g.world.size);
    if (!g.parcels.tileOwned(x, y)) { skipped.add(i); continue; }
    g.world.holeId[i] = h.id;
    g.world.courseId[i] = h.courseId;
  }
  // hole membership changed: let caches (paths, turf index) rebuild
  g.events.emit('edit', { tiles: region.filter(i => !skipped.has(i)) });
  // pins must sit on green; drop any that landed on a skipped tile (rock, someone else's land)
  const onGreen = (p: Vec2) => g.world.inBounds(p.x, p.y) && g.world.surface[g.world.idx(p.x, p.y)] === Surface.Green;
  h.pins = h.pins.filter(onGreen);
  // and top back up to four from the rest of the green, so the hole can still be seeded
  const c = h.greenCenter;
  for (const rr of [0.45, 0.3, 0.6, 0.15]) {
    for (let k = 0; k < 8 && h.pins.length < 4; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8;
      const p = { x: Math.round(c.x + Math.cos(a) * yardsToTiles(input.greenRadiusYd) * rr), y: Math.round(c.y + Math.sin(a) * yardsToTiles(input.greenRadiusYd) * rr) };
      if (onGreen(p) && !h.pins.some(q => Math.abs(q.x - p.x) + Math.abs(q.y - p.y) < 2)) h.pins.push(p);
    }
  }
  return ok(h);
}
