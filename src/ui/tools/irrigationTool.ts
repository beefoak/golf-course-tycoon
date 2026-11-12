import { activeCourseId } from '../../sim/course/active';
import { Vec2 } from '../../core/geom';
import { emptyPlan } from '../../sim/construction/plan';
import { Game } from '../../sim/game';
import { PIPE_COST_PER_TILE, PUMP_TIERS, PumpTier, REPAIR_COST, SPRINKLER_COST, coverage, droughtActive, planPipe } from '../../sim/turf/irrigation';
import { h, money } from '../dom';
import { brushTool, choice } from './brush';

type Mode = 'pipe' | 'sprinkler' | 'pump' | 'repair';

/** Irrigation: pump house, pipe runs, sprinkler heads by zone, and the nightly schedule. */
export function irrigationTool(g: Game) {
  let mode: Mode = 'sprinkler';
  let zone = 1;
  let tier: PumpTier = 1;
  const nearest = (t: Vec2) => {
    let best = null as Game['irrigation']['sprinklers'][number] | null, bd = 2.5;
    for (const s of g.irrigation.sprinklers) { const d = Math.hypot(s.pos.x - t.x, s.pos.y - t.y); if (d < bd) { bd = d; best = s; } }
    return best;
  };
  const say = (r: { ok: boolean; reason?: string }, okText: string) => g.notify(r.ok ? 'info' : 'warn', r.ok ? okText : r.reason ?? 'Not possible');

  const schedule = () => {
    const zones = [...new Set(g.irrigation.sprinklers.map(s => s.zone))].sort((a, b) => a - b);
    if (!zones.length) return h('div', { class: 'muted' }, 'No sprinklers yet.');
    const minutes = (z: number) => g.irrigation.schedule.find(x => x.zone === z)?.minutes ?? 0;
    return h('div', null, ...zones.map(z => h('div', { class: 'row' },
      h('span', { class: 'muted' }, `Zone ${z} (${g.irrigation.sprinklers.filter(s => s.zone === z).length} heads)`),
      h('input', { type: 'number', min: 0, max: 120, step: 5, value: minutes(z), style: 'width:60px;background:var(--panel-2);color:var(--text);border:2px solid var(--line);font:inherit;padding:2px',
        onchange: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          const next = zones.map(zz => ({ zone: zz, minutes: zz === z ? v : minutes(zz) }));
          const r = g.dispatch({ t: 'setIrrigationSchedule', schedule: next });
          if (!r.ok) g.notify('warn', r.reason);
        } }), h('span', { class: 'muted' }, 'min'))));
  };

  const tool = brushTool(g, {
    id: 'irrigation', label: 'Irrigation', color: () => (mode === 'pipe' ? 0x2050c0 : 0x60c0ff), radius: 0, maxRadius: 1, shape: 'square',
    stateKey: () => mode,
    clickMode: () => mode !== 'pipe',
    plan: tiles => (mode === 'pipe' ? planPipe(g, tiles) : emptyPlan()),
    command: tiles => (mode === 'pipe' ? { t: 'placePipe', tiles } : null),
    click: (t, e) => {
      if (mode === 'pump') say(g.dispatch({ t: 'placePump', at: t, tier }), `Pump house (tier ${tier}) built`);
      else if (mode === 'sprinkler') say(g.dispatch({ t: 'placeSprinkler', at: t, zone }), `Sprinkler added to zone ${zone} (${money(SPRINKLER_COST)})`);
      else {
        const s = nearest(t);
        if (!s) { g.notify('warn', 'No sprinkler there'); return; }
        if (e.shiftKey) say(g.dispatch({ t: 'removeSprinkler', id: s.id }), 'Sprinkler removed');
        else say(g.dispatch({ t: 'repairSprinkler', id: s.id }), `Sprinkler repaired (${money(REPAIR_COST)})`);
      }
      tool.refreshPanel();
    },
    clickStatus: t => {
      if (mode === 'pump') return `Pump house tier ${tier} · ${money(PUMP_TIERS[tier].cost)} · ${PUMP_TIERS[tier].capacityM3PerNight} m³/night · click to build (3×3)`;
      if (mode === 'sprinkler') return `Sprinkler · zone ${zone} · ${money(SPRINKLER_COST)} · 18 m throw · must sit on or beside a pipe`;
      const s = nearest(t);
      return s ? `Sprinkler #${s.id} zone ${s.zone}${s.broken ? ' · BROKEN — click to repair' : ' · working'} · shift-click to remove` : 'Click a sprinkler to repair · shift-click to remove';
    },
    options: () => {
      const irr = g.irrigation;
      const cid = activeCourseId(g) || undefined;
      return h('div', null,
        choice('Place', [
          { value: 'sprinkler', text: 'Sprinkler' }, { value: 'pipe', text: `Pipe ${money(PIPE_COST_PER_TILE)}/tile` },
          { value: 'pump', text: 'Pump house' }, { value: 'repair', text: 'Repair' },
        ] as { value: Mode; text: string }[], () => mode, v => { mode = v; tool.refreshPanel(); }),
        mode === 'sprinkler' ? choice('Zone', [1, 2, 3, 4, 5, 6, 7, 8].map(z => ({ value: z, text: String(z) })), () => zone, v => { zone = v; }) : null,
        mode === 'pump' ? choice('Size', ([1, 2, 3] as PumpTier[]).map(t => ({ value: t, text: `${PUMP_TIERS[t].capacityM3PerNight} m³ ${money(PUMP_TIERS[t].cost)}` })), () => tier, v => { tier = v; }) : null,
        h('label', null, 'Night schedule'),
        schedule(),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Pump'), h('span', null, irr.pump ? `${irr.pump.capacityM3PerNight} m³/night${droughtActive(g) ? ' (drought: half)' : ''}` : 'none')),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Last night'), h('span', null, `${Math.round(irr.lastNight.m3)} m³ · ${money(irr.lastNight.cost)}${irr.lastNight.limited ? ' · pump maxed' : ''}`)),
        cid ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Turf coverage'), h('span', null, `${Math.round(coverage(g, cid) * 100)}%`)) : null,
        h('div', { class: 'muted', style: 'margin-top:6px' }, 'Lay pipe from the pump house; heads must touch a pipe. Use the Irrigation and Moisture overlays to check coverage.'));
    },
  });
  // nightly watering changes the readout
  g.events.on('day', () => tool.refreshPanel());
  return tool;
}
