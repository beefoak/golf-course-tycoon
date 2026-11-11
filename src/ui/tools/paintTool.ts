import { PAINTABLE } from '../../sim/construction/costs';
import { planSurfacePaint } from '../../sim/construction/paint';
import { Game } from '../../sim/game';
import { Surface } from '../../sim/world/tiles';
import { brushTool, choice } from './brush';

export const SURFACE_LABEL: Record<Surface, string> = {
  [Surface.Natural]: 'Natural', [Surface.Tee]: 'Tee', [Surface.Fairway]: 'Fairway', [Surface.Green]: 'Green',
  [Surface.Fringe]: 'Fringe', [Surface.FirstCut]: 'First cut', [Surface.Rough]: 'Rough', [Surface.DeepRough]: 'Deep rough',
  [Surface.Native]: 'Native', [Surface.Bunker]: 'Bunker', [Surface.Waste]: 'Waste', [Surface.Water]: 'Water',
  [Surface.Path]: 'Path', [Surface.Building]: 'Building',
};

export function paintTool(g: Game) {
  let surface = Surface.Fairway;
  return brushTool(g, {
    id: 'paint', label: 'Paint', color: 0x9be070, radius: 2,
    stateKey: () => String(surface),
    plan: tiles => planSurfacePaint(g, tiles, surface),
    command: tiles => ({ t: 'paint', tiles, surface }),
    options: () => choice('Surface', [...PAINTABLE].map(s => ({ value: s, text: SURFACE_LABEL[s] })), () => surface, v => { surface = v; }),
  });
}
