import type { Graphics } from 'pixi.js';
import { Vec2 } from '../../core/geom';
import { TeeKind } from '../../sim/course/course';
import { brushTiles } from '../../sim/construction/paint';
import { Game } from '../../sim/game';
import { Surface } from '../../sim/world/tiles';
import { TILE_PX } from '../../render/camera';
import { Inspector } from '../inspector';
import { holePanel } from '../panels/holePanel';
import { HoleSelection } from '../selection';
import { Tool } from './tool';

/**
 * Select a hole by clicking it; the inspector shows its hole panel.
 * Tee placement: the panel's Add/Move puts the tool into placement mode; the click adds/moves the
 * tee box and paints a 5×3 tee pad.
 */
export function holeTool(g: Game, sel: HoleSelection, inspector: Inspector, openGreenTool: () => void): Tool & { render(): void } {
  let placing: TeeKind | null = null;
  let hover: Vec2 | null = null;
  let panelEl: HTMLElement | null = null;

  const render = () => {
    if (!panelEl || !inspector.isOwner(tool)) return;
    panelEl.replaceChildren(sel.id ? holePanel(g, sel.id, actions) : emptyBody());
  };
  const emptyBody = () => {
    const d = document.createElement('div');
    d.innerHTML = '<h3>Holes</h3><div class="muted">Click a hole on the map to select it. Draw new holes with the Fairway Pen.</div>';
    for (const c of g.courses.list) for (const ho of c.holes) {
      const b = document.createElement('button');
      b.className = 'btn'; b.style.margin = '2px'; b.textContent = `#${ho.number} ${ho.name}`;
      b.onclick = () => sel.set(ho.id);
      d.appendChild(b);
    }
    return d;
  };
  const actions = {
    placeTee: (k: TeeKind) => { placing = placing === k ? null : k; render(); },
    placingTee: () => placing,
    openGreenTool,
    refresh: render,
  };
  sel.onChange(() => { placing = null; render(); });
  for (const ev of ['edit', 'day', 'cash'] as const) g.events.on(ev, () => render());

  const tool: Tool & { render(): void } = {
    id: 'hole',
    label: 'Holes',
    cursor: 'pointer',
    render,
    onPointerMove(t) { hover = { x: Math.floor(t.x), y: Math.floor(t.y) }; },
    onPointerDown(t) {
      const p = { x: Math.floor(t.x), y: Math.floor(t.y) };
      if (placing && sel.id) {
        const ho = g.courses.hole(sel.id)!;
        const exists = ho.teeBoxes.some(x => x.kind === placing);
        const r = g.dispatch(exists ? { t: 'moveTeeBox', holeId: ho.id, kind: placing, center: p } : { t: 'addTeeBox', holeId: ho.id, kind: placing, center: p });
        if (!r.ok) { g.notify('warn', r.reason); return; }
        const pad = brushTiles(p.x, p.y, 1, 'square').concat([{ x: p.x - 2, y: p.y - 1 }, { x: p.x - 2, y: p.y }, { x: p.x - 2, y: p.y + 1 }, { x: p.x + 2, y: p.y - 1 }, { x: p.x + 2, y: p.y }, { x: p.x + 2, y: p.y + 1 }]);
        const paint = g.dispatch({ t: 'paint', tiles: pad, surface: Surface.Tee });
        if (!paint.ok) g.notify('warn', `Tee box placed, but the pad wasn't painted: ${paint.reason}`);
        placing = null;
        render();
        return;
      }
      const id = g.world.inBounds(p.x, p.y) ? g.world.holeId[g.world.idx(p.x, p.y)]! : 0;
      sel.set(id || null);
      render();
    },
    onKey(e) {
      if (e.key === 'Escape') { if (placing) { placing = null; render(); } else sel.set(null); }
    },
    status() {
      if (placing) return `Click to place the ${placing} tee · Esc cancels`;
      if (!hover || !g.world.inBounds(hover.x, hover.y)) return 'Holes: click a hole to select it';
      const id = g.world.holeId[g.world.idx(hover.x, hover.y)]!;
      const ho = id ? g.courses.hole(id) : null;
      return ho ? `${ho.name} · click to select` : 'Holes: click a hole to select it';
    },
    drawPreview(gfx: Graphics) {
      if (placing && hover) gfx.rect((hover.x - 2) * TILE_PX, (hover.y - 1) * TILE_PX, 5 * TILE_PX, 3 * TILE_PX).fill({ color: 0xffffff, alpha: 0.35 });
    },
    panel() {
      panelEl = document.createElement('div');
      queueMicrotask(render);
      return panelEl;
    },
    onDeactivate() { placing = null; panelEl = null; },
  };
  return tool;
}
