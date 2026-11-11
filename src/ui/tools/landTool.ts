import type { Graphics } from 'pixi.js';
import { Vec2 } from '../../core/geom';
import { PARCEL_TILES } from '../../core/units';
import { Game } from '../../sim/game';
import { Feature, Surface } from '../../sim/world/tiles';
import { TILE_PX } from '../../render/camera';
import { Tool } from './tool';

export function describeParcel(g: Game, px: number, py: number): string {
  const w = g.world;
  let water = 0, rock = 0, trees = 0, wetland = 0, creek = 0;
  for (let y = py * PARCEL_TILES; y < (py + 1) * PARCEL_TILES && y < w.size; y++) {
    for (let x = px * PARCEL_TILES; x < (px + 1) * PARCEL_TILES && x < w.size; x++) {
      const i = w.idx(x, y);
      if (w.feature[i] === Feature.Creek) creek++;
      else if (w.surface[i] === Surface.Water) water++;
      if (w.feature[i] === Feature.Rock) rock++;
      if (w.feature[i] === Feature.Wetland) wetland++;
      if (w.treeSpecies[i]) trees++;
    }
  }
  const total = PARCEL_TILES * PARCEL_TILES;
  const bits: string[] = [];
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  if (creek) bits.push('creek');
  if (water) bits.push(`water ${pct(water)}`);
  if (rock) bits.push(`rock ${pct(rock)}`);
  if (wetland) bits.push(`wetland ${pct(wetland)}`);
  if (trees) bits.push(`trees ${pct(trees)}`);
  return bits.join(', ') || 'open ground';
}

export function landTool(g: Game): Tool {
  let hover: { px: number; py: number } | null = null;
  const parcelAt = (t: Vec2) => ({ px: Math.floor(t.x / PARCEL_TILES), py: Math.floor(t.y / PARCEL_TILES) });
  return {
    id: 'land',
    label: 'Land',
    cursor: 'pointer',
    onPointerMove(t) {
      const p = parcelAt(t);
      hover = g.parcels.inRange(p.px, p.py) ? p : null;
    },
    onPointerDown(t, e) {
      const p = parcelAt(t);
      hover = g.parcels.inRange(p.px, p.py) ? p : null;
      const r = g.dispatch(e.shiftKey ? { t: 'sellParcel', px: p.px, py: p.py } : { t: 'buyParcel', px: p.px, py: p.py });
      if (!r.ok) g.notify('warn', r.reason);
      else g.notify('info', e.shiftKey ? 'Parcel sold' : 'Parcel purchased');
    },
    status() {
      if (!hover) return 'Click a parcel to buy it · Shift-click to sell';
      const owned = g.parcels.isOwned(hover.px, hover.py);
      const price = g.parcels.priceAt(hover.px, hover.py);
      const road = g.parcels.adjacentToRoad(g.world, hover.px, hover.py) ? ' · road access' : '';
      return `Parcel ${hover.px},${hover.py} · ${owned ? `owned (sell for $${Math.round(price * 0.7).toLocaleString()})` : `$${price.toLocaleString()}`} · ${describeParcel(g, hover.px, hover.py)}${road}`;
    },
    drawPreview(gfx: Graphics) {
      if (!hover) return;
      const s = PARCEL_TILES * TILE_PX;
      gfx.rect(hover.px * s, hover.py * s, s, s).stroke({ width: 6, color: g.parcels.isOwned(hover.px, hover.py) ? 0xffe066 : 0xffffff, alpha: 0.9 });
    },
  };
}
