import { Game } from '../src/sim/game';
import { Feature, Surface } from '../src/sim/world/tiles';

/** 100×100 game, normal difficulty, parcels (0,0) and (1,0) owned, whole map flattened and cleared. */
export function newOwnedGame(opts: { size?: number; parcels?: [number, number][] } = {}): Game {
  const g = Game.create({ seed: 1, terrain: 'parkland', difficulty: 'normal', size: opts.size ?? 100 });
  clearWorld(g);
  for (const [px, py] of opts.parcels ?? [[0, 0], [1, 0]]) g.parcels.owner[py * g.parcels.perSide + px] = 1;
  g.ledger.cash = 3_000_000;
  return g;
}

export function clearWorld(g: Game): void {
  const w = g.world;
  w.elevation.fill(10);
  w.surface.fill(Surface.Natural);
  w.feature.fill(Feature.None);
  w.treeSpecies.fill(0);
}

export function countSurface(g: Game, s: Surface): number {
  let n = 0;
  for (const v of g.world.surface) if (v === s) n++;
  return n;
}
