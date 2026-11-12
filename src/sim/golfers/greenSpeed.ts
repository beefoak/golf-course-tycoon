import type { Game } from '../game';
import { greenStimpFromTurf } from '../turf/turf';

/** game → holeId → [tick, stimp]: a rolling ball asks every step, the turf only changes between ticks */
const cache = new WeakMap<Game, Map<number, [number, number]>>();

/** Green speed (Stimp feet) for a hole, from the turf on its green (10 if it has no grass yet). */
export function greenStimp(g: Game, holeId: number): number {
  let m = cache.get(g);
  if (!m) { m = new Map(); cache.set(g, m); }
  const tick = g.clock.tick;
  const c = m.get(holeId);
  if (c && c[0] === tick) return c[1];
  const v = greenStimpFromTurf(g, holeId);
  m.set(holeId, [tick, v]);
  return v;
}
