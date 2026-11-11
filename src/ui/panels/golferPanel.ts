import { Game } from '../../sim/game';
import { formatHandicap } from '../../sim/golfers/golfer';
import { groupOf } from '../../sim/golfers/positions';
import { thoughtText } from '../../sim/golfers/thoughts';
import { holePar } from '../../sim/course/yardage';
import { h, money } from '../dom';

const TRAIT_LABEL = { pace: 'Pace', challenge: 'Challenge', aesthetics: 'Scenery', loyalty: 'Loyalty', social: 'Social', gear: 'Gear', food: 'Food & drink' } as const;
const PHASE_LABEL: Record<string, string> = {
  toTee: 'Heading to the 1st tee', teeing: 'Teeing off', walkingToBall: 'Walking to the ball', addressing: 'Lining up a shot',
  putting: 'Putting', holedOut: 'Holed out', toNextTee: 'Walking to the next tee', toClubhouse: 'Heading in', done: 'Finished',
};

/** Inspector body for one golfer: profile, traits, live scorecard and thoughts. */
export function golferPanel(g: Game, golferId: number, onFollow: () => void, following: boolean): HTMLElement {
  const p = g.golfers.all.get(golferId);
  if (!p) return h('div', { class: 'muted' }, 'Golfer has left.');
  const grp = groupOf(g, golferId);
  const bar = (v: number) => h('span', { style: 'display:inline-block;width:110px;height:8px;background:var(--panel-2);border:1px solid var(--line);vertical-align:middle' },
    h('span', { style: `display:block;height:100%;width:${Math.round(v * 100)}%;background:var(--accent)` }));

  let card: HTMLElement | null = null;
  if (grp) {
    const cards = grp.scores.get(golferId) ?? [];
    const cur = grp.balls.get(golferId);
    const rows = grp.holeOrder.map((hid, i) => {
      const hole = g.courses.hole(hid);
      const done = cards[i];
      const live = !done && cur && cur.holeId === hid ? cur.strokes : null;
      const par = hole ? holePar(hole) : 0;
      const score = done ? (done.pickedUp ? `${done.strokes}*` : String(done.strokes)) : live !== null ? `(${live})` : '';
      const color = done ? (done.strokes < par ? 'color:#ff6b6b' : done.strokes > par ? 'color:#8fb0ff' : '') : 'color:var(--muted)';
      return h('tr', null, h('td', null, `#${hole?.number ?? i + 1}`), h('td', null, String(par)), h('td', { style: color }, score), h('td', { class: 'muted' }, done ? `${done.putts}p` : ''));
    });
    const total = cards.reduce((s, c) => s + c.strokes, 0);
    const parSoFar = cards.reduce((s, c) => s + (g.courses.hole(c.holeId) ? holePar(g.courses.hole(c.holeId)!) : 0), 0);
    card = h('div', null,
      h('label', null, `Scorecard — ${PHASE_LABEL[grp.phase] ?? grp.phase}${grp.waitingMin >= 1 ? ` · waited ${Math.round(grp.waitingMin)} min` : ''}`),
      h('table', { class: 'grid' }, h('tr', null, h('th', null, 'Hole'), h('th', null, 'Par'), h('th', null, 'Score'), h('th', null, '')), ...rows),
      cards.length ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Total'), h('span', null, `${total} (${total - parSoFar >= 0 ? '+' : ''}${total - parSoFar})`)) : null);
  }
  const thoughts = g.thoughts.filter(t => t.golferId === golferId).slice(-8).reverse();
  return h('div', null,
    h('h3', null, p.name),
    h('div', { class: 'muted' }, `${p.age} · ${p.home} · ${p.type} · ${p.segment}`),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Handicap'), h('span', null, formatHandicap(p.handicap))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Visits'), h('span', null, String(p.visits))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Total spend'), h('span', null, money(p.totalSpend))),
    p.lastSatisfaction !== undefined ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Last round'), h('span', null, `${Math.round(p.lastSatisfaction)}/100`)) : null,
    grp ? h('button', { class: `btn${following ? ' on' : ''}`, style: 'margin:6px 0', onclick: onFollow }, following ? 'Following (click to stop)' : 'Follow') : null,
    card,
    h('label', null, 'Traits'),
    ...(Object.keys(TRAIT_LABEL) as (keyof typeof TRAIT_LABEL)[]).map(k => h('div', { class: 'row' }, h('span', { class: 'muted' }, TRAIT_LABEL[k]), bar(p.traits[k]))),
    h('label', null, 'Thoughts'),
    thoughts.length
      ? h('div', null, ...thoughts.map(t => h('div', { style: `color:${t.mood > 0 ? 'var(--accent)' : t.mood < 0 ? 'var(--warn)' : 'var(--text)'}` }, `“${thoughtText(t)}”`)))
      : h('div', { class: 'muted' }, 'Nothing yet.'),
  );
}
