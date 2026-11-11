import { Game } from '../../../src/sim/game';
import { lifecycleSystem } from '../../../src/sim/course/lifecycle';
import { Grass } from '../../../src/sim/turf/grasses';
import { applyPractice, practicesSystem } from '../../../src/sim/turf/practices';
import { greenStimpFromTurf, holeTiles } from '../../../src/sim/turf/turf';
import { Surface } from '../../../src/sim/world/tiles';
import { TILE_FLAG } from '../../../src/sim/world/world';
import { evaluateHoleThoughts } from '../../../src/sim/golfers/thoughts';
import { newOwnedGame } from '../../helpers';
import { golferWith } from '../golfers/holeFixture';
import { threeHoleCourse } from '../golfers/courseFixture';

function patch(g: Game, x0: number, y0: number, grass = Grass.Bent, surface = Surface.Green): number[] {
  const w = g.world;
  const out: number[] = [];
  for (let y = y0; y < y0 + 10; y++) for (let x = x0; x < x0 + 10; x++) {
    const i = w.idx(x, y);
    w.surface[i] = surface; w.grass[i] = grass; w.courseId[i] = 1;
    w.health[i] = 80; w.moisture[i] = 55; w.wear[i] = 0; w.mowHeight[i] = 50; w.thatch[i] = 20;
    out.push(i);
  }
  return out;
}
const avg = (a: ArrayLike<number>, idx: number[]) => idx.reduce((s, i) => s + a[i]!, 0) / idx.length;
const runDays = (g: Game, d: number) => { const end = g.day + d; while (g.day < end) g.tick(); };
const diseased = (g: Game, t: number[]) => t.filter(i => g.world.flags[i]! & TILE_FLAG.disease).length;

test('each practice changes the right tile fields', () => {
  const g = newOwnedGame();
  const w = g.world;
  const t = patch(g, 10, 10);
  applyPractice(g, 'mow', t);
  expect(w.mowHeight[t[0]!]).toBe(36);
  const rows = new Set(t.map(i => w.flags[i]! & TILE_FLAG.stripe));
  expect(rows.size).toBe(2); // striped
  applyPractice(g, 'mow', t, { mm: 3 });
  expect(w.mowHeight[t[0]!]).toBe(30);
  w.wear[t[0]!] = 100; applyPractice(g, 'fixDivots', [t[0]!]); expect(w.wear[t[0]!]).toBe(70);
  w.moisture[t[0]!] = 30; applyPractice(g, 'handWater', [t[0]!]); expect(w.moisture[t[0]!]).toBe(55);
  const f = w.firmness[t[0]!]!; applyPractice(g, 'topdress', [t[0]!]); expect(w.firmness[t[0]!]).toBe(f + 10); expect(w.thatch[t[0]!]).toBe(10);
  applyPractice(g, 'fertilize', [t[1]!]); expect(w.fedDay[t[1]!]).toBe(g.day);
  w.flags[t[2]!] = w.flags[t[2]!]! | TILE_FLAG.disease; applyPractice(g, 'spray', [t[2]!]); expect(w.flags[t[2]!]! & TILE_FLAG.disease).toBe(0);
  // bunkers
  const b = w.idx(40, 40); w.surface[b] = Surface.Bunker; w.health[b] = 10;
  applyPractice(g, 'rakeBunker', [b]); expect(w.health[b]).toBe(100);
});

test('rolling speeds the green up, aeration slows it for a week', () => {
  const { g, holes } = threeHoleCourse();
  const h = holes[0]!;
  const greens = holeTiles(g, h.id).green;
  for (const i of greens) { g.world.grass[i] = Grass.Bent; g.world.health[i] = 90; g.world.moisture[i] = 50; g.world.mowHeight[i] = 36; }
  const base = greenStimpFromTurf(g, h.id);
  applyPractice(g, 'roll', greens);
  expect(greenStimpFromTurf(g, h.id)).toBeCloseTo(base + 0.5, 5);
  applyPractice(g, 'aerate', greens);
  expect(greenStimpFromTurf(g, h.id)).toBeLessThan(base);
});

test('changeCup rotates the pin; moveTeeMarkers moves markers across the pad', () => {
  const { g, holes } = threeHoleCourse();
  const h = holes[0]!;
  h.pins = [h.greenCenter, { x: h.greenCenter.x + 1, y: h.greenCenter.y }];
  h.activePin = 0;
  applyPractice(g, 'changeCup', [], { holeId: h.id });
  expect(h.activePin).toBe(1);
  applyPractice(g, 'changeCup', [], { holeId: h.id });
  expect(h.activePin).toBe(0);
  const before = h.teeBoxes.map(tb => ({ ...tb.marker }));
  applyPractice(g, 'moveTeeMarkers', [], { holeId: h.id });
  expect(h.teeBoxes.map(tb => tb.marker)).not.toEqual(before);
});

test('disease spreads if untreated and clears when sprayed', () => {
  const g = newOwnedGame();
  const t = patch(g, 10, 10, Grass.PoaAnnua, Surface.Fairway);
  const w = g.world;
  w.flags[w.idx(15, 15)] = TILE_FLAG.disease;
  for (let d = 0; d < 6; d++) { practicesSystem.onDay!(g); g.clock.day++; }
  const n = diseased(g, t);
  expect(n).toBeGreaterThan(4);
  // diseased turf loses health in the turf pass
  runDays(g, 3);
  const sick = t.filter(i => w.flags[i]! & TILE_FLAG.disease);
  const well = t.filter(i => !(w.flags[i]! & TILE_FLAG.disease));
  expect(avg(w.health, sick)).toBeLessThan(avg(w.health, well) - 5);
  applyPractice(g, 'spray', t);
  expect(diseased(g, t)).toBe(0);
  practicesSystem.onDay!(g);
  expect(diseased(g, t)).toBe(0);
});

test('grow-in stalls while the hole is too dry', () => {
  const { g, holes } = threeHoleCourse();
  const h = holes[0]!;
  h.state = 'growingIn'; h.growInDaysLeft = 3;
  const turf = holeTiles(g, h.id).turf;
  expect(turf.length).toBeGreaterThan(50);
  for (const i of turf) g.world.moisture[i] = 15;
  for (let d = 0; d < 4; d++) lifecycleSystem.onDay!(g);
  expect(h.growInDaysLeft).toBe(3);
  expect(h.state).toBe('growingIn');
  for (const i of turf) g.world.moisture[i] = 60;
  for (let d = 0; d < 3; d++) lifecycleSystem.onDay!(g);
  expect(h.state).toBe('open');
});

test('aeration dips health at first, then beats no aeration after 21 days (thatch)', () => {
  const g = newOwnedGame();
  const w = g.world;
  const a = patch(g, 10, 10), b = patch(g, 40, 10);
  for (const i of [...a, ...b]) w.thatch[i] = 85;
  runDays(g, 2);
  applyPractice(g, 'aerate', a);
  expect(avg(w.health, a)).toBeLessThan(avg(w.health, b));
  runDays(g, 21);
  expect(avg(w.health, a)).toBeGreaterThan(avg(w.health, b) + 3);
});

test('bunkers decay daily and unraked bunkers annoy golfers', () => {
  const g = newOwnedGame();
  const w = g.world;
  const b = w.idx(30, 30);
  w.surface[b] = Surface.Bunker; w.health[b] = 100;
  g.turf.autoCare = false;
  practicesSystem.onDay!(g);
  expect(w.health[b]).toBe(85);
  for (let d = 0; d < 3; d++) practicesSystem.onDay!(g);
  expect(w.health[b]).toBe(40);
  const { g: g2, holes } = threeHoleCourse();
  const h = holes[0]!;
  const at = { x: h.greenCenter.x, y: h.greenCenter.y + 6 };
  const bi = g2.world.idx(at.x, at.y);
  g2.world.surface[bi] = Surface.Bunker; g2.world.health[bi] = 20;
  const golfer = golferWith(10);
  const result = { strokes: 4, putts: 1, pickedUp: false, penalties: 0, gir: false, fairwayHit: null, shots: [{ from: at, landing: h.greenCenter, final: h.greenCenter, club: 'SW', result: 'ok', penalty: 0, next: h.greenCenter }] };
  const keys = evaluateHoleThoughts(g2, golfer, h, result as never, 0).map(t => t.key);
  expect(keys).toContain('bunkerUnraked');
  g2.world.health[bi] = 100;
  expect(evaluateHoleThoughts(g2, golfer, h, result as never, 0).map(t => t.key)).not.toContain('bunkerUnraked');
});
