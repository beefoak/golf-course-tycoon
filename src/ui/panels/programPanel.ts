import { Command } from '../../sim/commands';
import { Game } from '../../sim/game';
import { PRACTICES, Practice } from '../../sim/turf/practices';
import { DEFAULT_TURF, TurfSettings, turfSettings } from '../../sim/turf/turf';
import { ProgramRule, programFor } from '../../sim/staff/program';
import { holeRanges, shortfallReport } from '../../sim/staff/workOrders';
import { Surface } from '../../sim/world/tiles';
import { h } from '../dom';
import { INPUT_STYLE, PanelTool, panelTool, tabs } from '../tools/panelTool';

type Tab = 'rules' | 'today' | 'zones' | 'turf';
export const SURFACE_NAME: Partial<Record<Surface, string>> = {
  [Surface.Green]: 'Greens', [Surface.Fringe]: 'Collars', [Surface.Tee]: 'Tees', [Surface.Fairway]: 'Fairways', [Surface.FirstCut]: 'First cut', [Surface.Rough]: 'Rough', [Surface.Bunker]: 'Bunkers',
};
const PRACTICE_NAME: Record<Practice, string> = {
  mow: 'Mow', roll: 'Roll', aerate: 'Aerate', topdress: 'Topdress', spray: 'Spray', fertilize: 'Fertilize', handWater: 'Hand-water',
  rakeBunker: 'Rake', changeCup: 'Change cups', fixDivots: 'Fill divots', moveTeeMarkers: 'Move tee markers',
};
/** "Mow greens", "Change cups" (per-hole jobs need no surface). */
export function jobName(p: Practice, s: Surface): string {
  if (p === 'changeCup' || p === 'moveTeeMarkers') return PRACTICE_NAME[p];
  return `${PRACTICE_NAME[p]} ${SURFACE_NAME[s]?.toLowerCase() ?? ''}`.trim();
}
const STATUS_COLOR = { open: 'var(--muted)', assigned: '#6fa0ff', done: 'var(--accent)', skipped: 'var(--warn)' } as const;

/** Parse "1-9, 12" into hole numbers. */
export function parseHoleList(s: string): number[] {
  const out: number[] = [];
  for (const part of s.split(',')) {
    const m = part.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (m) for (let n = Number(m[1]); n <= Number(m[2]); n++) out.push(n);
    else if (/^\d+$/.test(part.trim())) out.push(Number(part.trim()));
  }
  return out;
}

/** Program body for one course: editable rules, today's orders, zones, and course turf targets. */
export function programPanel(g: Game, courseId: number, refresh: () => void, state: { tab: Tab } = { tab: 'rules' }): HTMLElement {
  const run = (c: Command, okText?: string) => {
    const r = g.dispatch(c);
    if (!r.ok) g.notify('warn', r.reason);
    else if (okText) g.notify('info', okText);
    refresh();
  };
  const set = (v: Tab) => { state.tab = v; refresh(); };
  const body = state.tab === 'rules' ? rules(g, courseId, run)
    : state.tab === 'today' ? today(g, courseId, run)
    : state.tab === 'zones' ? zones(g, courseId, run)
    : turf(g, courseId, run);
  return h('div', null,
    h('h3', null, 'Maintenance program'),
    tabs<Tab>([{ value: 'rules', text: 'Rules' }, { value: 'today', text: 'Today' }, { value: 'zones', text: 'Zones' }, { value: 'turf', text: 'Turf targets' }], () => state.tab, set),
    body);
}

export function programTool(g: Game): PanelTool {
  const state = { tab: 'rules' as Tab };
  return panelTool(g, 'program', 'Program', refresh => {
    const c = g.courses.list[0];
    return c ? programPanel(g, c.id, refresh, state) : h('div', { class: 'muted' }, 'Build a course first.');
  }, 2000);
}

function rules(g: Game, courseId: number, run: (c: Command, ok?: string) => void): HTMLElement {
  const p = programFor(g, courseId);
  const save = (i: number, patch: Partial<ProgramRule>) => run({ t: 'setProgramRule', courseId, index: i, rule: { ...p.rules[i]!, ...patch } });
  const num = (v: number | string, w: number, on: (n: number) => void, extra: Record<string, unknown> = {}) =>
    h('input', { type: 'number', value: v, style: `width:${w}px;${INPUT_STYLE}`, onchange: (e: Event) => on(Number((e.target as HTMLInputElement).value)), ...extra });
  const rows = p.rules.map((r, i) => h('tr', { 'data-rule': String(i) },
    h('td', null, jobName(r.practice, r.surface)),
    h('td', null, num(Math.round(r.frequency.perWeek * 100) / 100, 46, n => save(i, { frequency: { perWeek: n } }), { min: 0.05, max: 14, step: 0.5, class: 'freq', title: 'times per week' })),
    h('td', null, r.practice === 'mow'
      ? h('input', { type: 'number', min: 1.5, max: 150, step: 0.1, placeholder: 'course', value: r.params?.mowMm ?? '', class: 'mm', title: 'mow height mm (blank = course setting)', style: `width:52px;${INPUT_STYLE}`,
        onchange: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          const rest = { ...p.rules[i]! };
          delete rest.params;
          run({ t: 'setProgramRule', courseId, index: i, rule: v === '' ? rest : { ...rest, params: { mowMm: Number(v) } } });
        } })
      : ''),
    h('td', null, h('select', { style: INPUT_STYLE, title: '1 = always done first', onchange: (e: Event) => save(i, { priority: Number((e.target as HTMLSelectElement).value) as 1 | 2 | 3 }) },
      ...[1, 2, 3].map(n => h('option', { value: String(n), selected: r.priority === n }, `P${n}`)))),
    h('td', null, h('button', { class: 'btn', title: 'Remove rule', onclick: () => run({ t: 'removeProgramRule', courseId, index: i }) }, '×'))));
  const prac = h('select', { style: INPUT_STYLE }, ...PRACTICES.map(x => h('option', { value: x }, PRACTICE_NAME[x])));
  const surf = h('select', { style: INPUT_STYLE }, ...(Object.keys(SURFACE_NAME).map(Number) as Surface[]).map(s => h('option', { value: String(s) }, SURFACE_NAME[s]!)));
  return h('div', null,
    h('table', { class: 'grid' }, h('tr', null, h('th', null, 'Job'), h('th', null, '/wk'), h('th', null, 'mm'), h('th', null, 'Pri'), h('th', null, '')), ...rows),
    h('div', { class: 'muted', style: 'margin:4px 0' }, 'Without a superintendent only P1 jobs get planned.'),
    h('label', null, 'Add a rule'),
    h('div', { style: 'display:flex;gap:3px;flex-wrap:wrap' }, prac, surf,
      h('button', { class: 'btn', onclick: () => run({ t: 'setProgramRule', courseId, rule: { practice: prac.value as Practice, surface: Number(surf.value) as Surface, frequency: { perWeek: 1 }, priority: 2 } }) }, 'Add')));
}

function today(g: Game, courseId: number, run: (c: Command, ok?: string) => void): HTMLElement {
  const orders = g.workOrders.all.filter(o => o.courseId === courseId && o.due === g.day);
  const count = (s: string) => orders.filter(o => o.status === s).length;
  const name = (id: number | null) => (id === null ? 'nobody' : g.staff.get(id)?.name.split(' ')[0] ?? '?');
  const rep = shortfallReport(g, courseId, g.day - 1);
  return h('div', null,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Orders today'),
      h('span', null, `${count('done')} done · ${count('assigned')} in hand · ${count('open')} unassigned · ${count('skipped')} skipped`)),
    orders.length ? h('table', { class: 'grid' }, ...orders.slice(0, 60).map(o => {
      const hole = g.courses.hole(o.holeId);
      const pct = o.tiles.length ? Math.round((o.progress / o.tiles.length) * 100) : o.status === 'done' ? 100 : 0;
      return h('tr', null,
        h('td', null, `${o.urgent ? '! ' : ''}${jobName(o.practice, o.surface)}`),
        h('td', null, hole ? `#${hole.number}` : ''),
        h('td', { class: 'muted' }, `${o.laborHours}h`),
        h('td', { style: `color:${STATUS_COLOR[o.status]}` }, o.status === 'assigned' ? `${name(o.assignedTo)} ${pct}%` : o.status === 'skipped' ? `skipped (${o.skipReason ?? ''})` : o.status),
        h('td', null, o.status === 'open' || o.status === 'assigned'
          ? h('button', { class: 'btn', title: o.paused ? 'Resume' : 'Hold this job', onclick: () => run({ t: 'pauseOrder', id: o.id, paused: !o.paused }) }, o.paused ? '▶' : '❚❚')
          : ''));
    })) : h('div', { class: 'muted' }, 'No orders today — they are planned at dawn for courses with staff.'),
    orders.length > 60 ? h('div', { class: 'muted' }, `…and ${orders.length - 60} more`) : null,
    h('label', null, 'Yesterday'),
    rep.text.length
      ? h('div', null, h('div', { class: 'warnline' }, `${Math.round(rep.hoursShort * 10) / 10} labour-hours short`), ...rep.text.map(t => h('div', { class: 'warnline' }, `• ${t}`)))
      : h('div', { style: 'color:var(--accent)' }, 'Everything planned got done.'));
}

function zones(g: Game, courseId: number, run: (c: Command, ok?: string) => void): HTMLElement {
  const p = programFor(g, courseId);
  const course = g.courses.get(courseId);
  const num = (id: number) => g.courses.hole(id)?.number ?? 0;
  const nameIn = h('input', { placeholder: 'Front nine', style: `width:90px;${INPUT_STYLE}` });
  const holesIn = h('input', { placeholder: '1-9', style: `width:70px;${INPUT_STYLE}` });
  return h('div', null,
    h('div', { class: 'muted' }, 'Split the course so each crew member sticks to their patch (set per person in Staff).'),
    p.zones.length ? h('div', null, ...p.zones.map(z => h('div', { class: 'row' },
      h('span', null, z.name),
      h('span', { class: 'muted' }, `holes ${holeRanges(z.holeIds.map(num)) || '—'} · ${g.staff.all.filter(s => s.zone === z.id).length} crew`)))) : h('div', { class: 'muted' }, 'No zones: everyone works the whole course.'),
    h('label', null, 'New zone'),
    h('div', { style: 'display:flex;gap:3px;flex-wrap:wrap' }, nameIn, holesIn,
      h('button', { class: 'btn', onclick: () => {
        const nums = new Set(parseHoleList(holesIn.value));
        const ids = (course?.holes ?? []).filter(x => nums.has(x.number)).map(x => x.id);
        if (!ids.length) { g.notify('warn', 'List the holes, e.g. 1-9'); return; }
        run({ t: 'createZone', courseId, name: nameIn.value, holeIds: ids }, 'Zone created');
      } }, 'Create')));
}

const TURF_FIELDS: { key: keyof TurfSettings; text: string; step: number }[] = [
  { key: 'greenMowMm', text: 'Greens mm', step: 0.1 }, { key: 'teeMowMm', text: 'Tees mm', step: 0.5 },
  { key: 'fairwayMowMm', text: 'Fairways mm', step: 0.5 }, { key: 'roughMowMm', text: 'Rough mm', step: 5 },
  { key: 'greenStimpTarget', text: 'Stimp target', step: 0.5 },
];

function turf(g: Game, courseId: number, run: (c: Command, ok?: string) => void): HTMLElement {
  const s = turfSettings(g, courseId);
  return h('div', null,
    h('div', { class: 'muted' }, 'Course-wide targets; holes can override them in the hole panel. Lower greens are faster but scalp below the grass minimum.'),
    ...TURF_FIELDS.map(f => h('div', { class: 'row' }, h('span', { class: 'muted' }, f.text),
      h('input', { type: 'number', step: f.step, value: s[f.key], style: `width:60px;${INPUT_STYLE}`,
        onchange: (e: Event) => run({ t: 'setTurfSettings', courseId, settings: { [f.key]: Number((e.target as HTMLInputElement).value) } }) }))),
    h('button', { class: 'btn', style: 'margin-top:4px', onclick: () => run({ t: 'setTurfSettings', courseId, settings: { ...DEFAULT_TURF } }, 'Turf targets reset') }, 'Reset to defaults'));
}
