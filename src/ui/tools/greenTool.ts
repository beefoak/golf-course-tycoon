import { Vec2 } from '../../core/geom';
import { emptyPlan } from '../../sim/construction/plan';
import { MAX_PINS } from '../../sim/course/course';
import { autoPins, greenTiles, pinnableTiles, planGreenShape } from '../../sim/course/green';
import { Game } from '../../sim/game';
import { rgba } from '../../render/atlas';
import { ChunkRenderer } from '../../render/chunks';
import { h } from '../dom';
import { HoleSelection } from '../selection';
import { brushTool, choice } from './brush';
import { TERRAIN_MODES, TerrainMode, terrainOp } from './terrainTool';

/** Green speed used for pin rules until maintenance sets per-course speeds. */
export const DEFAULT_STIMP = 10;

type Mode = TerrainMode | 'pins';

/**
 * Green shaping limited to the selected hole's green/fringe, with the pinnable area overlaid live,
 * and a pin placement mode (click adds, shift-click removes the nearest).
 */
export function greenTool(g: Game, sel: HoleSelection, chunks: ChunkRenderer, restoreOverlay: () => void) {
  let mode: Mode = 'pins';
  let amount = 0.1;
  let pinnable: Set<number> | null = null;
  let active = false;
  const hole = () => (sel.id ? g.courses.hole(sel.id) ?? null : null);

  const overlay = () => {
    const ho = hole();
    pinnable = null;
    if (!ho) { chunks.setOverlay(null); return; }
    chunks.setOverlay((x, y) => {
      const i = g.world.idx(x, y);
      if (g.world.holeId[i] !== ho.id) return null;
      if (!pinnable) pinnable = new Set(pinnableTiles(g, ho, DEFAULT_STIMP));
      if (pinnable.has(i)) return rgba(0x40ff60, 90);
      return greenTilesSet(ho).has(i) ? rgba(0xff4040, 90) : null;
    });
  };
  let greenCache: { id: number; set: Set<number> } | null = null;
  const greenTilesSet = (ho: { id: number }) => {
    if (greenCache?.id !== ho.id) greenCache = { id: ho.id, set: new Set(greenTiles(g, g.courses.hole(ho.id)!)) };
    return greenCache.set;
  };
  g.events.on('edit', () => { if (active) { pinnable = null; greenCache = null; chunks.refreshOverlay(); tool.refreshPanel(); } });
  sel.onChange(() => { if (active) { greenCache = null; overlay(); tool.refreshPanel(); } });

  const selectAt = (t: Vec2): boolean => {
    const id = g.world.inBounds(t.x, t.y) ? g.world.holeId[g.world.idx(t.x, t.y)]! : 0;
    if (id && id !== sel.id) { sel.set(id); return true; }
    return false;
  };
  const setPins = (pins: Vec2[]) => {
    const ho = hole();
    if (!ho) return;
    const r = g.dispatch({ t: 'setPins', holeId: ho.id, pins });
    if (!r.ok) g.notify('warn', r.reason);
    tool.refreshPanel();
  };

  const tool = brushTool(g, {
    id: 'green', label: 'Green', color: 0x40ff60, radius: 2, maxRadius: 6,
    stateKey: () => `${mode}:${amount}:${sel.id}`,
    plan: (tiles, start) => {
      const ho = hole();
      return ho && mode !== 'pins' ? planGreenShape(g, ho, terrainOp(g, mode, amount, start), tiles) : emptyPlan();
    },
    command: (tiles, start) => {
      const ho = hole();
      if (!ho || mode === 'pins') return null;
      return { t: 'shapeGreen', holeId: ho.id, tiles, op: terrainOp(g, mode, amount, start) };
    },
    clickMode: () => mode === 'pins' || !hole(),
    click: (t, e) => {
      if (selectAt(t)) return;
      const ho = hole();
      if (!ho) { g.notify('warn', 'Click a hole to select it first'); return; }
      if (e.shiftKey) {
        if (!ho.pins.length) return;
        let best = 0;
        ho.pins.forEach((p, i) => { if (Math.hypot(p.x - t.x, p.y - t.y) < Math.hypot(ho.pins[best]!.x - t.x, ho.pins[best]!.y - t.y)) best = i; });
        setPins(ho.pins.filter((_, i) => i !== best));
        return;
      }
      if (ho.pins.length >= MAX_PINS) { g.notify('warn', `At most ${MAX_PINS} pin positions`); return; }
      const i = g.world.idx(t.x, t.y);
      if (!pinnable) pinnable = new Set(pinnableTiles(g, ho, DEFAULT_STIMP));
      if (!pinnable.has(i)) g.notify('warn', 'Too steep or too close to the edge for a pin here');
      else setPins([...ho.pins, t]);
    },
    clickStatus: t => {
      const ho = hole();
      if (!ho) return 'Green: click a hole to select it';
      if (mode !== 'pins') return 'Green: click a hole to select it';
      const i = g.world.inBounds(t.x, t.y) ? g.world.idx(t.x, t.y) : -1;
      const ok = i >= 0 && (pinnable?.has(i) ?? false);
      return `${ho.name} pins ${ho.pins.length}/${MAX_PINS} · ${ok ? 'pinnable here' : 'not pinnable here'} · click adds, shift-click removes nearest · green = pinnable, red = too steep/edge`;
    },
    options: () => {
      const ho = hole();
      if (!ho) return h('div', { class: 'muted' }, 'Click a hole on the map to select it.');
      return h('div', null,
        h('div', null, `${ho.name} · ${ho.pins.length} pins · ${(pinnable ??= new Set(pinnableTiles(g, ho, DEFAULT_STIMP))).size} pinnable tiles`),
        choice('Mode', [{ value: 'pins', text: 'Place pins' }, ...TERRAIN_MODES] as { value: Mode; text: string }[], () => mode, v => { mode = v; tool.refreshPanel(); }),
        mode !== 'pins' ? choice('Amount per stroke', [0.05, 0.1, 0.25].map(v => ({ value: v, text: `${v} m` })), () => amount, v => { amount = v; }) : null,
        h('div', { style: 'margin-top:8px;display:flex;gap:4px' },
          h('button', { class: 'btn', onclick: () => setPins(autoPins(g, ho, DEFAULT_STIMP, 4)) }, 'Auto-place 4 pins'),
          h('button', { class: 'btn', onclick: () => setPins([]) }, 'Clear pins')),
        h('div', { class: 'muted', style: 'margin-top:6px' }, `Pins need a gentle slope (Stimp ${DEFAULT_STIMP}) and 2+ tiles from the edge.`));
    },
  });

  const basePanel = tool.panel!.bind(tool);
  const baseDeactivate = tool.onDeactivate!.bind(tool);
  tool.panel = () => { active = true; overlay(); return basePanel(); };
  tool.onDeactivate = () => { active = false; chunks.setOverlay(null); restoreOverlay(); baseDeactivate(); };
  return tool;
}
