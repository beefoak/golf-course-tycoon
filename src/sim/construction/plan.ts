import { Result, fail, ok } from '../../core/result';
import { TxCategory } from '../economy/ledger';
import type { Game } from '../game';
import { Feature, Surface } from '../world/tiles';

export interface TileChange {
  i: number;
  surface?: Surface;
  elevation?: number;
  treeSpecies?: number;
  feature?: Feature;
}

export interface EditPlan {
  changes: TileChange[];
  cost: number;
  skipped: number;
  /** m³ added to (+) or taken from (−) the soil stockpile */
  stockpileDelta: number;
  /** unique human-readable reasons for skipped tiles */
  reasons: string[];
}

export function emptyPlan(): EditPlan {
  return { changes: [], cost: 0, skipped: 0, stockpileDelta: 0, reasons: [] };
}

export function addReason(p: EditPlan, reason: string): void {
  p.skipped++;
  if (!p.reasons.includes(reason)) p.reasons.push(reason);
}

/** Apply a plan atomically: either everything (and the charge) or nothing. */
export function commitPlan(g: Game, p: EditPlan, cat: TxCategory): Result {
  if (p.changes.length === 0) return fail(p.reasons[0] ?? 'Nothing to change');
  const cost = Math.round(p.cost);
  if (!g.ledger.canAfford(cost)) return fail(`Not enough money ($${cost.toLocaleString()} needed)`);
  g.ledger.spend(cost, cat, g.day);
  const w = g.world;
  for (const c of p.changes) {
    if (c.surface !== undefined) w.surface[c.i] = c.surface;
    if (c.elevation !== undefined) w.elevation[c.i] = c.elevation;
    if (c.treeSpecies !== undefined) { w.treeSpecies[c.i] = c.treeSpecies; if (c.treeSpecies) w.treeAgeDays[c.i] = 0; }
    if (c.feature !== undefined) w.feature[c.i] = c.feature;
    const x = c.i % w.size, y = Math.floor(c.i / w.size);
    w.markDirty(x, y);
    // hill shading of neighbours changes with elevation
    if (c.elevation !== undefined) { w.markDirty(Math.min(w.size - 1, x + 1), y); w.markDirty(x, Math.min(w.size - 1, y + 1)); w.markDirty(Math.max(0, x - 1), y); w.markDirty(x, Math.max(0, y - 1)); }
  }
  g.soilStockpileM3 = Math.max(0, g.soilStockpileM3 + p.stockpileDelta);
  g.events.emit('edit', { tiles: p.changes.map(c => c.i) });
  return ok(undefined);
}
