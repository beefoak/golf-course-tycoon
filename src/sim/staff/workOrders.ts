import { Result, fail, ok } from '../../core/result';
import type { Game, System } from '../game';
import { registerSaveable } from '../saveRegistry';
import { Practice } from '../turf/practices';
import { Surface } from '../world/tiles';
import { EQUIPMENT, EQUIPMENT_KINDS, HAND_TOOL_RATE, sprayAllowed } from './equipment';
import { programFor, ruleDue, zoneOfHole } from './program';
import { ROLES } from './roles';
import { Staff, WorkOrderId, shiftHours } from './staff';

export interface WorkOrder {
  id: WorkOrderId;
  courseId: number;
  practice: Practice;
  surface: Surface;
  holeId: number;
  /** chunked ≤ 400 tiles each */
  tiles: number[];
  zone: number | null;
  priority: number;
  due: number;
  laborHours: number;
  status: 'open' | 'assigned' | 'done' | 'skipped';
  urgent: boolean;
  skipReason?: string;
  params?: { mowMm?: number };
  assignedTo: number | null;
  /** tiles finished so far (agents, Task 32) */
  progress: number;
  paused?: boolean;
}

export interface WorkOrderBook {
  all: WorkOrder[];
  nextId: number;
  /** last day each course's orders were planned (courseId → day) */
  plannedDay?: Record<number, number>;
}
export function newOrderBook(): WorkOrderBook { return { all: [], nextId: 1, plannedDay: {} }; }

export const MAX_ORDER_TILES = 400;
/** Fixed jobs per hole (hours). */
const PER_HOLE_HOURS: Partial<Record<Practice, number>> = { changeCup: 0.15, moveTeeMarkers: 0.1 };

/** Best tiles/hour the course can bring to a practice: its best working machine, else hand tools. */
export function courseRate(g: Game, courseId: number, practice: Practice): number {
  let best = 0;
  for (const e of g.equipment.all) {
    if (e.courseId !== courseId || e.broken || EQUIPMENT[e.kind].practice !== practice) continue;
    best = Math.max(best, EQUIPMENT[e.kind].tiers[e.tier - 1]!.tilesPerHour);
  }
  if (best) return best;
  const base = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].practice === practice).map(k => EQUIPMENT[k].tiers[0].tilesPerHour);
  return (base.length ? Math.min(...base) : 400) * HAND_TOOL_RATE;
}

export function superintendentOf(g: Game, courseId: number): Staff | undefined {
  return g.staff.all.find(s => s.role === 'superintendent' && s.courseId === courseId && s.trainingUntilDay <= g.day);
}

/** Tiles of each surface per hole on a course (one map scan). */
function tilesByHole(g: Game, courseId: number, surfaces: Set<Surface>): Map<string, number[]> {
  const w = g.world;
  const out = new Map<string, number[]>();
  for (let i = 0; i < w.holeId.length; i++) {
    const hid = w.holeId[i]!;
    if (!hid || w.courseId[i] !== courseId) continue;
    const s = w.surface[i] as Surface;
    if (!surfaces.has(s)) continue;
    const k = `${hid}:${s}`;
    let a = out.get(k);
    if (!a) { a = []; out.set(k, a); }
    a.push(i);
  }
  return out;
}

/** Today's orders from the program (called at the day rollover). */
export function generateDailyOrders(g: Game, courseId: number): WorkOrder[] {
  const course = g.courses.get(courseId);
  if (!course) return [];
  const p = programFor(g, courseId);
  const sup = superintendentOf(g, courseId);
  // a good superintendent organises the crew: up to 20% less labour
  const mgmt = sup ? 1 - 0.2 * ((sup.skills.management ?? 0) / 100) : 1;
  const rules = p.rules.filter(r => ruleDue(r, g.day) && (sup || r.priority === 1));
  const holes = course.holes.filter(h => h.state === 'open' || h.state === 'closing' || h.state === 'growingIn');
  const holeIds = new Set(holes.map(h => h.id));
  const surfaces = new Set(rules.map(r => r.surface));
  const tiles = tilesByHole(g, courseId, surfaces);
  const out: WorkOrder[] = [];
  const make = (r: (typeof rules)[number], holeId: number, ts: number[], hours: number, skipReason?: string) => {
    const o: WorkOrder = {
      id: g.workOrders.nextId++, courseId, practice: r.practice, surface: r.surface, holeId, tiles: ts, zone: zoneOfHole(p, holeId),
      priority: r.priority, due: g.day, laborHours: Math.round(hours * mgmt * 100) / 100, status: skipReason ? 'skipped' : 'open', urgent: false,
      assignedTo: null, progress: 0, ...(r.params ? { params: { ...r.params } } : {}), ...(skipReason ? { skipReason } : {}),
    };
    out.push(o);
  };
  for (const r of rules) {
    const perHole = PER_HOLE_HOURS[r.practice];
    for (const h of holes.sort((a, b) => a.number - b.number)) {
      if (!holeIds.has(h.id)) continue;
      if (perHole !== undefined) { make(r, h.id, [], perHole); continue; }
      const ts = tiles.get(`${h.id}:${r.surface}`) ?? [];
      if (!ts.length) continue;
      const rate = courseRate(g, courseId, r.practice);
      for (let k = 0; k < ts.length; k += MAX_ORDER_TILES) {
        const chunk = ts.slice(k, k + MAX_ORDER_TILES);
        const blocked = r.practice === 'spray' && !sprayAllowed(g, courseId) ? 'no chemical store' : undefined;
        make(r, h.id, chunk, chunk.length / rate, blocked);
      }
    }
  }
  g.workOrders.all.push(...out);
  return out;
}

/** Can this person do this kind of job? */
export function canDo(s: Staff, practice: Practice): boolean {
  return !!ROLES[s.role].practices?.includes(practice);
}

/** Hours of work a person can still take on today. */
function capacity(g: Game, s: Staff): number {
  if (s.trainingUntilDay > g.day) return 0;
  return shiftHours(s) * s.speed;
}

/**
 * Plan the day: urgent first, then priority, then due date; each order goes to a free person who
 * can do it, works in that zone (or any zone), and still has hours left in their shift.
 */
export function assignOrders(g: Game, courseId: number): void {
  const crew = g.staff.all.filter(s => s.courseId === courseId && s.trainingUntilDay <= g.day);
  const left = new Map<number, number>(crew.map(s => [s.id, capacity(g, s)]));
  for (const o of g.workOrders.all) if (o.courseId === courseId && o.status === 'assigned' && o.assignedTo !== null && o.due === g.day) left.set(o.assignedTo, (left.get(o.assignedTo) ?? 0) - o.laborHours);
  const queue = g.workOrders.all.filter(o => o.courseId === courseId && o.status === 'open' && !o.paused && o.due <= g.day)
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.priority - b.priority || a.due - b.due || a.id - b.id);
  for (const o of queue) {
    let best: Staff | null = null, bestLeft = -Infinity;
    for (const s of crew) {
      if (!canDo(s, o.practice)) continue;
      if (s.zone !== null && o.zone !== null && s.zone !== o.zone) continue;
      const l = left.get(s.id)! - o.laborHours / s.speed;
      if (l < 0) continue;
      if (l > bestLeft) { bestLeft = l; best = s; }
    }
    if (!best) continue;
    o.status = 'assigned';
    o.assignedTo = best.id;
    left.set(best.id, bestLeft);
  }
}

const PHRASE: Record<Practice, (s: Surface) => string> = {
  mow: s => `${SURFACE_PLURAL[s] ?? 'Turf'} not mown`,
  roll: () => 'Greens not rolled',
  aerate: s => `${SURFACE_PLURAL[s] ?? 'Turf'} not aerated`,
  topdress: s => `${SURFACE_PLURAL[s] ?? 'Turf'} not topdressed`,
  spray: () => 'Spraying not done',
  fertilize: s => `${SURFACE_PLURAL[s] ?? 'Turf'} not fertilized`,
  handWater: () => 'Hand-watering not done',
  rakeBunker: () => 'Bunkers not raked',
  changeCup: () => 'Cups not changed',
  fixDivots: () => 'Divots not filled',
  moveTeeMarkers: () => 'Tee markers not moved',
};
const SURFACE_PLURAL: Partial<Record<Surface, string>> = {
  [Surface.Green]: 'Greens', [Surface.Tee]: 'Tees', [Surface.Fairway]: 'Fairways', [Surface.Fringe]: 'Collars', [Surface.Rough]: 'Rough', [Surface.FirstCut]: 'First cut', [Surface.Bunker]: 'Bunkers',
};

/** "1–3, 7, 10–18" */
export function holeRanges(nums: number[]): string {
  const a = [...new Set(nums)].sort((x, y) => x - y);
  const out: string[] = [];
  for (let i = 0; i < a.length;) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j]! + 1) j++;
    out.push(i === j ? `${a[i]}` : `${a[i]}–${a[j]}`);
    i = j + 1;
  }
  return out.join(', ');
}

/** What didn't get done that day and how many labour-hours were missing. */
export function shortfallReport(g: Game, courseId: number, day: number): { skipped: WorkOrder[]; hoursShort: number; text: string[] } {
  const skipped = g.workOrders.all.filter(o => o.courseId === courseId && o.due === day && (o.status === 'skipped' || (day === g.day && o.status === 'open')));
  const groups = new Map<string, WorkOrder[]>();
  for (const o of skipped) {
    const k = `${o.practice}:${o.surface}:${o.skipReason ?? ''}`;
    const a = groups.get(k) ?? [];
    a.push(o);
    groups.set(k, a);
  }
  const text: string[] = [];
  let hoursShort = 0;
  for (const os of groups.values()) {
    const o = os[0]!;
    const hours = os.reduce((s, x) => s + x.laborHours * (1 - (x.tiles.length ? x.progress / x.tiles.length : 0)), 0);
    const nums = os.map(x => g.courses.hole(x.holeId)?.number ?? 0).filter(n => n > 0);
    if (o.skipReason === 'no chemical store') { text.push(`${PHRASE[o.practice](o.surface)} on ${holeRanges(nums)}: no chemical store`); continue; }
    hoursShort += hours;
    text.push(`${PHRASE[o.practice](o.surface).replace(' not ', ` on ${holeRanges(nums)} not `)}: ${Math.max(1, Math.round(hours))} labour-hour${Math.round(hours) === 1 ? '' : 's'} short`);
  }
  return { skipped, hoursShort: Math.round(hoursShort * 10) / 10, text };
}

export function createUrgentOrder(g: Game, courseId: number, practice: Practice, tiles: number[]): Result<WorkOrder> {
  if (!g.courses.get(courseId)) return fail('No such course');
  if (!tiles.length) return fail('Pick some tiles');
  if (practice === 'spray' && !sprayAllowed(g, courseId)) return fail('Spraying needs a chemical store at the maintenance building');
  const w = g.world;
  const holeId = w.holeId[tiles[0]!] ?? 0;
  const o: WorkOrder = {
    id: g.workOrders.nextId++, courseId, practice, surface: w.surface[tiles[0]!] as Surface, holeId, tiles: tiles.slice(0, MAX_ORDER_TILES * 4),
    zone: holeId ? zoneOfHole(programFor(g, courseId), holeId) : null, priority: 0, due: g.day,
    laborHours: Math.round((tiles.length / courseRate(g, courseId, practice)) * 100) / 100, status: 'open', urgent: true, assignedTo: null, progress: 0,
  };
  g.workOrders.all.push(o);
  assignOrders(g, courseId);
  return ok(o);
}

export function pauseOrder(g: Game, id: number, paused = true): Result {
  const o = g.workOrders.all.find(x => x.id === id);
  if (!o) return fail('No such order');
  o.paused = paused;
  if (paused && o.status === 'assigned') { o.status = 'open'; o.assignedTo = null; }
  return ok(undefined);
}

/** At the rollover: yesterday's leftovers are skipped, today's orders are generated and planned. */
export const programSystem: System = {
  name: 'program',
  onDay(g) {
    for (const o of g.workOrders.all) {
      if (o.due < g.day && (o.status === 'open' || o.status === 'assigned')) {
        o.status = 'skipped';
        o.skipReason ??= o.assignedTo === null ? 'no one available' : 'not finished';
      }
    }
    // keep two days of history
    g.workOrders.all = g.workOrders.all.filter(o => o.due >= g.day - 1);
    planDay(g);
  },
  onMinute(g) {
    // a crew hired (or a hole opened) mid-day gets today's plan straight away
    if (g.clock.minuteOfDay % 5 === 0) planDay(g);
  },
};

/** Generate and assign today's orders for each course that has staff and live holes and no plan yet. */
function planDay(g: Game): void {
  const planned = (g.workOrders.plannedDay ??= {});
  for (const c of g.courses.list) {
    if (planned[c.id] === g.day) continue;
    if (!c.holes.some(h => h.state === 'open' || h.state === 'growingIn' || h.state === 'closing')) continue;
    if (!g.staff.all.some(s => s.courseId === c.id)) continue;
    planned[c.id] = g.day;
    generateDailyOrders(g, c.id);
    assignOrders(g, c.id);
  }
}

registerSaveable({
  key: 'workOrders',
  save: g => g.workOrders,
  load: (g, d) => { g.workOrders = d as WorkOrderBook; },
});
