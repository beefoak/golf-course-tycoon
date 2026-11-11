import { generateWorld } from '../src/sim/world/mapgen';
import { Atlas } from '../src/render/atlas';
import { bakeChunk } from '../src/render/chunks';
import { PALETTES, TREE_COLORS, FEATURE_COLORS } from '../src/render/palette';
const w = generateWorld(1, 'parkland');
const a = new Atlas(PALETTES.parkland, TREE_COLORS, FEATURE_COLORS);
for (const lod of [16, 4]) {
  const t = performance.now(); for (let c = 0; c < 20; c++) bakeChunk(w, 200 + c, lod, a);
  console.log(`lod ${lod}: ${((performance.now() - t) / 20).toFixed(1)} ms/chunk`);
}
