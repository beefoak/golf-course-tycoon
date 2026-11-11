import { PathTier, STRUCTURE_COST, StructureKind, planBridge, planPath } from '../../sim/construction/paths';
import { emptyPlan } from '../../sim/construction/plan';
import { Game } from '../../sim/game';
import { money } from '../dom';
import { brushTool, choice } from './brush';

type Mode = PathTier | 'bridge';

export function pathTool(g: Game) {
  let mode: Mode = 'gravel';
  return brushTool(g, {
    id: 'path', label: 'Paths', color: 0xc8b898, radius: 1, maxRadius: 3, shape: 'square',
    stateKey: () => mode,
    plan: tiles => (mode === 'bridge' ? planBridge(g, tiles) : planPath(g, tiles, mode)),
    command: tiles => (mode === 'bridge' ? { t: 'bridge', tiles } : { t: 'path', tiles, tier: mode }),
    options: () => choice('Surface', [
      { value: 'gravel', text: 'Gravel' }, { value: 'asphalt', text: 'Asphalt' }, { value: 'concrete', text: 'Concrete' }, { value: 'bridge', text: 'Bridge' },
    ] as { value: Mode; text: string }[], () => mode, v => { mode = v; }),
  });
}

export const STRUCT_LABEL: Record<StructureKind, string> = { shelter: 'Shelter', restroom: 'Restroom', ballWasher: 'Ball washer', bench: 'Bench', drinkStation: 'Drink station' };

export function structureTool(g: Game) {
  let kind: StructureKind = 'bench';
  return brushTool(g, {
    id: 'structure', label: 'Structures', color: 0xffffff, radius: 0,
    plan: () => emptyPlan(),
    command: () => null,
    click: at => {
      const r = g.dispatch({ t: 'placeStructure', kind, at });
      g.notify(r.ok ? 'info' : 'warn', r.ok ? `${STRUCT_LABEL[kind]} placed (${money(STRUCTURE_COST[kind])})` : r.reason);
    },
    clickStatus: at => `${STRUCT_LABEL[kind]} · ${money(STRUCTURE_COST[kind])} · click to place at ${at.x},${at.y}`,
    options: () => choice('Structure', (Object.keys(STRUCT_LABEL) as StructureKind[]).map(k => ({ value: k, text: `${STRUCT_LABEL[k]} ${money(STRUCTURE_COST[k])}` })), () => kind, v => { kind = v; }),
  });
}
