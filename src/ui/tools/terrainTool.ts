import { Vec2 } from '../../core/geom';
import { TerrainOp, planTerrain } from '../../sim/construction/terrain';
import { Game } from '../../sim/game';
import { h } from '../dom';
import { brushTool, choice } from './brush';

export type TerrainMode = 'raise' | 'lower' | 'smooth' | 'flatten';

/** Shared terrain op builder (also used by the green tool). */
export function terrainOp(g: Game, mode: TerrainMode, amount: number, start: Vec2): TerrainOp {
  if (mode === 'smooth') return { op: 'smooth', strength: 0.6 };
  if (mode === 'flatten') return { op: 'flatten', targetM: g.world.elevation[g.world.idx(start.x, start.y)]! };
  return { op: mode, amountM: amount };
}

export const TERRAIN_MODES: { value: TerrainMode; text: string }[] = [
  { value: 'raise', text: 'Raise' }, { value: 'lower', text: 'Lower' }, { value: 'smooth', text: 'Smooth' }, { value: 'flatten', text: 'Flatten' },
];

export function terrainTool(g: Game) {
  let mode: TerrainMode = 'raise';
  let amount = 0.5;
  return brushTool(g, {
    id: 'terrain', label: 'Terrain', color: 0xd8b070, radius: 3,
    stateKey: () => `${mode}:${amount}`,
    plan: (tiles, start) => planTerrain(g, tiles, terrainOp(g, mode, amount, start)),
    command: (tiles, start) => ({ t: 'terrain', tiles, op: terrainOp(g, mode, amount, start) }),
    options: () => h('div', null,
      choice('Operation', TERRAIN_MODES, () => mode, v => { mode = v; }),
      choice('Amount per stroke', [0.25, 0.5, 1, 2].map(v => ({ value: v, text: `${v} m` })), () => amount, v => { amount = v; }),
      h('div', { class: 'muted' }, 'Flatten levels to the height where the stroke starts. Cut soil goes to the stockpile; fill uses it before importing.')),
  });
}
