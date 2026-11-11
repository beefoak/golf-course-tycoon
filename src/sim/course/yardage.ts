import { Vec2, dist } from '../../core/geom';
import { tilesToYards } from '../../core/units';
import { Hole, TeeKind } from './course';

export function routeLengthTiles(route: Vec2[]): number {
  let d = 0;
  for (let i = 1; i < route.length; i++) d += dist(route[i - 1]!, route[i]!);
  return d;
}

/** Yards from a tee box through the route's waypoints to the green centre. */
export function teeYards(h: Hole, kind: TeeKind): number {
  const tee = h.teeBoxes.find(t => t.kind === kind);
  if (!tee) return 0;
  return tilesToYards(routeLengthTiles([tee.center, ...h.route.slice(1, -1), h.greenCenter]));
}

export function suggestPar(yards: number): 3 | 4 | 5 {
  return yards <= 250 ? 3 : yards <= 470 ? 4 : 5;
}

/** Longest playing length; falls back to the drawn route when no tee boxes exist. */
export function longestYards(h: Hole): number {
  if (h.teeBoxes.length === 0) return tilesToYards(routeLengthTiles([...h.route.slice(0, -1), h.greenCenter]));
  return Math.max(...h.teeBoxes.map(t => teeYards(h, t.kind)));
}

export function holePar(h: Hole): number {
  return h.parOverride ?? suggestPar(longestYards(h));
}
