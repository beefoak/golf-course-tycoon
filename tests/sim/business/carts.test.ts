import { Rng } from '../../../src/core/rng';
import { Game } from '../../../src/sim/game';
import { CARTS_WITHOUT_BARN, WARMUP_HANDICAP, cartPathOnly, cartSystem, chooseCarts, fleetOf, playingGolfer, rangeWarmup } from '../../../src/sim/business/carts';
import { createGroup } from '../../../src/sim/golfers/groups';
import { playStroke, startHole } from '../../../src/sim/golfers/hole';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { spawnGolfers, threeHoleCourse } from '../golfers/courseFixture';

function withClubhouse() {
  const fx = threeHoleCourse();
  const w = fx.g.world;
  for (let x = 0; x < w.size; x++) { const i = w.idx(x, w.size - 1); w.feature[i] = Feature.Road; w.surface[i] = Surface.Path; }
  const r = fx.g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId: fx.course.id, origin: { x: 10, y: 289 } });
  if (!r.ok) throw new Error(r.reason);
  return fx;
}

test('more than 10 carts need a cart barn', () => {
  const { g, course } = withClubhouse();
  expect(g.dispatch({ t: 'buyCarts', courseId: course.id, n: CARTS_WITHOUT_BARN }).ok).toBe(true);
  const r = g.dispatch({ t: 'buyCarts', courseId: course.id, n: 1 });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(/cart barn/);
  expect(g.dispatch({ t: 'placeBuilding', kind: 'cartBarn', courseId: course.id, origin: { x: 200, y: 100 } }).ok).toBe(true);
  expect(g.dispatch({ t: 'buyCarts', courseId: course.id, n: 10 }).ok).toBe(true);
  expect(fleetOf(g, course.id).count).toBe(20);
});

test('older, wealthier golfers ride; riders pay the cart fee', () => {
  const { g, course, holes } = withClubhouse();
  g.dispatch({ t: 'buyCarts', courseId: course.id, n: 10 });
  const rng = new Rng(4);
  let rode = 0, groups = 0;
  for (let k = 0; k < 60; k++) {
    const ids = Array.from({ length: 2 }, () => { const p = g.golfers.spawn(rng); p.age = 68; p.segment = 'premium'; return p.id; });
    const grp = createGroup(g, course.id, ids, g.day, 900, holes.map(h => h.id));
    groups++;
    if (chooseCarts(g, grp)) rode++;
    grp.phase = 'done';
  }
  expect(rode / groups).toBeGreaterThan(0.4);
  expect(g.ledger.tx.filter(t => t.cat === 'carts').reduce((s, t) => s + t.in, 0)).toBe(rode * 2 * fleetOf(g, course.id).feePerRider);
});

test('wet days put carts on the paths: slower, and riders grumble', () => {
  const { g, course, holes } = withClubhouse();
  g.dispatch({ t: 'buyCarts', courseId: course.id, n: 10 });
  g.weather.kind = 'sunny';
  cartSystem.onDay!(g);
  expect(cartPathOnly(g, course.id)).toBe(false);
  g.weather.kind = 'rain';
  cartSystem.onDay!(g);
  expect(cartPathOnly(g, course.id)).toBe(true);
  // soggy turf alone does it too
  g.weather.kind = 'cloudy';
  g.world.moisture.fill(95);
  cartSystem.onDay!(g);
  expect(cartPathOnly(g, course.id)).toBe(true);
  const thoughts: string[] = [];
  g.events.on('thought', t => thoughts.push(t.key));
  const rng = new Rng(8);
  let rode = 0;
  for (let k = 0; k < 30 && !rode; k++) {
    const ids = Array.from({ length: 2 }, () => { const p = g.golfers.spawn(rng); p.age = 70; p.segment = 'premium'; return p.id; });
    if (chooseCarts(g, createGroup(g, course.id, ids, g.day, 900, holes.map(h => h.id)))) rode++;
  }
  expect(rode).toBe(1);
  expect(thoughts.filter(k => k === 'cartPathOnly').length).toBe(2);
});

test('a range warm-up lowers the average score', () => {
  const { g, course, holes } = withClubhouse();
  expect(g.dispatch({ t: 'placeBuilding', kind: 'range', courseId: course.id, origin: { x: 200, y: 20 } }).ok).toBe(true);
  // warm-ups happen and are paid for
  let warmed = 0;
  for (let k = 0; k < 30; k++) { const grp = createGroup(g, course.id, spawnGolfers(g, 4, 50 + k), g.day, 900, holes.map(h => h.id)); rangeWarmup(g, grp); warmed += grp.warm?.length ?? 0; }
  expect(warmed).toBeGreaterThan(10);
  expect(g.ledger.tx.filter(t => t.cat === 'range').reduce((s, t) => s + t.in, 0)).toBeGreaterThan(0);
  // same golfers, same random numbers: the warmed-up version scores lower on average
  const hole = holes[0]!;
  const score = (warm: boolean) => {
    let total = 0;
    for (let k = 0; k < 600; k++) {
      const [id] = spawnGolfers(g, 1, 1000 + k);
      const gf = g.golfers.all.get(id!)!;
      gf.handicap = 20;
      const grp = createGroup(g, course.id, [id!], g.day, 900, [hole.id]);
      if (warm) grp.warm = [id!];
      const me = playingGolfer(grp, gf);
      const rng = new Rng(77 + k);
      const b = startHole(g, me, hole);
      let guard = 0;
      while (!b.done && guard++ < 30) playStroke(g, me, hole, b, rng, { x: 0, y: 0 });
      total += b.strokes;
    }
    return total / 600;
  };
  expect(playingGolfer({ warm: [1] } as never, { id: 1, handicap: 10 } as never).handicap).toBe(10 - WARMUP_HANDICAP);
  expect(score(true)).toBeLessThan(score(false));
});
