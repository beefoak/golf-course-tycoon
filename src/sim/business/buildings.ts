import { isUnlocked } from '../rating/unlocks';
import { Vec2 } from '../../core/geom';
import { Result, fail, ok } from '../../core/result';
import { commitPlan } from '../construction/plan';
import { clearStroke } from '../construction/undo';
import { emptyPlan } from '../construction/plan';
import type { Game, System } from '../game';
import { Feature, Surface } from '../world/tiles';

export type BuildingKind = 'clubhouse' | 'maintenance' | 'proShop' | 'range' | 'practiceGreen' | 'halfwayHouse' | 'restaurant' | 'cartBarn' | 'parking' | 'lodging';

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
  /** upgrades bought (maintenance: storage, workshop, staffRoom, chemicalStore) */
  upgrades?: string[];
}

export interface BuildingDef {
  w: number;
  h: number;
  /** build cost per tier (tier 1 first) */
  cost: number[];
  roadAdjacent: boolean;
  label: string;
  /** running costs per day (clubhouse: per tier) */
  upkeepPerDay: number;
  /** another building the course must have first */
  requires?: BuildingKind;
  /** must touch this building (an addition to it) */
  adjacentTo?: BuildingKind;
  /** cars (parking), carts (cart barn), rooms (lodging) */
  capacity?: number;
  /** more than one per course */
  multiple?: boolean;
  /** ground it is built as (default: a building) */
  paint?: Surface;
}

export const BUILDING_DEFS: Record<BuildingKind, BuildingDef> = {
  clubhouse: { w: 15, h: 10, cost: [250_000, 900_000, 2_500_000], roadAdjacent: true, label: 'Clubhouse', upkeepPerDay: 300 },
  maintenance: { w: 12, h: 8, cost: [180_000], roadAdjacent: false, label: 'Maintenance building', upkeepPerDay: 120 },
  proShop: { w: 8, h: 6, cost: [120_000], roadAdjacent: false, label: 'Pro shop', upkeepPerDay: 100, requires: 'clubhouse', adjacentTo: 'clubhouse' },
  range: { w: 20, h: 80, cost: [150_000], roadAdjacent: false, label: 'Driving range', upkeepPerDay: 150, requires: 'clubhouse', paint: Surface.Fairway },
  practiceGreen: { w: 12, h: 10, cost: [60_000], roadAdjacent: false, label: 'Practice green', upkeepPerDay: 60, paint: Surface.Green },
  halfwayHouse: { w: 5, h: 5, cost: [90_000], roadAdjacent: false, label: 'Halfway house', upkeepPerDay: 80, requires: 'clubhouse' },
  restaurant: { w: 12, h: 10, cost: [600_000], roadAdjacent: false, label: 'Restaurant', upkeepPerDay: 400, requires: 'clubhouse' },
  cartBarn: { w: 10, h: 6, cost: [100_000], roadAdjacent: false, label: 'Cart barn', upkeepPerDay: 60, requires: 'clubhouse', capacity: 30 },
  parking: { w: 12, h: 10, cost: [40_000], roadAdjacent: true, label: 'Car park', upkeepPerDay: 20, capacity: 25, multiple: true, paint: Surface.Path },
  lodging: { w: 14, h: 10, cost: [1_500_000], roadAdjacent: false, label: 'Lodge', upkeepPerDay: 500, requires: 'clubhouse', capacity: 20 },
};

/** Cars the clubhouse's own lot holds, per clubhouse tier. */
export const CLUBHOUSE_LOT = 10;
/** Each parking space turns over this many times a day (a round is ~4.5 h of a 16 h day). */
export const PARKING_TURNS = 3;

/** Replaced by the reputation system in Task 42. */
export const lodgingHooks = { unlocked: (g: Game, _courseId: number): boolean => isUnlocked(g, 'lodging') };

/** Why a kind can't be built on this course yet (null = it can). */
export function buildingLocked(g: Game, kind: BuildingKind, courseId: number): string | null {
  const def = BUILDING_DEFS[kind];
  if (def.requires && !g.buildings.some(b => b.kind === def.requires && b.courseId === courseId)) return `${def.label} needs a ${BUILDING_DEFS[def.requires].label.toLowerCase()} first`;
  // lodging opens with a 4-star reputation (Task 42 wires the check)
  if (kind === 'lodging' && !lodgingHooks.unlocked(g, courseId)) return 'A lodge needs a 4-star reputation';
  return null;
}

/** Cars that fit on a course's lots (clubhouse lot + car parks). */
export function parkingCapacity(g: Game, courseId: number): number {
  let cars = 0;
  for (const b of g.buildings) {
    if (b.courseId !== courseId) continue;
    if (b.kind === 'clubhouse') cars += CLUBHOUSE_LOT * b.tier;
    if (b.kind === 'parking') cars += BUILDING_DEFS.parking.capacity!;
  }
  return cars;
}
/** Groups (one car each) a course can take in a day. */
export function maxGroupsPerDay(g: Game, courseId: number): number {
  return parkingCapacity(g, courseId) * PARKING_TURNS;
}

/** Upkeep is charged each morning, per course. */
export const buildingSystem: System = {
  name: 'buildings',
  onDay(g) {
    const per = new Map<number, number>();
    for (const b of g.buildings) {
      const u = BUILDING_DEFS[b.kind].upkeepPerDay * (b.kind === 'clubhouse' ? b.tier : 1);
      per.set(b.courseId, (per.get(b.courseId) ?? 0) + u);
    }
    for (const [cid, amt] of per) g.ledger.charge(amt, 'utilities', g.day, cid);
  },
};

/** Clubhouse to the next tier (more prestige, a bigger lot). */
export function upgradeTier(g: Game, buildingId: number): Result<Building> {
  const b = g.buildings.find(x => x.id === buildingId);
  if (!b) return fail('No such building');
  const def = BUILDING_DEFS[b.kind];
  const cost = def.cost[b.tier];
  if (cost === undefined) return fail(`${def.label} is at its top tier`);
  if (!g.ledger.spend(cost, 'construction', g.day, b.courseId)) return fail('Not enough money');
  b.tier++;
  return ok(b);
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** Check a footprint and work out its door, or say why it can't go there. */
export function checkFootprint(g: Game, kind: BuildingKind, origin: Vec2, courseId?: number): Result<{ door: Vec2; tiles: Vec2[] }> {
  const def = BUILDING_DEFS[kind];
  const w = g.world;
  const ox = Math.round(origin.x), oy = Math.round(origin.y);
  const tiles: Vec2[] = [];
  let roadSide: Vec2 | null = null;
  let touches = !def.adjacentTo;
  const host = def.adjacentTo ? g.buildings.filter(b => b.kind === def.adjacentTo && (courseId === undefined || b.courseId === courseId)) : [];
  const inHost = (x: number, y: number) => host.some(b => x >= b.origin.x && x < b.origin.x + b.w && y >= b.origin.y && y < b.origin.y + b.h);
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
      if (!touches && inHost(nx, ny)) touches = true;
    }
  }
  if (def.roadAdjacent && !roadSide) return fail(`${def.label} must be next to the road`);
  if (!touches) return fail(`${def.label} must be built onto the ${BUILDING_DEFS[def.adjacentTo!].label.toLowerCase()}`);
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
  if (!def.multiple && g.buildings.some(b => b.kind === kind && b.courseId === courseId)) return fail(`${course.name} already has a ${def.label.toLowerCase()}`);
  const locked = buildingLocked(g, kind, courseId);
  if (locked) return fail(locked);
  const fp = checkFootprint(g, kind, origin, courseId);
  if (!fp.ok) return fp;
  const plan = emptyPlan();
  for (const t of fp.value.tiles) plan.changes.push({ i: g.world.idx(t.x, t.y), surface: def.paint ?? Surface.Building, treeSpecies: 0 });
  plan.cost = def.cost[0]!;
  const r = commitPlan(g, plan, 'construction');
  if (!r.ok) return r;
  // a building is more than its tiles: not undoable as a stroke
  clearStroke(g);
  const b: Building = { id: g.nextBuildingId++, kind, courseId, tier: 1, origin: { x: Math.round(origin.x), y: Math.round(origin.y) }, w: def.w, h: def.h, door: fp.value.door };
  g.buildings.push(b);
  if (kind === 'clubhouse') course.clubhouse = { ...b.door };
  return ok(b);
}

export function clubhouseOf(g: Game, courseId: number): Building | undefined {
  return g.buildings.find(b => b.kind === 'clubhouse' && b.courseId === courseId);
}
