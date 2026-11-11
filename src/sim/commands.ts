import { Vec2 } from '../core/geom';
import { Surface } from './world/tiles';

/** Every change to the sim goes through Game.dispatch(command). Later tasks add members. */
export type Command =
  | { t: 'buyParcel'; px: number; py: number }
  | { t: 'sellParcel'; px: number; py: number }
  | { t: 'paint'; tiles: Vec2[]; surface: Surface };
