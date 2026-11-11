import { Game } from '../../sim/game';
import { holePar } from '../../sim/course/yardage';
import { teeSheetFor } from '../../sim/golfers/demand';
import { greenFee, roundOptions } from '../../sim/golfers/teeSheet';
import { statsFor } from '../../sim/golfers/roundEffects';
import { clubhouseOf } from '../../sim/business/buildings';
import { h, money } from '../dom';

/** Course overview: green fees, today's tee sheet, per-hole scoring and pace. */
export function statsPanel(g: Game, courseId: number, refresh: () => void): HTMLElement {
  const course = g.courses.get(courseId);
  if (!course) return h('div', { class: 'muted' }, 'No course yet — draw a hole with the Fairway Pen.');
  const st = statsFor(g, courseId);
  const opts = roundOptions(course);
  const pricing = g.pricing.get(courseId);
  const sheet = teeSheetFor(g, courseId);
  const golfersToday = sheet.golfers.get(g.day) ?? 0;
  const onCourse = g.groups.filter(x => x.courseId === courseId && x.started && x.phase !== 'done').length;
  const fees = g.ledger.totals(Math.max(0, g.day - 6), g.day, courseId).greenFees.in;

  const feeRows = opts.map(len => {
    const input = h('input', { type: 'number', min: 0, max: 1000, step: 1, value: greenFee(pricing, len), style: 'width:70px;background:var(--panel-2);color:var(--text);border:2px solid var(--line);font:inherit;padding:2px',
      onchange: (e: Event) => {
        const r = g.dispatch({ t: 'setGreenFee', courseId, holes: len, fee: Number((e.target as HTMLInputElement).value) });
        if (!r.ok) g.notify('warn', r.reason);
        refresh();
      } });
    return h('div', { class: 'row' }, h('span', { class: 'muted' }, `${len}-hole green fee $`), input);
  });

  const holeRows = course.holes.slice().sort((a, b) => a.number - b.number).map(hole => {
    const n = st.playedCount(hole.id);
    const vs = st.holeAvgVsPar(hole.id);
    return h('tr', null,
      h('td', null, `#${hole.number}`),
      h('td', null, String(holePar(hole))),
      h('td', null, n ? st.holeAverage(hole.id).toFixed(2) : '—'),
      h('td', { style: n ? (vs > 0.8 ? 'color:var(--bad)' : vs < 0.2 ? 'color:var(--accent)' : '') : '' }, n ? `${vs >= 0 ? '+' : ''}${vs.toFixed(2)}` : ''),
      h('td', null, n ? `${Math.round(st.threePuttRate(hole.id) * 100)}%` : ''),
      h('td', null, st.holeMinutes(hole.id) ? `${Math.round(st.holeMinutes(hole.id))}m` : ''));
  });
  const hardest = st.hardestHoles(3).map(id => g.courses.hole(id)).filter(Boolean);
  const avgRound = st.avgRoundMinutes();

  return h('div', null,
    h('h3', null, course.name),
    !clubhouseOf(g, courseId) ? h('div', { class: 'warnline' }, 'No clubhouse yet — golfers won\'t come. Build one next to the road.') : null,
    !opts.length ? h('div', { class: 'warnline' }, 'No open holes yet.') : null,
    ...feeRows,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Booked today'), h('span', null, `${golfersToday} golfers`)),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Groups on course'), h('span', null, String(onCourse))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Green fees (7 days)'), h('span', null, money(fees))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Avg round'), h('span', null, avgRound ? `${Math.floor(avgRound / 60)}h ${Math.round(avgRound % 60)}m` : '—')),
    h('label', null, 'Scoring (last 28 days)'),
    h('table', { class: 'grid' }, h('tr', null, h('th', null, 'Hole'), h('th', null, 'Par'), h('th', null, 'Avg'), h('th', null, '±'), h('th', null, '3-putt'), h('th', null, 'Time')), ...holeRows),
    hardest.length ? h('div', { class: 'muted', style: 'margin-top:6px' }, `Hardest: ${hardest.map(x => `#${x!.number}`).join(', ')}`) : null,
  );
}
