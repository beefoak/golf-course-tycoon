export enum Surface { Natural, Tee, Fairway, Green, Fringe, FirstCut, Rough, DeepRough, Native, Bunker, Waste, Water, Path, Building }
export enum Feature { None, Rock, Creek, Wetland, SpecimenTree, Road, Neighbor }

const PLAYABLE = new Set<Surface>([Surface.Tee, Surface.Fairway, Surface.Green, Surface.Fringe, Surface.FirstCut, Surface.Rough, Surface.DeepRough, Surface.Native, Surface.Bunker, Surface.Waste, Surface.Natural]);
export function isPlayableSurface(s: Surface): boolean { return PLAYABLE.has(s); }
/** Turf surfaces that grow grass and are maintained. */
export function isTurfSurface(s: Surface): boolean {
  return s === Surface.Tee || s === Surface.Fairway || s === Surface.Green || s === Surface.Fringe || s === Surface.FirstCut || s === Surface.Rough || s === Surface.DeepRough;
}
export function isBlockingFeature(f: Feature): boolean {
  return f === Feature.Rock || f === Feature.Creek || f === Feature.Wetland || f === Feature.Road || f === Feature.Neighbor;
}
