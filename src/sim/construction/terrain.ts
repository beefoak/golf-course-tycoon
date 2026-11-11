import { Vec2 } from '../../core/geom';
import { TILE_M } from '../../core/units';
import type { Game } from '../game';
import { Surface } from '../world/tiles';
import { COSTS } from './costs';
import { editableTile } from './paint';
import { EditPlan, addReason, emptyPlan } from './plan';

export type TerrainOp =
  | { op: 'raise' | 'lower'; amountM: number }
  | { op: 'smooth'; strength: number }
  | { op: 'flatten'; targetM: number }
  | { op: 'slopeLine'; from: Vec2; to: Vec2; fromM: number; toM: number; widthTiles: number };

const TILE_AREA = TILE_M * TILE_M;

/** Cosine falloff: 1 at the brush centre, 0 just beyond the outermost tile. */
function falloff(tiles: Vec2[]): (t: Vec2) => number {
  let cx = 0, cy = 0;
  for (const t of tiles) { cx += t.x; cy += t.y; }
  cx /= tiles.length; cy /= tiles.length;
  let r = 0;
  for (const t of tiles) r = Math.max(r, Math.hypot(t.x - cx, t.y - cy));
  const R = r + 1;
  return t => 0.5 * (1 + Math.cos((Math.PI * Math.min(R, Math.hypot(t.x - cx, t.y - cy))) / R));
}

/** Plan an earthworks edit, pricing cut/fill against the soil stockpile. */
export function planTerrain(g: Game, tiles: Vec2[], op: TerrainOp): EditPlan {
  const p = emptyPlan();
  const w = g.world;
  const valid: { t: Vec2; i: number }[] = [];
  const seen = new Set<number>();
  for (const t of tiles) {
    if (!w.inBounds(t.x, t.y)) { addReason(p, 'off the map'); continue; }
    const i = w.idx(t.x, t.y);
    if (seen.has(i)) continue;
    seen.add(i);
    const why = editableTile(g, t.x, t.y);
    if (why) { addReason(p, why); continue; }
    if (w.surface[i] === Surface.Water) { addReason(p, 'water (use the water tool)'); continue; }
    if (w.surface[i] === Surface.Building) { addReason(p, 'buildings'); continue; }
    valid.push({ t, i });
  }
  if (valid.length === 0) return p;

  const targets = new Map<number, number>();
  switch (op.op) {
    case 'raise':
    case 'lower': {
      const f = falloff(valid.map(v => v.t));
      const sign = op.op === 'raise' ? 1 : -1;
      for (const v of valid) targets.set(v.i, w.elevation[v.i]! + sign * op.amountM * f(v.t));
      break;
    }
    case 'flatten':
      for (const v of valid) targets.set(v.i, op.targetM);
      break;
    case 'smooth': {
      for (const v of valid) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = v.t.x + dx, y = v.t.y + dy;
          if (!w.inBounds(x, y)) continue;
          sum += w.elevation[w.idx(x, y)]!; n++;
        }
        const cur = w.elevation[v.i]!;
        targets.set(v.i, cur + (sum / n - cur) * Math.max(0, Math.min(1, op.strength)));
      }
      break;
    }
    case 'slopeLine': {
      const dx = op.to.x - op.from.x, dy = op.to.y - op.from.y;
      const len2 = dx * dx + dy * dy || 1;
      for (const v of valid) {
        const t = Math.max(0, Math.min(1, ((v.t.x - op.from.x) * dx + (v.t.y - op.from.y) * dy) / len2));
        const px = op.from.x + dx * t, py = op.from.y + dy * t;
        if (Math.hypot(v.t.x - px, v.t.y - py) > op.widthTiles / 2) continue;
        targets.set(v.i, op.fromM + (op.toM - op.fromM) * t);
      }
      break;
    }
  }

  let cut = 0, fill = 0;
  for (const [i, h] of targets) {
    const d = h - w.elevation[i]!;
    if (Math.abs(d) < 1e-6) continue;
    if (d < 0) cut += -d * TILE_AREA;
    else fill += d * TILE_AREA;
    p.changes.push({ i, elevation: Math.max(0, h) });
  }
  const available = g.soilStockpileM3 + cut;
  const fromStock = Math.min(fill, available);
  const imported = fill - fromStock;
  p.cost = cut * COSTS.cutPerM3 + fromStock * COSTS.fillFromStockPerM3 + imported * COSTS.importFillPerM3;
  p.stockpileDelta = cut - fromStock;
  return p;
}
