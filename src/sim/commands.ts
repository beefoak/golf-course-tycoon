import { Vec2 } from '../core/geom';
import { Surface } from './world/tiles';
import type { TerrainOp } from './construction/terrain';
import type { CourseCommand } from './course/courseCommands';

/** Every change to the sim goes through Game.dispatch(command). Later tasks add members. */
export type Command =
  | { t: 'buyParcel'; px: number; py: number }
  | { t: 'sellParcel'; px: number; py: number }
  | { t: 'paint'; tiles: Vec2[]; surface: Surface }
  | { t: 'terrain'; tiles: Vec2[]; op: TerrainOp }
  | CourseCommand;
