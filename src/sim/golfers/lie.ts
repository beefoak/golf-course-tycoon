import { Vec2 } from '../../core/geom';
import { World } from '../world/world';
import { Surface } from '../world/tiles';
import { ClubId } from './clubs';

export type Lie = 'tee' | 'fairway' | 'fringe' | 'firstCut' | 'rough' | 'deepRough' | 'native' | 'bunker' | 'waste' | 'green' | 'trees' | 'path';

export const LIE_EFFECT: Record<Lie, { distMult: number; angleMult: number; maxClub?: ClubId }> = {
  tee: { distMult: 1, angleMult: 1 },
  fairway: { distMult: 1, angleMult: 1, maxClub: '3W' },
  fringe: { distMult: 1, angleMult: 1, maxClub: '3W' },
  firstCut: { distMult: 0.95, angleMult: 1.1, maxClub: '3W' },
  rough: { distMult: 0.85, angleMult: 1.3, maxClub: '5W' },
  deepRough: { distMult: 0.6, angleMult: 1.8, maxClub: '7I' },
  native: { distMult: 0.7, angleMult: 1.6, maxClub: '7I' },
  bunker: { distMult: 0.7, angleMult: 1.5, maxClub: 'PW' },
  waste: { distMult: 0.9, angleMult: 1.2, maxClub: '5I' },
  green: { distMult: 1, angleMult: 1 },
  trees: { distMult: 0.5, angleMult: 2, maxClub: '7I' },
  path: { distMult: 0.95, angleMult: 1.1, maxClub: '5W' },
};

const SURFACE_LIE: Record<Surface, Lie> = {
  [Surface.Natural]: 'rough', [Surface.Tee]: 'tee', [Surface.Fairway]: 'fairway', [Surface.Green]: 'green',
  [Surface.Fringe]: 'fringe', [Surface.FirstCut]: 'firstCut', [Surface.Rough]: 'rough', [Surface.DeepRough]: 'deepRough',
  [Surface.Native]: 'native', [Surface.Bunker]: 'bunker', [Surface.Waste]: 'waste', [Surface.Water]: 'rough',
  [Surface.Path]: 'path', [Surface.Building]: 'path',
};

export function lieAt(w: World, p: Vec2): Lie {
  const x = Math.floor(p.x), y = Math.floor(p.y);
  if (!w.inBounds(x, y)) return 'rough';
  const i = w.idx(x, y);
  if (w.treeSpecies[i]) return 'trees';
  return SURFACE_LIE[w.surface[i] as Surface];
}
