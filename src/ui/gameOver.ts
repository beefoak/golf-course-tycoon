import { Game } from '../sim/game';
import { MILESTONE_KEYS, MILESTONES } from '../sim/rating/milestones';
import { regionalRanking } from '../sim/rating/rivals';
import { statementFor } from '../sim/economy/reports';
import { h, money } from './dom';

/** Career over: a summary of how it went, and a way to start again. */
export function showGameOver(root: HTMLElement, g: Game, reason: string, onNewGame: () => void): void {
  const open = Math.max(0, ...g.courses.list.map(c => c.holes.filter(x => x.state === 'open').length));
  const ranking = regionalRanking(g);
  const best = ranking.findIndex(r => r.isPlayer);
  const all = statementFor(g, null, 1, g.day);
  const reached = MILESTONE_KEYS.filter(k => g.milestones[k] !== undefined);
  const row = (k: string, v: string) => h('div', { class: 'row' }, h('span', { class: 'muted' }, k), h('span', null, v));
  const back = h('div', { class: 'modal-back' });
  back.appendChild(h('div', { class: 'panel modal' },
    h('h1', null, 'Game over'),
    h('div', { class: 'warnline' }, reason),
    row('Days played', String(g.day)),
    row('Holes open', String(open)),
    row('Golf revenue, all time', money(all.totalRevenue)),
    row('Best regional rank', best >= 0 ? `#${best + 1} of ${ranking.length}` : '—'),
    row('Milestones', reached.length ? reached.map(k => MILESTONES[k].label).join(', ') : 'none'),
    h('div', { class: 'actions' }, h('button', { class: 'btn on', onclick: () => { back.remove(); onNewGame(); } }, 'New game'))));
  root.appendChild(back);
}
