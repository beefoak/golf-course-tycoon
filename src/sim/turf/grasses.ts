import type { Season } from '../clock';
import { Surface } from '../world/tiles';
import type { ClimateId } from '../world/terrainTypes';

export enum Grass { None, Bent, PoaAnnua, Bermuda, Zoysia, Ryegrass, Bluegrass, FineFescue, Paspalum }

export interface GrassSpec {
  name: string;
  /** 0..1 how well it does in each climate */
  climateFit: Record<ClimateId, number>;
  /** mowing below this stresses the plant */
  minMowMm: number;
  /** 0.5..1.3 multiplier on wear recovery */
  wearTolerance: number;
  /** 0..1 relative water demand */
  waterNeed: number;
  /** 0..1 relative disease susceptibility */
  diseaseRisk: number;
  seedCostPerTile: number;
  sodCostPerTile: number;
  /** green speed (feet) at 3 mm on a healthy, dry-ish green */
  baseStimpAt3mm: number;
  /** cool- or warm-season grass (drives seasonal growth) */
  warm: boolean;
}

const fit = (temperate: number, maritime: number, arid: number, alpine: number): Record<ClimateId, number> => ({ temperate, maritime, arid, alpine });

export const GRASSES: Record<Exclude<Grass, Grass.None>, GrassSpec> = {
  [Grass.Bent]: { name: 'Creeping bentgrass', climateFit: fit(0.9, 0.85, 0.35, 0.8), minMowMm: 2.5, wearTolerance: 0.7, waterNeed: 0.8, diseaseRisk: 0.7, seedCostPerTile: 3, sodCostPerTile: 16, baseStimpAt3mm: 11, warm: false },
  [Grass.PoaAnnua]: { name: 'Poa annua', climateFit: fit(0.75, 0.9, 0.2, 0.6), minMowMm: 2.8, wearTolerance: 0.6, waterNeed: 0.9, diseaseRisk: 0.9, seedCostPerTile: 1, sodCostPerTile: 10, baseStimpAt3mm: 10.5, warm: false },
  [Grass.Bermuda]: { name: 'Bermudagrass', climateFit: fit(0.55, 0.3, 0.95, 0.15), minMowMm: 3.0, wearTolerance: 1.3, waterNeed: 0.5, diseaseRisk: 0.3, seedCostPerTile: 2, sodCostPerTile: 12, baseStimpAt3mm: 10, warm: true },
  [Grass.Zoysia]: { name: 'Zoysia', climateFit: fit(0.65, 0.4, 0.85, 0.2), minMowMm: 6, wearTolerance: 1.2, waterNeed: 0.45, diseaseRisk: 0.25, seedCostPerTile: 3, sodCostPerTile: 14, baseStimpAt3mm: 9.5, warm: true },
  [Grass.Ryegrass]: { name: 'Perennial ryegrass', climateFit: fit(0.9, 0.85, 0.4, 0.7), minMowMm: 6, wearTolerance: 1.0, waterNeed: 0.7, diseaseRisk: 0.5, seedCostPerTile: 1, sodCostPerTile: 9, baseStimpAt3mm: 9.5, warm: false },
  [Grass.Bluegrass]: { name: 'Kentucky bluegrass', climateFit: fit(0.85, 0.75, 0.3, 0.9), minMowMm: 10, wearTolerance: 0.9, waterNeed: 0.75, diseaseRisk: 0.45, seedCostPerTile: 1, sodCostPerTile: 8, baseStimpAt3mm: 9, warm: false },
  [Grass.FineFescue]: { name: 'Fine fescue', climateFit: fit(0.75, 0.95, 0.3, 0.85), minMowMm: 5, wearTolerance: 0.8, waterNeed: 0.35, diseaseRisk: 0.3, seedCostPerTile: 1, sodCostPerTile: 9, baseStimpAt3mm: 9, warm: false },
  [Grass.Paspalum]: { name: 'Seashore paspalum', climateFit: fit(0.45, 0.6, 0.9, 0.1), minMowMm: 3.0, wearTolerance: 1.1, waterNeed: 0.55, diseaseRisk: 0.35, seedCostPerTile: 3, sodCostPerTile: 15, baseStimpAt3mm: 10, warm: true },
};

export function grassSpec(gr: Grass): GrassSpec | null {
  return gr === Grass.None ? null : GRASSES[gr];
}

export const GRASS_LIST = Object.keys(GRASSES).map(Number) as Exclude<Grass, Grass.None>[];

/** Growth in mm/day: warm-season grasses peak in summer, cool-season in spring/autumn; sick turf grows less. */
export function growthMmPerDay(gr: Grass, season: Season, health: number): number {
  const s = grassSpec(gr);
  if (!s) return 0;
  return seasonalGrowth(s, season) * (0.3 + 0.7 * health / 100);
}

const WARM_SEASON: Record<Season, number> = { spring: 0.7, summer: 1, autumn: 0.5, winter: 0.05 };
const COOL_SEASON: Record<Season, number> = { spring: 1, summer: 0.6, autumn: 0.8, winter: 0.15 };
/** Peak growth (mm/day) of healthy turf this season. */
export function seasonalGrowth(s: GrassSpec, season: Season): number {
  return 2 * (s.warm ? WARM_SEASON : COOL_SEASON)[season];
}

/** What the map-maker sows on a newly built turf tile in each climate. */
export function defaultGrass(climate: ClimateId, s: Surface): Grass {
  const green = s === Surface.Green || s === Surface.Fringe;
  switch (climate) {
    case 'arid': return green ? Grass.Paspalum : Grass.Bermuda;
    case 'maritime': return green ? Grass.Bent : Grass.FineFescue;
    case 'alpine': return green ? Grass.Bent : Grass.Bluegrass;
    default:
      if (green) return Grass.Bent;
      return s === Surface.Rough || s === Surface.DeepRough || s === Surface.FirstCut ? Grass.Bluegrass : Grass.Ryegrass;
  }
}
