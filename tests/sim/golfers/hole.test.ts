import { Rng } from '../../../src/core/rng';
import { simulateHole } from '../../../src/sim/golfers/hole';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { golferWith, straightHole } from './holeFixture';

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('400-yard open par 4: scratch averages < 4.4, a 24 averages > 4.9', () => {
  const { g, hole } = straightHole();
  const rng = new Rng(21);
  const scratch = Array.from({ length: 500 }, () => simulateHole(g, golferWith(0), hole, rng).strokes);
  const high = Array.from({ length: 500 }, () => simulateHole(g, golferWith(24), hole, rng).strokes);
  expect(avg(scratch)).toBeLessThan(4.4);
  expect(avg(high)).toBeGreaterThan(4.9);
});

test('a pond in front of the green hurts the 24 more than the scratch player', () => {
  const plain = straightHole();
  const pond = straightHole();
  const w = pond.g.world;
  for (let y = pond.green.y + 12; y <= pond.green.y + 30; y++) for (let x = 130; x < 170; x++) w.surface[w.idx(x, y)] = Surface.Water;
  const run = (fx: ReturnType<typeof straightHole>, h: number) => {
    const rng = new Rng(5);
    return avg(Array.from({ length: 400 }, () => simulateHole(fx.g, golferWith(h), fx.hole, rng).strokes));
  };
  const dScratch = run(pond, 0) - run(plain, 0);
  const dHigh = run(pond, 24) - run(plain, 24);
  expect(dHigh).toBeGreaterThan(dScratch);
});

test('picks up at double par on an impossible hole', () => {
  const { g, hole, green } = straightHole();
  const w = g.world;
  for (let y = -40; y <= 40; y++) for (let x = -40; x <= 40; x++) {
    const d = Math.hypot(x, y);
    if ((x || y) && d <= 40) w.feature[w.idx(green.x + x, green.y + y)] = Feature.Rock;
  }
  // rock everywhere within 40 tiles of the cup (the green included) except the cup tile itself
  const t0 = performance.now();
  const r = simulateHole(g, golferWith(18), hole, new Rng(3));
  const ms = performance.now() - t0;
  expect(r.strokes).toBeLessThanOrEqual(8);
  expect(r.pickedUp).toBe(true);
  expect(ms).toBeLessThan(50);
});

test('every hole result is self-consistent', () => {
  const { g, hole } = straightHole();
  const rng = new Rng(8);
  for (let i = 0; i < 100; i++) {
    const r = simulateHole(g, golferWith(15), hole, rng);
    const shotStrokes = r.shots.length + r.shots.reduce((s, x) => s + x.penalty, 0);
    if (!r.pickedUp) expect(r.strokes).toBe(shotStrokes);
    expect(r.strokes).toBeLessThanOrEqual(8);
    expect(r.putts).toBe(r.shots.filter(s => s.club === 'P').length);
  }
});
