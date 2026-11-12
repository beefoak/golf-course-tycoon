import { Game } from '../../../src/sim/game';
import { EVENTS, TOURNAMENT_STIMP, acceptEvent, eventBlocker, eventSystem, offerEvent } from '../../../src/sim/rating/events';
import { reputation } from '../../../src/sim/rating/reputation';
import { scheduleDay, teeSheetFor } from '../../../src/sim/golfers/demand';
import { turfSettings, holeTiles } from '../../../src/sim/turf/turf';
import { Grass } from '../../../src/sim/turf/grasses';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { blockCourse } from '../staff/blockFixture';

function eighteen(health: number) {
  const fx = blockCourse(18);
  const { g, courseId } = fx;
  const w = g.world;
  for (const id of fx.holeIds) for (const i of holeTiles(g, id).turf) { w.grass[i] = Grass.Bent; w.health[i] = health; w.mowHeight[i] = 36; }
  // greens at the stimp target so condition is all about the turf
  g.turf.settings.set(courseId, { ...turfSettings(g, courseId), greenStimpTarget: 9 });
  for (let x = 0; x < w.size; x++) { const i = w.idx(x, w.size - 1); w.feature[i] = Feature.Road; w.surface[i] = Surface.Path; }
  const r = g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId, origin: { x: 10, y: w.size - 11 } });
  if (!r.ok) throw new Error(r.reason);
  return fx;
}
const course = (g: Game, id: number) => g.courses.get(id)!;

test('a club championship needs 18 holes and condition ≥ 70', () => {
  const poor = eighteen(25);
  expect(eventBlocker(poor.g, course(poor.g, poor.courseId), 'clubChampionship')).toMatch(/condition/);
  const e = offerEvent(poor.g, poor.courseId, 'clubChampionship');
  expect(acceptEvent(poor.g, e.id).ok).toBe(false);
  const small = blockCourse(9);
  expect(eventBlocker(small.g, course(small.g, small.courseId), 'clubChampionship')).toMatch(/18 open holes/);
  const good = eighteen(95);
  expect(eventBlocker(good.g, course(good.g, good.courseId), 'clubChampionship')).toBeNull();
});

test('an accepted championship takes the day\'s public tee times, pays, and sets up the course', () => {
  const { g, courseId } = eighteen(95);
  const e = offerEvent(g, courseId, 'clubChampionship', g.day + 1);
  expect(acceptEvent(g, e.id).ok).toBe(true);
  // an ordinary day: golfers book
  scheduleDay(g);
  expect(g.groups.filter(x => x.day === g.day).length).toBeGreaterThan(0);
  // event day: nobody else gets on
  g.clock.day = e.day;
  const cash = g.ledger.cash;
  eventSystem.onDay!(g);
  scheduleDay(g);
  expect(g.groups.filter(x => x.day === g.day).length).toBe(0);
  const sheet = teeSheetFor(g, courseId);
  expect(sheet.nearestFree(g.day, 600, 18)).toBeNull();
  const d = EVENTS.clubChampionship;
  expect(g.ledger.totals(g.day, g.day).events.in).toBe(d.players * d.entryFee + d.sponsorship);
  expect(g.ledger.cash).toBeGreaterThan(cash);
  // a one-day event: set up and stood down the same day, with prestige banked and the milestone reached
  expect(turfSettings(g, courseId).greenStimpTarget).toBe(9);
  expect(e.result!.prestige).toBeGreaterThan(0);
  expect(g.milestones.clubChampionship).toBe(g.day);
  const before = reputation(g, courseId).overall;
  expect(g.repState.bonuses.length).toBe(1);
  void before;
});

test('a multi-day event runs tournament greens until its last day', () => {
  const { g, courseId } = eighteen(95);
  g.ratings.set(courseId, { courseRating: 72, slope: 130, tee: 'middle', day: g.day, holes: '', strokeIndex: {} });
  g.reputation.set(courseId, { ...reputation(g, courseId), overall: 4, day: g.day });
  const e = offerEvent(g, courseId, 'regionalAmateur', g.day + 1);
  expect(acceptEvent(g, e.id).ok).toBe(true);
  g.clock.day = e.day;
  eventSystem.onDay!(g);
  expect(turfSettings(g, courseId).greenStimpTarget).toBe(TOURNAMENT_STIMP);
  g.clock.day = e.day + 1;
  eventSystem.onDay!(g);
  expect(turfSettings(g, courseId).greenStimpTarget).toBe(9);
});
