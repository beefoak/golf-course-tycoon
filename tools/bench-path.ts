import { Game } from '../src/sim/game';
import { findPath, clearPathCache } from '../src/sim/world/pathfind';
const g = Game.create({ seed: 5, terrain: 'parkland', difficulty: 'normal' });
g.parcels.owner.fill(1);
let total = 0, n = 0, nulls = 0;
for (let k = 0; k < 20; k++) {
  const a = { x: 100 + k * 30 + 0.5, y: 200.5 }, b = { x: 300 + k * 25 + 0.5, y: 450.5 };
  clearPathCache(g);
  const t = performance.now();
  const p = findPath(g, a, b, 'walk');
  total += performance.now() - t; n++; if (!p) nulls++;
}
console.log(`avg ${(total / n).toFixed(1)} ms over ${n} (~300-tile) queries, ${nulls} unreachable`);
