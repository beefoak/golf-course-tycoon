import { Application, Container, Sprite, Texture } from 'pixi.js';
import { PARCEL_TILES } from '../core/units';
import { World } from '../sim/world/world';
import { Feature, Surface } from '../sim/world/tiles';
import { Atlas, PATTERN_PX, shadePacked } from './atlas';
import { Camera, TILE_PX } from './camera';
import { hillshade } from './shading';

/** Returns a packed ABGR colour (alpha included) for a tile, or null for no tint. */
export type OverlayFn = (x: number, y: number) => number | null;

const C = PARCEL_TILES;

function patternName(w: World, x: number, y: number): string {
  const i = w.idx(x, y);
  switch (w.feature[i] as Feature) {
    case Feature.Rock: return 'rock';
    case Feature.Road: return 'road';
    case Feature.Wetland: return 'wetland';
    case Feature.Neighbor: return 'neighbor';
  }
  const s = w.surface[i] as Surface;
  if (s === Surface.Fairway) return Math.floor((x + y) / 4) % 2 === 0 ? 'fairway_stripe_a' : 'fairway_stripe_b';
  return `surface_${s}`;
}

/** Bake one chunk's ground + trees into a pixel buffer of (50·lodPx)² ABGR pixels. Pure. */
export function bakeChunk(w: World, chunk: number, lodPx: number, atlas: Atlas, contours = false): Uint32Array {
  const cx = chunk % w.chunksPerSide, cy = Math.floor(chunk / w.chunksPerSide);
  const side = C * lodPx;
  const out = new Uint32Array(side * side);
  const step = PATTERN_PX / lodPx;
  for (let ty = 0; ty < C; ty++) {
    for (let tx = 0; tx < C; tx++) {
      const x = cx * C + tx, y = cy * C + ty;
      if (!w.inBounds(x, y)) continue;
      const i = w.idx(x, y);
      const pat = atlas.pattern(patternName(w, x, y));
      const isWater = w.surface[i] === Surface.Water;
      const sh = isWater ? 1 : hillshade(w, x, y);
      const species = w.treeSpecies[i]!;
      const canopy = species ? atlas.pattern(`tree_${species}`) : null;
      let contour = false;
      if (contours && !isWater) {
        const e = Math.floor(w.elevation[i]!);
        contour = (x + 1 < w.size && Math.floor(w.elevation[i + 1]!) !== e) || (y + 1 < w.size && Math.floor(w.elevation[i + w.size]!) !== e);
      }
      for (let py = 0; py < lodPx; py++) {
        for (let px = 0; px < lodPx; px++) {
          const pi = (py * step | 0) * PATTERN_PX + (px * step | 0);
          let v = shadePacked(pat[pi]!, sh);
          if (canopy) {
            const c = canopy[pi]!;
            if (c >>> 24) v = shadePacked(c, sh);
            else if (lodPx < PATTERN_PX) v = shadePacked(v, 0.85);
          }
          if (contour && (py === lodPx - 1 || px === lodPx - 1)) v = shadePacked(v, 0.7);
          out[(ty * lodPx + py) * side + tx * lodPx + px] = v;
        }
      }
    }
  }
  return out;
}

function toTexture(px: Uint32Array, side: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d')!;
  const img = new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.byteLength), side, side);
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

interface Entry { sprite: Sprite; lod: number; lastUsed: number }

export class ChunkRenderer {
  readonly container = new Container();
  private ground = new Container();
  private overlayLayer = new Container();
  private cache = new Map<number, Entry>();
  private overlays = new Map<number, Sprite>();
  private overlayFn: OverlayFn | null = null;
  private frame = 0;
  contours = false;
  bakeBudget = 3;
  maxCached = 90;

  constructor(private app: Application, private atlas: Atlas, private world: World) {
    this.container.addChild(this.ground, this.overlayLayer);
    app.stage.addChild(this.container);
  }

  setOverlay(fn: OverlayFn | null): void {
    this.overlayFn = fn;
    this.refreshOverlay();
  }
  refreshOverlay(): void {
    for (const s of this.overlays.values()) { s.texture.destroy(true); s.destroy(); }
    this.overlays.clear();
  }
  setContours(on: boolean): void {
    if (this.contours === on) return;
    this.contours = on;
    this.invalidateAll();
  }
  invalidateAll(): void {
    for (const e of this.cache.values()) { e.sprite.texture.destroy(true); e.sprite.destroy(); }
    this.cache.clear();
  }

  update(camera: Camera): void {
    this.frame++;
    const viewW = this.app.renderer.width / this.app.renderer.resolution;
    const viewH = this.app.renderer.height / this.app.renderer.resolution;
    for (const c of this.world.takeDirtyChunks()) {
      const e = this.cache.get(c);
      if (e) { e.lod = -1; }
      const o = this.overlays.get(c);
      if (o) { o.texture.destroy(true); o.destroy(); this.overlays.delete(c); }
    }
    const lod = camera.zoom >= 1 ? 16 : 4;
    const visible = camera.visibleChunks(viewW, viewH, this.world.chunksPerSide);
    const visibleSet = new Set(visible);
    let budget = this.bakeBudget;
    for (const c of visible) {
      let e = this.cache.get(c);
      if ((!e || e.lod !== lod) && budget > 0) {
        budget--;
        const tex = toTexture(bakeChunk(this.world, c, lod, this.atlas, this.contours), C * lod);
        if (e) { e.sprite.texture.destroy(true); e.sprite.texture = tex; e.lod = lod; }
        else {
          const sprite = new Sprite(tex);
          e = { sprite, lod, lastUsed: this.frame };
          this.cache.set(c, e);
          this.ground.addChild(sprite);
        }
      }
      if (e) {
        const cx = c % this.world.chunksPerSide, cy = Math.floor(c / this.world.chunksPerSide);
        e.sprite.x = cx * C * TILE_PX;
        e.sprite.y = cy * C * TILE_PX;
        e.sprite.scale.set(TILE_PX / (e.sprite.texture.width / C));
        e.sprite.visible = true;
        e.lastUsed = this.frame;
      }
      if (this.overlayFn && !this.overlays.has(c) && budget >= 0) this.bakeOverlay(c);
    }
    for (const [c, e] of this.cache) if (!visibleSet.has(c)) e.sprite.visible = false;
    for (const [c, s] of this.overlays) s.visible = visibleSet.has(c);
    if (this.cache.size > this.maxCached) {
      const old = [...this.cache.entries()].filter(([c]) => !visibleSet.has(c)).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      for (const [c, e] of old.slice(0, this.cache.size - this.maxCached)) {
        e.sprite.texture.destroy(true); e.sprite.destroy(); this.cache.delete(c);
      }
    }
    this.container.scale.set(camera.zoom);
    this.container.x = Math.round(viewW / 2 - camera.x * camera.pxPerTile);
    this.container.y = Math.round(viewH / 2 - camera.y * camera.pxPerTile);
  }

  private bakeOverlay(c: number): void {
    const fn = this.overlayFn!;
    const cx = c % this.world.chunksPerSide, cy = Math.floor(c / this.world.chunksPerSide);
    const px = new Uint32Array(C * C);
    for (let ty = 0; ty < C; ty++) for (let tx = 0; tx < C; tx++) {
      const x = cx * C + tx, y = cy * C + ty;
      if (!this.world.inBounds(x, y)) continue;
      px[ty * C + tx] = fn(x, y) ?? 0;
    }
    const s = new Sprite(toTexture(px, C));
    s.x = cx * C * TILE_PX; s.y = cy * C * TILE_PX; s.scale.set(TILE_PX);
    this.overlays.set(c, s);
    this.overlayLayer.addChild(s);
  }
}
