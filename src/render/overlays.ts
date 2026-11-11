import { PARCEL_TILES } from '../core/units';
import { Game } from '../sim/game';
import { PRICE_MAX, PRICE_MIN } from '../sim/land/parcels';
import { slopeAt } from '../sim/world/slope';
import { Surface } from '../sim/world/tiles';
import { rgba } from './atlas';
import { OverlayFn } from './chunks';

export type OverlayId = 'elevation' | 'slope' | 'land';
export const OVERLAY_LABELS: Record<OverlayId, string> = { elevation: 'Elevation', slope: 'Slope', land: 'Land' };

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
  land: g => (x, y) => {
    const px = Math.floor(x / PARCEL_TILES), py = Math.floor(y / PARCEL_TILES);
    if (g.parcels.isOwned(px, py)) return rgba(0x60ff60, 70);
    const t = (g.parcels.priceAt(px, py) - PRICE_MIN) / (PRICE_MAX - PRICE_MIN);
    return rgba(ramp([0xffffff, 0x303060], t), 60 + Math.round(t * 60));
  },
};
