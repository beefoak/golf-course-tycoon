import { Rng } from '../../../src/core/rng';
import { TeeKind } from '../../../src/sim/course/course';
import { chooseTee, planShot } from '../../../src/sim/golfers/ai';
import { Surface } from '../../../src/sim/world/tiles';
import { golferWith, straightHole } from './holeFixture';

test('chooseTee by handicap, ego and age', () => {
  const { hole } = straightHole();
  const kind = (h: number, extra = {}) => chooseTee(golferWith(h, extra), hole).kind;
  expect(kind(3)).toBe('championship');
  expect(kind(10)).toBe('back');
  expect(kind(18)).toBe('middle');
  expect(kind(28)).toBe('forward');
  expect(kind(18, { traits: { challenge: 0.9 } })).toBe('back');
  expect(kind(18, { age: 70, traits: { challenge: 0.1 } })).toBe('forward');
});

test('chooseTee falls back to the nearest existing tee', () => {
  const { hole } = straightHole();
  hole.teeBoxes = hole.teeBoxes.filter(t => (['back', 'forward'] as TeeKind[]).includes(t.kind));
  expect(chooseTee(golferWith(3), hole).kind).toBe('back');
  expect(chooseTee(golferWith(18), hole).kind).toBe('forward');
});

test('a 30-handicap lays up short of a 200 m carry over water at least half the time', () => {
  const { g, hole, tee } = straightHole(160);
  const w = g.world;
  // ball 220 m from the green on the fairway; water from 150 m to 200 m ahead of it
  const ball = { x: 150.5, y: 250.5 };
  for (let y = 250 - 100; y > 250 - 75 - 26; y--) for (let x = 120; x < 180; x++) w.surface[w.idx(x, y)] = Surface.Water;
  void tee;
  let layups = 0;
  const rng = new Rng(2);
  for (let i = 0; i < 40; i++) {
    const p = planShot(g, golferWith(30, { traits: { challenge: rng.next() } }), ball, 'fairway', hole, { x: 150.5, y: hole.greenCenter.y + 0.5 }, rng);
    if (ball.y - p.target.y < 74) layups++;
  }
  expect(layups / 40).toBeGreaterThanOrEqual(0.5);
});
