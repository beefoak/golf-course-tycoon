import { Vec2 } from '../../core/geom';
import type { Game } from '../game';
import { Feature, Surface, isBlockingFeature } from '../world/tiles';
import { COSTS, PAINTABLE } from './costs';
import { EditPlan, addReason, emptyPlan } from './plan';

export { commitPlan } from './plan';
export type { EditPlan, TileChange } from './plan';

export function brushTiles(cx: number, cy: number, radius: number, shape: 'circle' | 'square' = 'circle'): Vec2[] {
  const out: Vec2[] = [];
  const x0 = Math.round(cx), y0 = Math.round(cy), r = Math.max(0, Math.round(radius));
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (shape === 'circle' && dx * dx + dy * dy > r * r + 0.5) continue;
      out.push({ x: x0 + dx, y: y0 + dy });
    }
  }
  return out;
}

const FEATURE_REASON: Partial<Record<Feature, string>> = {
  [Feature.Rock]: 'rock outcrop (immovable)',
  [Feature.Creek]: 'creek (cannot be changed)',
  [Feature.Wetland]: 'protected wetland',
  [Feature.Road]: 'public road',
  [Feature.Neighbor]: "neighbour's property",
};

/** Why a tile cannot be edited, or null if it can. */
export function editableTile(g: Game, x: number, y: number): string | null {
  const w = g.world;
  if (!w.inBounds(x, y)) return 'off the map';
  if (!g.parcels.tileOwned(x, y)) return "land you don't own";
  const i = w.idx(x, y);
  const f = w.feature[i] as Feature;
  if (isBlockingFeature(f)) return FEATURE_REASON[f] ?? 'blocked';
  const hole = w.holeId[i]!;
  if (hole) {
    const r = g.holeLockReason(hole);
    if (r) return r;
  }
  return null;
}

/** Plan painting `s` onto tiles. Skips uneditable tiles; removes regular trees (charged). */
export function planSurfacePaint(g: Game, tiles: Vec2[], s: Surface): EditPlan {
  const p = emptyPlan();
  const w = g.world;
  if (!PAINTABLE.has(s)) { addReason(p, 'use the dedicated tool for this surface'); return p; }
  const seen = new Set<number>();
  for (const t of tiles) {
    if (!w.inBounds(t.x, t.y)) { addReason(p, 'off the map'); continue; }
    const i = w.idx(t.x, t.y);
    if (seen.has(i)) continue;
    seen.add(i);
    const why = editableTile(g, t.x, t.y);
    if (why) { addReason(p, why); continue; }
    const cur = w.surface[i] as Surface;
    if (cur === Surface.Water) { addReason(p, 'water (use the water tool to fill it)'); continue; }
    if (cur === Surface.Path || cur === Surface.Building) { addReason(p, 'paths and buildings'); continue; }
    if (w.feature[i] === Feature.SpecimenTree) { addReason(p, 'specimen tree (remove it with the tree tool first)'); continue; }
    const hasTree = w.treeSpecies[i]! !== 0;
    if (cur === s && !hasTree) continue;
    let cost = cur === s ? 0 : COSTS.surface[s];
    const change: { i: number; surface: Surface; treeSpecies?: number } = { i, surface: s };
    if (hasTree) { cost += COSTS.treeRemove; change.treeSpecies = 0; }
    p.changes.push(change);
    p.cost += cost;
  }
  return p;
}
