import type { Graphics } from 'pixi.js';
import { Vec2 } from '../../core/geom';
import { EditPlan } from '../../sim/construction/plan';
import { brushTiles } from '../../sim/construction/paint';
import { Command } from '../../sim/commands';
import { Game } from '../../sim/game';
import { TILE_PX } from '../../render/camera';
import { h, money } from '../dom';
import { Tool } from './tool';

export interface BrushSpec {
  id: string;
  label: string;
  color: number | (() => number);
  radius?: number;
  maxRadius?: number;
  shape?: 'circle' | 'square';
  /** Plan for these tiles (used for the live cost readout). */
  plan(tiles: Vec2[], start: Vec2): EditPlan;
  /** The command to dispatch for a finished stroke. */
  command(tiles: Vec2[], start: Vec2): Command | null;
  /** Panel body (mode/option selectors); the brush adds the radius row itself. */
  options?(): HTMLElement | null;
  /** Single-click tools (e.g. structures) skip the drag stroke. */
  click?(t: Vec2, e: PointerEvent): void;
  /** When present, click mode is only on while this returns true. */
  clickMode?(): boolean;
  /** Changes whenever an option that affects the plan changes (busts the cost cache). */
  stateKey?(): string;
  clickStatus?(t: Vec2): string;
}

export type BrushTool = Tool & { radius: number; refreshPanel(): void };

/**
 * Generic drag brush: collects the tiles under the brush for the whole stroke,
 * shows the live cost, and dispatches one command on pointer-up (one transaction per stroke).
 */
export function brushTool(g: Game, spec: BrushSpec): BrushTool {
  const max = spec.maxRadius ?? 12;
  let hover: Vec2 | null = null;
  let stroke: Map<number, Vec2> | null = null;
  let start: Vec2 = { x: 0, y: 0 };
  let cache: { key: string; plan: EditPlan } | null = null;
  let panelEl: HTMLElement | null = null;

  g.events.on('edit', () => { cache = null; });
  const isClick = () => !!spec.click && (spec.clickMode?.() ?? true);
  const snap = (t: Vec2): Vec2 => ({ x: Math.floor(t.x), y: Math.floor(t.y) });
  const add = (t: Vec2) => {
    if (!stroke) return;
    for (const p of brushTiles(t.x, t.y, tool.radius, spec.shape)) {
      if (g.world.inBounds(p.x, p.y)) stroke.set(g.world.idx(p.x, p.y), p);
    }
  };
  const current = (): Vec2[] => {
    if (stroke) return [...stroke.values()];
    if (!hover) return [];
    return brushTiles(hover.x, hover.y, tool.radius, spec.shape).filter(p => g.world.inBounds(p.x, p.y));
  };
  const plan = (): EditPlan | null => {
    const tiles = current();
    if (!tiles.length) return null;
    const key = `${stroke ? stroke.size : 'h'}:${hover?.x},${hover?.y}:${tool.radius}:${spec.stateKey?.() ?? ''}`;
    if (cache?.key !== key) cache = { key, plan: spec.plan(tiles, stroke ? start : hover!) };
    return cache.plan;
  };
  const radiusRow = () => {
    const val = h('span', null, String(tool.radius));
    const input = h('input', { type: 'range', min: 0, max, value: tool.radius, oninput: (e: Event) => { tool.radius = Number((e.target as HTMLInputElement).value); val.textContent = String(tool.radius); } });
    return h('div', null, h('label', null, 'Brush radius ', val, h('span', { class: 'muted' }, '  ( [ / ] )')), input);
  };
  const buildPanel = () => h('div', null, h('h3', null, spec.label), spec.options?.() ?? null, isClick() ? null : radiusRow());

  const tool: BrushTool = {
    id: spec.id,
    label: spec.label,
    cursor: 'crosshair',
    radius: spec.radius ?? 2,
    refreshPanel() {
      if (!panelEl) return;
      const next = buildPanel();
      panelEl.replaceChildren(...next.childNodes);
    },
    onPointerDown(t, e) {
      hover = snap(t);
      if (isClick()) { spec.click!(hover, e); cache = null; return; }
      stroke = new Map();
      start = hover;
      add(hover);
    },
    onPointerMove(t) {
      hover = snap(t);
      if (stroke) add(hover);
    },
    onPointerUp() {
      if (!stroke) return;
      const tiles = [...stroke.values()];
      stroke = null;
      cache = null;
      const c = spec.command(tiles, start);
      if (!c) return;
      const before = g.ledger.cash;
      const r = g.dispatch(c);
      if (!r.ok) g.notify('warn', r.reason);
      else if (before - g.ledger.cash > 0) g.notify('info', `${spec.label}: spent ${money(before - g.ledger.cash)}`);
    },
    onKey(e) {
      if (e.key === '[') tool.radius = Math.max(0, tool.radius - 1);
      else if (e.key === ']') tool.radius = Math.min(max, tool.radius + 1);
      else if (e.key === 'Escape') { stroke = null; cache = null; }
      else return;
      tool.refreshPanel();
    },
    onDeactivate() { stroke = null; hover = null; cache = null; panelEl = null; },
    status() {
      if (isClick()) return hover && spec.clickStatus ? spec.clickStatus(hover) : `${spec.label}: click to place`;
      const p = plan();
      if (!p) return `${spec.label}: drag to apply · [ ] brush size`;
      const skip = p.skipped ? ` · ${p.skipped} skipped (${p.reasons.slice(0, 2).join(', ')})` : '';
      const soil = p.stockpileDelta ? ` · soil ${p.stockpileDelta > 0 ? '+' : ''}${Math.round(p.stockpileDelta)} m³` : '';
      const afford = g.ledger.canAfford(Math.round(p.cost)) ? '' : ' · ⚠ not enough cash';
      return `${spec.label} r${tool.radius} · ${p.changes.length} tiles · ${stroke ? 'stroke' : 'brush'} cost ${money(p.cost)}${soil}${skip}${afford}`;
    },
    drawPreview(gfx: Graphics) {
      const tiles = current();
      if (!tiles.length) return;
      for (const t of tiles) gfx.rect(t.x * TILE_PX, t.y * TILE_PX, TILE_PX, TILE_PX);
      gfx.fill({ color: typeof spec.color === 'function' ? spec.color() : spec.color, alpha: stroke ? 0.45 : 0.25 });
    },
    panel() {
      panelEl = buildPanel();
      return panelEl;
    },
  };
  return tool;
}

/** Button group helper for tool option panels. */
export function choice<T extends string | number>(label: string, options: { value: T; text: string }[], get: () => T, set: (v: T) => void): HTMLElement {
  const row = h('div', { style: 'display:flex;flex-wrap:wrap;gap:3px' });
  const render = () => {
    row.replaceChildren(...options.map(o => h('button', { class: `btn${o.value === get() ? ' on' : ''}`, onclick: () => { set(o.value); render(); } }, o.text)));
  };
  render();
  return h('div', null, h('label', null, label), row);
}
