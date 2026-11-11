import { Rng } from '../../../src/core/rng';
import { TILE_M } from '../../../src/core/units';
import { generateGolfer } from '../../../src/sim/golfers/generate';
import { putt } from '../../../src/sim/golfers/putting';
import { Surface } from '../../../src/sim/world/tiles';
import { Game } from '../../../src/sim/game';
import { newOwnedGame } from '../../helpers';

const golfer = { ...generateGolfer(new Rng(1), 1), handicap: 16 };
const cup = { x: 50.5, y: 25.5 };
function green(): Game {
  const g = newOwnedGame();
  g.world.surface.fill(Surface.Green);
  return g;
}
const N = 2000;

function putts(g: Game, dM: number, stimp: number, seed = 1): number[] {
  const rng = new Rng(seed);
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    let ball = { x: cup.x - dM / TILE_M, y: cup.y };
    let n = 0;
    for (;;) {
      n++;
      const r = putt(g, ball, cup, golfer, stimp, rng);
      if (r.holed || n >= 6) break;
      ball = r.final;
    }
    out.push(n);
  }
  return out;
}
const rate = (xs: number[], f: (n: number) => boolean) => xs.filter(f).length / xs.length;

test('one-putt rate: >85% from 1 m, <20% from 10 m', () => {
  const g = green();
  expect(rate(putts(g, 1, 10), n => n === 1)).toBeGreaterThan(0.85);
  expect(rate(putts(g, 10, 10), n => n === 1)).toBeLessThan(0.2);
});

test('three-putts from 15 m are more common at Stimp 13 than Stimp 8', () => {
  const g = green();
  expect(rate(putts(g, 15, 13), n => n >= 3)).toBeGreaterThan(rate(putts(g, 15, 8), n => n >= 3));
});

test('a sloped cup lowers the make rate', () => {
  const flat = green();
  const sloped = green();
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) sloped.world.elevation[sloped.world.idx(x, y)] = 10 + y * 0.06;
  expect(rate(putts(sloped, 3, 10), n => n === 1)).toBeLessThan(rate(putts(flat, 3, 10), n => n === 1) - 0.1);
});
