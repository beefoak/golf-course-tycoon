import { Game } from '../../sim/game';
import { EVENTS, EVENT_KINDS, eventBlocker } from '../../sim/rating/events';
import { MILESTONES, MILESTONE_KEYS } from '../../sim/rating/milestones';
import { UNLOCK_LABEL, UnlockKey, isUnlocked, lockedReason } from '../../sim/rating/unlocks';
import { activeCourseId } from '../../sim/course/active';
import { h, money } from '../dom';
import { PanelTool, panelTool, tabs } from '../tools/panelTool';

type Tab = 'events' | 'milestones';

/** Event requests to accept or decline, what's booked, and the milestones and unlocks of a career. */
export function clubTool(g: Game): PanelTool {
  let tab: Tab = 'events';
  return panelTool(g, 'club', 'Club', refresh => {
    const run = (c: Parameters<Game['dispatch']>[0], okText: string) => { const r = g.dispatch(c); g.notify(r.ok ? 'info' : 'warn', r.ok ? okText : r.reason); refresh(); };
    const courseId = activeCourseId(g);
    const course = g.courses.get(courseId);
    const name = (id: number) => g.courses.get(id)?.name ?? 'course';
    let body: HTMLElement;
    if (tab === 'events') {
      const offers = g.golfEvents.filter(e => e.status === 'offered');
      const booked = g.golfEvents.filter(e => e.status === 'accepted' || (e.status === 'done' && g.day < e.day + EVENTS[e.kind].days));
      const past = g.golfEvents.filter(e => e.status === 'done' && g.day >= e.day + EVENTS[e.kind].days).slice(-5).reverse();
      const terms = (k: keyof typeof EVENTS) => {
        const d = EVENTS[k];
        return `${d.days} day${d.days > 1 ? 's' : ''} · ${money(d.players * d.entryFee + d.sponsorship)}${d.spectatorsPerDay ? ` · ${d.spectatorsPerDay.toLocaleString()} spectators a day` : ''}`;
      };
      body = h('div', null,
        h('label', null, 'Requests'),
        ...(offers.length ? offers.map(e => h('div', { style: 'border-top:1px solid var(--line);padding:3px 0' },
          h('div', { class: 'row' }, h('span', null, `${EVENTS[e.kind].label} — ${name(e.courseId)}`), h('span', { class: 'muted' }, `day ${e.day}`)),
          h('div', { class: 'muted' }, terms(e.kind)),
          h('div', { style: 'display:flex;gap:3px;margin-top:2px' },
            h('button', { class: 'btn on', onclick: () => run({ t: 'acceptEvent', id: e.id }, `${EVENTS[e.kind].label} booked for day ${e.day}`) }, 'Accept'),
            h('button', { class: 'btn', onclick: () => run({ t: 'declineEvent', id: e.id }, 'Declined') }, 'Decline'))))
          : [h('div', { class: 'muted' }, 'No requests right now. They come in weekly once your course can host something.')]),
        h('label', null, 'Booked'),
        ...(booked.length ? booked.map(e => h('div', { class: 'row' }, h('span', null, `${EVENTS[e.kind].label} — ${name(e.courseId)}`), h('span', { class: 'muted' }, `day ${e.day}`)))
          : [h('div', { class: 'muted' }, 'Nothing booked. Event days close the tee sheet to the public and set up fast greens and thick rough.')]),
        past.length ? h('label', null, 'Recent') : null,
        ...past.map(e => h('div', { class: 'row' }, h('span', null, `${EVENTS[e.kind].label} (day ${e.day})`),
          h('span', { style: (e.result?.prestige ?? 0) < 0 ? 'color:var(--bad)' : '' }, `${money(e.result?.revenue ?? 0)} · ${(e.result?.prestige ?? 0) >= 0 ? '+' : ''}${(e.result?.prestige ?? 0).toFixed(2)}★`))),
        course ? h('label', null, `What ${course.name} can host`) : null,
        ...(course ? EVENT_KINDS.map(k => { const why = eventBlocker(g, course, k); return h('div', { class: 'row' }, h('span', null, EVENTS[k].label), h('span', { class: why ? 'muted' : '', style: why ? '' : 'color:var(--accent)' }, why ?? 'Ready')); }) : []));
    } else {
      body = h('div', null,
        h('label', null, 'Milestones'),
        ...MILESTONE_KEYS.map(k => {
          const day = g.milestones[k];
          const m = MILESTONES[k];
          return h('div', { class: 'row', style: day !== undefined ? 'color:var(--accent)' : '' },
            h('span', null, `${day !== undefined ? '✔' : '○'} ${m.label}`),
            h('span', { class: 'muted' }, day !== undefined ? `day ${day}` : [m.grant ? money(m.grant) : '', ...m.unlocks.map(u => UNLOCK_LABEL[u])].filter(Boolean).join(' · ')));
        }),
        h('label', null, 'Unlocks'),
        ...(Object.keys(UNLOCK_LABEL) as UnlockKey[]).map(k => h('div', { class: 'row' },
          h('span', null, `${isUnlocked(g, k) ? '🔓' : '🔒'} ${UNLOCK_LABEL[k]}`),
          h('span', { class: 'muted', style: 'font-size:11px' }, isUnlocked(g, k) ? '' : lockedReason(k)))));
    }
    return h('div', null,
      h('h3', null, 'Club'),
      tabs<Tab>([{ value: 'events', text: 'Events' }, { value: 'milestones', text: 'Milestones' }], () => tab, v => { tab = v; refresh(); }),
      body);
  }, 3000);
}
