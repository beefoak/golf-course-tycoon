import { Rng } from '../../core/rng';
import { Result, ok, fail } from '../../core/result';
import { PARCEL_TILES } from '../../core/units';
import { Ledger } from '../economy/ledger';
import { World } from '../world/world';
import { Feature, Surface, isBlockingFeature } from '../world/tiles';

export const SELL_BACK_RATE = 0.7;
export const PRICE_MIN = 20_000;
export const PRICE_MAX = 150_000;

export class ParcelGrid {
  readonly perSide: number;
  price: Int32Array;
  owner: Uint8Array;

  constructor(perSide: number) {
    this.perSide = perSide;
    this.price = new Int32Array(perSide * perSide).fill(PRICE_MIN);
    this.owner = new Uint8Array(perSide * perSide);
  }

  static fromWorld(world: World, rng: Rng): ParcelGrid {
    const g = new ParcelGrid(world.chunksPerSide);
    for (let py = 0; py < g.perSide; py++) for (let px = 0; px < g.perSide; px++) {
      g.price[py * g.perSide + px] = ParcelGrid.priceFor(world, px, py, rng);
    }
    return g;
  }

  /**
   * Proposal formula (plan Task 4): $20k + $60k × buildable fraction + $40k if within 2 parcels
   * of the road + $30k × water-frontage fraction, ±5% jitter, clamped and rounded to $1,000.
   */
  static priceFor(world: World, px: number, py: number, rng: Rng): number {
    let buildable = 0, water = 0, total = 0;
    const x0 = px * PARCEL_TILES, y0 = py * PARCEL_TILES;
    for (let y = y0; y < Math.min(y0 + PARCEL_TILES, world.size); y++) {
      for (let x = x0; x < Math.min(x0 + PARCEL_TILES, world.size); x++) {
        const i = world.idx(x, y);
        total++;
        const s = world.surface[i] as Surface, f = world.feature[i] as Feature;
        if (s === Surface.Water) water++;
        else if (!isBlockingFeature(f)) buildable++;
      }
    }
    if (total === 0) return PRICE_MIN;
    const perSide = Math.ceil(world.size / PARCEL_TILES);
    const nearRoad = perSide - 1 - py <= 2;
    const waterFrac = Math.min(1, (water / total) * 4); // a little water = good frontage
    let p = 20_000 + 60_000 * (buildable / total) + (nearRoad ? 40_000 : 0) + 30_000 * waterFrac;
    p *= rng.range(0.95, 1.05);
    p = Math.round(p / 1000) * 1000;
    return Math.max(PRICE_MIN, Math.min(PRICE_MAX, p));
  }

  inRange(px: number, py: number): boolean {
    return px >= 0 && py >= 0 && px < this.perSide && py < this.perSide;
  }
  isOwned(px: number, py: number): boolean {
    return this.inRange(px, py) && this.owner[py * this.perSide + px] === 1;
  }
  tileOwned(x: number, y: number): boolean {
    if (x < 0 || y < 0) return false;
    return this.isOwned(Math.floor(x / PARCEL_TILES), Math.floor(y / PARCEL_TILES));
  }
  priceAt(px: number, py: number): number {
    return this.price[py * this.perSide + px]!;
  }
  buy(px: number, py: number, ledger: Ledger, day: number): Result {
    if (!this.inRange(px, py)) return fail('Parcel is off the map');
    if (this.isOwned(px, py)) return fail('You already own this parcel');
    const price = this.priceAt(px, py);
    if (!ledger.spend(price, 'land', day)) return fail(`Not enough money ($${price.toLocaleString()} needed)`);
    this.owner[py * this.perSide + px] = 1;
    return ok(undefined);
  }
  sell(px: number, py: number, ledger: Ledger, day: number, blockedReason?: string): Result {
    if (!this.isOwned(px, py)) return fail('You do not own this parcel');
    if (blockedReason) return fail(`Cannot sell: ${blockedReason}`);
    this.owner[py * this.perSide + px] = 0;
    ledger.earn(this.priceAt(px, py) * SELL_BACK_RATE, 'land', day);
    return ok(undefined);
  }
  adjacentToRoad(world: World, px: number, py: number): boolean {
    const y = Math.min(world.size - 1, (py + 1) * PARCEL_TILES);
    for (let x = px * PARCEL_TILES; x < Math.min((px + 1) * PARCEL_TILES, world.size); x++) {
      for (let yy = y - 1; yy <= Math.min(world.size - 1, y); yy++) {
        if (world.feature[world.idx(x, yy)] === Feature.Road) return true;
      }
    }
    return false;
  }
}
