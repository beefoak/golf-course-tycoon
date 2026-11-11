export enum Surface { Natural, Tee, Fairway, Green, Fringe, FirstCut, Rough, DeepRough, Native, Bunker, Waste, Water, Path, Building }
export enum Feature { None, Rock, Creek, Wetland, SpecimenTree, Road, Neighbor }

const PLAYABLE = new Set<Surface>([Surface.Tee, Surface.Fairway, Surface.Green, Surface.Fringe, Surface.FirstCut, Surface.Rough, Surface.DeepRough, Surface.Native, Surface.Bunker, Surface.Waste, Surface.Natural]);
export function isPlayableSurface(s: Surface): boolean { return PLAYABLE.has(s); }
/** Turf surfaces that grow grass and are maintained. */
export function isTurfSurface(s: Surface): boolean {
  return s === Surface.Tee || s === Surface.Fairway || s === Surface.Green || s === Surface.Fringe || s === Surface.FirstCut || s === Surface.Rough || s === Surface.DeepRough;
}
/** Can golfers/staff walk on this tile? Bridges are Path tiles over creeks. */
export function isWalkable(w: { size: number; surface: Uint8Array; feature: Uint8Array }, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= w.size || y >= w.size) return false;
  const i = y * w.size + x;
  if (w.surface[i] === Surface.Water) return false;
  const f = w.feature[i] as Feature;
  return f !== Feature.Rock && f !== Feature.Wetland && f !== Feature.Neighbor && f !== Feature.Road;
}

export function isBlockingFeature(f: Feature): boolean {
  return f === Feature.Rock || f === Feature.Creek || f === Feature.Wetland || f === Feature.Road || f === Feature.Neighbor;
}
