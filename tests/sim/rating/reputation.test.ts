import { Rng } from '../../../src/core/rng';
import { dailyDemand } from '../../../src/sim/golfers/demand';
import { computeReputation, drainEvents, landValueFeedback, reputation, reputationSystem } from '../../../src/sim/rating/reputation';
import { maybeReview, starsFor } from '../../../src/sim/rating/reviews';
import { aestheticsScore, conditionScore } from '../../../src/sim/rating/scores';
import { holeTiles } from '../../../src/sim/turf/turf';
import { Feature } from '../../../src/sim/world/tiles';
import { Grass } from '../../../src/sim/turf/grasses';
import { addClubhouse, threeHoleCourse } from '../golfers/courseFixture';

test('unowned parcels near the course rise in price when reputation is above 2.5', () => {
  const { g } = threeHoleCourse();
  const p = g.parcels;
  // own just the corner parcel: (2,1) is within 3 parcels of it, the far corner is not
  p.owner.fill(0);
  p.owner[0] = 1;
  const near = 1 * p.perSide + 2, far = (p.perSide - 1) * p.perSide + (p.perSide - 1);
  expect(p.perSide).toBeGreaterThan(4);
  const before = { near: p.price[near]!, far: p.price[far]! };
  landValueFeedback(g, 4.5);
  expect(p.price[near]).toBeGreaterThan(before.near);
  expect(p.price[far]).toBe(before.far);
  landValueFeedback(g, 1);
  landValueFeedback(g, 1);
  expect(p.price[near]).toBeLessThan(before.near * 1.08 * 0.97);
});

test('poor condition lowers the condition score and, over 30 days, the reputation', () => {
  const run = (health: number) => {
    const { g, course } = threeHoleCourse();
    addClubhouse(g, course);
    const tiles = course.holes.flatMap(h => holeTiles(g, h.id).turf);
    for (const i of tiles) { g.world.grass[i] = Grass.Bent; g.world.health[i] = health; }
    const score = conditionScore(g, course.id);
    // hold the turf where it is and let the reviews come in
    for (let d = 0; d < 30; d++) {
      for (const i of tiles) g.world.health[i] = health;
      const end = g.day + 1;
      while (g.day < end) g.tick();
    }
    for (const i of tiles) g.world.health[i] = health;
    return { score, rep: computeReputation(g, course.id) };
  };
  const good = run(90), bad = run(25);
  expect(bad.score).toBeLessThan(good.score - 20);
  expect(bad.rep.overall).toBeLessThan(good.rep.overall);
  expect(bad.rep.reviews + good.rep.reviews).toBeGreaterThan(0);
});

test('competitive players rate a hard course higher than casual players do', () => {
  const { g, course } = threeHoleCourse();
  const rng = new Rng(2);
  const comp = g.golfers.spawn(rng, { type: 'competitive' }), casual = g.golfers.spawn(rng, { type: 'casual' });
  comp.traits.challenge = 0.9; casual.traits.challenge = 0.2;
  g.ratings.set(course.id, { courseRating: 74, slope: 150, tee: 'middle', day: g.day, holes: '', strokeIndex: {} });
  expect(starsFor(g, comp, course.id, 60)).toBeGreaterThan(starsFor(g, casual, course.id, 60));
  // and reviews carry the golfer's thoughts
  let r = null;
  for (let k = 0; k < 40 && !r; k++) { g.clock.day++; r = maybeReview(g, comp, course.id, 80, [{ golferId: comp.id, day: g.day, minute: 600, key: 'greatShot', holeNumber: 2, mood: 2 }]); }
  expect(r?.text).toMatch(/Birdie on 2/);
});

test('removing a specimen tree drops aesthetics', () => {
  const { g, course, holes } = threeHoleCourse();
  const w = g.world;
  addClubhouse(g, course);
  // a wooded first hole, so there is something to lose
  for (let y = -18; y <= 18; y += 2) for (let x = 0; x < 60; x += 3) { const k = w.idx(holes[0]!.teeBoxes[0]!.center.x + x, holes[0]!.greenCenter.y + y); if (Math.abs(y) > 8) w.treeSpecies[k] = 1; }
  const at = { x: holes[0]!.greenCenter.x + 14, y: holes[0]!.greenCenter.y };
  const i = w.idx(at.x, at.y);
  w.feature[i] = Feature.SpecimenTree;
  const before = aestheticsScore(g, course.id);
  // what the remove-trees tool does on commit
  w.feature[i] = Feature.None;
  g.pendingReputationEvents.push({ kind: 'specimenRemoved', at });
  drainEvents(g);
  expect(g.repState.penalties.length).toBe(1);
  expect(aestheticsScore(g, course.id)).toBeLessThan(before - 5);
});

test('higher reputation brings more golfers', () => {
  const { g, course } = threeHoleCourse();
  addClubhouse(g, course);
  reputationSystem.onDay!(g);
  const base = reputation(g, course.id);
  const at = (stars: number) => { g.reputation.set(course.id, { ...base, overall: stars, day: g.day }); return dailyDemand(g, course); };
  expect(at(4.5)).toBeGreaterThan(at(1.5));
});
