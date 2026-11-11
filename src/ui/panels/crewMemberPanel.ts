import { Game } from '../../sim/game';
import { staffActivity } from '../../sim/staff/agents';
import { EQUIPMENT } from '../../sim/staff/equipment';
import { ROLES } from '../../sim/staff/roles';
import { h, money } from '../dom';

/** Inspector body for one staff member clicked on the map: who, what they are doing, follow. */
export function crewMemberPanel(g: Game, staffId: number, onFollow: () => void, following: boolean): HTMLElement {
  const s = g.staff.get(staffId);
  if (!s) return h('div', { class: 'muted' }, 'No longer on staff.');
  const o = s.task !== null ? g.workOrders.all.find(x => x.id === s.task) : undefined;
  const e = s.equipmentId !== null ? g.equipment.all.find(x => x.id === s.equipmentId) : undefined;
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const row = (k: string, v: string) => h('div', { class: 'row' }, h('span', { class: 'muted' }, k), h('span', null, v));
  return h('div', null,
    h('h3', null, s.name),
    h('div', { class: 'muted' }, ROLES[s.role].name),
    row('Now', staffActivity(g, s)),
    o && o.tiles.length ? row('Progress', `${Math.round((o.progress / o.tiles.length) * 100)}%`) : null,
    e ? row('Machine', `${EQUIPMENT[e.kind].name} (tier ${e.tier}, ${Math.round(e.condition)}%)`) : null,
    row('Shift', `${hm(s.shift.startMin)}–${hm(s.shift.endMin)}`),
    row('Morale', `${Math.round(s.morale)}/100`),
    row('Fatigue', `${Math.round(s.fatigue)}/100`),
    row('Wage', `${money(s.wagePerDay)}/day`),
    h('button', { class: `btn${following ? ' on' : ''}`, style: 'margin:6px 0', onclick: onFollow }, following ? 'Following (click to stop)' : 'Follow'),
  );
}
