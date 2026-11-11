import { Vec2 } from '../../core/geom';
import { Result, fail, ok } from '../../core/result';

export type HoleState = 'construction' | 'growingIn' | 'open' | 'closing' | 'closed';
export type TeeKind = 'championship' | 'back' | 'middle' | 'forward';
export const TEE_ORDER: TeeKind[] = ['championship', 'back', 'middle', 'forward'];
export const MAX_PINS = 6;
export const MIN_PINS = 4;

export interface TeeBox { kind: TeeKind; center: Vec2; marker: Vec2 }
export interface Stakes { ob: Vec2[]; red: Vec2[]; yellow: Vec2[] }

export interface Hole {
  id: number;
  courseId: number;
  number: number;
  name: string;
  state: HoleState;
  /** tee → waypoints → green centre */
  route: Vec2[];
  teeBoxes: TeeBox[];
  greenCenter: Vec2;
  pins: Vec2[];
  activePin: number;
  parOverride: number | null;
  strokeIndex: number | null;
  growInDaysLeft: number;
  stakes: Stakes;
  stakeOverrides: { add: { kind: keyof Stakes; at: Vec2 }[] };
  /** true when turf tiles were edited while the hole was closed (Task 14) */
  editedSinceClose: boolean;
}

export interface Course { id: number; name: string; holes: Hole[]; clubhouse: Vec2 | null }

export class CourseRegistry {
  list: Course[] = [];
  private holes = new Map<number, Hole>();
  private nextCourse = 1;
  private nextHole = 1;

  create(name: string): Course {
    const c: Course = { id: this.nextCourse++, name, holes: [], clubhouse: null };
    this.list.push(c);
    return c;
  }
  get(id: number): Course | undefined {
    return this.list.find(c => c.id === id);
  }
  hole(id: number): Hole | undefined {
    return this.holes.get(id);
  }
  allHoles(): Hole[] {
    return this.list.flatMap(c => c.holes);
  }
  nextHoleId(): number {
    return this.nextHole;
  }
  addHole(courseId: number, init: Pick<Hole, 'route' | 'greenCenter'> & Partial<Hole>): Hole {
    const c = this.get(courseId);
    if (!c) throw new Error(`No course ${courseId}`);
    const id = this.nextHole++;
    const number = c.holes.length + 1;
    const h: Hole = {
      id, courseId, number, name: `Hole ${number}`, state: 'construction',
      teeBoxes: [], pins: [], activePin: 0, parOverride: null, strokeIndex: null, growInDaysLeft: 0,
      stakes: { ob: [], red: [], yellow: [] }, stakeOverrides: { add: [] }, editedSinceClose: false,
      ...init,
    };
    c.holes.push(h);
    this.holes.set(id, h);
    return h;
  }
  removeHole(id: number): void {
    const h = this.holes.get(id);
    if (!h) return;
    const c = this.get(h.courseId)!;
    c.holes = c.holes.filter(x => x.id !== id);
    c.holes.forEach((x, i) => { x.number = i + 1; if (/^Hole \d+$/.test(x.name)) x.name = `Hole ${i + 1}`; });
    this.holes.delete(id);
  }
  /** For save/load. */
  restore(list: Course[], nextCourse: number, nextHole: number): void {
    this.list = list;
    this.holes.clear();
    for (const h of this.allHoles()) this.holes.set(h.id, h);
    this.nextCourse = nextCourse;
    this.nextHole = nextHole;
  }
  counters(): { nextCourse: number; nextHole: number } {
    return { nextCourse: this.nextCourse, nextHole: this.nextHole };
  }
}

export function renumber(course: Course, orderedHoleIds: number[]): Result {
  const ids = new Set(course.holes.map(h => h.id));
  if (orderedHoleIds.length !== ids.size || !orderedHoleIds.every(id => ids.has(id)) || new Set(orderedHoleIds).size !== ids.size) {
    return fail('The new order must list every hole of the course exactly once');
  }
  const byId = new Map(course.holes.map(h => [h.id, h]));
  course.holes = orderedHoleIds.map((id, i) => {
    const h = byId.get(id)!;
    h.number = i + 1;
    if (/^Hole \d+$/.test(h.name)) h.name = `Hole ${i + 1}`;
    return h;
  });
  return ok(undefined);
}
