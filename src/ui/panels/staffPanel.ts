import { activeCourseId } from '../../sim/course/active';
import { Command } from '../../sim/commands';
import { Game } from '../../sim/game';
import { staffActivity } from '../../sim/staff/agents';
import { EQUIPMENT, EQUIPMENT_KINDS, EquipmentKind, MAINTENANCE, MaintenanceUpgrade, hasUpgrade, maintenanceOf, resaleValue, storageSlots } from '../../sim/staff/equipment';
import { generateCandidates } from '../../sim/staff/market';
import { programFor } from '../../sim/staff/program';
import { ROLES, RoleId, SkillId } from '../../sim/staff/roles';
import { Staff, TRAINING_COST, skillAvg } from '../../sim/staff/staff';
import { h, money } from '../dom';
import { INPUT_STYLE, PanelTool, panelTool, tabs } from '../tools/panelTool';

type Tab = 'roster' | 'hire' | 'equipment';
const TRAIT_LABEL: Record<string, string> = { earlyRiser: 'Early riser', perfectionist: 'Perfectionist', careless: 'Careless', fast: 'Fast', grumpy: 'Grumpy', mentor: 'Mentor', loyal: 'Loyal' };
const SHIFTS: { text: string; start: number; end: number }[] = [
  { text: '05:00–13:30', start: 300, end: 810 }, { text: '06:00–14:30', start: 360, end: 870 },
  { text: '07:00–17:00', start: 420, end: 1020 }, { text: '12:00–20:30', start: 720, end: 1230 },
];
const UPGRADE_LABEL: Record<MaintenanceUpgrade, string> = { storage: 'Storage bay', workshop: 'Workshop', staffRoom: 'Staff room', chemicalStore: 'Chemical store' };
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Staff: roster with per-person controls, the hiring market, and the equipment fleet. */
export function staffTool(g: Game): PanelTool {
  let tab: Tab = 'roster';
  let hireRole: RoleId = 'greenkeeper';
  let open: number | null = null;
  const buyKind = { kind: 'greensMower' as EquipmentKind };
  return panelTool(g, 'staff', 'Staff', refresh => {
    const courseId = activeCourseId(g);
    const run = (c: Command, okText?: string) => {
      const r = g.dispatch(c);
      if (!r.ok) g.notify('warn', r.reason);
      else if (okText) g.notify('info', okText);
      refresh();
    };
    const set = (v: Tab) => { tab = v; refresh(); };
    const crew = g.staff.all.filter(s => s.courseId === courseId);
    const body = tab === 'roster' ? roster(g, crew, courseId, run, () => open, id => { open = open === id ? null : id; refresh(); })
      : tab === 'hire' ? hiring(g, courseId, hireRole, r => { hireRole = r; refresh(); }, run)
      : equipment(g, courseId, crew, run, buyKind);
    const wages = crew.reduce((a, s) => a + s.wagePerDay, 0);
    return h('div', null,
      h('h3', null, 'Staff'),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, `${crew.length} on staff`), h('span', null, `${money(wages)}/day`)),
      tabs<Tab>([{ value: 'roster', text: 'Roster' }, { value: 'hire', text: 'Hire' }, { value: 'equipment', text: 'Equipment' }], () => tab, set),
      body);
  });
}

function roster(g: Game, crew: Staff[], courseId: number, run: (c: Command, ok?: string) => void, open: () => number | null, toggle: (id: number) => void): HTMLElement {
  if (!crew.length) return h('div', { class: 'muted' }, 'Nobody on staff yet. Hire a greenkeeper or two from the Hire tab — without a crew the turf goes downhill.');
  const zones = programFor(g, courseId).zones;
  return h('div', null, ...crew.map(s => {
    const moraleCol = s.morale < 30 ? 'var(--bad, #e05040)' : s.morale < 50 ? 'var(--warn)' : 'var(--text)';
    const head = h('div', { class: 'row', style: 'cursor:pointer', onclick: () => toggle(s.id) },
      h('span', null, `${open() === s.id ? '▾' : '▸'} ${s.name}`),
      h('span', { class: 'muted' }, `${ROLES[s.role].name} · `, h('span', { style: `color:${moraleCol}` }, `☺${Math.round(s.morale)}`)));
    if (open() !== s.id) return head;
    const skills = ROLES[s.role].skills;
    const shift = h('select', { style: INPUT_STYLE, onchange: (e: Event) => { const v = SHIFTS[Number((e.target as HTMLSelectElement).value)]!; run({ t: 'setShift', id: s.id, startMin: v.start, endMin: v.end }); } },
      ...SHIFTS.map((v, i) => h('option', { value: String(i), selected: v.start === s.shift.startMin && v.end === s.shift.endMin }, v.text)),
      SHIFTS.some(v => v.start === s.shift.startMin && v.end === s.shift.endMin) ? null : h('option', { value: '-1', selected: true }, `${hm(s.shift.startMin)}–${hm(s.shift.endMin)}`));
    const zone = h('select', { style: INPUT_STYLE, onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; run({ t: 'assignZone', staffId: s.id, zone: v === '' ? null : Number(v) }); } },
      h('option', { value: '', selected: s.zone === null }, 'Whole course'), ...zones.map(z => h('option', { value: String(z.id), selected: s.zone === z.id }, z.name)));
    const train = h('select', { style: INPUT_STYLE }, ...skills.map(k => h('option', { value: k }, k)));
    const away = s.trainingUntilDay > g.day;
    return h('div', { style: 'border:1px solid var(--line);padding:4px;margin:2px 0' },
      head,
      h('div', { class: 'muted' }, staffActivity(g, s)),
      ...skills.map(k => h('div', { class: 'row' }, h('span', { class: 'muted' }, k), h('span', null, String(Math.round(s.skills[k] ?? 0))))),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Speed · reliability'), h('span', null, `${s.speed.toFixed(2)} · ${Math.round(s.reliability * 100)}%`)),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Fatigue'), h('span', null, `${Math.round(s.fatigue)}/100`)),
      s.traits.length ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Traits'), h('span', null, s.traits.map(t => TRAIT_LABEL[t] ?? t).join(', '))) : null,
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Wage $/day'),
        h('input', { type: 'number', min: 50, max: 2000, step: 5, value: s.wagePerDay, style: `width:70px;${INPUT_STYLE}`,
          onchange: (e: Event) => run({ t: 'setWage', id: s.id, wagePerDay: Number((e.target as HTMLInputElement).value) }) })),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Shift'), shift),
      ROLES[s.role].dept === 'maintenance' ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Zone'), zone) : null,
      h('div', { style: 'display:flex;gap:4px;margin-top:4px;flex-wrap:wrap' },
        away ? h('span', { class: 'muted' }, `Training until day ${s.trainingUntilDay}`)
          : h('span', null, train, h('button', { class: 'btn', onclick: () => run({ t: 'trainStaff', id: s.id, skill: train.value as SkillId }, `${s.name} is off on a course`) }, `Train ${money(TRAINING_COST)}`)),
        h('button', { class: 'btn', onclick: () => { if (confirm(`Let ${s.name} go? Severance is a week's wages.`)) run({ t: 'fireStaff', id: s.id }, `${s.name} let go`); } }, 'Fire')));
  }));
}

function hiring(g: Game, courseId: number, role: RoleId, setRole: (r: RoleId) => void, run: (c: Command, ok?: string) => void): HTMLElement {
  const pick = h('select', { style: INPUT_STYLE, onchange: (e: Event) => setRole((e.target as HTMLSelectElement).value as RoleId) },
    ...(Object.keys(ROLES) as RoleId[]).map(r => h('option', { value: r, selected: r === role }, `${ROLES[r].name} (~${money(ROLES[r].baseWagePerDay)}/day)`)));
  const list = generateCandidates(g, role).filter(c => !g.staff.hiredCandidates.has(c.candidateId));
  return h('div', null,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Role'), pick),
    h('div', { class: 'muted', style: 'margin:4px 0' }, 'New faces each week.'),
    ...list.map(c => {
      const why = g.staff.hireBlocker(g, c, courseId);
      return h('div', { style: 'border:1px solid var(--line);padding:4px;margin:2px 0' },
        h('div', { class: 'row' }, h('span', null, c.name), h('span', null, `${money(c.wagePerDay)}/day`)),
        h('div', { class: 'muted' }, ROLES[c.role].skills.map(k => `${k} ${Math.round(c.skills[k] ?? 0)}`).join(' · ') + ` · avg ${Math.round(skillAvg(c))}`),
        c.traits.length ? h('div', { class: 'muted' }, c.traits.map(t => TRAIT_LABEL[t] ?? t).join(', ')) : null,
        why ? h('div', { class: 'warnline' }, why)
          : h('button', { class: 'btn', style: 'margin-top:3px', onclick: () => run({ t: 'hireStaff', candidateId: c.candidateId, courseId }, `${c.name} hired`) }, 'Hire'));
    }),
    list.length ? null : h('div', { class: 'muted' }, 'Nobody looking for this job this week.'));
}

function equipment(g: Game, courseId: number, crew: Staff[], run: (c: Command, ok?: string) => void, pick: { kind: EquipmentKind }): HTMLElement {
  const shed = maintenanceOf(g, courseId);
  if (!shed) return h('div', { class: 'muted' }, 'Build a maintenance building (Maintenance tool, M) to store machines. Until then the crew works with hand tools at a quarter of the speed.');
  const fleet = g.equipment.all.filter(e => e.courseId === courseId);
  const kindSel = h('select', { style: INPUT_STYLE, onchange: (e: Event) => { pick.kind = (e.target as HTMLSelectElement).value as EquipmentKind; buy.replaceChildren(...tierButtons()); } },
    ...EQUIPMENT_KINDS.map(k => h('option', { value: k, selected: k === pick.kind }, EQUIPMENT[k].name)));
  const kind = () => pick.kind;
  const tierButtons = () => ([1, 2, 3] as const).map(t => {
    const spec = EQUIPMENT[kind()].tiers[t - 1]!;
    return h('button', { class: 'btn', title: `${spec.tilesPerHour} tiles/hour`, onclick: () => run({ t: 'buyEquipment', courseId, kind: kind(), tier: t }, `${EQUIPMENT[kind()].name} bought`) }, `T${t} ${money(spec.cost)}`);
  });
  const buy = h('div', { style: 'display:flex;gap:3px;flex-wrap:wrap' }, ...tierButtons());
  const name = (id: number | null) => (id === null ? '—' : crew.find(s => s.id === id)?.name ?? '—');
  return h('div', null,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Storage'), h('span', null, `${fleet.length}/${storageSlots(g, courseId)}`)),
    h('label', null, 'Buy'),
    kindSel, buy,
    h('label', null, 'Fleet'),
    fleet.length ? h('div', null, ...fleet.map(e => {
      const who = h('select', { style: INPUT_STYLE, disabled: e.broken, onchange: (ev: Event) => { const v = (ev.target as HTMLSelectElement).value; run({ t: 'assignEquipment', id: e.id, staffId: v === '' ? null : Number(v) }); } },
        h('option', { value: '', selected: e.assignedTo === null }, 'Pool (crew grab it)'),
        ...crew.filter(s => ROLES[s.role].dept === 'maintenance').map(s => h('option', { value: String(s.id), selected: e.assignedTo === s.id }, s.name)));
      return h('div', { style: 'border:1px solid var(--line);padding:4px;margin:2px 0' },
        h('div', { class: 'row' }, h('span', null, `${EQUIPMENT[e.kind].name} T${e.tier}`), h('span', { style: e.broken ? 'color:var(--warn)' : '' }, e.broken ? 'BROKEN' : `${Math.round(e.condition)}%`)),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, `With ${name(e.assignedTo)}`), who),
        h('button', { class: 'btn', onclick: () => run({ t: 'sellEquipment', id: e.id }, `Sold for ${money(resaleValue(e))}`) }, `Sell ${money(resaleValue(e))}`));
    })) : h('div', { class: 'muted' }, 'No machines yet.'),
    h('label', null, 'Building upgrades'),
    h('div', { style: 'display:flex;gap:3px;flex-wrap:wrap' }, ...(Object.keys(UPGRADE_LABEL) as MaintenanceUpgrade[]).map(u => hasUpgrade(shed, u)
      ? h('span', { class: 'muted', style: 'padding:2px 4px' }, `✓ ${UPGRADE_LABEL[u]}`)
      : h('button', { class: 'btn', onclick: () => run({ t: 'upgradeBuilding', buildingId: shed.id, upgrade: u }, `${UPGRADE_LABEL[u]} built`) }, `${UPGRADE_LABEL[u]} ${money(MAINTENANCE.upgradeCost[u])}`))),
  );
}
