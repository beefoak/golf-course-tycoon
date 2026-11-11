/** World scale constants (GDD §4). */
export const TILE_M = 2;
export const PARCEL_TILES = 50;
export const MAP_TILES = 1000;
export const PARCELS_PER_SIDE = MAP_TILES / PARCEL_TILES;
export const M_TO_YD = 1.0936133;

export function tilesToYards(t: number): number {
  return t * TILE_M * M_TO_YD;
}
export function yardsToTiles(y: number): number {
  return y / M_TO_YD / TILE_M;
}
