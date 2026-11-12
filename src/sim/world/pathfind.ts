import { Vec2 } from '../../core/geom';
import type { Game } from '../game';
import { Feature, Surface, isWalkable } from './tiles';

export type MoveMode = 'walk' | 'cart';

/** Cache granularity: 2×2 tiles (4 m). */
export const CELL = 2;
const SQRT2 = Math.SQRT2;

/** Per-tile movement cost; Infinity = impassable. */
export function tileCost(g: Game, x: number, y: number, mode: MoveMode): number {
  const w = g.world;
  if (!w.inBounds(x, y) || !g.parcels.tileOwned(x, y)) return Infinity;
  if (!isWalkable(w, x, y)) return Infinity;
  const i = w.idx(x, y);
  const s = w.surface[i] as Surface;
  if (s === Surface.Building) return Infinity;
  if (s === Surface.Path) return 0.6;
  if (s === Surface.Green) return mode === 'cart' ? Infinity : 3;
  if (s === Surface.Tee) return mode === 'cart' ? Infinity : 1;
  if (s === Surface.Bunker) return mode === 'cart' ? Infinity : 4;
  if (w.feature[i] === Feature.Creek) return Infinity;
  if (w.treeSpecies[i]) return mode === 'cart' ? Infinity : 1.5;
  return 1;
}

interface Scratch { size: number; g: Float32Array; came: Int32Array; stamp: Uint32Array; closed: Uint32Array; cost: Float32Array; costStamp: Uint32Array; gen: number }
let scratch: Scratch | null = null;
function getScratch(n: number): Scratch {
  if (!scratch || scratch.size !== n) scratch = { size: n, g: new Float32Array(n), came: new Int32Array(n), stamp: new Uint32Array(n), closed: new Uint32Array(n), cost: new Float32Array(n), costStamp: new Uint32Array(n), gen: 0 };
  scratch.gen++;
  return scratch;
}

class Heap {
  private k: number[] = [];
  private p: number[] = [];
  get size(): number { return this.k.length; }
  push(key: number, pri: number): void {
    this.k.push(key); this.p.push(pri);
    let i = this.k.length - 1;
    while (i > 0) {
      const pa = (i - 1) >> 1;
      if (this.p[pa]! <= this.p[i]!) break;
      this.swap(i, pa); i = pa;
    }
  }
  pop(): number {
    const top = this.k[0]!;
    const lk = this.k.pop()!, lp = this.p.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.p[l]! < this.p[m]!) m = l;
        if (r < this.k.length && this.p[r]! < this.p[m]!) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.k[a], this.k[b]] = [this.k[b]!, this.k[a]!];
    [this.p[a], this.p[b]] = [this.p[b]!, this.p[a]!];
  }
}

/** Per-tile cost the A* heuristic assumes (open ground). */
export const HEURISTIC_COST = 1;
const caches = new WeakMap<Game, Map<string, Vec2[] | null>>();
/** Paths depend on surfaces and owned land: drop the cache on edits and land deals. */
function cacheFor(g: Game): Map<string, Vec2[] | null> {
  let c = caches.get(g);
  if (!c) {
    const m = new Map<string, Vec2[] | null>();
    caches.set(g, m);
    g.events.on('edit', () => { m.clear(); regions.delete(g); });
    g.events.on('land', () => { m.clear(); regions.delete(g); });
    c = m;
  }
  return c;
}
export function clearPathCache(g: Game): void {
  cacheFor(g).clear();
  regions.delete(g);
}

/**
 * Connected regions of passable tiles per move mode (4-neighbour flood fill; the search never
 * cuts corners, so 8-neighbour moves reach nothing more). A goal in another region fails at once
 * instead of searching every reachable tile first. Rebuilt lazily after edits and land deals.
 */
const regions = new WeakMap<Game, Partial<Record<MoveMode, Int32Array>>>();
function regionMap(g: Game, mode: MoveMode): Int32Array {
  let byMode = regions.get(g);
  if (!byMode) { byMode = {}; regions.set(g, byMode); }
  const have = byMode[mode];
  if (have) return have;
  const n = g.world.size;
  const r = new Int32Array(n * n).fill(-1);
  const stack = new Int32Array(n * n);
  let next = 0;
  for (let i0 = 0; i0 < n * n; i0++) {
    if (r[i0] !== -1 || !Number.isFinite(tileCost(g, i0 % n, Math.floor(i0 / n), mode))) continue;
    const id = next++;
    let sp = 0;
    stack[sp++] = i0; r[i0] = id;
    while (sp) {
      const i = stack[--sp]!;
      const x = i % n, y = Math.floor(i / n);
      if (x > 0 && r[i - 1] === -1 && Number.isFinite(tileCost(g, x - 1, y, mode))) { r[i - 1] = id; stack[sp++] = i - 1; }
      if (x < n - 1 && r[i + 1] === -1 && Number.isFinite(tileCost(g, x + 1, y, mode))) { r[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && r[i - n] === -1 && Number.isFinite(tileCost(g, x, y - 1, mode))) { r[i - n] = id; stack[sp++] = i - n; }
      if (y < n - 1 && r[i + n] === -1 && Number.isFinite(tileCost(g, x, y + 1, mode))) { r[i + n] = id; stack[sp++] = i + n; }
    }
  }
  byMode[mode] = r;
  return r;
}

/** False when both tiles are passable but no route joins them. */
export function sameRegion(g: Game, a: Vec2, b: Vec2, mode: MoveMode): boolean {
  const r = regionMap(g, mode), n = g.world.size;
  const ra = r[Math.floor(a.y) * n + Math.floor(a.x)]!, rb = r[Math.floor(b.y) * n + Math.floor(b.x)]!;
  return ra === -1 || rb === -1 || ra === rb;
}

/** First passable tile of a cell in fixed order (centre-ish first), or null if the cell is blocked. */
function anchor(g: Game, cx: number, cy: number, mode: MoveMode): Vec2 | null {
  for (const [dx, dy] of [[1, 1], [0, 0], [1, 0], [0, 1]] as const) {
    const x = cx * CELL + dx, y = cy * CELL + dy;
    if (Number.isFinite(tileCost(g, x, y, mode))) return { x, y };
  }
  return null;
}

/**
 * A* over tiles (8-neighbour, no corner cutting). Returns tile-space waypoints from `from` to `to`
 * (inclusive, simplified to turning points), or null when unreachable. Results are cached per
 * (from 4 m cell, to 4 m cell, mode) and the cache clears on edits and land deals.
 */
/** Longest walk (tiles) checked for a straight-line route before searching. */
export const STRAIGHT_MAX_TILES = 80;
/** Every tile on the line is open ground (no greens, bunkers, water or blocked tiles). */
function straightClear(g: Game, a: Vec2, b: Vec2, mode: MoveMode): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len > STRAIGHT_MAX_TILES) return false;
  const steps = Math.ceil(len * 2);
  let last = -1;
  for (let k = 0; k <= steps; k++) {
    const x = Math.floor(a.x + (dx * k) / Math.max(1, steps)), y = Math.floor(a.y + (dy * k) / Math.max(1, steps));
    const i = y * g.world.size + x;
    if (i === last) continue;
    last = i;
    if (!(tileCost(g, x, y, mode) <= 1.5)) return false;
  }
  return true;
}

export function findPath(g: Game, from: Vec2, to: Vec2, mode: MoveMode): Vec2[] | null {
  const w = g.world;
  const n = w.size;
  const fx = Math.floor(from.x), fy = Math.floor(from.y);
  const tx = Math.floor(to.x), ty = Math.floor(to.y);
  if (!w.inBounds(fx, fy) || !w.inBounds(tx, ty)) return null;
  // a short walk over open ground: the straight line is already the best route
  if (straightClear(g, from, to, mode)) return [{ ...from }, { ...to }];
  const key = `${Math.floor(fx / CELL)},${Math.floor(fy / CELL)}|${Math.floor(tx / CELL)},${Math.floor(ty / CELL)}|${mode}`;
  const cache = cacheFor(g);
  if (cache.has(key)) {
    const c = cache.get(key)!;
    return c ? [{ ...from }, ...c.slice(1, -1).map(p => ({ ...p })), { ...to }] : null;
  }
  // Search between canonical tiles of the two cells, so a cached result never depends on which
  // exact tile asked first (keeps simulation deterministic across save/load).
  const sa = anchor(g, Math.floor(fx / CELL), Math.floor(fy / CELL), mode);
  const ga = anchor(g, Math.floor(tx / CELL), Math.floor(ty / CELL), mode);
  if (!ga) { cache.set(key, null); return null; }
  const s0 = sa ?? { x: Math.floor(fx / CELL) * CELL, y: Math.floor(fy / CELL) * CELL };
  // walled off (water, creek, someone else's land): no search will get there
  if (sa && !sameRegion(g, sa, ga, mode)) { cache.set(key, null); return null; }

  const start = s0.y * n + s0.x, goal = ga.y * n + ga.x;
  const s = getScratch(n * n);
  const gen = s.gen;
  const cost = (i: number) => {
    if (s.costStamp[i] === gen) return s.cost[i]!;
    const v = tileCost(g, i % n, Math.floor(i / n), mode);
    s.costStamp[i] = gen; s.cost[i] = v;
    return v;
  };
  // octile distance at open-ground cost: not admissible where paths are cheaper, so a route may
  // ignore a distant path, but it searches far fewer tiles (weighted A*, Task 45 perf)
  const h = (i: number) => {
    const dx = Math.abs((i % n) - tx), dy = Math.abs(Math.floor(i / n) - ty);
    return HEURISTIC_COST * (Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy));
  };
  const open = new Heap();
  s.g[start] = 0; s.stamp[start] = gen; s.came[start] = -1;
  open.push(start, h(start));
  let found = start === goal;
  let expanded = 0;
  while (open.size && !found) {
    const cur = open.pop();
    if (s.closed[cur] === gen) continue;
    s.closed[cur] = gen;
    if (cur === goal) { found = true; break; }
    if (++expanded > 400_000) break;
    const cx = cur % n, cy = Math.floor(cur / n);
    const cc = cost(cur);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const ni = ny * n + nx;
      if (s.closed[ni] === gen) continue;
      const nc = cost(ni);
      if (!Number.isFinite(nc)) continue;
      if (dx && dy && (!Number.isFinite(cost(cy * n + nx)) || !Number.isFinite(cost(ny * n + cx)))) continue;
      const ng = s.g[cur]! + ((cc + nc) / 2) * (dx && dy ? SQRT2 : 1);
      if (s.stamp[ni] !== gen || ng < s.g[ni]!) {
        s.stamp[ni] = gen; s.g[ni] = ng; s.came[ni] = cur;
        open.push(ni, ng + h(ni));
      }
    }
  }
  if (!found) { cache.set(key, null); return null; }
  const tiles: number[] = [];
  for (let c = goal; c !== -1; c = s.came[c]!) tiles.push(c);
  tiles.reverse();
  // keep only turning points
  const pts: Vec2[] = [];
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k]!;
    if (k > 0 && k < tiles.length - 1) {
      const a = tiles[k - 1]!, b = tiles[k + 1]!;
      if (t - a === b - t) continue;
    }
    pts.push({ x: (t % n) + 0.5, y: Math.floor(t / n) + 0.5 });
  }
  const path = [{ ...from }, ...pts.slice(1, -1), { ...to }];
  cache.set(key, path);
  return path.map(p => ({ ...p }));
}

/** Length of a tile-space polyline in tiles. */
export function pathLength(p: Vec2[]): number {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.y - p[i - 1]!.y);
  return d;
}
