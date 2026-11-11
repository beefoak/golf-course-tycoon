import { Result, fail } from '../../core/result';
import { Vec2 } from '../../core/geom';
import { addReason, commitPlan, emptyPlan, EditPlan } from '../construction/plan';
import { editableTile } from '../construction/paint';
import type { Game, System } from '../game';
import { registerSaveable } from '../saveRegistry';
import { isTurfSurface, Surface } from '../world/tiles';
import { TERRAINS } from '../world/terrainTypes';
import { ambientMoisture } from './weather';
import { practiceModifier, recentlyAerated } from './practices';
import { defaultGrass, Grass, grassSpec, seasonalGrowth } from './grasses';

/** Per-course mowing and conditioning targets (holes may override). */
export interface TurfSettings {
  greenMowMm: number;
  teeMowMm: number;
  fairwayMowMm: number;
  roughMowMm: number;
  /** 8..13 */
  greenStimpTarget: number;
  /** 0..100 */
  fairwayFirmnessTarget: number;
}
export const DEFAULT_TURF: TurfSettings = { greenMowMm: 3.6, teeMowMm: 10, fairwayMowMm: 12, roughMowMm: 50, greenStimpTarget: 10, fairwayFirmnessTarget: 60 };

export interface TurfState {
  settings: Map<number, TurfSettings>;
  holeOverrides: Map<number, Partial<TurfSettings>>;
  /** Until the maintenance program (Task 31) exists, course turf is mown and bunkers raked each night. */
  autoCare: boolean;
}
export function newTurfState(): TurfState {
  return { settings: new Map(), holeOverrides: new Map(), autoCare: true };
}

export function turfSettings(g: Game, courseId: number, holeId = 0): TurfSettings {
  const base = g.turf.settings.get(courseId) ?? DEFAULT_TURF;
  const o = holeId ? g.turf.holeOverrides.get(holeId) : undefined;
  return o ? { ...base, ...o } : base;
}

/** Mow height target (mm) for a surface, or null when it isn't mown. */
export function mowTargetMm(s: TurfSettings, surface: Surface): number | null {
  switch (surface) {
    case Surface.Green: return s.greenMowMm;
    case Surface.Fringe: return Math.max(8, s.greenMowMm * 2.5);
    case Surface.Tee: return s.teeMowMm;
    case Surface.Fairway: return s.fairwayMowMm;
    case Surface.FirstCut: return Math.max(s.fairwayMowMm * 2, 25);
    case Surface.Rough: return s.roughMowMm;
    default: return null;
  }
}

/** Green speed in feet: lower mow → faster; rolled +0.5; wet −1; unhealthy turf slows down. */
export function stimpFor(grass: Grass, mowMm: number, health: number, moisture: number, rolledToday: boolean): number {
  const spec = grassSpec(grass);
  if (!spec) return 10;
  let v = spec.baseStimpAt3mm + (3 - mowMm) * 1.6;
  if (rolledToday) v += 0.5;
  if (moisture > 70) v -= 1;
  if (health < 60) v -= (60 - health) / 15;
  return Math.max(5, Math.min(14, v));
}

// --- per-hole tile index (rebuilt lazily after edits) ---
interface HoleTiles { green: number[]; turf: number[] }
const tileIndex = new WeakMap<Game, Map<number, HoleTiles>>();
export function holeTiles(g: Game, holeId: number): HoleTiles {
  let m = tileIndex.get(g);
  if (!m) {
    m = new Map();
    const w = g.world;
    for (let i = 0; i < w.holeId.length; i++) {
      const id = w.holeId[i]!;
      if (!id) continue;
      const s = w.surface[i] as Surface;
      if (!isTurfSurface(s)) continue;
      let e = m.get(id);
      if (!e) { e = { green: [], turf: [] }; m.set(id, e); }
      e.turf.push(i);
      if (s === Surface.Green) e.green.push(i);
    }
    tileIndex.set(g, m);
  }
  return m.get(holeId) ?? { green: [], turf: [] };
}

/** Average Stimp over the hole's grassed green tiles (10 when it has none). */
export function greenStimpFromTurf(g: Game, holeId: number): number {
  const w = g.world;
  const greens = holeTiles(g, holeId).green;
  let sum = 0, n = 0;
  for (const i of greens) {
    const gr = w.grass[i] as Grass;
    if (gr === Grass.None) continue;
    sum += stimpFor(gr, w.mowHeight[i]! / 10, w.health[i]!, w.moisture[i]!, w.rolledDay[i] === g.day) - (recentlyAerated(g, i) ? 1.5 : 0);
    n++;
  }
  return n ? sum / n : 10;
}

/** Average health of a hole's grassed turf (null when nothing is grassed). */
export function holeCondition(g: Game, holeId: number): number | null {
  const w = g.world;
  let sum = 0, n = 0;
  for (const i of holeTiles(g, holeId).turf) {
    if (w.grass[i] === Grass.None) continue;
    sum += w.health[i]!; n++;
  }
  return n ? sum / n : null;
}

export function addWear(g: Game, x: number, y: number, amount: number): void {
  const w = g.world;
  if (!w.inBounds(x, y)) return;
  const i = w.idx(Math.floor(x), Math.floor(y));
  if (w.grass[i] === Grass.None) return;
  w.wear[i] = Math.min(255, w.wear[i]! + amount);
}

// --- simulation ---
/** Stripes: each tick processes every STRIPES-th tile, so a full pass takes STRIPES ticks (6 game minutes). */
export const STRIPES = 60;
const DT_DAYS = STRIPES / 10 / 960;

/** Deterministic stochastic rounding: integer tile fields still move by fractional amounts on average. */
function sround(v: number, i: number, tick: number): number {
  const f = Math.floor(v);
  const h = Math.imul(i ^ Math.imul(tick, 0x9e3779b1), 0x85ebca6b) >>> 16;
  return f + ((h & 0xffff) / 65536 < v - f ? 1 : 0);
}

/** Where soil moisture drifts today (weather-driven; irrigation adds water at night on top). */
export function moistureTarget(g: Game): number {
  return g.weather ? ambientMoisture(g.weather) : 55;
}

/** Health a tile settles toward given climate, moisture, wear and mowing stress. */
export function healthTarget(fitness: number, moisture: number, wear: number, mowMm: number, minMowMm: number): number {
  let t = 30 + 65 * fitness;
  if (moisture < 20) t -= (20 - moisture) * 2;
  if (moisture > 85) t -= (moisture - 85) * 1.5;
  t -= wear * 0.25;
  if (mowMm < minMowMm) t -= ((minMowMm - mowMm) / minMowMm) * 120;
  return Math.max(0, Math.min(100, t));
}

/** Health lost each time a tile is mown below its grass's minimum height (scalping). */
export function scalpDamage(targetMm: number, minMowMm: number): number {
  return targetMm < minMowMm ? ((minMowMm - targetMm) / minMowMm) * 25 : 0;
}

const NG = 9;
export const turfSystem: System = {
  name: 'turf',
  onTick(g) {
    const w = g.world;
    const tick = g.clock.tick;
    const climate = TERRAINS[g.terrain].climate;
    const season = g.clock.season;
    // per-grass constants for this tick
    const growK = new Float64Array(NG), fitK = new Float64Array(NG), minMow = new Float64Array(NG), wearK = new Float64Array(NG);
    for (let gr = 1; gr < NG; gr++) {
      const spec = grassSpec(gr as Grass)!;
      growK[gr] = seasonalGrowth(spec, season) * 10 * DT_DAYS;
      fitK[gr] = spec.climateFit[climate];
      minMow[gr] = spec.minMowMm;
      wearK[gr] = 20 * spec.wearTolerance * DT_DAYS;
    }
    const up = 4 * DT_DAYS, down = 8 * DT_DAYS;
    const mt = moistureTarget(g);
    const n = w.grass.length;
    const grass = w.grass, health = w.health, mow = w.mowHeight, moist = w.moisture, wearA = w.wear;
    for (let i = tick % STRIPES; i < n; i += STRIPES) {
      const gr = grass[i]!;
      if (gr === 0) continue;
      let h = health[i]!;
      // growth (sick turf grows less)
      const mh = Math.min(1500, mow[i]! + sround(growK[gr]! * (0.3 + 0.007 * h), i, tick));
      mow[i] = mh;
      // moisture drifts toward the weather/irrigation target
      const m = moist[i]!;
      const m2 = mt === m ? m : Math.max(0, Math.min(100, m + sround(Math.abs(mt - m) * 2 * DT_DAYS, i + 1, tick) * Math.sign(mt - m)));
      moist[i] = m2;
      // wear recovers faster on healthy, tolerant turf
      let wr = wearA[i]!;
      if (wr) { wr = Math.max(0, wr - sround(wearK[gr]! * (0.5 + h / 200), i + 2, tick)); wearA[i] = wr; }
      // health
      const target = Math.max(0, Math.min(100, healthTarget(fitK[gr]!, m2, wr, mh / 10, minMow[gr]!) + practiceModifier(g, i)));
      if (target > h) h = Math.min(target, h + sround(up, i + 3, tick));
      else if (target < h) h = Math.max(target, h - sround(down, i + 3, tick));
      health[i] = h;
    }
  },
  onDay(g) {
    if (!g.turf.autoCare) return;
    const w = g.world;
    for (let i = 0; i < w.grass.length; i++) {
      const cid = w.courseId[i]!;
      if (w.surface[i] === Surface.Bunker) { if (g.parcels.tileOwned(i % w.size, Math.floor(i / w.size))) w.health[i] = 100; continue; }
      if (!cid || w.grass[i] === Grass.None) continue;
      const t = mowTargetMm(turfSettings(g, cid, w.holeId[i]!), w.surface[i] as Surface);
      if (t === null || w.mowHeight[i]! <= t * 10) continue;
      w.mowHeight[i] = Math.round(t * 10);
      const dmg = scalpDamage(t, grassSpec(w.grass[i] as Grass)!.minMowMm);
      if (dmg) w.health[i] = Math.max(0, Math.round(w.health[i]! - dmg));
    }
  },
};

/** Change the grass on tiles (seeded turf starts thin, sod starts healthy). Refused on open holes like any edit. */
export function planSetGrass(g: Game, tiles: Vec2[], grass: Grass, method: 'seed' | 'sod'): EditPlan {
  const w = g.world;
  const p = emptyPlan();
  const spec = grassSpec(grass);
  if (!spec) { addReason(p, 'pick a grass'); return p; }
  const seen = new Set<number>();
  for (const t of tiles) {
    const why = editableTile(g, t.x, t.y);
    if (why) { addReason(p, why); continue; }
    const i = w.idx(t.x, t.y);
    if (seen.has(i)) continue;
    seen.add(i);
    if (!isTurfSurface(w.surface[i] as Surface)) { addReason(p, 'only turf surfaces take grass'); continue; }
    if (w.grass[i] === grass) continue;
    p.changes.push({ i, grass });
    p.cost += method === 'seed' ? spec.seedCostPerTile : spec.sodCostPerTile;
  }
  const changed = p.changes.map(c => c.i);
  p.onCommit = gm => { for (const i of changed) { gm.world.health[i] = method === 'seed' ? 25 : 75; gm.world.wear[i] = 0; } };
  return p;
}

export function setGrass(g: Game, tiles: Vec2[], grass: Grass, method: 'seed' | 'sod'): Result {
  if (grass === Grass.None) return fail('Pick a grass');
  return commitPlan(g, planSetGrass(g, tiles, grass, method), 'construction');
}

/** New turf gets the climate's default grass; tiles that stop being turf lose theirs. Hole tile index is rebuilt. */
export function attachTurf(g: Game): void {
  g.registerSystem(turfSystem);
  g.events.on('edit', ({ tiles }) => {
    tileIndex.delete(g);
    const w = g.world;
    const climate = TERRAINS[g.terrain].climate;
    for (const i of tiles) {
      const s = w.surface[i] as Surface;
      if (!isTurfSurface(s)) { w.grass[i] = Grass.None; if (s === Surface.Bunker) w.health[i] = 100; continue; }
      if (w.grass[i] !== Grass.None) continue;
      w.grass[i] = defaultGrass(climate, s);
      w.health[i] = 75;
      w.wear[i] = 0;
      const t = mowTargetMm(DEFAULT_TURF, s);
      w.mowHeight[i] = Math.round((t ?? 100) * 10);
    }
  });
}

registerSaveable({
  key: 'turf',
  save: g => ({ settings: [...g.turf.settings], holeOverrides: [...g.turf.holeOverrides], autoCare: g.turf.autoCare }),
  load: (g, d) => {
    const s = d as { settings: [number, TurfSettings][]; holeOverrides: [number, Partial<TurfSettings>][]; autoCare: boolean };
    g.turf = { settings: new Map(s.settings), holeOverrides: new Map(s.holeOverrides), autoCare: s.autoCare };
  },
});
