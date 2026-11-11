import { Vec2 } from '../../core/geom';
import { SandType, planBunker, planDigWater, planFillWater, planRemoveTrees, planTrees } from '../../sim/construction/hazards';
import { Command } from '../../sim/commands';
import { Game } from '../../sim/game';
import { TERRAINS, TREE } from '../../sim/world/terrainTypes';
import { h } from '../dom';
import { brushTool, choice } from './brush';

type Mode = 'bunker' | 'dig' | 'fill' | 'plant' | 'remove';
const TREE_NAME = Object.fromEntries(Object.entries(TREE).map(([k, v]) => [v, k])) as Record<number, string>;
const COLORS: Record<Mode, number> = { bunker: 0xf0e0a0, dig: 0x3a7ad8, fill: 0x8a6a40, plant: 0x2f6b2a, remove: 0xd84a3a };

export function hazardTool(g: Game) {
  let mode: Mode = 'bunker';
  let sand: SandType = 'standard';
  const speciesList: number[] = [...TERRAINS[g.terrain].treeSpecies];
  let species = speciesList[0]!;
  let density = 0.5;
  const plan = (tiles: Vec2[]) => {
    switch (mode) {
      case 'bunker': return planBunker(g, tiles, sand);
      case 'dig': return planDigWater(g, tiles);
      case 'fill': return planFillWater(g, tiles);
      case 'plant': return planTrees(g, tiles, species, density);
      case 'remove': return planRemoveTrees(g, tiles);
    }
  };
  const command = (tiles: Vec2[]): Command => {
    switch (mode) {
      case 'bunker': return { t: 'bunker', tiles, sand };
      case 'dig': return { t: 'digWater', tiles };
      case 'fill': return { t: 'fillWater', tiles };
      case 'plant': return { t: 'plantTrees', tiles, species, density };
      case 'remove': return { t: 'removeTrees', tiles };
    }
  };
  const tool = brushTool(g, {
    id: 'hazard', label: 'Hazards', color: () => COLORS[mode], radius: 2,
    stateKey: () => `${mode}:${sand}:${species}:${density}`,
    plan, command,
    options: () => h('div', null,
      choice('Mode', [
        { value: 'bunker', text: 'Bunker' }, { value: 'dig', text: 'Dig water' }, { value: 'fill', text: 'Fill water' },
        { value: 'plant', text: 'Plant trees' }, { value: 'remove', text: 'Remove trees' },
      ] as { value: Mode; text: string }[], () => mode, v => { mode = v; tool.refreshPanel(); }),
      mode === 'bunker' ? choice('Sand', [{ value: 'standard', text: 'Standard' }, { value: 'premium', text: 'Premium' }, { value: 'native', text: 'Native' }] as { value: SandType; text: string }[], () => sand, v => { sand = v; }) : null,
      mode === 'plant' ? choice('Species', speciesList.map(s => ({ value: s, text: TREE_NAME[s] ?? `#${s}` })), () => species, v => { species = v; }) : null,
      mode === 'plant' ? choice('Density', [0.2, 0.5, 0.8, 1].map(v => ({ value: v, text: `${v * 100}%` })), () => density, v => { density = v; }) : null),
  });
  return tool;
}
