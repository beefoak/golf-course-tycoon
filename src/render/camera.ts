import { Vec2 } from '../core/geom';
import { PARCEL_TILES } from '../core/units';

export const TILE_PX = 16;
export const ZOOMS = [0.25, 0.5, 1, 2, 3, 4] as const;
export type Zoom = (typeof ZOOMS)[number];

/** Camera position is the world tile coordinate at the centre of the screen. */
export class Camera {
  x = 0;
  y = 0;
  zoom: Zoom = 1;

  get pxPerTile(): number {
    return TILE_PX * this.zoom;
  }
  screenToTile(sx: number, sy: number, viewW: number, viewH: number): Vec2 {
    return { x: this.x + (sx - viewW / 2) / this.pxPerTile, y: this.y + (sy - viewH / 2) / this.pxPerTile };
  }
  tileToScreen(tx: number, ty: number, viewW: number, viewH: number): Vec2 {
    return { x: (tx - this.x) * this.pxPerTile + viewW / 2, y: (ty - this.y) * this.pxPerTile + viewH / 2 };
  }
  visibleChunks(viewW: number, viewH: number, chunksPerSide: number): number[] {
    const a = this.screenToTile(0, 0, viewW, viewH);
    const b = this.screenToTile(viewW, viewH, viewW, viewH);
    const c0 = Math.max(0, Math.floor(a.x / PARCEL_TILES)), c1 = Math.min(chunksPerSide - 1, Math.floor(b.x / PARCEL_TILES));
    const r0 = Math.max(0, Math.floor(a.y / PARCEL_TILES)), r1 = Math.min(chunksPerSide - 1, Math.floor(b.y / PARCEL_TILES));
    const out: number[] = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * chunksPerSide + c);
    return out;
  }
  zoomAt(dir: 1 | -1, sx: number, sy: number, viewW: number, viewH: number): void {
    const i = ZOOMS.indexOf(this.zoom);
    const ni = Math.max(0, Math.min(ZOOMS.length - 1, i + dir));
    if (ni === i) return;
    const before = this.screenToTile(sx, sy, viewW, viewH);
    this.zoom = ZOOMS[ni]!;
    const after = this.screenToTile(sx, sy, viewW, viewH);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }
  clampTo(size: number): void {
    this.x = Math.max(0, Math.min(size, this.x));
    this.y = Math.max(0, Math.min(size, this.y));
  }
}
