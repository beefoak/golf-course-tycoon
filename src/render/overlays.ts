import { PARCEL_TILES } from '../core/units';
import { Game } from '../sim/game';
import { PRICE_MAX, PRICE_MIN } from '../sim/land/parcels';
import { slopeAt } from '../sim/world/slope';
import { Surface } from '../sim/world/tiles';
import { rgba } from './atlas';
import { OverlayFn } from './chunks';
import { HEAT_CELL } from '../sim/golfers/stats';
import { Grass } from '../sim/turf/grasses';
import { connectedSprinklers, forEachInRadius } from '../sim/turf/irrigation';

export type OverlayId = 'elevation' | 'slope' | 'land' | 'traffic' | 'landing' | 'pace' | 'moisture' | 'irrigation' | 'health' | 'wear' | 'mowHeight' | 'staffCoverage' | 'workOrders';
export const OVERLAY_LABELS: Record<OverlayId, string> = {
  elevation: 'Elevation', slope: 'Slope', land: 'Land', traffic: 'Traffic', landing: 'Landing zones', pace: 'Pace', moisture: 'Moisture', irrigation: 'Irrigation',
  health: 'Turf health', wear: 'Wear', mowHeight: 'Mow height', staffCoverage: 'Crew coverage', workOrders: 'Work orders',
};
/** Overlays whose data moves during the day (redrawn every few seconds while shown). */
export const LIVE_OVERLAYS = new Set<OverlayId>(['moisture', 'health', 'wear', 'mowHeight', 'staffCoverage', 'workOrders']);

/** Linear ramp through colour stops, t in [0,1]. */
export function ramp(stops: number[], t: number): number {
  const c = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(c)), f = c - i;
  const a = stops[i]!, b = stops[i + 1]!;
  const mix = (sh: number) => Math.round(((a >> sh) & 255) * (1 - f) + ((b >> sh) & 255) * f);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

export const OVERLAYS: Record<OverlayId, (g: Game) => OverlayFn> = {
  elevation: g => {
    let lo = Infinity, hi = -Infinity;
    for (const v of g.world.elevation) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo || 1;
    return (x, y) => {
      const i = g.world.idx(x, y);
      if (g.world.surface[i] === Surface.Water) return null;
      return rgba(ramp([0x2b6b3a, 0xc9c25a, 0xb0603a, 0xf4f0ea], (g.world.elevation[i]! - lo) / span), 150);
    };
  },
  slope: g => (x, y) => {
    const s = slopeAt(g.world, x, y).gradient;
    return rgba(ramp([0x3a9a4a, 0xe8d84a, 0xd84a3a], s / 0.25), 150);
  },
  traffic: g => {
    const side = Math.ceil(g.world.size / 2);
    let max = 1;
    for (const v of g.footfall) if (v > max) max = v;
    return (x, y) => {
      const v = g.footfall[Math.floor(y / 2) * side + Math.floor(x / 2)] ?? 0;
      return v ? rgba(ramp([0x3060ff, 0xffe040, 0xff3020], Math.sqrt(v / max)), 150) : null;
    };
  },
  landing: g => {
    // merge every course's landing heat
    const side = Math.ceil(g.world.size / HEAT_CELL);
    const heat = new Float32Array(side * side);
    let max = 1;
    for (const st of g.stats.values()) for (let i = 0; i < heat.length; i++) { heat[i]! += st.landingHeat[i] ?? 0; if (heat[i]! > max) max = heat[i]!; }
    return (x, y) => {
      const v = heat[Math.floor(y / HEAT_CELL) * side + Math.floor(x / HEAT_CELL)]!;
      return v ? rgba(ramp([0x40c0ff, 0xffffff, 0xff40c0], Math.sqrt(v / max)), 160) : null;
    };
  },
  pace: g => (x, y) => {
    const id = g.world.holeId[g.world.idx(x, y)];
    if (!id) return null;
    const h = g.courses.hole(id);
    const mins = h ? g.stats.get(h.courseId)?.holeMinutes(id) ?? 0 : 0;
    if (!mins) return rgba(0x808080, 60);
    // ≤12 min per hole is brisk, ≥20 is slow
    return rgba(ramp([0x40d060, 0xf0d040, 0xe04030], (mins - 12) / 8), 120);
  },
  moisture: g => (x, y) => {
    const i = g.world.idx(x, y);
    if (g.world.grass[i] === Grass.None) return null;
    // brown (parched) → green (ideal 35–70) → blue (waterlogged)
    return rgba(ramp([0xa05a20, 0xd8c040, 0x40c050, 0x40c050, 0x3070e0], g.world.moisture[i]! / 100), 150);
  },
  irrigation: g => {
    // per-tile mask: 1 covered, 2 broken head's throw, 3 pipe, 4 head
    const w = g.world;
    const mask = new Uint8Array(w.size * w.size);
    const live = connectedSprinklers(g);
    for (const s of g.irrigation.sprinklers) {
      const v = s.broken || !live.has(s.id) ? 2 : 1;
      forEachInRadius(g, s, i => { if (mask[i]! !== 1) mask[i] = v; });
    }
    for (const run of g.irrigation.pipes) for (const p of run) mask[w.idx(p.x, p.y)] = 3;
    for (const s of g.irrigation.sprinklers) mask[w.idx(s.pos.x, s.pos.y)] = 4;
    return (x, y) => {
      switch (mask[w.idx(x, y)]) {
        case 1: return rgba(0x40a0ff, 80);
        case 2: return rgba(0xff5040, 80);
        case 3: return rgba(0x1840a0, 220);
        case 4: return rgba(0xffffff, 255);
        default: return null;
      }
    };
  },
  health: g => (x, y) => {
    const i = g.world.idx(x, y);
    if (g.world.grass[i] === Grass.None) return null;
    return rgba(ramp([0x8a4a20, 0xe0c040, 0x30c050], g.world.health[i]! / 100), 150);
  },
  wear: g => (x, y) => {
    const v = g.world.wear[g.world.idx(x, y)]!;
    return v > 2 ? rgba(ramp([0xf0e080, 0xe08030, 0xa02020], v / 100), 60 + Math.round(v * 1.4)) : null;
  },
  mowHeight: g => (x, y) => {
    const i = g.world.idx(x, y);
    if (g.world.grass[i] === Grass.None || !g.world.courseId[i]) return null;
    // short (greens) → long (rough), on a log-ish scale: 3, 10, 25, 60+ mm
    const mm = g.world.mowHeight[i]! / 10;
    return rgba(ramp([0x2040c0, 0x30b0d0, 0x60d060, 0xe0d040, 0xd06020], Math.log(Math.max(2, mm) / 2) / Math.log(40)), 150);
  },
  staffCoverage: g => {
    // share of the last two days' planned labour actually done, per hole
    const done = new Map<number, number>(), planned = new Map<number, number>();
    for (const o of g.workOrders.all) {
      if (!o.holeId || o.due < g.day - 1) continue;
      planned.set(o.holeId, (planned.get(o.holeId) ?? 0) + o.laborHours);
      const frac = o.status === 'done' ? 1 : o.tiles.length ? o.progress / o.tiles.length : 0;
      done.set(o.holeId, (done.get(o.holeId) ?? 0) + o.laborHours * frac);
    }
    return (x, y) => {
      const id = g.world.holeId[g.world.idx(x, y)];
      if (!id) return null;
      const p = planned.get(id);
      if (!p) return rgba(0x808080, 70);
      return rgba(ramp([0xe04030, 0xf0d040, 0x40d060], (done.get(id) ?? 0) / p), 120);
    };
  },
  workOrders: g => {
    // today's orders; a tile shows its worst state: red skipped > grey unassigned > blue to do > green done
    const w = g.world;
    const mask = new Uint8Array(w.size * w.size);
    const rank = { done: 1, assigned: 2, open: 3, skipped: 4 } as const;
    for (const o of g.workOrders.all) {
      if (o.due !== g.day) continue;
      for (let k = 0; k < o.tiles.length; k++) {
        const i = o.tiles[k]!;
        const r = o.status === 'assigned' && k < o.progress ? rank.done : rank[o.status];
        if (r > mask[i]!) mask[i] = r;
      }
    }
    const col = [0, rgba(0x40d060, 90), rgba(0x4080ff, 110), rgba(0xa0a0a0, 110), rgba(0xe04030, 130)];
    return (x, y) => {
      const m = mask[w.idx(x, y)]!;
      return m ? col[m]! : null;
    };
  },
  land: g => (x, y) => {
    const px = Math.floor(x / PARCEL_TILES), py = Math.floor(y / PARCEL_TILES);
    if (g.parcels.isOwned(px, py)) return rgba(0x60ff60, 70);
    const t = (g.parcels.priceAt(px, py) - PRICE_MIN) / (PRICE_MAX - PRICE_MIN);
    return rgba(ramp([0xffffff, 0x303060], t), 60 + Math.round(t * 60));
  },
};
