import type { Game } from '../game';

/** Green speed (Stimp feet) for a hole. Constant until maintenance (Task 25) drives it. */
export function greenStimp(_g: Game, _holeId: number): number {
  return 10;
}
