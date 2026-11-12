import { activeCourseId } from '../../sim/course/active';
import type { Graphics } from 'pixi.js';
import { Vec2 } from '../../core/geom';
import { BUILDING_DEFS, BuildingKind, buildingLocked, checkFootprint } from '../../sim/business/buildings';
import { Game } from '../../sim/game';
import { TILE_PX } from '../../render/camera';
import { h, money } from '../dom';
import { Tool } from './tool';

export const BUILDING_BLURB: Record<BuildingKind, string> = {
  clubhouse: 'Golfers arrive and leave through the yellow door. A course needs a clubhouse and at least one open hole before golfers come. Its own lot holds 10 cars per tier.',
  maintenance: 'Off the holes. Stores up to 20 machines (40 with the storage upgrade), lets you hire more than 3 greenkeepers, and unlocks mechanics and spray techs.',
  proShop: 'Built onto the clubhouse. Sells balls, gear and clubs; home of the head pro.',
  range: 'A practice range golfers warm up on before their round (ball buckets earn money).',
  practiceGreen: 'A putting green by the clubhouse. Golfers like a warm-up putt.',
  halfwayHouse: 'Snacks and drinks out on the course — best near the turn.',
  restaurant: 'Lunch and dinner after the round; needs cooks and servers.',
  cartBarn: 'Stores and charges up to 30 rental carts.',
  parking: 'Beside the road. 25 more cars: each car is one group, and each space turns over about three times a day.',
  lodging: 'Stay-and-play packages for travelling golfers.',
};

/** Place one kind of building (fixed, or picked from a list via `kindOf`). */
export function buildingPlacer(g: Game, kindOf: () => BuildingKind, id: string, label: string, extraPanel?: () => HTMLElement | null): Tool & { refresh?: () => void } {
  let hover: Vec2 | null = null;
  const def = () => BUILDING_DEFS[kindOf()];
  const origin = (t: Vec2): Vec2 => ({ x: Math.floor(t.x - def().w / 2), y: Math.floor(t.y - def().h / 2) });
  const courseId = () => (activeCourseId(g) || null);
  const blocker = (): string | null => {
    const id = courseId();
    const k = kindOf();
    if (id === null) return buildingLocked(g, k, 0);
    if (!def().multiple && g.buildings.some(b => b.kind === k && b.courseId === id)) return `This course already has a ${def().label.toLowerCase()}`;
    return buildingLocked(g, k, id);
  };
  return {
    id, label, cursor: 'crosshair',
    onPointerMove(t) { hover = origin(t); },
    onPointerDown(t) {
      let cid = courseId();
      if (cid === null) { g.dispatch({ t: 'createCourse', name: 'Course 1' }); cid = courseId()!; }
      const k = kindOf();
      const r = g.dispatch({ t: 'placeBuilding', kind: k, courseId: cid, origin: origin(t) });
      g.notify(r.ok ? 'info' : 'warn', r.ok ? `${def().label} built (${money(def().cost[0]!)})${k === 'clubhouse' ? ' — golfers can now book tee times' : ''}` : r.reason);
    },
    status() {
      const why = blocker();
      if (why) return why;
      const d = def();
      if (!hover) return `${d.label} ${money(d.cost[0]!)}${d.roadAdjacent ? ' · must touch the road' : ''}`;
      const fp = checkFootprint(g, kindOf(), hover, courseId() ?? undefined);
      return fp.ok ? `${d.label} ${money(d.cost[0]!)} · ${money(d.upkeepPerDay)}/day upkeep · click to build` : `${d.label}: ${fp.reason}`;
    },
    drawPreview(gfx: Graphics) {
      if (!hover) return;
      const d = def();
      const ok = checkFootprint(g, kindOf(), hover, courseId() ?? undefined);
      const fine = ok.ok && !blocker();
      gfx.rect(hover.x * TILE_PX, hover.y * TILE_PX, d.w * TILE_PX, d.h * TILE_PX).fill({ color: fine ? 0x80ff80 : 0xff6060, alpha: 0.35 }).stroke({ width: 3, color: 0xffffff });
      if (ok.ok) gfx.rect(ok.value.door.x * TILE_PX, ok.value.door.y * TILE_PX, TILE_PX, TILE_PX).fill({ color: 0xffe066, alpha: 0.9 });
    },
    panel() {
      const d = def();
      return h('div', null,
        extraPanel?.() ?? h('h3', null, d.label),
        h('div', { class: 'muted' }, `${money(d.cost[0]!)} · ${d.w}×${d.h} tiles · ${money(d.upkeepPerDay)}/day upkeep${d.roadAdjacent ? ' · touching the road' : ''}`),
        h('div', { class: 'muted', style: 'margin-top:4px' }, BUILDING_BLURB[kindOf()]),
        blocker() ? h('div', { class: 'warnline', style: 'margin-top:4px' }, blocker()) : null);
    },
  };
}

/** The clubhouse (15×10, beside the road) or the maintenance building (12×8). */
export function clubhouseTool(g: Game, kind: BuildingKind = 'clubhouse'): Tool {
  return buildingPlacer(g, () => kind, kind, kind === 'clubhouse' ? 'Clubhouse' : 'Maintenance');
}
