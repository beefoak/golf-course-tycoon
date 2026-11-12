import { Surface } from '../world/tiles';

/** Construction prices per tile (a tile is 4 m²) unless stated. Rebalanced in Task 45: see docs/balance-notes.md. */
export const COSTS = {
  surface: {
    [Surface.Natural]: 2,
    [Surface.Tee]: 60,
    [Surface.Fairway]: 14,
    [Surface.Green]: 180,
    [Surface.Fringe]: 60,
    [Surface.FirstCut]: 8,
    [Surface.Rough]: 3,
    [Surface.DeepRough]: 4,
    [Surface.Native]: 3,
    [Surface.Bunker]: 120,
    [Surface.Waste]: 30,
    [Surface.Water]: 0,
    [Surface.Path]: 0,
    [Surface.Building]: 0,
  } as Record<Surface, number>,
  cutPerM3: 6,
  fillFromStockPerM3: 4,
  importFillPerM3: 22,
  treePlantDefault: 350,
  treeRemove: 40,
  specimenRemove: 12_000,
  digWaterPerM3: 9,
  pondLinerPerTile: 30,
  fillWaterPerM3: 40,
};

/** Surfaces the paint brush may lay down (others have their own tools). */
export const PAINTABLE: ReadonlySet<Surface> = new Set([
  Surface.Natural, Surface.Tee, Surface.Fairway, Surface.Green, Surface.Fringe, Surface.FirstCut,
  Surface.Rough, Surface.DeepRough, Surface.Native, Surface.Bunker, Surface.Waste,
]);
