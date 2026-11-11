import { Vec2 } from '../../core/geom';
import { Result, fail, ok } from '../../core/result';
import { commitPlan } from '../construction/plan';
import { emptyPlan } from '../construction/plan';
import type { Game } from '../game';
import { Feature, Surface } from '../world/tiles';

export type BuildingKind = 'clubhouse';

export interface Building {
  id: number;
  kind: BuildingKind;
  courseId: number;
  tier: number;
  origin: Vec2;
  w: number;
  h: number;
  /** walkable tile in front of the building where golfers arrive and leave */
  door: Vec2;
}

export interface BuildingDef { w: number; h: number; cost: number[]; roadAdjacent: boolean; label: string }

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  clubhouse: { w: 15, h: 10, cost: [250_000, 900_000, 2_500_000], roadAdjacent: true, label: 'Clubhouse' },
};

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Check a footprint and work out its door, or say why it can't go there. */
export function checkFootprint(g: Game, kind: BuildingKind, origin: Vec2): Result<{ door: Vec2; tiles: Vec2[] }> {
  const def = BUILDING_DEFS[kind];
  const w = g.world;
  const ox = Math.round(origin.x), oy = Math.round(origin.y);
  const tiles: Vec2[] = [];
  let roadSide: Vec2 | null = null;
  for (let y = oy; y < oy + def.h; y++) for (let x = ox; x < ox + def.w; x++) {
    if (!w.inBounds(x, y) || !g.parcels.tileOwned(x, y)) return fail(`${def.label} must be on land you own`);
    const i = w.idx(x, y);
    if (w.holeId[i]) return fail(`${def.label} can't overlap a hole`);
    const s = w.surface[i] as Surface;
    if (s === Surface.Water || s === Surface.Building || s === Surface.Path && w.feature[i] === Feature.Road) return fail(`${def.label} needs clear ground`);
    const f = w.feature[i] as Feature;
    if (f === Feature.Rock || f === Feature.Creek || f === Feature.Wetland || f === Feature.SpecimenTree) return fail(`${def.label} needs clear ground (rock, creek, wetland or specimen tree in the way)`);
    tiles.push({ x, y });
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (w.inBounds(nx, ny) && w.feature[w.idx(nx, ny)] === Feature.Road) roadSide = { x: dx, y: dy };
    }
  }
  if (def.roadAdjacent && !roadSide) return fail(`${def.label} must be next to the road`);
  // door on the side facing away from the road (toward the course)
  const away = roadSide ? { x: -roadSide.x, y: -roadSide.y } : { x: 0, y: -1 };
  const door = {
    x: away.x === 0 ? ox + Math.floor(def.w / 2) : away.x > 0 ? ox + def.w : ox - 1,
    y: away.y === 0 ? oy + Math.floor(def.h / 2) : away.y > 0 ? oy + def.h : oy - 1,
  };
  return ok({ door, tiles });
}

/** Build a tier-1 building: paints Surface.Building, charges construction, records it. */
export function placeBuilding(g: Game, kind: BuildingKind, courseId: number, origin: Vec2): Result<Building> {
  const def = BUILDING_DEFS[kind];
  const course = g.courses.get(courseId);
  if (!course) return fail('No such course');
  if (kind === 'clubhouse' && g.buildings.some(b => b.kind === 'clubhouse' && b.courseId === courseId)) return fail(`${course.name} already has a clubhouse`);
  const fp = checkFootprint(g, kind, origin);
  if (!fp.ok) return fp;
  const plan = emptyPlan();
  for (const t of fp.value.tiles) plan.changes.push({ i: g.world.idx(t.x, t.y), surface: Surface.Building, treeSpecies: 0 });
  plan.cost = def.cost[0]!;
  const r = commitPlan(g, plan, 'construction');
  if (!r.ok) return r;
  const b: Building = { id: g.nextBuildingId++, kind, courseId, tier: 1, origin: { x: Math.round(origin.x), y: Math.round(origin.y) }, w: def.w, h: def.h, door: fp.value.door };
  g.buildings.push(b);
  if (kind === 'clubhouse') course.clubhouse = { ...b.door };
  return ok(b);
}

export function clubhouseOf(g: Game, courseId: number): Building | undefined {
  return g.buildings.find(b => b.kind === 'clubhouse' && b.courseId === courseId);
}
