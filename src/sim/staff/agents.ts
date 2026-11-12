import { Vec2 } from '../../core/geom';
import { TILE_M } from '../../core/units';
import { TICKS_PER_MIN } from '../clock';
import type { Game, System } from '../game';
import { CART_MPS, Group, WALK_MPS, SEC_PER_TICK } from '../golfers/groups';
import { THOUGHT_MOOD } from '../golfers/thoughts';
import { pushThought } from '../golfers/roundEffects';
import { Practice, applyPractice } from '../turf/practices';
import { TILE_FLAG } from '../world/world';
import { AGENT_WEIGHT, findPath } from '../world/pathfind';
import { EQUIPMENT, workRate } from './equipment';
import { errorRate } from './morale';
import { SkillId } from './roles';
import { Staff, isWorking, shiftHours, startPos } from './staff';
import { SUPPLY_PER_TILE, logHoleWork } from '../economy/finance';
import { WorkOrder } from './workOrders';

/** Crew stop work while a group is this close (40 m). */
export const CREW_PAUSE_TILES = 40 / TILE_M;
/** Fatigue per hour of work; tired hands slow down. */
export const FATIGUE_PER_HOUR = 8;
/** Shot-time multipliers from the pace staff. */
export const STARTER_PACE = 0.95;
export const MARSHAL_PACE = 0.9;

const PRACTICE_SKILL: Record<Practice, SkillId> = {
  mow: 'mowing', roll: 'greens', aerate: 'greens', topdress: 'greens', spray: 'spraying', fertilize: 'spraying',
  handWater: 'irrigation', rakeBunker: 'bunkers', changeCup: 'greens', fixDivots: 'mowing', moveTeeMarkers: 'mowing',
};

/** What a crew member is doing right now (for the click panel). */
export function staffActivity(g: Game, s: Staff): string {
  if (s.trainingUntilDay > g.day) return 'Away training';
  if (!isWorking(g, s)) return 'Off shift';
  if (s.agent?.waiting) return 'Waiting for golfers to play through';
  const o = s.task !== null ? orderById(g, s.task) : undefined;
  if (o) {
    const hole = g.courses.hole(o.holeId);
    const where = hole ? ` on ${hole.number}` : '';
    const verb = s.agent?.path.length ? 'Heading out to' : 'Working:';
    return `${verb} ${o.practice}${where}`;
  }
  switch (s.role) {
    case 'marshal': return 'Patrolling the course';
    case 'starter': return 'At the first tee';
    case 'mechanic': return 'In the workshop';
    default: return 'Idle';
  }
}

function orderById(g: Game, id: number): WorkOrder | undefined {
  return g.workOrders.all.find(o => o.id === id);
}

function agent(s: Staff): NonNullable<Staff['agent']> {
  return (s.agent ??= { path: [], carry: 0, waiting: false, autoEquip: false });
}

function walkTo(g: Game, s: Staff, to: Vec2): void {
  const a = agent(s);
  // turf machines go where people walk (onto greens and tees), just faster than on foot
  const p = findPath(g, s.pos, to, 'walk', AGENT_WEIGHT);
  a.path = p ? p.slice(1) : [{ ...to }];
}

function step(s: Staff): void {
  const a = agent(s);
  let left = ((s.equipmentId !== null ? CART_MPS : WALK_MPS) * SEC_PER_TICK) / TILE_M;
  while (left > 0 && a.path.length) {
    const t = a.path[0]!;
    const d = Math.hypot(t.x - s.pos.x, t.y - s.pos.y);
    if (d <= left) { s.pos = { ...t }; a.path.shift(); left -= d; }
    else { s.pos = { x: s.pos.x + ((t.x - s.pos.x) * left) / d, y: s.pos.y + ((t.y - s.pos.y) * left) / d }; left = 0; }
  }
}

function tileXY(g: Game, i: number): Vec2 {
  return { x: (i % g.world.size) + 0.5, y: Math.floor(i / g.world.size) + 0.5 };
}

/** Where on the map the next bit of this order's work is. */
function workSpot(g: Game, o: WorkOrder): Vec2 | null {
  if (o.tiles.length) return o.progress < o.tiles.length ? tileXY(g, o.tiles[o.progress]!) : null;
  const h = g.courses.hole(o.holeId);
  if (!h) return null;
  if (o.practice === 'moveTeeMarkers' && h.teeBoxes[0]) return { ...h.teeBoxes[0].center };
  return { ...h.greenCenter };
}

function nextOrder(g: Game, s: Staff): WorkOrder | undefined {
  return g.workOrders.all
    .filter(o => o.assignedTo === s.id && o.status === 'assigned' && !o.paused && o.due === g.day)
    .sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.priority - b.priority || a.id - b.id)[0];
}

/** Grab a free working machine for the job (handed back when the job is done). */
function pickUpMachine(g: Game, s: Staff, practice: Practice): void {
  if (s.equipmentId !== null) return;
  const e = g.equipment.all
    .filter(x => x.courseId === s.courseId && !x.broken && x.assignedTo === null && EQUIPMENT[x.kind].practice === practice)
    .sort((a, b) => b.tier - a.tier)[0];
  if (!e) return;
  e.assignedTo = s.id;
  s.equipmentId = e.id;
  agent(s).autoEquip = true;
}

function dropMachine(g: Game, s: Staff): void {
  const a = agent(s);
  if (!a.autoEquip || s.equipmentId === null) return;
  const e = g.equipment.all.find(x => x.id === s.equipmentId);
  if (e) e.assignedTo = null;
  s.equipmentId = null;
  a.autoEquip = false;
}

/** Groups out on the course near a spot. */
function groupsNear(g: Game, courseId: number, p: Vec2, r: number): Group[] {
  return g.groups.filter(grp => grp.started && grp.courseId === courseId && grp.phase !== 'done' && grp.phase !== 'toClubhouse'
    && Math.hypot(grp.pos.x - p.x, grp.pos.y - p.y) <= r);
}

function hash01(a: number, b: number): number {
  return ((Math.imul(a ^ Math.imul(b, 0x9e3779b1), 0x85ebca6b) >>> 8) & 0xffff) / 65536;
}

/** One tick of hands-on work. */
function work(g: Game, s: Staff, o: WorkOrder): void {
  const a = agent(s);
  const skill = (s.skills[PRACTICE_SKILL[o.practice]] ?? 30) / 100;
  const pace = s.speed * (0.6 + 0.8 * skill) * Math.max(0.4, 1 - s.fatigue / 250);
  const hours = 1 / (60 * TICKS_PER_MIN);
  s.fatigue = Math.min(100, s.fatigue + FATIGUE_PER_HOUR * hours);
  const e = s.equipmentId !== null ? g.equipment.all.find(x => x.id === s.equipmentId) : undefined;
  if (e) e.hoursToday += hours;
  // the hole pays for the time spent on it (and the supplies the job uses)
  const labour = hours * s.wagePerDay / Math.max(1, shiftHours(s));
  if (!o.tiles.length) {
    logHoleWork(g, o.courseId, o.holeId, labour, 0);
    // per-hole jobs (cups, tee markers) take fixed time
    a.carry += hours * pace;
    if (a.carry >= o.laborHours) {
      applyPractice(g, o.practice, [], { holeId: o.holeId });
      a.carry = 0;
      o.progress = 1;
      o.status = 'done';
    }
    return;
  }
  a.carry += workRate(g, s, o.practice) * pace * hours;
  const err = errorRate(s) + (skill < 0.3 ? (0.3 - skill) * 0.5 : 0);
  const w = g.world;
  const from = o.progress;
  while (a.carry >= 1 && o.progress < o.tiles.length) {
    const i = o.tiles[o.progress]!;
    // the next tile is out of reach: walk there first
    const p = tileXY(g, i);
    if (Math.hypot(p.x - s.pos.x, p.y - s.pos.y) > 3) { walkTo(g, s, p); break; }
    a.carry -= 1;
    o.progress++;
    s.pos = p;
    if (err > 0 && hash01(i, g.day * 31 + s.id) < err) {
      // sloppy work: a missed strip, or a scalped patch
      if (o.practice === 'mow' && hash01(i, g.day) < 0.5) {
        applyPractice(g, o.practice, [i], o.params?.mowMm !== undefined ? { mm: o.params.mowMm } : {});
        w.health[i] = Math.max(0, w.health[i]! - 8);
      }
      w.flags[i] = w.flags[i]! & ~TILE_FLAG.stripe;
      continue;
    }
    applyPractice(g, o.practice, [i], o.params?.mowMm !== undefined ? { mm: o.params.mowMm } : {});
  }
  logHoleWork(g, o.courseId, o.holeId, labour, (o.progress - from) * (SUPPLY_PER_TILE[o.practice] ?? 0));
  if (o.progress >= o.tiles.length) { o.status = 'done'; a.carry = 0; }
}

function tickStaff(g: Game, s: Staff): void {
  const a = agent(s);
  if (!isWorking(g, s)) {
    a.waiting = false;
    // clock off: head back to the shed and put the machine away
    if (s.task !== null) s.task = null;
    dropMachine(g, s);
    if (!a.path.length) {
      const home = startPos(g, s.courseId);
      if (Math.hypot(home.x - s.pos.x, home.y - s.pos.y) > 1) walkTo(g, s, home);
    }
    step(s);
    return;
  }
  if (a.path.length) { step(s); return; }
  switch (s.role) {
    case 'starter': {
      const first = g.courses.get(s.courseId)?.holes.find(h => h.state === 'open')?.teeBoxes[0];
      if (first && Math.hypot(first.center.x - s.pos.x, first.center.y - s.pos.y) > 3) walkTo(g, s, { x: first.center.x - 2, y: first.center.y });
      return;
    }
    case 'marshal': {
      // ride to wherever golfers are waiting
      const slow = g.groups.filter(x => x.courseId === s.courseId && x.started && x.phase !== 'done').sort((x, y) => (y.waitingMin - y.holeWaitStart) - (x.waitingMin - x.holeWaitStart))[0];
      if (slow && Math.hypot(slow.pos.x - s.pos.x, slow.pos.y - s.pos.y) > 15 && g.clock.minuteOfDay % 15 === 0) walkTo(g, s, { x: slow.pos.x + 4, y: slow.pos.y });
      return;
    }
    case 'mechanic': case 'arborist': {
      const home = startPos(g, s.courseId);
      if (Math.hypot(home.x - s.pos.x, home.y - s.pos.y) > 1) walkTo(g, s, home);
      return;
    }
  }
  let o = s.task !== null ? orderById(g, s.task) : undefined;
  if (!o || o.status !== 'assigned' || o.paused) {
    s.task = null;
    dropMachine(g, s);
    o = nextOrder(g, s);
    if (!o) return;
    s.task = o.id;
    a.carry = 0;
    pickUpMachine(g, s, o.practice);
  }
  const spot = workSpot(g, o);
  if (!spot) { o.status = 'done'; s.task = null; return; }
  if (Math.hypot(spot.x - s.pos.x, spot.y - s.pos.y) > 3) { walkTo(g, s, spot); step(s); return; }
  // golfers nearby: stand aside and let them play
  const near = groupsNear(g, s.courseId, s.pos, CREW_PAUSE_TILES);
  if (near.length) {
    a.waiting = true;
    for (const grp of near) crewInWay(g, grp);
    return;
  }
  a.waiting = false;
  work(g, s, o);
  if (o.status === 'done') { s.task = null; dropMachine(g, s); }
}

/** Each group grumbles once per hole about crew in the way. */
function crewInWay(g: Game, grp: Group): void {
  const key = `${grp.id}:${grp.holeIdx}`;
  if (g.crewGrumbles.has(key)) return;
  g.crewGrumbles.add(key);
  const hole = g.courses.hole(grp.holeOrder[grp.holeIdx]!);
  const list = g.roundThoughts.get(grp.id) ?? [];
  g.roundThoughts.set(grp.id, list);
  for (const id of grp.golferIds) {
    pushThought(g, { golferId: id, day: g.day, minute: g.clock.minuteOfDay, key: 'crewInWay', ...(hole ? { holeNumber: hole.number } : {}), mood: THOUGHT_MOOD.crewInWay }, list);
  }
}

/** Shot-time multiplier for a course from the starter and the marshal. */
export function paceFactor(g: Game, courseId: number): number {
  return g.pacePush.get(courseId) ?? 1;
}

export const staffAgentSystem: System = {
  name: 'staffAgents',
  onTick(g) {
    for (const s of g.staff.all) {
      if (s.trainingUntilDay > g.day) continue;
      tickStaff(g, s);
    }
  },
  onMinute(g) {
    // the starter keeps the first tee moving; the marshal hurries groups along when a backlog builds
    g.pacePush.clear();
    for (const c of g.courses.list) {
      let f = 1;
      const on = (role: Staff['role']) => g.staff.all.filter(s => s.role === role && s.courseId === c.id && isWorking(g, s));
      const starters = on('starter');
      if (starters.length) f *= STARTER_PACE - 0.03 * Math.max(...starters.map(s => (s.skills.pace ?? 0) / 100));
      if (on('marshal').length && g.groups.some(x => x.courseId === c.id && x.started && x.phase !== 'done' && x.waitingMin > x.holeWaitStart)) f *= MARSHAL_PACE;
      if (f !== 1) g.pacePush.set(c.id, f);
    }
  },
  onDay(g) {
    g.crewGrumbles.clear();
  },
};
