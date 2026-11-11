import { Vec2 } from '../../core/geom';
import { EditPlan, addReason } from '../construction/plan';
import { TerrainOp, planTerrain } from '../construction/terrain';
import type { Game } from '../game';
import { slopeAt } from '../world/slope';
import { Surface } from '../world/tiles';
import { Hole } from './course';

/** A pin needs ≥2 green tiles between it and the green's edge. */
const EDGE_BAND = 2;

/** Max gradient allowed at a pin: 0.03 at Stimp 8 falling linearly to 0.015 at Stimp 13. */
export function MAX_PIN_SLOPE(stimp: number): number {
  const t = Math.max(0, Math.min(1, (stimp - 8) / 5));
  return 0.03 - 0.015 * t;
}

/** Tile indices of the green reached by flood fill from the green centre. */
export function greenTiles(g: Game, hole: Hole): number[] {
  const w = g.world;
  const sx = Math.round(hole.greenCenter.x), sy = Math.round(hole.greenCenter.y);
  if (!w.inBounds(sx, sy) || w.surface[w.idx(sx, sy)] !== Surface.Green) return [];
  const seen = new Set<number>([w.idx(sx, sy)]);
  const stack = [w.idx(sx, sy)];
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w.size, y = Math.floor(i / w.size);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (!w.inBounds(nx, ny)) continue;
      const j = w.idx(nx, ny);
      if (!seen.has(j) && w.surface[j] === Surface.Green) { seen.add(j); stack.push(j); }
    }
  }
  return [...seen];
}

/** Steps (4-neighbour) from each green tile to the nearest non-green tile. */
function edgeDistances(g: Game, tiles: number[]): Map<number, number> {
  const w = g.world;
  const set = new Set(tiles);
  const d = new Map<number, number>();
  let frontier: number[] = [];
  for (const i of tiles) {
    const x = i % w.size, y = Math.floor(i / w.size);
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !set.has(w.idx(x + dx!, y + dy!)) || !w.inBounds(x + dx!, y + dy!));
    if (edge) { d.set(i, 1); frontier.push(i); }
  }
  let k = 1;
  while (frontier.length) {
    k++;
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w.size, y = Math.floor(i / w.size);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (!w.inBounds(x + dx, y + dy)) continue;
        const j = w.idx(x + dx, y + dy);
        if (set.has(j) && !d.has(j)) { d.set(j, k); next.push(j); }
      }
    }
    frontier = next;
  }
  return d;
}

export function pinnableTiles(g: Game, hole: Hole, stimp: number): number[] {
  const w = g.world;
  const tiles = greenTiles(g, hole);
  const d = edgeDistances(g, tiles);
  const max = MAX_PIN_SLOPE(stimp);
  return tiles.filter(i => (d.get(i) ?? 0) > EDGE_BAND && slopeAt(w, i % w.size, Math.floor(i / w.size)).gradient <= max + 1e-9);
}

/** 0 (easy) .. 1 (hard) from slope at the pin and closeness to the edge. */
export function pinDifficulty(g: Game, hole: Hole, pin: Vec2, stimp: number): number {
  const w = g.world;
  const tiles = greenTiles(g, hole);
  const d = edgeDistances(g, tiles).get(w.idx(Math.round(pin.x), Math.round(pin.y))) ?? 1;
  const slope = Math.min(1, slopeAt(w, pin.x, pin.y).gradient / MAX_PIN_SLOPE(stimp));
  const edge = Math.max(0, Math.min(1, 1 - (d - EDGE_BAND - 1) / 6));
  return 0.6 * slope + 0.4 * edge;
}

/** Terrain shaping restricted to this hole's green and fringe. */
export function planGreenShape(g: Game, hole: Hole, op: TerrainOp, tiles: Vec2[]): EditPlan {
  const w = g.world;
  const ok: Vec2[] = [];
  let outside = 0;
  for (const t of tiles) {
    if (!w.inBounds(t.x, t.y)) { outside++; continue; }
    const i = w.idx(t.x, t.y);
    const s = w.surface[i];
    if ((s === Surface.Green || s === Surface.Fringe) && w.holeId[i] === hole.id) ok.push(t);
    else outside++;
  }
  const p = planTerrain(g, ok, op);
  for (let k = 0; k < outside; k++) addReason(p, 'outside this green');
  return p;
}

/** Spread pins over the pinnable area with farthest-point sampling, starting nearest the centre. */
export function autoPins(g: Game, hole: Hole, stimp: number, count = 4): Vec2[] {
  const w = g.world;
  const cand = pinnableTiles(g, hole, stimp).map(i => ({ x: i % w.size, y: Math.floor(i / w.size) }));
  if (cand.length === 0) return [];
  const c = hole.greenCenter;
  let first = cand[0]!;
  for (const p of cand) if (Math.hypot(p.x - c.x, p.y - c.y) < Math.hypot(first.x - c.x, first.y - c.y)) first = p;
  const pins = [first];
  while (pins.length < count) {
    let best: Vec2 | null = null, bestD = -1;
    for (const p of cand) {
      const d = Math.min(...pins.map(q => Math.hypot(p.x - q.x, p.y - q.y)));
      if (d > bestD) { bestD = d; best = p; }
    }
    if (!best || bestD <= 0) break;
    pins.push(best);
  }
  return pins;
}
