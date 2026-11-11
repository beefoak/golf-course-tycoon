import { Game } from '../../../src/sim/game';
import { Grass, GRASSES } from '../../../src/sim/turf/grasses';
import { DEFAULT_TURF, addWear, greenStimpFromTurf, stimpFor, turfSystem } from '../../../src/sim/turf/turf';
import { Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';
import { deserialize, serialize } from '../../../src/sim/save';
import { threeHoleCourse } from '../golfers/courseFixture';

/** A 10×10 patch of maintained turf on course 1. */
function patch(g: Game, grass: Grass, surface = Surface.Green, health = 80): number[] {
  const w = g.world;
  const out: number[] = [];
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) {
    const i = w.idx(x, y);
    w.surface[i] = surface; w.grass[i] = grass; w.courseId[i] = 1;
    w.health[i] = health; w.moisture[i] = 55; w.wear[i] = 0; w.mowHeight[i] = 36;
    out.push(i);
  }
  return out;
}
const avg = (a: ArrayLike<number>, idx: number[]) => idx.reduce((s, i) => s + a[i]!, 0) / idx.length;
function runDays(g: Game, days: number) {
  const end = g.day + days;
  while (g.day < end) g.tick();
}

test('lower mow height gives a faster green', () => {
  expect(stimpFor(Grass.Bent, 2.8, 90, 50, false)).toBeGreaterThan(stimpFor(Grass.Bent, 3.6, 90, 50, false));
  expect(stimpFor(Grass.Bent, 3.6, 90, 50, true)).toBeCloseTo(stimpFor(Grass.Bent, 3.6, 90, 50, false) + 0.5);
  expect(stimpFor(Grass.Bent, 3.6, 90, 80, false)).toBeLessThan(stimpFor(Grass.Bent, 3.6, 90, 50, false));
  expect(stimpFor(Grass.Bent, 3.6, 30, 50, false)).toBeLessThan(stimpFor(Grass.Bent, 3.6, 90, 50, false));
  expect(GRASSES[Grass.Bent].baseStimpAt3mm).toBeGreaterThan(GRASSES[Grass.FineFescue].baseStimpAt3mm);
});

test('mowing below the grass minimum lowers health over 10 days', () => {
  const ok = newOwnedGame(), scalped = newOwnedGame();
  const a = patch(ok, Grass.Bent), b = patch(scalped, Grass.Bent);
  ok.turf.autoCare = scalped.turf.autoCare = true; // the nightly free mow stands in for a crew
  scalped.turf.settings.set(1, { ...DEFAULT_TURF, greenMowMm: 1.8 });
  runDays(ok, 10); runDays(scalped, 10);
  expect(avg(scalped.world.mowHeight, b)).toBeLessThanOrEqual(20);
  expect(avg(scalped.world.health, b)).toBeLessThan(avg(ok.world.health, a) - 15);
});

test('grass that does not suit the climate loses health', () => {
  const g = Game.create({ seed: 3, terrain: 'desert', difficulty: 'normal', size: 100 });
  const bent = patch(g, Grass.Bent, Surface.Fairway, 80);
  const w = g.world;
  const bermuda: number[] = [];
  for (let y = 40; y < 50; y++) for (let x = 10; x < 20; x++) {
    const i = w.idx(x, y);
    w.surface[i] = Surface.Fairway; w.grass[i] = Grass.Bermuda; w.courseId[i] = 1; w.health[i] = 80; w.moisture[i] = 55; w.mowHeight[i] = 120;
    bermuda.push(i);
  }
  runDays(g, 15);
  expect(avg(w.health, bent)).toBeLessThan(65);
  expect(avg(w.health, bermuda)).toBeGreaterThan(avg(w.health, bent) + 20);
});

test('heavy tee traffic wears turf, which recovers over 14 idle days', () => {
  const g = newOwnedGame();
  const tee = patch(g, Grass.Ryegrass, Surface.Tee, 85);
  const w = g.world;
  const pad = tee.slice(0, 15); // a 15-tile tee box
  const start = avg(w.health, pad);
  // 200 rounds × 4 tee shots, each divot on one of the tee's tiles
  for (let r = 0; r < 200 * 4; r++) { const i = pad[r % pad.length]!; addWear(g, i % w.size, Math.floor(i / w.size), 4); }
  const peakWear = avg(w.wear, pad);
  expect(peakWear).toBeGreaterThan(20);
  runDays(g, 3);
  const worn = avg(w.health, pad);
  expect(worn).toBeLessThan(start - 3);
  runDays(g, 14);
  expect(avg(w.wear, pad)).toBeLessThan(peakWear * 0.2);
  expect(avg(w.health, pad)).toBeGreaterThan(worn + 2);
});

test('turf updates are deterministic', () => {
  const run = () => {
    const g = newOwnedGame();
    const t = patch(g, Grass.Bent);
    addWear(g, 12, 12, 200);
    runDays(g, 3);
    return t.map(i => [g.world.health[i], g.world.mowHeight[i], g.world.moisture[i], g.world.wear[i]].join()).join('|');
  };
  expect(run()).toBe(run());
});

test('green speed on a real hole comes from its turf; new turf gets the climate default grass', () => {
  const { g, holes } = threeHoleCourse();
  const h = holes[0]!;
  const w = g.world;
  const greens: number[] = [];
  for (let i = 0; i < w.holeId.length; i++) if (w.holeId[i] === h.id && w.surface[i] === Surface.Green) greens.push(i);
  expect(greens.length).toBeGreaterThan(10);
  for (const i of greens) { w.grass[i] = Grass.Bent; w.health[i] = 90; w.moisture[i] = 50; w.mowHeight[i] = 36; }
  const normal = greenStimpFromTurf(g, h.id);
  for (const i of greens) w.mowHeight[i] = 28;
  expect(greenStimpFromTurf(g, h.id)).toBeGreaterThan(normal + 1);
  // painting new fairway on owned land gives it the temperate default
  const r = g.dispatch({ t: 'paint', surface: Surface.Fairway, tiles: [{ x: 200, y: 100 }] });
  expect(r.ok).toBe(true);
  expect(w.grass[w.idx(200, 100)]).toBe(Grass.Ryegrass);
});

test('setGrass charges per tile and is refused on an open hole', () => {
  const { g, holes } = threeHoleCourse();
  const cash = g.ledger.cash;
  g.world.surface[g.world.idx(200, 100)] = Surface.Natural;
  const r = g.dispatch({ t: 'setGrass', tiles: [{ x: 200, y: 100 }], grass: Grass.Bermuda, method: 'sod' });
  expect(r.ok).toBe(false); // natural surface, not turf
  g.dispatch({ t: 'paint', surface: Surface.Fairway, tiles: [{ x: 200, y: 100 }, { x: 201, y: 100 }] });
  const before = g.ledger.cash;
  expect(g.dispatch({ t: 'setGrass', tiles: [{ x: 200, y: 100 }, { x: 201, y: 100 }], grass: Grass.Bermuda, method: 'sod' }).ok).toBe(true);
  expect(before - g.ledger.cash).toBe(2 * GRASSES[Grass.Bermuda].sodCostPerTile);
  expect(g.world.grass[g.world.idx(200, 100)]).toBe(Grass.Bermuda);
  const g0 = holes[0]!.greenCenter;
  expect(g.dispatch({ t: 'setGrass', tiles: [g0], grass: Grass.Bermuda, method: 'sod' }).ok).toBe(false);
  expect(cash).toBeGreaterThan(g.ledger.cash);
});


test('turf settings survive save/load', () => {
  const g = newOwnedGame();
  g.turf.settings.set(1, { ...DEFAULT_TURF, greenMowMm: 3.1 });
  g.turf.holeOverrides.set(4, { fairwayMowMm: 9 });
  const r = deserialize(serialize(g));
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.turf.settings.get(1)?.greenMowMm).toBe(3.1);
    expect(r.value.turf.holeOverrides.get(4)).toEqual({ fairwayMowMm: 9 });
  }
});
