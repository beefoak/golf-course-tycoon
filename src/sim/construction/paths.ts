import { Vec2 } from '../../core/geom';
import { Result, fail, ok } from '../../core/result';
import type { Game } from '../game';
import { Feature, Surface } from '../world/tiles';
import { COSTS } from './costs';
import { editableTile } from './paint';
import { EditPlan, addReason, emptyPlan } from './plan';

export type PathTier = 'gravel' | 'asphalt' | 'concrete';
export const PATH_COST: Record<PathTier, number> = { gravel: 20, asphalt: 45, concrete: 70 };
export const PATH_CODE: Record<PathTier, number> = { gravel: 1, asphalt: 2, concrete: 3 };
export const BRIDGE_COST = 600;

export function planPath(g: Game, tiles: Vec2[], tier: PathTier): EditPlan {
  const p = emptyPlan();
  const w = g.world;
  const seen = new Set<number>();
  for (const t of tiles) {
    if (!w.inBounds(t.x, t.y)) { addReason(p, 'off the map'); continue; }
    const i = w.idx(t.x, t.y);
    if (seen.has(i)) continue;
    seen.add(i);
    const why = editableTile(g, t.x, t.y);
    if (why) { addReason(p, why); continue; }
    const s = w.surface[i] as Surface;
    if (s === Surface.Water) { addReason(p, 'water (build a bridge)'); continue; }
    if (s === Surface.Building) { addReason(p, 'buildings'); continue; }
    if (s === Surface.Green || s === Surface.Tee) { addReason(p, 'greens and tees'); continue; }
    if (w.feature[i] === Feature.SpecimenTree) { addReason(p, 'specimen tree (remove it first)'); continue; }
    if (s === Surface.Path && w.firmness[i] === PATH_CODE[tier]) continue;
    let cost = PATH_COST[tier];
    const change: { i: number; surface: Surface; material: number; treeSpecies?: number } = { i, surface: Surface.Path, material: PATH_CODE[tier] };
    if (w.treeSpecies[i]) { change.treeSpecies = 0; cost += COSTS.treeRemove; }
    p.changes.push(change);
    p.cost += cost;
  }
  return p;
}

/** Bridges go over water and creeks (which are otherwise uneditable); the creek flag stays. */
export function planBridge(g: Game, tiles: Vec2[]): EditPlan {
  const p = emptyPlan();
  const w = g.world;
  const seen = new Set<number>();
  for (const t of tiles) {
    if (!w.inBounds(t.x, t.y)) { addReason(p, 'off the map'); continue; }
    const i = w.idx(t.x, t.y);
    if (seen.has(i)) continue;
    seen.add(i);
    if (!g.parcels.tileOwned(t.x, t.y)) { addReason(p, "land you don't own"); continue; }
    if (w.surface[i] !== Surface.Water) { addReason(p, 'bridges only go over water'); continue; }
    const hole = w.holeId[i]!;
    const lock = hole ? g.holeLockReason(hole) : null;
    if (lock) { addReason(p, lock); continue; }
    p.changes.push({ i, surface: Surface.Path, material: PATH_CODE.concrete });
    p.cost += BRIDGE_COST;
  }
  return p;
}

export type StructureKind = 'shelter' | 'restroom' | 'ballWasher' | 'bench' | 'drinkStation';
export const STRUCTURE_COST: Record<StructureKind, number> = { shelter: 8000, restroom: 25000, ballWasher: 300, bench: 400, drinkStation: 15000 };
export interface Structure { id: number; kind: StructureKind; at: Vec2 }

export function placeStructure(g: Game, kind: StructureKind, at: Vec2): Result<Structure> {
  const x = Math.round(at.x), y = Math.round(at.y);
  const why = editableTile(g, x, y);
  if (why) return fail(`Can't build on ${why}`);
  const s = g.world.surface[g.world.idx(x, y)] as Surface;
  if (s === Surface.Water || s === Surface.Green || s === Surface.Bunker || s === Surface.Building) return fail('Pick a dry spot off the green and bunkers');
  if (g.structures.some(st => st.at.x === x && st.at.y === y)) return fail('Something is already there');
  if (!g.ledger.spend(STRUCTURE_COST[kind], 'construction', g.day)) return fail(`Not enough money ($${STRUCTURE_COST[kind].toLocaleString()} needed)`);
  const st: Structure = { id: g.structures.length ? Math.max(...g.structures.map(s2 => s2.id)) + 1 : 1, kind, at: { x, y } };
  g.structures.push(st);
  g.world.markDirty(x, y);
  return ok(st);
}
