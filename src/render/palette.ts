import { Surface, Feature } from '../sim/world/tiles';
import { TerrainType } from '../sim/world/terrainTypes';

type SurfacePalette = Record<Surface, number>;

const BASE: SurfacePalette = {
  [Surface.Natural]: 0x5f8f3e,
  [Surface.Tee]: 0x7cc251,
  [Surface.Fairway]: 0x6fb848,
  [Surface.Green]: 0x86d65a,
  [Surface.Fringe]: 0x78c04f,
  [Surface.FirstCut]: 0x65a843,
  [Surface.Rough]: 0x55923a,
  [Surface.DeepRough]: 0x4a7f33,
  [Surface.Native]: 0x9a9a52,
  [Surface.Bunker]: 0xe8d9a0,
  [Surface.Waste]: 0xcdb984,
  [Surface.Water]: 0x3a78c2,
  [Surface.Path]: 0x9e9a8e,
  [Surface.Building]: 0x9a5b3c,
};

export const PALETTES: Record<TerrainType, SurfacePalette> = {
  parkland: BASE,
  links: { ...BASE, [Surface.Natural]: 0x8a9a55, [Surface.Native]: 0xb0a868, [Surface.Water]: 0x3a6ea8 },
  desert: { ...BASE, [Surface.Natural]: 0xb59e6a, [Surface.Waste]: 0xd2b98a, [Surface.Native]: 0xa98f5a },
  mountain: { ...BASE, [Surface.Natural]: 0x557f3a, [Surface.Water]: 0x2f6aa8 },
};

export const FEATURE_COLORS: Partial<Record<Feature, number>> = {
  [Feature.Rock]: 0x8a8580,
  [Feature.Wetland]: 0x4f7a5a,
  [Feature.Road]: 0x45464a,
  [Feature.Neighbor]: 0xa0a080,
};

/** Canopy colour per tree species id (index = species). */
export const TREE_COLORS: number[] = [0, 0x2f6b2a, 0x3d7d2c, 0x5c8c3a, 0x1f5a35, 0x1c4d33, 0x3f8a3a, 0x6b7a3a, 0x2a5e3c, 0x4d8a46];

export const UI_COLORS = { flag: 0xe23b3b, teeMarker: 0xffffff, ob: 0xffffff, red: 0xe23b3b, yellow: 0xf0d030 };
