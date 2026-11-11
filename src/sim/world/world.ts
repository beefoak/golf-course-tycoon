import { MAP_TILES, PARCEL_TILES } from '../../core/units';

/** Struct-of-arrays tile store. Chunk = one parcel (50×50 tiles). */
export class World {
  readonly size: number;
  readonly chunksPerSide: number;
  elevation: Float32Array;
  surface: Uint8Array;
  feature: Uint8Array;
  treeSpecies: Uint8Array;
  treeAgeDays: Uint16Array;
  grass: Uint8Array;
  health: Uint8Array;
  moisture: Uint8Array;
  wear: Uint8Array;
  firmness: Uint8Array;
  mowHeight: Uint16Array;
  holeId: Uint16Array;
  courseId: Uint8Array;
  private dirtyFlags: Uint8Array;
  private dirtyList: number[] = [];

  constructor(size = MAP_TILES) {
    this.size = size;
    this.chunksPerSide = Math.ceil(size / PARCEL_TILES);
    const n = size * size;
    this.elevation = new Float32Array(n);
    this.surface = new Uint8Array(n);
    this.feature = new Uint8Array(n);
    this.treeSpecies = new Uint8Array(n);
    this.treeAgeDays = new Uint16Array(n);
    this.grass = new Uint8Array(n);
    this.health = new Uint8Array(n);
    this.moisture = new Uint8Array(n);
    this.wear = new Uint8Array(n);
    this.firmness = new Uint8Array(n);
    this.mowHeight = new Uint16Array(n);
    this.holeId = new Uint16Array(n);
    this.courseId = new Uint8Array(n);
    this.dirtyFlags = new Uint8Array(this.chunksPerSide * this.chunksPerSide);
  }
  idx(x: number, y: number): number { return y * this.size + x; }
  inBounds(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.size && y < this.size; }
  chunkOf(x: number, y: number): number {
    return Math.floor(y / PARCEL_TILES) * this.chunksPerSide + Math.floor(x / PARCEL_TILES);
  }
  markDirty(x: number, y: number): void {
    const c = this.chunkOf(x, y);
    if (!this.dirtyFlags[c]) { this.dirtyFlags[c] = 1; this.dirtyList.push(c); }
  }
  markAllDirty(): void {
    for (let c = 0; c < this.dirtyFlags.length; c++) if (!this.dirtyFlags[c]) { this.dirtyFlags[c] = 1; this.dirtyList.push(c); }
  }
  takeDirtyChunks(): number[] {
    const out = this.dirtyList; this.dirtyList = [];
    for (const c of out) this.dirtyFlags[c] = 0;
    return out;
  }
}
