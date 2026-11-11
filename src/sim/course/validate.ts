import { Vec2, dist } from '../../core/geom';
import type { Game } from '../game';
import { isWalkable } from '../world/tiles';
import { Hole, MAX_PINS, MIN_PINS } from './course';
import { greenTiles } from './green';
import { Surface } from '../world/tiles';

const CLUBHOUSE_NEAR_TILES = 75; // 150 m

/**
 * Reachability on foot between two points. Replaced by findPath (Task 20) via setRouteCheck;
 * the default is a bounded BFS over walkable tiles.
 */
export type RouteCheck = (g: Game, from: Vec2, to: Vec2) => boolean;
let routeCheck: RouteCheck = bfsReachable;
export function setRouteCheck(fn: RouteCheck): void {
  routeCheck = fn;
}

function nearestWalkable(g: Game, p: Vec2): Vec2 | null {
  const x0 = Math.round(p.x), y0 = Math.round(p.y);
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (isWalkable(g.world, x0 + dx, y0 + dy)) return { x: x0 + dx, y: y0 + dy };
    }
  }
  return null;
}

export function bfsReachable(g: Game, from: Vec2, to: Vec2): boolean {
  const w = g.world;
  const a = nearestWalkable(g, from), b = nearestWalkable(g, to);
  if (!a || !b) return false;
  const pad = 80;
  const x0 = Math.max(0, Math.min(a.x, b.x) - pad), x1 = Math.min(w.size - 1, Math.max(a.x, b.x) + pad);
  const y0 = Math.max(0, Math.min(a.y, b.y) - pad), y1 = Math.min(w.size - 1, Math.max(a.y, b.y) + pad);
  const bw = x1 - x0 + 1;
  const seen = new Uint8Array(bw * (y1 - y0 + 1));
  const q: number[] = [(a.y - y0) * bw + (a.x - x0)];
  seen[q[0]!] = 1;
  const target = (b.y - y0) * bw + (b.x - x0);
  for (let k = 0; k < q.length; k++) {
    const c = q[k]!;
    if (c === target) return true;
    const x = (c % bw) + x0, y = Math.floor(c / bw) + y0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
      const j = (ny - y0) * bw + (nx - x0);
      if (seen[j] || !isWalkable(w, nx, ny)) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return false;
}

export function validateHole(g: Game, hole: Hole): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const w = g.world;
  if (hole.teeBoxes.length === 0) errors.push('Needs at least one tee box');
  if (greenTiles(g, hole).length === 0) errors.push('Needs a green at the green centre');
  if (hole.pins.length < MIN_PINS || hole.pins.length > MAX_PINS) errors.push(`Needs ${MIN_PINS}–${MAX_PINS} pin positions (has ${hole.pins.length})`);
  for (const p of hole.pins) {
    if (!w.inBounds(p.x, p.y) || w.surface[w.idx(p.x, p.y)] !== Surface.Green) { errors.push('A pin is not on the green'); break; }
  }
  for (const t of hole.teeBoxes) if (!g.parcels.tileOwned(t.center.x, t.center.y)) errors.push(`The ${t.kind} tee is on land you don't own`);
  if (!g.parcels.tileOwned(hole.greenCenter.x, hole.greenCenter.y)) errors.push("The green is on land you don't own");

  const course = g.courses.get(hole.courseId);
  const prev = course?.holes.find(h => h.number === hole.number - 1);
  const firstTee = hole.teeBoxes[0]?.center;
  if (prev && firstTee && !routeCheck(g, prev.greenCenter, firstTee)) errors.push(`Golfers can't walk here from ${prev.name}'s green`);

  if (course?.clubhouse && (hole.number === 1 || hole.number === 10) && firstTee && dist(course.clubhouse, firstTee) > CLUBHOUSE_NEAR_TILES) {
    warnings.push(`${hole.name} tee is more than 150 m from the clubhouse`);
  }
  return { errors, warnings };
}
