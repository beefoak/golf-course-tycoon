import { Vec2 } from '../../core/geom';
import { TILE_M } from '../../core/units';
import { Hole, Stakes } from '../course/course';
import { projectOnRoute } from '../course/pen';
import type { Game } from '../game';
import { Feature, Surface } from '../world/tiles';
import { COSTS } from './costs';
import { editableTile } from './paint';
import { EditPlan, addReason, emptyPlan } from './plan';

export type SandType = 'standard' | 'premium' | 'native';
export const SAND: Record<SandType, { code: number; costMult: number; rakeNeed: number }> = {
  standard: { code: 1, costMult: 1, rakeNeed: 1 },
  premium: { code: 2, costMult: 1.6, rakeNeed: 0.8 },
  native: { code: 3, costMult: 0.7, rakeNeed: 1.3 },
};

const AREA = TILE_M * TILE_M;
/** Surfaces trees may be planted on. */
const TREE_OK = new Set<Surface>([Surface.Natural, Surface.Rough, Surface.DeepRough, Surface.Native, Surface.FirstCut, Surface.Waste]);

/** Iterate unique in-bounds tiles; report off-map and uneditable tiles on the plan. */
function eachEditable(g: Game, p: EditPlan, tiles: Vec2[], fn: (i: number, t: Vec2) => void): void {
  const seen = new Set<number>();
  for (const t of tiles) {
    if (!g.world.inBounds(t.x, t.y)) { addReason(p, 'off the map'); continue; }
    const i = g.world.idx(t.x, t.y);
    if (seen.has(i)) continue;
    seen.add(i);
    const why = editableTile(g, t.x, t.y);
    if (why) { addReason(p, why); continue; }
    fn(i, t);
  }
}

export function planBunker(g: Game, tiles: Vec2[], sand: SandType, depthM = 0.6): EditPlan {
  const p = emptyPlan();
  const w = g.world;
  eachEditable(g, p, tiles, i => {
    const s = w.surface[i] as Surface;
    if (s === Surface.Water || s === Surface.Path || s === Surface.Building) { addReason(p, 'water, paths and buildings'); return; }
    if (w.feature[i] === Feature.SpecimenTree) { addReason(p, 'specimen tree (remove it first)'); return; }
    if (s === Surface.Bunker && w.firmness[i] === SAND[sand].code) return;
    const fresh = s !== Surface.Bunker;
    let cost = COSTS.surface[Surface.Bunker] * SAND[sand].costMult;
    const change: { i: number; surface: Surface; material: number; elevation?: number; treeSpecies?: number } = { i, surface: Surface.Bunker, material: SAND[sand].code };
    if (fresh) {
      change.elevation = Math.max(0, w.elevation[i]! - depthM);
      cost += depthM * AREA * COSTS.cutPerM3;
      p.stockpileDelta += depthM * AREA;
    }
    if (w.treeSpecies[i]) { change.treeSpecies = 0; cost += COSTS.treeRemove; }
    p.changes.push(change);
    p.cost += cost;
  });
  return p;
}

export function planDigWater(g: Game, tiles: Vec2[], depthM = 1.5): EditPlan {
  const p = emptyPlan();
  const w = g.world;
  eachEditable(g, p, tiles, i => {
    const s = w.surface[i] as Surface;
    if (s === Surface.Water) return;
    if (s === Surface.Path || s === Surface.Building) { addReason(p, 'paths and buildings'); return; }
    if (w.feature[i] === Feature.SpecimenTree) { addReason(p, 'specimen tree (remove it first)'); return; }
    const vol = depthM * AREA;
    let cost = vol * COSTS.digWaterPerM3 + COSTS.pondLinerPerTile;
    const change: { i: number; surface: Surface; elevation: number; treeSpecies?: number } = { i, surface: Surface.Water, elevation: Math.max(0, w.elevation[i]! - depthM) };
    if (w.treeSpecies[i]) { change.treeSpecies = 0; cost += COSTS.treeRemove; }
    p.changes.push(change);
    p.cost += cost;
    p.stockpileDelta += vol;
  });
  return p;
}

/** Turn water back into natural ground at the grade of the surrounding dry land. */
export function planFillWater(g: Game, tiles: Vec2[]): EditPlan {
  const p = emptyPlan();
  const w = g.world;
  const seen = new Set<number>();
  for (const t of tiles) {
    if (!w.inBounds(t.x, t.y)) { addReason(p, 'off the map'); continue; }
    const i = w.idx(t.x, t.y);
    if (seen.has(i)) continue;
    seen.add(i);
    if (w.feature[i] === Feature.Creek) { addReason(p, 'creek (cannot be changed)'); continue; }
    const why = editableTile(g, t.x, t.y);
    if (why) { addReason(p, why); continue; }
    if (w.surface[i] !== Surface.Water) continue;
    let sum = 0, n = 0;
    for (let r = 1; r <= 6 && n === 0; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = t.x + dx, y = t.y + dy;
        if (!w.inBounds(x, y)) continue;
        const j = w.idx(x, y);
        if (w.surface[j] !== Surface.Water) { sum += w.elevation[j]!; n++; }
      }
    }
    const target = n ? sum / n : w.elevation[i]! + 1.5;
    const vol = Math.max(0, target - w.elevation[i]!) * AREA;
    p.changes.push({ i, surface: Surface.Natural, elevation: target });
    p.cost += vol * COSTS.fillWaterPerM3;
  }
  return p;
}

export function planTrees(g: Game, tiles: Vec2[], species: number, density: number): EditPlan {
  const p = emptyPlan();
  const w = g.world;
  const rng = g.rng.fork(`trees:${g.clock.tick}:${tiles.length}`);
  eachEditable(g, p, tiles, i => {
    if (w.treeSpecies[i] || w.feature[i] === Feature.SpecimenTree) return;
    if (!TREE_OK.has(w.surface[i] as Surface)) { addReason(p, 'trees only go on rough, native or natural ground'); return; }
    if (density < 1 && rng.next() >= density) return;
    p.changes.push({ i, treeSpecies: species });
    p.cost += COSTS.treePlantDefault;
  });
  return p;
}

export function planRemoveTrees(g: Game, tiles: Vec2[]): EditPlan {
  const p = emptyPlan();
  const w = g.world;
  const removedSpecimens: Vec2[] = [];
  eachEditable(g, p, tiles, (i, t) => {
    if (w.feature[i] === Feature.SpecimenTree) {
      p.changes.push({ i, treeSpecies: 0, feature: Feature.None });
      p.cost += COSTS.specimenRemove;
      removedSpecimens.push({ x: t.x, y: t.y });
    } else if (w.treeSpecies[i]) {
      p.changes.push({ i, treeSpecies: 0 });
      p.cost += COSTS.treeRemove;
    }
  });
  if (removedSpecimens.length) {
    p.onCommit = gg => { for (const at of removedSpecimens) gg.pendingReputationEvents.push({ kind: 'specimenRemoved', at }); };
  }
  return p;
}

const OB_SPACING = 8;
const WATER_SPACING = 6;
const NEAR_TILES = 20; // 40 m

function spaced(points: Vec2[], spacing: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) if (out.every(q => Math.abs(q.x - p.x) + Math.abs(q.y - p.y) >= spacing)) out.push(p);
  return out;
}

/** OB stakes along unowned/road/neighbour boundaries near the hole; red (lateral) and yellow (crossing) water stakes. */
export function computeStakes(g: Game, hole: Hole): Stakes {
  const w = g.world;
  const route = [...hole.route.slice(0, -1), hole.greenCenter];
  let reach = 0;
  let x0 = w.size, y0 = w.size, x1 = 0, y1 = 0;
  for (let i = 0; i < w.holeId.length; i++) {
    if (w.holeId[i] !== hole.id) continue;
    const x = i % w.size, y = Math.floor(i / w.size);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    reach = Math.max(reach, projectOnRoute(route, { x, y }).d);
  }
  if (x0 > x1) return { ob: [], red: [], yellow: [] };
  const fairwayHalf = Math.max(4, Math.min(reach, 9));
  const ob: Vec2[] = [], red: Vec2[] = [], yellow: Vec2[] = [];
  const bad = (x: number, y: number) => {
    if (!w.inBounds(x, y)) return false;
    const f = w.feature[w.idx(x, y)] as Feature;
    return !g.parcels.tileOwned(x, y) || f === Feature.Road || f === Feature.Neighbor;
  };
  for (let y = Math.max(0, y0 - NEAR_TILES); y <= Math.min(w.size - 1, y1 + NEAR_TILES); y++) {
    for (let x = Math.max(0, x0 - NEAR_TILES); x <= Math.min(w.size - 1, x1 + NEAR_TILES); x++) {
      const { d } = projectOnRoute(route, { x, y });
      if (d > reach + NEAR_TILES) continue;
      const i = w.idx(x, y);
      if (bad(x, y)) continue;
      if (bad(x + 1, y) || bad(x - 1, y) || bad(x, y + 1) || bad(x, y - 1)) ob.push({ x, y });
      if (w.surface[i] === Surface.Water) {
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w.inBounds(x + dx!, y + dy!) && w.surface[w.idx(x + dx!, y + dy!)] !== Surface.Water);
        if (edge) (d <= fairwayHalf ? yellow : red).push({ x, y });
      }
    }
  }
  const s: Stakes = { ob: spaced(ob, OB_SPACING), red: spaced(red, WATER_SPACING), yellow: spaced(yellow, WATER_SPACING) };
  for (const o of hole.stakeOverrides.add) s[o.kind].push(o.at);
  return s;
}
