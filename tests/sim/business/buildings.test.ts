import { BUILDING_DEFS, clubhouseOf } from '../../../src/sim/business/buildings';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { threeHoleCourse } from '../golfers/courseFixture';

function withRoad() {
  const fx = threeHoleCourse();
  const w = fx.g.world;
  for (let x = 0; x < w.size; x++) { const i = w.idx(x, w.size - 1); w.feature[i] = Feature.Road; w.surface[i] = Surface.Path; }
  return fx;
}

test('a clubhouse beside the road is built, painted and charged; its door faces the course', () => {
  const { g, course } = withRoad();
  const before = g.ledger.cash;
  const r = g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId: course.id, origin: { x: 10, y: 289 } });
  expect(r.ok).toBe(true);
  expect(before - g.ledger.cash).toBe(BUILDING_DEFS.clubhouse.cost[0]);
  expect(g.world.surface[g.world.idx(10, 289)]).toBe(Surface.Building);
  expect(g.world.surface[g.world.idx(24, 298)]).toBe(Surface.Building);
  const b = clubhouseOf(g, course.id)!;
  expect(b.door.y).toBe(288);
  expect(course.clubhouse).toEqual(b.door);
});

test('a clubhouse away from the road is refused', () => {
  const { g, course } = withRoad();
  const r = g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId: course.id, origin: { x: 10, y: 200 } });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(/road/);
});

test('a clubhouse on unowned land or over a hole is refused, and only one per course', () => {
  const { g, course } = withRoad();
  g.parcels.owner[5 * g.parcels.perSide + 0] = 0; // parcel (0,5) unowned
  expect(g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId: course.id, origin: { x: 10, y: 289 } }).ok).toBe(false);
  g.parcels.owner[5 * g.parcels.perSide + 0] = 1;
  expect(g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId: course.id, origin: { x: 54, y: 240 } }).ok).toBe(false);
  expect(g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId: course.id, origin: { x: 10, y: 289 } }).ok).toBe(true);
  expect(g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId: course.id, origin: { x: 200, y: 289 } }).ok).toBe(false);
});
