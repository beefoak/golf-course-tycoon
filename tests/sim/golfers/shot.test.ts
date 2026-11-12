import { Rng } from '../../../src/core/rng';
import { clubSet } from '../../../src/sim/golfers/clubs';
import { generateGolfer } from '../../../src/sim/golfers/generate';
import { simulateShot, windAllowance } from '../../../src/sim/golfers/shot';
import { Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

function setup() {
  const g = newOwnedGame({ size: 200, parcels: [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1]] });
  g.world.surface.fill(Surface.Fairway);
  return g;
}
const golfer = (handicap: number) => ({ ...generateGolfer(new Rng(1), 1), handicap, age: 35 });

test('a scratch player finishes closer to the target than a 25-handicap', () => {
  const g = setup();
  const from = { x: 20.5, y: 50.5 }, target = { x: 95.5, y: 50.5 }; // 150 m
  const avg = (h: number) => {
    const p = golfer(h), rng = new Rng(9);
    const club = clubSet(h, 35).find(c => c.carryM >= 150 && c.id !== 'D')!;
    let s = 0;
    for (let i = 0; i < 2000; i++) {
      const o = simulateShot(g, { from, target, club, lie: 'fairway', golfer: p, wind: { x: 0, y: 0 } }, rng);
      s += Math.hypot(o.landing.x - target.x, o.landing.y - target.y);
    }
    return s / 2000;
  };
  expect(avg(0)).toBeLessThan(avg(25));
});

test('mishit rate rises with handicap', () => {
  const g = setup();
  const rate = (h: number) => {
    const p = golfer(h), rng = new Rng(4), club = clubSet(h, 35)[6]!;
    let n = 0;
    for (let i = 0; i < 2000; i++) if (simulateShot(g, { from: { x: 20, y: 50 }, target: { x: 80, y: 50 }, club, lie: 'fairway', golfer: p, wind: { x: 0, y: 0 } }, rng).mishit) n++;
    return n / 2000;
  };
  expect(rate(28)).toBeGreaterThan(rate(2) + 0.05);
});

test('wind pushes the landing downwind, less for golfers who allow for it', () => {
  const g = setup();
  const drift = (hcp: number) => {
    const p = golfer(hcp), club = clubSet(hcp, 35)[6]!;
    let calm = 0, windy = 0;
    const r1 = new Rng(5), r2 = new Rng(5);
    for (let i = 0; i < 300; i++) {
      calm += simulateShot(g, { from: { x: 20, y: 50 }, target: { x: 90, y: 50 }, club, lie: 'fairway', golfer: p, wind: { x: 0, y: 0 } }, r1).landing.y;
      windy += simulateShot(g, { from: { x: 20, y: 50 }, target: { x: 90, y: 50 }, club, lie: 'fairway', golfer: p, wind: { x: 0, y: 8 } }, r2).landing.y;
    }
    return (windy - calm) / 300;
  };
  expect(drift(25)).toBeGreaterThan(2);
  expect(drift(0)).toBeGreaterThan(0);
  expect(drift(0)).toBeLessThan(drift(25) / 2);
  expect(windAllowance(0)).toBeGreaterThan(windAllowance(25));
});
