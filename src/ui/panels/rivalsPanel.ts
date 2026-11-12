import { Game } from '../../sim/game';
import { regionalRanking, rivalsOf } from '../../sim/rating/rivals';
import { h, money } from '../dom';
import { PanelTool, panelTool } from '../tools/panelTool';

/** The region's courses ranked, and what each rival is up to. */
export function rivalsTool(g: Game): PanelTool {
  return panelTool(g, 'rivals', 'Rivals', () => {
    const rows = regionalRanking(g);
    const rivals = new Map(rivalsOf(g).map(r => [r.name, r]));
    return h('div', null,
      h('h3', null, 'Regional ranking'),
      h('table', { class: 'grid' },
        h('tr', null, h('th', null, '#'), h('th', null, 'Course'), h('th', null, '★'), h('th', null, 'Holes'), h('th', null, 'Fee/18')),
        ...rows.map((r, k) => {
          const rv = rivals.get(r.name);
          const reno = rv?.renovatingUntil !== undefined && rv.renovatingUntil > g.day;
          return h('tr', { style: r.isPlayer ? 'color:var(--accent);font-weight:bold' : '' },
            h('td', null, String(k + 1)),
            h('td', { title: rv ? `${rv.style}${rv.trend > 0.02 ? ', on the up' : rv.trend < -0.02 ? ', slipping' : ''}` : 'Yours' }, `${r.name}${reno ? ' (renovating)' : ''}`),
            h('td', null, r.reputation.toFixed(1)),
            h('td', null, String(r.holes)),
            h('td', null, money(r.fee)));
        })),
      h('div', { class: 'muted', style: 'margin-top:6px' }, 'Golfers weigh each course\'s reputation against its price — budget golfers chase cheap rounds, premium golfers chase stars. Rivals change their fees and renovate from time to time.'));
  }, 5000);
}
