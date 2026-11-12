import { Vec2 } from '../../core/geom';
import { Result, fail, ok } from '../../core/result';
import { Rng } from '../../core/rng';
import { addReason, emptyPlan, EditPlan } from '../construction/plan';
import type { Game, System } from '../game';
import { registerSaveable } from '../saveRegistry';
import { Feature, Surface } from '../world/tiles';
import { TERRAINS } from '../world/terrainTypes';
import { Grass } from './grasses';

export const SPRINKLER_RADIUS = 9; // tiles (18 m)
export const SPRINKLER_COST = 900;
export const PIPE_COST_PER_TILE = 15;
export const REPAIR_COST = 150;
export const WATER_COST_PER_M3 = 0.6;
/** Water a head throws per minute of run time. */
export const SPRINKLER_M3_PER_MIN = 0.4;
/** Moisture points a tile gains per minute under a full-pressure head. */
export const MOISTURE_PER_MIN = 1.5;
export const BREAK_CHANCE_PER_NIGHT = 0.002;
export const PUMP_SIZE = 3;

export type PumpTier = 1 | 2 | 3;
export const PUMP_TIERS: Record<PumpTier, { capacityM3PerNight: number; cost: number }> = {
  1: { capacityM3PerNight: 400, cost: 60_000 },
  2: { capacityM3PerNight: 900, cost: 140_000 },
  3: { capacityM3PerNight: 2000, cost: 300_000 },
};

export interface Sprinkler { id: number; pos: Vec2; radiusTiles: number; zone: number; broken: boolean }
export interface PumpHouse { pos: Vec2; capacityM3PerNight: number; tier: PumpTier }
export interface IrrigationSystem {
  pump: PumpHouse | null;
  sprinklers: Sprinkler[];
  /** pipe runs as laid (one per stroke) */
  pipes: Vec2[][];
  schedule: { zone: number; minutes: number }[];
  nextSprinklerId: number;
  droughtUntilDay: number;
  /** last night's watering, for the panel */
  lastNight: { m3: number; cost: number; limited: boolean };
  rng: Rng;
}

export function newIrrigation(seedRng: Rng): IrrigationSystem {
  return { pump: null, sprinklers: [], pipes: [], schedule: [], nextSprinklerId: 1, droughtUntilDay: 0, lastNight: { m3: 0, cost: 0, limited: false }, rng: seedRng.fork('irrigation') };
}

// --- placement ---
function buildable(g: Game, x: number, y: number): string | null {
  const w = g.world;
  if (!w.inBounds(x, y)) return 'off the map';
  if (!g.parcels.tileOwned(x, y)) return "land you don't own";
  const i = w.idx(x, y);
  const s = w.surface[i] as Surface;
  if (s === Surface.Water || s === Surface.Building) return 'water or buildings';
  const f = w.feature[i] as Feature;
  if (f === Feature.Rock || f === Feature.Road || f === Feature.Neighbor) return 'rock or roads';
  return null;
}

export function placePump(g: Game, at: Vec2, tier: PumpTier): Result<PumpHouse> {
  const irr = g.irrigation;
  if (irr.pump && irr.pump.tier >= tier) return fail('You already have a pump house this size or bigger');
  const spec = PUMP_TIERS[tier];
  // upgrading in place keeps the existing building
  if (irr.pump) {
    const cost = spec.cost - PUMP_TIERS[irr.pump.tier].cost;
    if (!g.ledger.spend(cost, 'construction', g.day)) return fail(`Not enough money ($${cost.toLocaleString()} needed)`);
    irr.pump = { ...irr.pump, tier, capacityM3PerNight: spec.capacityM3PerNight };
    return ok(irr.pump);
  }
  const ox = Math.round(at.x) - 1, oy = Math.round(at.y) - 1;
  const w = g.world;
  for (let y = oy; y < oy + PUMP_SIZE; y++) for (let x = ox; x < ox + PUMP_SIZE; x++) {
    const why = buildable(g, x, y);
    if (why) return fail(`Can't build the pump house on ${why}`);
    const s = w.surface[w.idx(x, y)] as Surface;
    if (s === Surface.Green || s === Surface.Bunker || w.holeId[w.idx(x, y)]) return fail('Keep the pump house off the holes');
  }
  if (!g.ledger.spend(spec.cost, 'construction', g.day)) return fail(`Not enough money ($${spec.cost.toLocaleString()} needed)`);
  for (let y = oy; y < oy + PUMP_SIZE; y++) for (let x = ox; x < ox + PUMP_SIZE; x++) {
    const i = w.idx(x, y);
    w.surface[i] = Surface.Building; w.grass[i] = Grass.None; w.treeSpecies[i] = 0;
    w.markDirty(x, y);
  }
  irr.pump = { pos: { x: ox, y: oy }, capacityM3PerNight: spec.capacityM3PerNight, tier };
  g.events.emit('edit', { tiles: [] });
  return ok(irr.pump);
}

export function placeSprinkler(g: Game, at: Vec2, zone: number): Result<Sprinkler> {
  const x = Math.round(at.x), y = Math.round(at.y);
  const why = buildable(g, x, y);
  if (why) return fail(`Can't place a sprinkler on ${why}`);
  if (!Number.isInteger(zone) || zone < 1 || zone > 32) return fail('Zones are numbered 1–32');
  const irr = g.irrigation;
  if (irr.sprinklers.some(s => s.pos.x === x && s.pos.y === y)) return fail('There is already a sprinkler there');
  if (!g.ledger.spend(SPRINKLER_COST, 'construction', g.day)) return fail(`Not enough money ($${SPRINKLER_COST} needed)`);
  const s: Sprinkler = { id: irr.nextSprinklerId++, pos: { x, y }, radiusTiles: SPRINKLER_RADIUS, zone, broken: false };
  irr.sprinklers.push(s);
  // a new zone gets a sensible default run time
  if (!irr.schedule.some(z => z.zone === zone)) irr.schedule.push({ zone, minutes: 15 });
  return ok(s);
}

export function removeSprinkler(g: Game, id: number): Result {
  const irr = g.irrigation;
  const n = irr.sprinklers.length;
  irr.sprinklers = irr.sprinklers.filter(s => s.id !== id);
  return irr.sprinklers.length < n ? ok(undefined) : fail('No such sprinkler');
}

export function repairSprinkler(g: Game, id: number): Result {
  const s = g.irrigation.sprinklers.find(x => x.id === id);
  if (!s) return fail('No such sprinkler');
  if (!s.broken) return fail('That sprinkler works fine');
  if (!g.ledger.spend(REPAIR_COST, 'supplies', g.day)) return fail(`Not enough money ($${REPAIR_COST} needed)`);
  s.broken = false;
  return ok(undefined);
}

function pipeSet(g: Game): Set<number> {
  const set = new Set<number>();
  for (const run of g.irrigation.pipes) for (const p of run) set.add(g.world.idx(p.x, p.y));
  return set;
}

/** Cost readout for a pipe stroke (no tiles change: pipes are underground). */
export function planPipe(g: Game, tiles: Vec2[]): EditPlan {
  const p = emptyPlan();
  const have = pipeSet(g);
  const seen = new Set<number>();
  for (const t of tiles) {
    const why = buildable(g, t.x, t.y);
    if (why) { addReason(p, why); continue; }
    const i = g.world.idx(t.x, t.y);
    if (have.has(i) || seen.has(i)) continue;
    seen.add(i);
    p.changes.push({ i });
    p.cost += PIPE_COST_PER_TILE;
  }
  return p;
}

export function placePipe(g: Game, tiles: Vec2[]): Result<number> {
  const p = planPipe(g, tiles);
  if (!p.changes.length) return fail(p.reasons[0] ? `Can't lay pipe on ${p.reasons[0]}` : 'Pipe already there');
  if (!g.ledger.spend(p.cost, 'construction', g.day)) return fail(`Not enough money ($${p.cost.toLocaleString()} needed)`);
  const w = g.world;
  g.irrigation.pipes.push(p.changes.map(c => ({ x: c.i % w.size, y: Math.floor(c.i / w.size) })));
  return ok(p.changes.length);
}

export function setSchedule(g: Game, schedule: { zone: number; minutes: number }[]): Result {
  for (const z of schedule) if (!(z.minutes >= 0 && z.minutes <= 120) || !Number.isInteger(z.zone)) return fail('Run times are 0–120 minutes');
  g.irrigation.schedule = schedule.map(z => ({ zone: z.zone, minutes: Math.round(z.minutes) }));
  return ok(undefined);
}

// --- network ---
/** Sprinklers joined to the pump by pipe (4-neighbour pipe runs; a head sits on or next to a pipe). */
export function connectedSprinklers(g: Game): Set<number> {
  const irr = g.irrigation;
  const out = new Set<number>();
  if (!irr.pump) return out;
  const w = g.world;
  const pipes = pipeSet(g);
  const reached = new Set<number>();
  const queue: number[] = [];
  const { x: px, y: py } = irr.pump.pos;
  // pipe tiles touching the pump house
  for (let y = py - 1; y <= py + PUMP_SIZE; y++) for (let x = px - 1; x <= px + PUMP_SIZE; x++) {
    if (!w.inBounds(x, y)) continue;
    const i = w.idx(x, y);
    if (pipes.has(i) && !reached.has(i)) { reached.add(i); queue.push(i); }
  }
  while (queue.length) {
    const i = queue.pop()!;
    const x = i % w.size, y = Math.floor(i / w.size);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!w.inBounds(x + dx, y + dy)) continue;
      const j = w.idx(x + dx, y + dy);
      if (pipes.has(j) && !reached.has(j)) { reached.add(j); queue.push(j); }
    }
  }
  for (const s of irr.sprinklers) {
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) {
      if (w.inBounds(s.pos.x + dx, s.pos.y + dy) && reached.has(w.idx(s.pos.x + dx, s.pos.y + dy))) hit = true;
    }
    if (hit) out.add(s.id);
  }
  return out;
}

/** Visit every tile inside a sprinkler's throw. */
export function forEachInRadius(g: Game, s: Sprinkler, fn: (i: number) => void): void {
  const w = g.world, r = s.radiusTiles;
  for (let y = Math.max(0, s.pos.y - r); y <= Math.min(w.size - 1, s.pos.y + r); y++) {
    for (let x = Math.max(0, s.pos.x - r); x <= Math.min(w.size - 1, s.pos.x + r); x++) {
      if ((x - s.pos.x) ** 2 + (y - s.pos.y) ** 2 <= r * r) fn(w.idx(x, y));
    }
  }
}

/** Share (0..1) of a course's grassed turf inside the throw of a working, connected sprinkler. */
export function coverage(g: Game, courseId: number): number {
  const w = g.world;
  const live = connectedSprinklers(g);
  const covered = new Set<number>();
  for (const s of g.irrigation.sprinklers) if (live.has(s.id) && !s.broken) forEachInRadius(g, s, i => covered.add(i));
  let total = 0, hit = 0;
  for (let i = 0; i < w.grass.length; i++) {
    if (w.courseId[i] !== courseId || w.grass[i] === Grass.None) continue;
    total++;
    if (covered.has(i)) hit++;
  }
  return total ? hit / total : 0;
}

export function droughtActive(g: Game): boolean {
  return g.day < g.irrigation.droughtUntilDay;
}

/** Water the pump can deliver tonight: halved in a drought, never above the scenario/difficulty cap. */
export function nightlyCapacity(g: Game): number {
  const p = g.irrigation.pump;
  return p ? p.capacityM3PerNight * Math.min(droughtActive(g) ? 0.5 : 1, g.opts.droughtCap) : 0;
}

/** Night watering: scheduled zones in order until the pump's nightly capacity runs out. */
export function waterAtNight(g: Game): void {
  const irr = g.irrigation;
  irr.lastNight = { m3: 0, cost: 0, limited: false };
  if (!irr.pump || !irr.schedule.length) return;
  const live = connectedSprinklers(g);
  let left = nightlyCapacity(g);
  const w = g.world;
  for (const { zone, minutes } of irr.schedule) {
    if (minutes <= 0) continue;
    const heads = irr.sprinklers.filter(s => s.zone === zone && !s.broken && live.has(s.id));
    if (!heads.length) continue;
    const want = heads.length * minutes * SPRINKLER_M3_PER_MIN;
    const got = Math.min(want, left);
    if (got < want) irr.lastNight.limited = true;
    left -= got;
    irr.lastNight.m3 += got;
    const gain = minutes * MOISTURE_PER_MIN * (want ? got / want : 0);
    if (gain <= 0) continue;
    for (const s of heads) forEachInRadius(g, s, i => { if (w.grass[i] !== Grass.None) w.moisture[i] = Math.min(100, Math.round(w.moisture[i]! + gain)); });
  }
  irr.lastNight.cost = Math.round(irr.lastNight.m3 * WATER_COST_PER_M3);
  if (irr.lastNight.cost) g.ledger.charge(irr.lastNight.cost, 'water', g.day);
}

export const irrigationSystem: System = {
  name: 'irrigation',
  onDay(g) {
    const irr = g.irrigation;
    // drought restrictions: arid and temperate summers, checked weekly
    const climate = TERRAINS[g.terrain].climate;
    if (g.day % 7 === 1 && g.clock.season === 'summer' && (climate === 'arid' || climate === 'temperate') && !droughtActive(g) && irr.rng.chance(0.1)) {
      irr.droughtUntilDay = g.day + 7;
      g.notify('warn', 'Drought restrictions: irrigation is capped at half capacity for a week');
    }
    waterAtNight(g);
    for (const s of irr.sprinklers) {
      if (!s.broken && irr.rng.chance(BREAK_CHANCE_PER_NIGHT)) {
        s.broken = true;
        g.notify('warn', `A sprinkler in zone ${s.zone} broke — the turf around it will dry out`, s.pos);
      }
    }
  },
};

export function attachIrrigation(g: Game): void {
  g.registerSystem(irrigationSystem);
}

registerSaveable({
  key: 'irrigation',
  save: g => { const { rng, ...rest } = g.irrigation; return { ...rest, rng: rng.getState() }; },
  load: (g, d) => {
    const s = d as Omit<IrrigationSystem, 'rng'> & { rng: number };
    const rng = new Rng(0);
    rng.setState(s.rng);
    g.irrigation = { ...s, rng };
  },
});
