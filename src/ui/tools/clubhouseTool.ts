import type { Graphics } from 'pixi.js';
import { Vec2 } from '../../core/geom';
import { BUILDING_DEFS, checkFootprint, clubhouseOf } from '../../sim/business/buildings';
import { Game } from '../../sim/game';
import { TILE_PX } from '../../render/camera';
import { h, money } from '../dom';
import { Tool } from './tool';

/** Place the course's clubhouse (15×10 tiles, beside the road). */
export function clubhouseTool(g: Game): Tool {
  const def = BUILDING_DEFS.clubhouse;
  let hover: Vec2 | null = null;
  const origin = (t: Vec2): Vec2 => ({ x: Math.floor(t.x - def.w / 2), y: Math.floor(t.y - def.h / 2) });
  const courseId = () => g.courses.list[0]?.id ?? null;
  return {
    id: 'clubhouse',
    label: 'Clubhouse',
    cursor: 'crosshair',
    onPointerMove(t) { hover = origin(t); },
    onPointerDown(t) {
      let id = courseId();
      if (id === null) { g.dispatch({ t: 'createCourse', name: 'Course 1' }); id = courseId()!; }
      const r = g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId: id, origin: origin(t) });
      g.notify(r.ok ? 'info' : 'warn', r.ok ? `Clubhouse built (${money(def.cost[0]!)}) — golfers can now book tee times` : r.reason);
    },
    status() {
      const id = courseId();
      if (id !== null && clubhouseOf(g, id)) return 'This course already has a clubhouse';
      if (!hover) return `Clubhouse ${money(def.cost[0]!)} · must touch the road`;
      const fp = checkFootprint(g, 'clubhouse', hover);
      return fp.ok ? `Clubhouse ${money(def.cost[0]!)} · click to build` : `Clubhouse: ${fp.reason}`;
    },
    drawPreview(gfx: Graphics) {
      if (!hover) return;
      const ok = checkFootprint(g, 'clubhouse', hover);
      gfx.rect(hover.x * TILE_PX, hover.y * TILE_PX, def.w * TILE_PX, def.h * TILE_PX).fill({ color: ok.ok ? 0x80ff80 : 0xff6060, alpha: 0.35 }).stroke({ width: 3, color: 0xffffff });
      if (ok.ok) gfx.rect(ok.value.door.x * TILE_PX, ok.value.door.y * TILE_PX, TILE_PX, TILE_PX).fill({ color: 0xffe066, alpha: 0.9 });
    },
    panel() {
      return h('div', null, h('h3', null, 'Clubhouse'),
        h('div', { class: 'muted' }, `Tier 1: ${money(def.cost[0]!)}. 15×10 tiles on owned land, touching the road. Golfers arrive and leave through the yellow door. A course needs a clubhouse and at least one open hole before golfers come.`));
    },
  };
}
