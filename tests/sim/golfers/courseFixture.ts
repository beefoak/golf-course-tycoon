import { Vec2 } from '../../../src/core/geom';
import { Rng } from '../../../src/core/rng';
import { Course, Hole } from '../../../src/sim/course/course';
import { Game } from '../../../src/sim/game';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

/** Paint a straight hole (fairway 12 wide, green r8 + fringe) and register it as open. */
export function addStraightHole(g: Game, course: Course, tee: Vec2, green: Vec2): Hole {
  const w = g.world;
  const len = Math.hypot(green.x - tee.x, green.y - tee.y);
  for (let t = 10; t <= len; t += 0.5) {
    const cx = tee.x + ((green.x - tee.x) * t) / len, cy = tee.y + ((green.y - tee.y) * t) / len;
    for (let o = -6; o < 6; o++) {
      const x = Math.round(cx + o * Math.abs((green.y - tee.y) / len)), y = Math.round(cy + o * Math.abs((green.x - tee.x) / len));
      if (w.inBounds(x, y)) w.surface[w.idx(x, y)] = Surface.Fairway;
    }
  }
  for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) {
    const d = Math.hypot(x, y);
    if (d <= 10) w.surface[w.idx(green.x + x, green.y + y)] = d <= 8 ? Surface.Green : Surface.Fringe;
  }
  for (let y = -2; y <= 2; y++) for (let x = -3; x <= 3; x++) w.surface[w.idx(tee.x + x, tee.y + y)] = Surface.Tee;
  const h = g.courses.addHole(course.id, {
    route: [tee, green], greenCenter: green, state: 'open', pins: [green],
    teeBoxes: (['championship', 'back', 'middle', 'forward'] as const).map(kind => ({ kind, center: tee, marker: tee })),
  });
  for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) {
    const i = w.idx(x, y);
    if (Math.hypot(x - green.x, y - green.y) <= 10 || Math.abs(x - tee.x) <= 3 && Math.abs(y - tee.y) <= 2) w.holeId[i] = h.id;
  }
  return h;
}

/** Three ~140 m par 3s side by side on a fully owned 300×300 map, clubhouse by the first tee. */
export function threeHoleCourse(): { g: Game; course: Course; holes: Hole[] } {
  const parcels: [number, number][] = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) parcels.push([x, y]);
  const g = newOwnedGame({ size: 300, parcels });
  g.world.surface.fill(Surface.Rough);
  const course = g.courses.create('Test Links');
  const holes = [
    addStraightHole(g, course, { x: 60, y: 250 }, { x: 60, y: 180 }),
    addStraightHole(g, course, { x: 100, y: 180 }, { x: 100, y: 250 }),
    addStraightHole(g, course, { x: 140, y: 250 }, { x: 140, y: 180 }),
  ];
  course.clubhouse = { x: 60, y: 270 };
  return { g, course, holes };
}

export function spawnGolfers(g: Game, n: number, seed = 1): number[] {
  const rng = new Rng(seed);
  return Array.from({ length: n }, () => g.golfers.spawn(rng).id);
}

/** Put a road along the bottom row and build the clubhouse beside it (west of hole 1's tee). */
export function addClubhouse(g: Game, course: Course): void {
  const w = g.world;
  for (let x = 0; x < w.size; x++) { const i = w.idx(x, w.size - 1); w.feature[i] = Feature.Road; w.surface[i] = Surface.Path; }
  const r = g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId: course.id, origin: { x: 10, y: w.size - 11 } });
  if (!r.ok) throw new Error(r.reason);
}
