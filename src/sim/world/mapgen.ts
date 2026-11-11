import { Rng } from '../../core/rng';
import { createNoise2D, fbm } from '../../core/noise';
import { MAP_TILES } from '../../core/units';
import { World } from './world';
import { Surface, Feature } from './tiles';
import { TERRAINS, TerrainType } from './terrainTypes';

const ROAD_DEPTH = 3;
const NEIGHBOR_DEPTH = 2;

/** Deterministic world generation from a seed (GDD §4). */
export function generateWorld(seed: number, terrain: TerrainType, size = MAP_TILES): World {
  const cfg = TERRAINS[terrain];
  const w = new World(size);
  const root = new Rng(seed);
  const areaScale = (size * size) / (MAP_TILES * MAP_TILES);
  const scaled = (r: [number, number], rng: Rng): number => {
    const v = Math.round(rng.int(r[0], r[1]) * areaScale);
    return r[0] > 0 ? Math.max(1, v) : v;
  };
  const n = size * size;

  // 1. Elevation
  const en = createNoise2D(root.fork('elevation'));
  const octaves = terrain === 'links' ? 3 : 5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = fbm(en, x * cfg.elevationFreq, y * cfg.elevationFreq, octaves);
      if (terrain === 'mountain') v = Math.sign(v) * Math.pow(Math.abs(v), 0.8);
      w.elevation[y * size + x] = ((v + 1) / 2) * cfg.elevationAmpM;
    }
  }

  // defaults
  w.surface.fill(cfg.naturalSurface);
  w.health.fill(70);
  w.moisture.fill(50);
  w.mowHeight.fill(1000);
  w.firmness.fill(50);

  // 2. Creeks: meandering walk from one edge across the map
  const cRng = root.fork('creeks');
  const creeks = scaled(cfg.creekCount, cRng);
  const meander = createNoise2D(cRng.fork('meander'));
  for (let c = 0; c < creeks; c++) {
    const vertical = cRng.chance(0.5);
    let x = vertical ? cRng.range(size * 0.15, size * 0.85) : 0;
    let y = vertical ? 0 : cRng.range(size * 0.15, size * 0.65);
    const width = cRng.int(2, 3);
    const phase = cRng.range(0, 1000);
    for (let step = 0; step < size * 3; step++) {
      const ang = (vertical ? Math.PI / 2 : 0) + meander(step * 0.01 + phase, c * 10) * 1.1;
      x += Math.cos(ang);
      y += Math.sin(ang);
      if (x < 0 || y < 0 || x >= size || y >= size) break;
      for (let dy = 0; dy < width; dy++) {
        for (let dx = 0; dx < width; dx++) {
          const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
          if (!w.inBounds(tx, ty)) continue;
          const i = w.idx(tx, ty);
          if (w.feature[i] !== Feature.Creek) w.elevation[i] = Math.max(0, w.elevation[i]! - 1);
          w.surface[i] = Surface.Water;
          w.feature[i] = Feature.Creek;
        }
      }
    }
  }

  // 3. Ponds: noisy blobs on low ground, flattened below their lowest point
  const pRng = root.fork('ponds');
  const ponds = scaled(cfg.pondCount, pRng);
  const pn = createNoise2D(pRng.fork('shape'));
  for (let p = 0; p < ponds; p++) {
    let best = { x: 0, y: 0, e: Infinity };
    for (let k = 0; k < 6; k++) {
      const cx = pRng.int(20, size - 25), cy = pRng.int(20, size - 25);
      const e = w.elevation[w.idx(cx, cy)]!;
      if (e < best.e) best = { x: cx, y: cy, e };
    }
    const r = pRng.range(4, 24);
    const tiles: number[] = [];
    let minE = Infinity;
    const R = Math.ceil(r * 1.4);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const tx = best.x + dx, ty = best.y + dy;
        if (!w.inBounds(tx, ty)) continue;
        const d = Math.hypot(dx, dy) / r;
        if (d < 1 + 0.35 * pn(tx * 0.08, ty * 0.08)) {
          const i = w.idx(tx, ty);
          tiles.push(i);
          minE = Math.min(minE, w.elevation[i]!);
        }
      }
    }
    for (const i of tiles) {
      w.surface[i] = Surface.Water;
      w.elevation[i] = Math.max(0, minE - 1);
    }
  }

  // 4. Wetlands: low noisy patches within 8 tiles of water
  if (cfg.wetlandDensity > 0) {
    const wn = createNoise2D(root.fork('wetland'));
    const distW = new Uint8Array(n).fill(255);
    let frontier: number[] = [];
    for (let i = 0; i < n; i++) {
      if (w.surface[i] === Surface.Water) {
        distW[i] = 0;
        frontier.push(i);
      }
    }
    for (let d = 1; d <= 8 && frontier.length; d++) {
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % size, y = (i / size) | 0;
        if (x > 0 && distW[i - 1] === 255) { distW[i - 1] = d; next.push(i - 1); }
        if (x < size - 1 && distW[i + 1] === 255) { distW[i + 1] = d; next.push(i + 1); }
        if (y > 0 && distW[i - size] === 255) { distW[i - size] = d; next.push(i - size); }
        if (y < size - 1 && distW[i + size] === 255) { distW[i + size] = d; next.push(i + size); }
      }
      frontier = next;
    }
    const threshold = 1 - cfg.wetlandDensity * 0.5;
    for (let i = 0; i < n; i++) {
      const d = distW[i]!;
      if (d === 0 || d === 255) continue;
      const x = i % size, y = (i / size) | 0;
      if ((wn(x * 0.05, y * 0.05) + 1) / 2 > threshold + d * 0.02) w.feature[i] = Feature.Wetland;
    }
  }

  // 5. Rocks: clustered outcrops, more likely on steep ground
  const rn = createNoise2D(root.fork('rocks'));
  const rockThreshold = 1 - cfg.rockDensity * 6;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      if (w.surface[i] === Surface.Water || w.feature[i] !== Feature.None) continue;
      const steep = Math.abs(w.elevation[i + 1]! - w.elevation[i - 1]!) + Math.abs(w.elevation[i + size]! - w.elevation[i - size]!);
      const v = (fbm(rn, x * 0.04, y * 0.04, 2) + 1) / 2 + Math.min(0.15, steep * 0.05);
      if (v > rockThreshold) w.feature[i] = Feature.Rock;
    }
  }

  // 6. Trees: noise-clustered forests plus scattered singles
  const tRng = root.fork('trees');
  const tn = createNoise2D(tRng.fork('cluster'));
  const sn = createNoise2D(tRng.fork('species'));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (w.surface[i] === Surface.Water || w.feature[i] === Feature.Rock || w.feature[i] === Feature.Creek) continue;
      const cluster = (fbm(tn, x * 0.015, y * 0.015, 3) + 1) / 2;
      const p = cluster > 1 - cfg.treeDensity ? 0.55 : 0.01;
      if (tRng.next() < p) {
        const k = Math.floor(((sn(x * 0.01, y * 0.01) + 1) / 2) * cfg.treeSpecies.length);
        w.treeSpecies[i] = cfg.treeSpecies[Math.min(k, cfg.treeSpecies.length - 1)]!;
        w.treeAgeDays[i] = tRng.int(3650, 30000);
      }
    }
  }

  // 7. Specimen trees
  const sRng = root.fork('specimen');
  const specimens = scaled(cfg.specimenTreeCount, sRng);
  for (let s = 0, tries = 0; s < specimens && tries < specimens * 50; tries++) {
    const x = sRng.int(5, size - 6), y = sRng.int(5, size - 10);
    const i = w.idx(x, y);
    if (w.surface[i] === Surface.Water || w.feature[i] !== Feature.None) continue;
    w.feature[i] = Feature.SpecimenTree;
    w.treeSpecies[i] = sRng.pick(cfg.treeSpecies);
    w.treeAgeDays[i] = 65535;
    s++;
  }

  // 8. Road on the south edge, a neighbouring property on one other edge
  for (let y = size - ROAD_DEPTH; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = w.idx(x, y);
      w.feature[i] = Feature.Road;
      w.surface[i] = Surface.Path;
      w.treeSpecies[i] = 0;
    }
  }
  const edge = root.fork('neighbor').int(0, 2); // 0 north, 1 west, 2 east
  for (let d = 0; d < NEIGHBOR_DEPTH; d++) {
    for (let k = 0; k < size - ROAD_DEPTH; k++) {
      const x = edge === 0 ? k : edge === 1 ? d : size - 1 - d;
      const y = edge === 0 ? d : k;
      const i = w.idx(x, y);
      if (w.feature[i] === Feature.Creek) continue;
      w.feature[i] = Feature.Neighbor;
      w.treeSpecies[i] = 0;
    }
  }
  return w;
}
