import { Vec2 } from '../../core/geom';
import { Result, fail, ok } from '../../core/result';
import type { Game } from '../game';
import { Surface } from '../world/tiles';
import { MAX_PINS, TEE_ORDER, TeeKind, renumber } from './course';

export type CourseCommand =
  | { t: 'createCourse'; name: string }
  | { t: 'renumberHoles'; courseId: number; order: number[] }
  | { t: 'renameHole'; holeId: number; name: string }
  | { t: 'setPar'; holeId: number; par: number | null }
  | { t: 'addTeeBox'; holeId: number; kind: TeeKind; center: Vec2 }
  | { t: 'moveTeeBox'; holeId: number; kind: TeeKind; center: Vec2 }
  | { t: 'removeTeeBox'; holeId: number; kind: TeeKind }
  | { t: 'setPins'; holeId: number; pins: Vec2[] }
  | { t: 'setActivePin'; holeId: number; index: number }
  | { t: 'setPinMode'; holeId: number; mode: 'auto' | 'manual' };

const COURSE_COMMANDS = new Set<string>(['createCourse', 'renumberHoles', 'renameHole', 'setPar', 'addTeeBox', 'moveTeeBox', 'removeTeeBox', 'setPins', 'setActivePin', 'setPinMode']);
export function isCourseCommand(c: { t: string }): c is CourseCommand {
  return COURSE_COMMANDS.has(c.t);
}

const round = (v: Vec2): Vec2 => ({ x: Math.round(v.x), y: Math.round(v.y) });

export function handleCourseCommand(g: Game, c: CourseCommand): Result<unknown> {
  if (c.t === 'createCourse') return ok(g.courses.create(c.name.trim() || `Course ${g.courses.list.length + 1}`));
  if (c.t === 'renumberHoles') {
    const course = g.courses.get(c.courseId);
    if (!course) return fail('No such course');
    return renumber(course, c.order);
  }
  const h = g.courses.hole(c.holeId);
  if (!h) return fail('No such hole');
  const locked = g.holeLockReason(h.id);
  switch (c.t) {
    case 'renameHole':
      h.name = c.name.trim() || `Hole ${h.number}`;
      return ok(undefined);
    case 'setPar':
      if (c.par !== null && (c.par < 3 || c.par > 5)) return fail('Par must be 3, 4 or 5');
      h.parOverride = c.par;
      return ok(undefined);
    case 'addTeeBox': {
      if (locked) return fail(locked);
      if (h.teeBoxes.length >= 4) return fail('A hole can have at most 4 tee boxes');
      if (h.teeBoxes.some(t => t.kind === c.kind)) return fail(`This hole already has a ${c.kind} tee`);
      if (!g.parcels.tileOwned(c.center.x, c.center.y)) return fail("Tee box must be on land you own");
      h.teeBoxes.push({ kind: c.kind, center: round(c.center), marker: round(c.center) });
      h.teeBoxes.sort((a, b) => TEE_ORDER.indexOf(a.kind) - TEE_ORDER.indexOf(b.kind));
      return ok(undefined);
    }
    case 'moveTeeBox': {
      if (locked) return fail(locked);
      const t = h.teeBoxes.find(x => x.kind === c.kind);
      if (!t) return fail(`No ${c.kind} tee on this hole`);
      if (!g.parcels.tileOwned(c.center.x, c.center.y)) return fail("Tee box must be on land you own");
      t.center = round(c.center);
      t.marker = round(c.center);
      return ok(undefined);
    }
    case 'removeTeeBox':
      if (locked) return fail(locked);
      if (!h.teeBoxes.some(t => t.kind === c.kind)) return fail(`No ${c.kind} tee on this hole`);
      h.teeBoxes = h.teeBoxes.filter(t => t.kind !== c.kind);
      return ok(undefined);
    case 'setPins': {
      if (c.pins.length > MAX_PINS) return fail(`At most ${MAX_PINS} pin positions`);
      for (const p of c.pins) {
        const r = round(p);
        if (!g.world.inBounds(r.x, r.y) || g.world.surface[g.world.idx(r.x, r.y)] !== Surface.Green) return fail('Every pin must be on the green');
      }
      h.pins = c.pins.map(round);
      h.activePin = Math.min(h.activePin, Math.max(0, h.pins.length - 1));
      return ok(undefined);
    }
    case 'setActivePin':
      if (c.index < 0 || c.index >= h.pins.length) return fail('No such pin position');
      h.activePin = c.index;
      return ok(undefined);
    case 'setPinMode':
      if (c.mode !== 'auto' && c.mode !== 'manual') return fail('Pin mode is auto or manual');
      h.pinMode = c.mode;
      return ok(undefined);
  }
}
