import { TEE_ORDER, TeeKind } from '../../sim/course/course';
import { GROW_IN_DAYS, GrowMethod, growInCost } from '../../sim/course/lifecycle';
import { validateHole } from '../../sim/course/validate';
import { holePar, longestYards, suggestPar, teeYards } from '../../sim/course/yardage';
import { Command } from '../../sim/commands';
import { Game } from '../../sim/game';
import { GRASSES, Grass } from '../../sim/turf/grasses';
import { greenStimpFromTurf, holeCondition, holeTiles, turfSettings } from '../../sim/turf/turf';
import { h, money } from '../dom';
import { INPUT_STYLE } from '../tools/panelTool';

export interface HolePanelActions {
  placeTee(kind: TeeKind): void;
  placingTee(): TeeKind | null;
  openGreenTool(): void;
  refresh(): void;
}

const STATE_LABEL = { construction: 'Under construction', growingIn: 'Growing in', open: 'Open', closing: 'Closing (waiting for groups)', closed: 'Closed' };
const TEE_COLOR: Record<TeeKind, string> = { championship: '#222', back: '#4a7ad8', middle: '#e8e8e8', forward: '#e23b3b' };

/** Inspector body for one hole: name, par, tees, pins, validation, grow-in and open/close. */
export function holePanel(g: Game, holeId: number, a: HolePanelActions): HTMLElement {
  const ho = g.courses.hole(holeId);
  if (!ho) return h('div', { class: 'muted' }, 'Hole removed.');
  const run = (c: Command, okText?: string) => {
    const r = g.dispatch(c);
    if (!r.ok) g.notify('warn', r.reason);
    else if (okText) g.notify('info', okText);
    a.refresh();
  };
  const v = validateHole(g, ho);
  const yd = Math.round(longestYards(ho));
  const editable = ho.state === 'construction' || ho.state === 'closed';

  const name = h('input', { value: ho.name, style: 'width:100%;box-sizing:border-box;background:var(--panel-2);color:var(--text);border:2px solid var(--line);padding:4px;font:inherit',
    onchange: (e: Event) => run({ t: 'renameHole', holeId, name: (e.target as HTMLInputElement).value }) });
  const par = h('select', { onchange: (e: Event) => { const val = (e.target as HTMLSelectElement).value; run({ t: 'setPar', holeId, par: val === 'auto' ? null : Number(val) }); } },
    h('option', { value: 'auto' }, `Auto (${suggestPar(yd)})`), ...[3, 4, 5].map(p => h('option', { value: String(p) }, `Par ${p}`)));
  par.value = ho.parOverride === null ? 'auto' : String(ho.parOverride);

  const teeRows = TEE_ORDER.map(kind => {
    const t = ho.teeBoxes.find(x => x.kind === kind);
    const placing = a.placingTee() === kind;
    return h('tr', null,
      h('td', null, h('span', { style: `display:inline-block;width:8px;height:8px;margin-right:4px;background:${TEE_COLOR[kind]}` }), kind),
      h('td', null, t ? `${Math.round(teeYards(ho, kind))} yd` : '—'),
      h('td', null,
        h('button', { class: `btn${placing ? ' on' : ''}`, disabled: !editable, onclick: () => a.placeTee(kind) }, t ? 'Move' : 'Add'),
        t ? h('button', { class: 'btn', disabled: !editable, onclick: () => run({ t: 'removeTeeBox', holeId, kind }) }, '×') : null));
  });

  const pins = h('div', { style: 'display:flex;flex-wrap:wrap;gap:3px' }, ...ho.pins.map((p, i) =>
    h('button', { class: `btn${i === ho.activePin ? ' on' : ''}`, title: `${p.x},${p.y}`, onclick: () => run({ t: 'setActivePin', holeId, index: i }) }, `Pin ${i + 1}`)));

  const grow = (m: GrowMethod) => {
    const cost = growInCost(g, holeId, m);
    return h('button', { class: 'btn', disabled: !editable || v.errors.length > 0, onclick: () => run({ t: 'startGrowIn', holeId, method: m }, `${ho.name}: ${m === 'seed' ? 'seeded' : 'sodded'}; open in ${GROW_IN_DAYS[m]} days`) },
      `${m === 'seed' ? 'Seed' : 'Sod'} ${money(cost)} · ${GROW_IN_DAYS[m]}d`);
  };

  return h('div', null,
    h('h3', null, `#${ho.number} ${ho.name}`),
    name,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'State'), h('span', null, STATE_LABEL[ho.state] + (ho.state === 'growingIn' ? ` · ${ho.growInDaysLeft}d left` : ''))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Length'), h('span', null, `${yd} yd`)),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Par'), h('span', null, `${holePar(ho)} `, par)),
    h('label', null, 'Tee boxes'),
    h('table', { class: 'grid' }, ...teeRows),
    a.placingTee() ? h('div', { class: 'warnline' }, `Click the map to place the ${a.placingTee()} tee (Esc cancels)`) : null,
    h('label', null, `Pin positions (${ho.pins.length})`),
    pins,
    h('div', { style: 'display:flex;gap:3px;margin-top:3px' },
      h('span', { class: 'muted', style: 'align-self:center' }, 'Pin sheet'),
      h('button', { class: `btn${ho.pinMode !== 'manual' ? ' on' : ''}`, title: 'The crew moves the cup each morning', onclick: () => run({ t: 'setPinMode', holeId, mode: 'auto' }) }, 'Auto'),
      h('button', { class: `btn${ho.pinMode === 'manual' ? ' on' : ''}`, title: 'The pin stays where you set it', onclick: () => run({ t: 'setPinMode', holeId, mode: 'manual' }) }, 'Manual')),
    h('button', { class: 'btn', style: 'margin-top:4px', onclick: a.openGreenTool }, 'Shape green / place pins…'),
    turfSection(g, holeId, run),
    h('label', null, 'Checks'),
    v.errors.length || v.warnings.length
      ? h('div', null, ...v.errors.map(e => h('div', { class: 'errline' }, `✗ ${e}`)), ...v.warnings.map(w => h('div', { class: 'warnline' }, `! ${w}`)))
      : h('div', { style: 'color:var(--accent)' }, '✓ Ready to grow in'),
    h('label', null, 'Lifecycle'),
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px' },
      editable ? grow('seed') : null,
      editable ? grow('sod') : null,
      ho.state === 'open' ? h('button', { class: 'btn', onclick: () => run({ t: 'closeHole', holeId }, `${ho.name} closing`) }, 'Close for editing') : null,
      ho.state === 'closed' && !ho.editedSinceClose ? h('button', { class: 'btn', onclick: () => run({ t: 'reopenHole', holeId }, `${ho.name} reopened`) }, 'Reopen') : null,
      h('button', { class: 'btn', onclick: () => run({ t: 'refreshStakes', holeId }, 'Stakes refreshed') }, 'Refresh stakes')),
    ho.state === 'closed' && ho.editedSinceClose ? h('div', { class: 'muted' }, 'Edited since closing — needs a grow-in before reopening.') : null,
  );
}

/** Grass on the green, live speed and condition, and per-hole turf overrides. */
function turfSection(g: Game, holeId: number, run: (c: Command, okText?: string) => void): HTMLElement {
  const ho = g.courses.hole(holeId)!;
  const w = g.world;
  const greens = holeTiles(g, holeId).green;
  const count = new Map<Grass, number>();
  for (const i of greens) count.set(w.grass[i] as Grass, (count.get(w.grass[i] as Grass) ?? 0) + 1);
  const main = [...count.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? Grass.None;
  const base = turfSettings(g, ho.courseId);
  const over = g.turf.holeOverrides.get(holeId) ?? {};
  const cond = holeCondition(g, holeId);
  const grassSel = h('select', { style: INPUT_STYLE, title: 'Re-grass the green (sod, needs the hole closed)',
    onchange: (e: Event) => {
      const gr = Number((e.target as HTMLSelectElement).value) as Grass;
      run({ t: 'setGrass', tiles: greens.map(i => ({ x: i % w.size, y: Math.floor(i / w.size) })), grass: gr, method: 'sod' }, 'Green re-grassed');
    } },
    main === Grass.None ? h('option', { value: '0', selected: true }, '—') : null,
    ...(Object.keys(GRASSES).map(Number) as Exclude<Grass, Grass.None>[]).map(k => h('option', { value: String(k), selected: k === main }, GRASSES[k].name)));
  const field = (key: 'greenMowMm' | 'greenStimpTarget', text: string, step: number) => h('div', { class: 'row' },
    h('span', { class: 'muted' }, text),
    h('input', { type: 'number', step, value: over[key] ?? '', placeholder: String(base[key]), style: `width:60px;${INPUT_STYLE}`,
      onchange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value;
        if (v === '') {
          const rest = { ...over };
          delete rest[key];
          run({ t: 'setTurfSettings', courseId: ho.courseId, holeId, settings: null });
          if (Object.keys(rest).length) run({ t: 'setTurfSettings', courseId: ho.courseId, holeId, settings: rest });
        } else run({ t: 'setTurfSettings', courseId: ho.courseId, holeId, settings: { [key]: Number(v) } });
      } }));
  return h('div', null,
    h('label', null, 'Turf'),
    greens.length ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Green grass'), grassSel) : null,
    greens.length ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Green speed'), h('span', null, `${greenStimpFromTurf(g, holeId).toFixed(1)} ft (target ${over.greenStimpTarget ?? base.greenStimpTarget})`)) : null,
    cond !== null ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Condition'), h('span', { style: cond < 45 ? 'color:var(--warn)' : '' }, `${Math.round(cond)}/100`)) : null,
    field('greenMowMm', 'Green height mm', 0.1),
    field('greenStimpTarget', 'Stimp target', 0.5),
    h('div', { class: 'muted' }, 'Blank = course setting (Program → Turf targets).'));
}
