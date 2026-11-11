import { Surface } from '../world/tiles';

/** Construction prices (GDD §5, proposal values). Per tile unless stated. */
export const COSTS = {
  surface: {
    [Surface.Natural]: 5,
    [Surface.Tee]: 120,
    [Surface.Fairway]: 40,
    [Surface.Green]: 400,
    [Surface.Fringe]: 150,
    [Surface.FirstCut]: 25,
    [Surface.Rough]: 15,
    [Surface.DeepRough]: 10,
    [Surface.Native]: 8,
    [Surface.Bunker]: 250,
    [Surface.Waste]: 60,
    [Surface.Water]: 0,
    [Surface.Path]: 0,
    [Surface.Building]: 0,
  } as Record<Surface, number>,
  cutPerM3: 6,
  fillFromStockPerM3: 4,
  importFillPerM3: 22,
  treePlantDefault: 350,
  treeRemove: 400,
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
