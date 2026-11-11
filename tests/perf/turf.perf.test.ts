import { Game } from '../../src/sim/game';
import { Grass } from '../../src/sim/turf/grasses';
import { turfSystem } from '../../src/sim/turf/turf';

// Timing budgets run on their own (npm run test:perf), one file at a time, so other suites can't skew them.
test('a full turf pass over a fully grassed 1000² map stays within budget', () => {
  const g = Game.create({ seed: 5, terrain: 'parkland', difficulty: 'normal' });
  g.world.grass.fill(Grass.Ryegrass);
  for (let i = 0; i < 60; i++) turfSystem.onTick!(g); // warm up
  // best of three full passes, to ride out scheduler noise
  let worst = 0, total = Infinity;
  for (let round = 0; round < 3; round++) {
    let w = 0;
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) {
      const s = performance.now();
      turfSystem.onTick!(g);
      g.clock.tick++;
      w = Math.max(w, performance.now() - s);
    }
    const t = performance.now() - t0;
    if (t < total) { total = t; worst = w; }
  }
  console.log(`turf pass ${total.toFixed(1)} ms, worst tick ${worst.toFixed(2)} ms`);
  expect(total).toBeLessThan(50);
  expect(worst).toBeLessThan(2);
}, 30000);
