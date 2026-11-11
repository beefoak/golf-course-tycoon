import type { Game } from '../game';
import { greenStimpFromTurf } from '../turf/turf';

/** Green speed (Stimp feet) for a hole, from the turf on its green (10 if it has no grass yet). */
export function greenStimp(g: Game, holeId: number): number {
  return greenStimpFromTurf(g, holeId);
}
