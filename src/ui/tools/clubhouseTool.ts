import type { Graphics } from 'pixi.js';
import { Vec2 } from '../../core/geom';
import { BUILDING_DEFS, BuildingKind, checkFootprint } from '../../sim/business/buildings';
import { Game } from '../../sim/game';
import { TILE_PX } from '../../render/camera';
import { h, money } from '../dom';
import { Tool } from './tool';

const BLURB: Record<BuildingKind, (cost: string) => string> = {
  clubhouse: c => `Tier 1: ${c}. 15×10 tiles on owned land, touching the road. Golfers arrive and leave through the yellow door. A course needs a clubhouse and at least one open hole before golfers come.`,
  maintenance: c => `${c}. 12×8 tiles on owned land, off the holes. Stores up to 20 machines (40 with the storage upgrade), lets you hire more than 3 greenkeepers, and unlocks mechanics and spray techs.`,
};

/** Place a course building: the clubhouse (15×10, beside the road) or the maintenance building (12×8). */
export function clubhouseTool(g: Game, kind: BuildingKind = 'clubhouse'): Tool {
  const def = BUILDING_DEFS[kind];
  const name = def.label;
  let hover: Vec2 | null = null;
  const origin = (t: Vec2): Vec2 => ({ x: Math.floor(t.x - def.w / 2), y: Math.floor(t.y - def.h / 2) });
  const courseId = () => g.courses.list[0]?.id ?? null;
  return {
    id: kind,
    label: kind === 'clubhouse' ? 'Clubhouse' : 'Maintenance',
    cursor: 'crosshair',
    onPointerMove(t) { hover = origin(t); },
    onPointerDown(t) {
      let id = courseId();
      if (id === null) { g.dispatch({ t: 'createCourse', name: 'Course 1' }); id = courseId()!; }
      const r = g.dispatch({ t: 'placeBuilding', kind, courseId: id, origin: origin(t) });
      g.notify(r.ok ? 'info' : 'warn', r.ok ? `${name} built (${money(def.cost[0]!)})${kind === 'clubhouse' ? ' — golfers can now book tee times' : ''}` : r.reason);
    },
    status() {
      const id = courseId();
      if (id !== null && g.buildings.some(b => b.kind === kind && b.courseId === id)) return `This course already has a ${name.toLowerCase()}`;
      if (!hover) return `${name} ${money(def.cost[0]!)}${def.roadAdjacent ? ' · must touch the road' : ''}`;
      const fp = checkFootprint(g, kind, hover);
      return fp.ok ? `${name} ${money(def.cost[0]!)} · click to build` : `${name}: ${fp.reason}`;
    },
    drawPreview(gfx: Graphics) {
      if (!hover) return;
      const ok = checkFootprint(g, kind, hover);
      gfx.rect(hover.x * TILE_PX, hover.y * TILE_PX, def.w * TILE_PX, def.h * TILE_PX).fill({ color: ok.ok ? 0x80ff80 : 0xff6060, alpha: 0.35 }).stroke({ width: 3, color: 0xffffff });
      if (ok.ok) gfx.rect(ok.value.door.x * TILE_PX, ok.value.door.y * TILE_PX, TILE_PX, TILE_PX).fill({ color: 0xffe066, alpha: 0.9 });
    },
    panel() {
      return h('div', null, h('h3', null, name), h('div', { class: 'muted' }, BLURB[kind](money(def.cost[0]!))));
    },
  };
}
