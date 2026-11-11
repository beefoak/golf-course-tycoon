import { Surface } from './tiles';

export type TerrainType = 'parkland' | 'links' | 'desert' | 'mountain';
export type ClimateId = 'temperate' | 'maritime' | 'arid' | 'alpine';

export interface TerrainConfig {
  elevationAmpM: number;
  /** base noise frequency in cycles per tile */
  elevationFreq: number;
  pondCount: [number, number];
  creekCount: [number, number];
  rockDensity: number;
  treeDensity: number;
  wetlandDensity: number;
  specimenTreeCount: [number, number];
  treeSpecies: number[];
  climate: ClimateId;
  naturalSurface: Surface;
}

/** Tree species ids (0 = none). */
export const TREE = { Oak: 1, Maple: 2, Birch: 3, Pine: 4, Spruce: 5, Palm: 6, Mesquite: 7, Cypress: 8, Willow: 9 } as const;

/** Counts are per 1,000x1,000-tile map; generation scales them by area. */
export const TERRAINS: Record<TerrainType, TerrainConfig> = {
  parkland: { elevationAmpM: 25, elevationFreq: 1 / 300, pondCount: [6, 12], creekCount: [1, 2], rockDensity: 0.01, treeDensity: 0.35, wetlandDensity: 0.4, specimenTreeCount: [8, 16], treeSpecies: [TREE.Oak, TREE.Maple, TREE.Birch, TREE.Willow], climate: 'temperate', naturalSurface: Surface.Natural },
  links: { elevationAmpM: 12, elevationFreq: 1 / 60, pondCount: [2, 5], creekCount: [0, 1], rockDensity: 0.004, treeDensity: 0.05, wetlandDensity: 0.2, specimenTreeCount: [2, 5], treeSpecies: [TREE.Pine, TREE.Cypress], climate: 'maritime', naturalSurface: Surface.Natural },
  desert: { elevationAmpM: 15, elevationFreq: 1 / 250, pondCount: [1, 3], creekCount: [0, 1], rockDensity: 0.03, treeDensity: 0.04, wetlandDensity: 0, specimenTreeCount: [3, 6], treeSpecies: [TREE.Palm, TREE.Mesquite], climate: 'arid', naturalSurface: Surface.Waste },
  mountain: { elevationAmpM: 120, elevationFreq: 1 / 400, pondCount: [3, 7], creekCount: [2, 3], rockDensity: 0.04, treeDensity: 0.45, wetlandDensity: 0.15, specimenTreeCount: [6, 12], treeSpecies: [TREE.Pine, TREE.Spruce, TREE.Birch], climate: 'alpine', naturalSurface: Surface.Natural },
};
