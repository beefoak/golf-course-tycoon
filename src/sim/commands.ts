import { Vec2 } from '../core/geom';
import { Surface } from './world/tiles';
import type { TerrainOp } from './construction/terrain';
import type { CourseCommand } from './course/courseCommands';
import type { PenInput } from './course/pen';
import type { SandType } from './construction/hazards';
import type { PathTier, StructureKind } from './construction/paths';
import type { GrowMethod } from './course/lifecycle';

/** Every change to the sim goes through Game.dispatch(command). Later tasks add members. */
export type Command =
  | { t: 'buyParcel'; px: number; py: number }
  | { t: 'sellParcel'; px: number; py: number }
  | { t: 'paint'; tiles: Vec2[]; surface: Surface }
  | { t: 'terrain'; tiles: Vec2[]; op: TerrainOp }
  | { t: 'shapeGreen'; holeId: number; tiles: Vec2[]; op: TerrainOp }
  | { t: 'penHole'; input: PenInput }
  | { t: 'bunker'; tiles: Vec2[]; sand: SandType }
  | { t: 'digWater'; tiles: Vec2[] }
  | { t: 'fillWater'; tiles: Vec2[] }
  | { t: 'plantTrees'; tiles: Vec2[]; species: number; density: number }
  | { t: 'removeTrees'; tiles: Vec2[] }
  | { t: 'path'; tiles: Vec2[]; tier: PathTier }
  | { t: 'bridge'; tiles: Vec2[] }
  | { t: 'placeStructure'; kind: StructureKind; at: Vec2 }
  | { t: 'refreshStakes'; holeId: number }
  | { t: 'setStakeOverride'; holeId: number; kind: 'ob' | 'red' | 'yellow'; at: Vec2 }
  | { t: 'startGrowIn'; holeId: number; method: GrowMethod }
  | { t: 'closeHole'; holeId: number }
  | { t: 'reopenHole'; holeId: number; method?: GrowMethod }
  | CourseCommand;
