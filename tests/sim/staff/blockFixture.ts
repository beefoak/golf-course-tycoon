import { Game } from '../../../src/sim/game';
import { Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

/** N compact open holes in 50×50 cells: tee 5×3, fairway 20×8, green 10×10, bunker 3×3. */
export function blockCourse(n: number): { g: Game; courseId: number; holeIds: number[] } {
  const parcels: [number, number][] = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) parcels.push([x, y]);
  const g = newOwnedGame({ size: 300, parcels });
  const course = g.courses.create('Blocks');
  const w = g.world;
  const holeIds: number[] = [];
  const paint = (x0: number, y0: number, wdt: number, ht: number, s: Surface, hid: number) => {
    for (let y = y0; y < y0 + ht; y++) for (let x = x0; x < x0 + wdt; x++) { const i = w.idx(x, y); w.surface[i] = s; w.holeId[i] = hid; w.courseId[i] = course.id; }
  };
  for (let k = 0; k < n; k++) {
    const ox = (k % 6) * 50, oy = Math.floor(k / 6) * 50;
    const h = g.courses.addHole(course.id, { route: [{ x: ox + 5, y: oy + 25 }, { x: ox + 40, y: oy + 25 }], greenCenter: { x: ox + 40, y: oy + 25 }, state: 'open', pins: [{ x: ox + 40, y: oy + 25 }] });
    paint(ox + 3, oy + 24, 5, 3, Surface.Tee, h.id);
    paint(ox + 12, oy + 21, 20, 8, Surface.Fairway, h.id);
    paint(ox + 35, oy + 20, 10, 10, Surface.Green, h.id);
    paint(ox + 36, oy + 31, 3, 3, Surface.Bunker, h.id);
    holeIds.push(h.id);
  }
  return { g, courseId: course.id, holeIds };
}
