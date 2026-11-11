import { Game } from '../../../src/sim/game';
import { SLOPE_MAX, SLOPE_MIN, computeStrokeIndex, holeDifficulty, rateCourse, ratingSystem } from '../../../src/sim/rating/courseRating';
import { Surface } from '../../../src/sim/world/tiles';
import { addStraightHole } from '../golfers/courseFixture';
import { newOwnedGame } from '../../helpers';

function game(): Game {
  const parcels: [number, number][] = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) parcels.push([x, y]);
  return newOwnedGame({ size: 300, parcels });
}
/** Water across the fairway, `from`..`to` tiles out from the tee. */
function waterBand(g: Game, tee: { x: number; y: number }, from: number, to: number) {
  const w = g.world;
  for (let x = tee.x + from; x < tee.x + to; x++) for (let y = tee.y - 30; y <= tee.y + 30; y++) w.surface[w.idx(x, y)] = Surface.Water;
}

test('a longer, more hazardous course rates higher in course rating and slope', () => {
  const short = game();
  const sc = short.courses.create('Pitch');
  for (let k = 0; k < 3; k++) addStraightHole(short, sc, { x: 20, y: 30 + k * 80 }, { x: 90, y: 30 + k * 80 });
  const long = game();
  const lc = long.courses.create('Monster');
  for (let k = 0; k < 3; k++) {
    const tee = { x: 15, y: 30 + k * 80 };
    addStraightHole(long, lc, tee, { x: 230, y: 30 + k * 80 });
    waterBand(long, tee, 95, 110);
  }
  const a = rateCourse(short, sc.id, 'middle', 40);
  const b = rateCourse(long, lc.id, 'middle', 40);
  expect(b.courseRating).toBeGreaterThan(a.courseRating);
  expect(b.slope).toBeGreaterThan(a.slope);
  for (const r of [a, b]) { expect(r.slope).toBeGreaterThanOrEqual(SLOPE_MIN); expect(r.slope).toBeLessThanOrEqual(SLOPE_MAX); }
});

test('rating leaves no wear behind and is repeatable', () => {
  const g = game();
  const c = g.courses.create('C');
  addStraightHole(g, c, { x: 20, y: 30 }, { x: 150, y: 30 });
  const wear = g.world.wear.slice();
  const r1 = rateCourse(g, c.id, 'middle', 20);
  expect(g.world.wear).toEqual(wear);
  expect(rateCourse(g, c.id, 'middle', 20)).toEqual(r1);
});

test('stroke index is a permutation of 1..N, odd on the front nine, and water holes rank harder', () => {
  const g = game();
  const c = g.courses.create('Twelve');
  const holes = [];
  for (let k = 0; k < 12; k++) {
    const row = k % 6, col = Math.floor(k / 6);
    const tee = { x: 10 + col * 145, y: 15 + row * 48 };
    holes.push(addStraightHole(g, c, tee, { x: tee.x + 110, y: tee.y }));
  }
  // hole 4 (front) and hole 10 (back) carry water short of the green
  waterBand(g, { x: 10, y: 15 + 3 * 48 }, 70, 82);
  waterBand(g, { x: 155, y: 15 + 3 * 48 }, 70, 82);
  const diff = holeDifficulty(g, c.id, 30);
  const si = computeStrokeIndex(g, c.id, diff);
  const values = [...si.values()].sort((a, b) => a - b);
  expect(values).toEqual(Array.from({ length: 12 }, (_, k) => k + 1));
  // the front nine takes every odd number (6 of them); the back nine's three take evens
  expect(holes.filter(h => h.number <= 9 && si.get(h.id)! % 2 === 1).length).toBe(6);
  expect(holes.filter(h => h.number > 9).every(h => si.get(h.id)! % 2 === 0)).toBe(true);
  const water = holes.filter(h => h.number === 4 || h.number === 10).map(h => si.get(h.id)!);
  expect(Math.max(...water)).toBeLessThanOrEqual(2);
  // a manual index sticks
  holes[0]!.strokeIndex = 12;
  expect(computeStrokeIndex(g, c.id, diff).get(holes[0]!.id)).toBe(12);
});

test('the rating system rates a course once it has open holes', () => {
  const g = game();
  const c = g.courses.create('C');
  addStraightHole(g, c, { x: 20, y: 30 }, { x: 150, y: 30 });
  ratingSystem.onDay!(g);
  const r = g.ratings.get(c.id)!;
  expect(r.courseRating).toBeGreaterThan(0);
  expect(Object.keys(r.strokeIndex).length).toBe(1);
});
