import { Rng } from '../../../src/core/rng';
import { Game } from '../../../src/sim/game';
import { COST_OF_GOODS, coversPerHour, fnbAfterHole, fnbOf, restaurantVisit } from '../../../src/sim/business/fnb';
import { Group, createGroup } from '../../../src/sim/golfers/groups';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { threeHoleCourse } from '../golfers/courseFixture';

function withClubhouse() {
  const fx = threeHoleCourse();
  const w = fx.g.world;
  for (let x = 0; x < w.size; x++) { const i = w.idx(x, w.size - 1); w.feature[i] = Feature.Road; w.surface[i] = Surface.Path; }
  const r = fx.g.dispatch({ t: 'placeBuilding', kind: 'clubhouse', courseId: fx.course.id, origin: { x: 10, y: 289 } });
  if (!r.ok) throw new Error(r.reason);
  return fx;
}
function hungryGroup(g: Game, courseId: number, holeOrder: number[], seed: number): Group {
  const rng = new Rng(seed);
  const ids = Array.from({ length: 4 }, () => { const p = g.golfers.spawn(rng); p.traits.food = 1; p.segment = 'premium'; return p.id; });
  return createGroup(g, courseId, ids, g.day, 900, holeOrder);
}
const fnbIn = (g: Game) => g.ledger.tx.filter(t => t.cat === 'fnb').reduce((s, t) => s + t.in, 0);

test('the halfway house earns only at the turn of a 10+ hole round, or through a drink station', () => {
  const { g, course, holes } = withClubhouse();
  expect(g.dispatch({ t: 'placeBuilding', kind: 'halfwayHouse', courseId: course.id, origin: { x: 200, y: 100 } }).ok).toBe(true);
  // a 3-hole round: no turn, no drink station → nothing sold
  for (let k = 0; k < 40; k++) {
    const grp = hungryGroup(g, course.id, holes.map(h => h.id), k);
    for (const h of holes) fnbAfterHole(g, grp, h.id);
  }
  expect(fnbIn(g)).toBe(0);
  // a 12-hole loop (holes repeated) passes the turn after its 9th hole
  const twelve = [...holes, ...holes, ...holes, ...holes].map(h => h.id);
  for (let k = 0; k < 40; k++) { const grp = hungryGroup(g, course.id, twelve, 100 + k); grp.holeIdx = 8; fnbAfterHole(g, grp, twelve[8]!); }
  const turn = fnbIn(g);
  expect(turn).toBeGreaterThan(0);
  // a drink station by hole 1's green sells on short rounds too
  g.structures.push({ id: 1, kind: 'drinkStation', at: { x: holes[0]!.greenCenter.x + 12, y: holes[0]!.greenCenter.y } });
  for (let k = 0; k < 40; k++) { const grp = hungryGroup(g, course.id, holes.map(h => h.id), 200 + k); fnbAfterHole(g, grp, holes[0]!.id); }
  expect(fnbIn(g)).toBeGreaterThan(turn);
});

test('without a halfway house, drink stations sell nothing', () => {
  const { g, course, holes } = withClubhouse();
  g.structures.push({ id: 1, kind: 'drinkStation', at: { x: holes[0]!.greenCenter.x + 12, y: holes[0]!.greenCenter.y } });
  for (let k = 0; k < 40; k++) { const grp = hungryGroup(g, course.id, holes.map(h => h.id), k); fnbAfterHole(g, grp, holes[0]!.id); }
  expect(fnbIn(g)).toBe(0);
});

test('restaurant takings carry a 32% cost of goods, and a packed hour means slow service', () => {
  const { g, course } = withClubhouse();
  expect(g.dispatch({ t: 'placeBuilding', kind: 'restaurant', courseId: course.id, origin: { x: 200, y: 100 } }).ok).toBe(true);
  const thoughts: string[] = [];
  g.events.on('thought', t => thoughts.push(t.key));
  const rng = new Rng(3);
  let served = 0;
  for (let k = 0; k < 120; k++) {
    const p = g.golfers.spawn(rng); p.traits.food = 1; p.segment = 'premium';
    if (restaurantVisit(g, course.id, p)) served++;
  }
  expect(served).toBeGreaterThan(coversPerHour(g, course.id));
  const rev = fnbIn(g);
  const cogs = g.ledger.tx.filter(t => t.cat === 'supplies').reduce((s, t) => s + t.out, 0);
  expect(Math.abs(cogs - rev * COST_OF_GOODS)).toBeLessThan(served);
  expect(fnbOf(g, course.id).today.slow).toBe(served - coversPerHour(g, course.id));
  expect(thoughts.filter(k => k === 'slowService').length).toBe(served - coversPerHour(g, course.id));
});

test('dearer menus sell fewer covers', () => {
  const run = (mult: number) => {
    const { g, course } = withClubhouse();
    g.dispatch({ t: 'placeBuilding', kind: 'restaurant', courseId: course.id, origin: { x: 200, y: 100 } });
    g.dispatch({ t: 'setMenuPrices', courseId: course.id, mult });
    const rng = new Rng(5);
    let n = 0;
    for (let k = 0; k < 300; k++) { const p = g.golfers.spawn(rng); if (restaurantVisit(g, course.id, p)) n++; }
    return n;
  };
  expect(run(1.8)).toBeLessThan(run(0.8));
});
