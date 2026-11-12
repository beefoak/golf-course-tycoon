import { Result, fail, ok } from '../../core/result';
import { TxCategory } from '../economy/ledger';
import type { Game } from '../game';

/** Everything a stroke changed on one tile, as it was before. */
interface TileBefore {
  i: number; surface: number; elevation: number; treeSpecies: number; treeAgeDays: number;
  feature: number; firmness: number; grass: number; health: number; holeId: number; courseId: number;
}

/** The last construction stroke, kept so it can be taken back (same game day, full refund). */
export interface StrokeUndo {
  day: number;
  cat: TxCategory;
  cost: number;
  stockpileDelta: number;
  tiles: TileBefore[];
  /** extra clean-up (a penned hole is removed again) */
  extra?: (g: Game) => void;
  /** a reason the stroke can no longer be taken back (e.g. the hole has been seeded) */
  guard?: (g: Game) => string | null;
  label: string;
}

const strokes = new WeakMap<Game, StrokeUndo | null>();

export function lastStroke(g: Game): StrokeUndo | null { return strokes.get(g) ?? null; }
export function clearStroke(g: Game): void { strokes.set(g, null); }

/** Snapshot the tiles a plan is about to change (called by commitPlan before it applies). */
export function recordStroke(g: Game, tiles: number[], cat: TxCategory, cost: number, stockpileDelta: number, label = 'construction'): StrokeUndo {
  const w = g.world;
  const s: StrokeUndo = {
    day: g.day, cat, cost, stockpileDelta, label,
    tiles: tiles.map(i => ({
      i, surface: w.surface[i]!, elevation: w.elevation[i]!, treeSpecies: w.treeSpecies[i]!, treeAgeDays: w.treeAgeDays[i]!,
      feature: w.feature[i]!, firmness: w.firmness[i]!, grass: w.grass[i]!, health: w.health[i]!, holeId: w.holeId[i]!, courseId: w.courseId[i]!,
    })),
  };
  strokes.set(g, s);
  return s;
}

/** Put the last stroke's tiles back and refund it in full; only on the day it was built. */
export function undoStroke(g: Game): Result<StrokeUndo> {
  const s = lastStroke(g);
  if (!s) return fail('Nothing to undo');
  if (s.day !== g.day) { clearStroke(g); return fail('Too late to undo: that was built on an earlier day'); }
  const why = s.guard?.(g);
  if (why) return fail(why);
  const w = g.world;
  for (const t of s.tiles) {
    w.surface[t.i] = t.surface; w.elevation[t.i] = t.elevation; w.treeSpecies[t.i] = t.treeSpecies; w.treeAgeDays[t.i] = t.treeAgeDays;
    w.feature[t.i] = t.feature; w.firmness[t.i] = t.firmness; w.grass[t.i] = t.grass; w.health[t.i] = t.health;
    w.holeId[t.i] = t.holeId; w.courseId[t.i] = t.courseId;
    const x = t.i % w.size, y = Math.floor(t.i / w.size);
    w.markDirty(x, y);
    w.markDirty(Math.min(w.size - 1, x + 1), y); w.markDirty(x, Math.min(w.size - 1, y + 1));
    w.markDirty(Math.max(0, x - 1), y); w.markDirty(x, Math.max(0, y - 1));
  }
  g.soilStockpileM3 = Math.max(0, g.soilStockpileM3 - s.stockpileDelta);
  if (s.cost > 0) g.ledger.earn(s.cost, s.cat, g.day);
  s.extra?.(g);
  clearStroke(g);
  g.events.emit('edit', { tiles: s.tiles.map(t => t.i) });
  return ok(s);
}
