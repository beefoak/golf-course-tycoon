import { Result, fail, ok } from '../../core/result';
import type { Game } from '../game';
import { registerSaveable } from '../saveRegistry';
import { PRACTICES, Practice } from '../turf/practices';
import { Surface } from '../world/tiles';

export interface ProgramRule {
  practice: Practice;
  surface: Surface;
  frequency: { perWeek: number };
  params?: { mowMm?: number };
  /** 1 = basics the crew always does */
  priority: 1 | 2 | 3;
}
export interface Zone { id: number; name: string; holeIds: number[] }
export interface MaintenanceProgram { courseId: number; rules: ProgramRule[]; zones: Zone[]; nextZoneId: number }

/** 112-day year = 16 weeks; "2 per year" is 2/16 per week. */
const PER_YEAR = (n: number) => n / 16;

export function defaultRules(): ProgramRule[] {
  return [
    { practice: 'mow', surface: Surface.Green, frequency: { perWeek: 7 }, params: { mowMm: 3.0 }, priority: 1 },
    { practice: 'changeCup', surface: Surface.Green, frequency: { perWeek: 7 }, priority: 1 },
    { practice: 'mow', surface: Surface.Fairway, frequency: { perWeek: 3 }, params: { mowMm: 12 }, priority: 1 },
    { practice: 'rakeBunker', surface: Surface.Bunker, frequency: { perWeek: 7 }, priority: 2 },
    { practice: 'roll', surface: Surface.Green, frequency: { perWeek: 3 }, priority: 2 },
    { practice: 'mow', surface: Surface.Tee, frequency: { perWeek: 3 }, priority: 2 },
    { practice: 'mow', surface: Surface.Fringe, frequency: { perWeek: 3 }, priority: 2 },
    { practice: 'mow', surface: Surface.Rough, frequency: { perWeek: 1 }, priority: 3 },
    { practice: 'fixDivots', surface: Surface.Fairway, frequency: { perWeek: 2 }, priority: 3 },
    { practice: 'aerate', surface: Surface.Green, frequency: { perWeek: PER_YEAR(2) }, priority: 3 },
  ];
}

export function programFor(g: Game, courseId: number): MaintenanceProgram {
  let p = g.programs.get(courseId);
  if (!p) { p = { courseId, rules: defaultRules(), zones: [], nextZoneId: 1 }; g.programs.set(courseId, p); }
  return p;
}

/** Spread N-per-week evenly: a rule is due on day d when the running count ticks over. */
export function ruleDue(rule: ProgramRule, day: number): boolean {
  const f = rule.frequency.perWeek / 7;
  return Math.floor(day * f + 1e-9) > Math.floor((day - 1) * f + 1e-9);
}

export function zoneOfHole(p: MaintenanceProgram, holeId: number): number | null {
  return p.zones.find(z => z.holeIds.includes(holeId))?.id ?? null;
}

function validRule(r: ProgramRule): string | null {
  if (!PRACTICES.includes(r.practice)) return 'Unknown practice';
  if (!(r.frequency.perWeek > 0 && r.frequency.perWeek <= 14)) return 'Frequency must be up to 14 a week';
  if (![1, 2, 3].includes(r.priority)) return 'Priority is 1, 2 or 3';
  if (r.params?.mowMm !== undefined && !(r.params.mowMm >= 1.5 && r.params.mowMm <= 150)) return 'Mow height must be 1.5–150 mm';
  return null;
}

export function setProgramRule(g: Game, courseId: number, rule: ProgramRule, index?: number): Result {
  const why = validRule(rule);
  if (why) return fail(why);
  const p = programFor(g, courseId);
  if (index === undefined) p.rules.push(rule);
  else if (index >= 0 && index < p.rules.length) p.rules[index] = rule;
  else return fail('No such rule');
  return ok(undefined);
}

export function removeProgramRule(g: Game, courseId: number, index: number): Result {
  const p = programFor(g, courseId);
  if (index < 0 || index >= p.rules.length) return fail('No such rule');
  p.rules.splice(index, 1);
  return ok(undefined);
}

export function createZone(g: Game, courseId: number, name: string, holeIds: number[]): Result<Zone> {
  const p = programFor(g, courseId);
  const z: Zone = { id: p.nextZoneId++, name: name.trim() || `Zone ${p.nextZoneId - 1}`, holeIds: [] };
  // a hole lives in one zone
  for (const id of holeIds) { for (const o of p.zones) o.holeIds = o.holeIds.filter(h => h !== id); z.holeIds.push(id); }
  p.zones.push(z);
  return ok(z);
}

export function assignZone(g: Game, staffId: number, zone: number | null): Result {
  const s = g.staff.get(staffId);
  if (!s) return fail('No such staff member');
  if (zone !== null && !programFor(g, s.courseId).zones.some(z => z.id === zone)) return fail('No such zone');
  s.zone = zone;
  return ok(undefined);
}

registerSaveable({
  key: 'programs',
  save: g => [...g.programs],
  load: (g, d) => { g.programs = new Map(d as [number, MaintenanceProgram][]); },
});
