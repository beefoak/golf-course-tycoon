import { BUILDING_DEFS, BuildingKind, buildingLocked, clubhouseOf, maxGroupsPerDay, parkingCapacity } from '../../sim/business/buildings';
import { Game } from '../../sim/game';
import { h, money } from '../dom';
import { buildingPlacer } from '../tools/clubhouseTool';
import { Tool } from '../tools/tool';

const AMENITIES: BuildingKind[] = ['proShop', 'parking', 'practiceGreen', 'range', 'halfwayHouse', 'restaurant', 'cartBarn', 'lodging'];

/** Amenities: pick a building, click the map to place it; clubhouse tier and parking at a glance. */
export function amenityTool(g: Game): Tool {
  let kind: BuildingKind = 'proShop';
  const courseId = () => g.courses.list[0]?.id ?? 0;
  const box = h('div');
  const refresh = () => box.replaceChildren(base.panel!()!);
  const header = () => {
    const cid = courseId();
    const club = clubhouseOf(g, cid);
    const nextCost = club ? BUILDING_DEFS.clubhouse.cost[club.tier] : undefined;
    return h('div', null,
      h('h3', null, 'Amenities'),
      h('div', { style: 'display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px' }, ...AMENITIES.map(k => {
        const locked = buildingLocked(g, k, cid);
        return h('button', { class: `btn${k === kind ? ' on' : ''}`, title: locked ?? BUILDING_DEFS[k].label, style: locked ? 'opacity:0.55' : '', onclick: () => { kind = k; refresh(); } }, BUILDING_DEFS[k].label);
      })),
      club ? h('div', { class: 'row' }, h('span', { class: 'muted' }, `Clubhouse tier ${club.tier}`),
        nextCost !== undefined
          ? h('button', { class: 'btn', onclick: () => { const r = g.dispatch({ t: 'upgradeTier', buildingId: club.id }); g.notify(r.ok ? 'info' : 'warn', r.ok ? `Clubhouse upgraded to tier ${club.tier}` : r.reason); refresh(); } }, `Upgrade ${money(nextCost)}`)
          : h('span', { class: 'muted' }, 'top tier')) : null,
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Parking'), h('span', null, `${parkingCapacity(g, cid)} cars · up to ${maxGroupsPerDay(g, cid)} groups/day`)),
      h('h3', { style: 'margin-top:8px' }, BUILDING_DEFS[kind].label));
  };
  const base = buildingPlacer(g, () => kind, 'amenities', 'Amenities', header);
  return { ...base, panel: () => { refresh(); return box; } };
}
