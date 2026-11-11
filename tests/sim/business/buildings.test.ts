import { BUILDING_DEFS, CLUBHOUSE_LOT, PARKING_TURNS, buildingSystem, clubhouseOf, maxGroupsPerDay, parkingCapacity } from '../../../src/sim/business/buildings';
import { createGroup } from '../../../src/sim/golfers/groups';
import { scheduleDay } from '../../../src/sim/golfers/demand';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { spawnGolfers, threeHoleCourse } from '../golfers/courseFixture';

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

function withClubhouse() {
  const fx = withRoad();
  const r = fx.g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId: fx.course.id, origin: { x: 10, y: 289 } });
  if (!r.ok) throw new Error(r.reason);
  return fx;
}

test('the pro shop must be built onto the clubhouse', () => {
  const { g, course } = withClubhouse();
  const far = g.dispatch({ t: 'placeBuilding', kind: 'proShop', courseId: course.id, origin: { x: 40, y: 270 } });
  expect(far.ok).toBe(false);
  if (!far.ok) expect(far.reason).toMatch(/onto the clubhouse/);
  // clubhouse spans x 10–24, y 289–298: a shop directly west of it touches
  const next = g.dispatch({ t: 'placeBuilding', kind: 'proShop', courseId: course.id, origin: { x: 2, y: 290 } });
  expect(next.ok).toBe(true);
});

test('amenities that need a clubhouse are refused without one; the lodge stays locked', () => {
  const { g, course } = withRoad();
  const r = g.dispatch({ t: 'placeBuilding', kind: 'restaurant', courseId: course.id, origin: { x: 200, y: 120 } });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(/clubhouse first/);
  g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId: course.id, origin: { x: 10, y: 289 } });
  const lodge = g.dispatch({ t: 'placeBuilding', kind: 'lodging', courseId: course.id, origin: { x: 200, y: 120 } });
  expect(lodge.ok).toBe(false);
  if (!lodge.ok) expect(lodge.reason).toMatch(/4-star/);
  expect(g.dispatch({ t: 'placeBuilding', kind: 'restaurant', courseId: course.id, origin: { x: 200, y: 120 } }).ok).toBe(true);
});

test('upkeep is charged daily to utilities, per building', () => {
  const { g, course } = withClubhouse();
  g.dispatch({ t: 'placeBuilding', kind: 'parking', courseId: course.id, origin: { x: 40, y: 289 } });
  const cash = g.ledger.cash;
  buildingSystem.onDay!(g);
  const expected = BUILDING_DEFS.clubhouse.upkeepPerDay + BUILDING_DEFS.parking.upkeepPerDay;
  expect(cash - g.ledger.cash).toBe(expected);
  expect(g.ledger.tx.filter(t => t.cat === 'utilities').reduce((s, t) => s + t.out, 0)).toBe(expected);
});

test('parking caps daily arrivals: a full car park turns groups away with a notification', () => {
  const { g, course } = withClubhouse();
  const cap = maxGroupsPerDay(g, course.id);
  expect(cap).toBe(CLUBHOUSE_LOT * PARKING_TURNS);
  // the lot is nearly full already today
  for (let k = 0; k < cap - 1; k++) createGroup(g, course.id, spawnGolfers(g, 1, k + 1), g.day, 1200);
  const msgs: string[] = [];
  let away = 0;
  g.events.on('notify', n => msgs.push(n.text));
  g.events.on('noParking', e => { away += e.golfers; });
  g.pricing.set(course.id, { greenFee: { 3: 0, 9: 0, 18: 0 } }); // free golf: plenty of takers
  scheduleDay(g);
  expect(g.groups.filter(x => x.courseId === course.id && x.day === g.day).length).toBe(cap);
  expect(away).toBeGreaterThan(0);
  expect(msgs.some(m => /car park full/.test(m))).toBe(true);
  // a car park adds 25 cars → 75 more groups a day
  expect(g.dispatch({ t: 'placeBuilding', kind: 'parking', courseId: course.id, origin: { x: 40, y: 289 } }).ok).toBe(true);
  expect(maxGroupsPerDay(g, course.id)).toBe(cap + BUILDING_DEFS.parking.capacity! * PARKING_TURNS);
});

test('upgrading the clubhouse tier costs the next tier and enlarges its lot', () => {
  const { g, course } = withClubhouse();
  const club = clubhouseOf(g, course.id)!;
  const cash = g.ledger.cash;
  expect(g.dispatch({ t: 'upgradeTier', buildingId: club.id }).ok).toBe(true);
  expect(cash - g.ledger.cash).toBe(BUILDING_DEFS.clubhouse.cost[1]);
  expect(club.tier).toBe(2);
  expect(parkingCapacity(g, course.id)).toBe(CLUBHOUSE_LOT * 2);
  g.dispatch({ t: 'upgradeTier', buildingId: club.id });
  expect(g.dispatch({ t: 'upgradeTier', buildingId: club.id }).ok).toBe(false);
});
