import { TEE_ORDER, TeeKind } from '../../sim/course/course';
import { GROW_IN_DAYS, GrowMethod, growInCost } from '../../sim/course/lifecycle';
import { validateHole } from '../../sim/course/validate';
import { holePar, longestYards, suggestPar, teeYards } from '../../sim/course/yardage';
import { Command } from '../../sim/commands';
import { Game } from '../../sim/game';
import { h, money } from '../dom';

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
    h('button', { class: 'btn', style: 'margin-top:4px', onclick: a.openGreenTool }, 'Shape green / place pins…'),
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
