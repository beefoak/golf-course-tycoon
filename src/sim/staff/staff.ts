import { Vec2 } from '../../core/geom';
import { Result, fail, ok } from '../../core/result';
import type { Game } from '../game';
import { registerSaveable } from '../saveRegistry';
import { ROLES, RoleId, SkillId, STARTER_CREW, StaffTrait } from './roles';

export type WorkOrderId = number;

export interface Staff {
  id: number;
  name: string;
  role: RoleId;
  courseId: number;
  skills: Partial<Record<SkillId, number>>;
  /** 0.6..1.4 */
  speed: number;
  /** 0..1 */
  reliability: number;
  /** 0..100 */
  morale: number;
  /** 0..100 */
  fatigue: number;
  wagePerDay: number;
  traits: StaffTrait[];
  hiredDay: number;
  xp: Partial<Record<SkillId, number>>;
  shift: { startMin: number; endMin: number };
  zone: number | null;
  pos: Vec2;
  task: WorkOrderId | null;
  /** away training until this day (exclusive) */
  trainingUntilDay: number;
  /** equipment in hand (Task 30) */
  equipmentId: number | null;
  /** on-map state (Task 32) */
  agent?: { path: Vec2[]; carry: number; waiting: boolean; autoEquip: boolean };
}

/** A person on the job market (not yet hired). */
export interface Candidate extends Omit<Staff, 'id' | 'courseId' | 'hiredDay' | 'xp' | 'zone' | 'pos' | 'task' | 'trainingUntilDay' | 'equipmentId' | 'fatigue'> {
  candidateId: string;
}

export const TRAINING_COST = 1500;
export const TRAINING_DAYS = 3;
export const SEVERANCE_DAYS = 7;

export function skillAvg(s: { role: RoleId; skills: Partial<Record<SkillId, number>> }): number {
  const ks = ROLES[s.role].skills;
  return ks.reduce((a, k) => a + (s.skills[k] ?? 0), 0) / Math.max(1, ks.length);
}

export function hasBuilding(g: Game, kind: string, courseId: number): boolean {
  return g.buildings.some(b => (b.kind as string) === kind && (b.courseId === courseId || courseId === 0));
}

export class StaffRoster {
  all: Staff[] = [];
  nextId = 1;
  /** candidate ids already taken off the market */
  hiredCandidates = new Set<string>();

  byRole(role: RoleId): Staff[] {
    return this.all.filter(s => s.role === role);
  }
  get(id: number): Staff | undefined {
    return this.all.find(s => s.id === id);
  }

  /** Why this candidate can't be hired right now (null = OK). */
  hireBlocker(g: Game, c: Candidate, courseId: number): string | null {
    if (this.hiredCandidates.has(c.candidateId)) return `${c.name} has already been hired`;
    const req = ROLES[c.role].requires;
    if (req && !hasBuilding(g, req, courseId)) return `A ${ROLES[c.role].name.toLowerCase()} needs a ${req === 'restaurant' ? 'restaurant' : req === 'proShop' ? 'pro shop' : `${req} building`} first`;
    if (c.role === 'greenkeeper' && !hasBuilding(g, 'maintenance', courseId) && this.byRole('greenkeeper').filter(s => s.courseId === courseId).length >= STARTER_CREW) {
      return `Build a maintenance building to hire more than ${STARTER_CREW} greenkeepers`;
    }
    return null;
  }

  /** Hiring is free up front; the wage is paid daily. */
  hire(g: Game, c: Candidate, courseId: number): Result<Staff> {
    const why = this.hireBlocker(g, c, courseId);
    if (why) return fail(why);
    const home = startPos(g, courseId);
    const s: Staff = {
      id: this.nextId++, name: c.name, role: c.role, courseId, skills: { ...c.skills }, speed: c.speed, reliability: c.reliability,
      morale: c.morale, fatigue: 0, wagePerDay: c.wagePerDay, traits: [...c.traits], hiredDay: g.day, xp: {},
      shift: { ...c.shift }, zone: null, pos: home, task: null, trainingUntilDay: 0, equipmentId: null,
    };
    this.all.push(s);
    this.hiredCandidates.add(c.candidateId);
    g.events.emit('staff', { id: s.id });
    return ok(s);
  }

  /** Letting someone go costs a week's wages in severance. */
  fire(g: Game, id: number): Result {
    const s = this.get(id);
    if (!s) return fail('No such staff member');
    g.ledger.charge(s.wagePerDay * SEVERANCE_DAYS, 'wages', g.day, s.courseId);
    this.remove(g, id);
    return ok(undefined);
  }
  remove(g: Game, id: number): void {
    const s = this.get(id);
    this.all = this.all.filter(x => x.id !== id);
    if (s) g.events.emit('staff', { id });
  }
}

/** Where a new hire turns up: the maintenance building, else the clubhouse door, else the map centre. */
export function startPos(g: Game, courseId: number): Vec2 {
  const b = g.buildings.find(x => (x.kind as string) === 'maintenance' && x.courseId === courseId) ?? g.buildings.find(x => x.kind === 'clubhouse' && x.courseId === courseId);
  if (b) return { ...b.door };
  return { x: Math.floor(g.world.size / 2), y: Math.floor(g.world.size / 2) };
}

export function isWorking(g: Game, s: Staff): boolean {
  if (s.trainingUntilDay > g.day) return false;
  const m = g.clock.minuteOfDay;
  return m >= s.shift.startMin && m < s.shift.endMin;
}

export function shiftHours(s: Staff): number {
  return Math.max(0, s.shift.endMin - s.shift.startMin) / 60;
}

/** Send someone on a course: $1,500, away 3 days, +8–15 in the skill. */
export function train(g: Game, staffId: number, skill: SkillId): Result<number> {
  const s = g.staff.get(staffId);
  if (!s) return fail('No such staff member');
  if (s.trainingUntilDay > g.day) return fail(`${s.name} is already away training`);
  if ((s.skills[skill] ?? 0) >= 100) return fail(`${s.name} has mastered ${skill}`);
  if (!g.ledger.spend(TRAINING_COST, 'other', g.day, s.courseId)) return fail(`Not enough money ($${TRAINING_COST.toLocaleString()} needed)`);
  const gain = g.staffRng.int(8, 15);
  s.skills[skill] = Math.min(100, (s.skills[skill] ?? 0) + gain);
  s.trainingUntilDay = g.day + TRAINING_DAYS;
  s.task = null;
  return ok(gain);
}

export function setWage(g: Game, staffId: number, wage: number): Result {
  const s = g.staff.get(staffId);
  if (!s) return fail('No such staff member');
  if (!(wage >= 0 && wage <= 5000)) return fail('Wage must be $0–$5,000 a day');
  s.wagePerDay = Math.round(wage);
  return ok(undefined);
}

export function setShift(g: Game, staffId: number, startMin: number, endMin: number): Result {
  const s = g.staff.get(staffId);
  if (!s) return fail('No such staff member');
  if (!(startMin >= 0 && endMin <= 1440 && endMin > startMin)) return fail('Shift must end after it starts');
  s.shift = { startMin: Math.round(startMin), endMin: Math.round(endMin) };
  return ok(undefined);
}

registerSaveable({
  key: 'staff',
  save: g => ({ all: g.staff.all, nextId: g.staff.nextId, hired: [...g.staff.hiredCandidates], rng: g.staffRng.getState() }),
  load: (g, d) => {
    const s = d as { all: Staff[]; nextId: number; hired: string[]; rng: number };
    g.staff.all = s.all; g.staff.nextId = s.nextId; g.staff.hiredCandidates = new Set(s.hired);
    g.staffRng.setState(s.rng);
  },
});
