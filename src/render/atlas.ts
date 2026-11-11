import { Rng } from '../core/rng';
import { Surface } from '../sim/world/tiles';

/**
 * Programmer-art atlas (GDD §18). Every tile pattern and sprite is generated here and looked
 * up by name, so real art can replace any entry later without touching other code.
 * Patterns are 16×16 RGBA pixels packed as ABGR uint32 (ImageData little-endian layout).
 */
export const PATTERN_PX = 16;
export type Pattern = Uint32Array;

export function rgba(hex: number, a = 255): number {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}
export function shade(hex: number, f: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
}
/** Multiply a packed ABGR pixel's RGB by f. */
export function shadePacked(p: number, f: number): number {
  const a = p >>> 24;
  const b = Math.min(255, (((p >> 16) & 255) * f) | 0);
  const g = Math.min(255, (((p >> 8) & 255) * f) | 0);
  const r = Math.min(255, ((p & 255) * f) | 0);
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

type PatternKind = 'grass' | 'stripe_a' | 'stripe_b' | 'green' | 'sand' | 'water' | 'rock' | 'gravel' | 'asphalt' | 'roof' | 'reeds' | 'flat';

function makePattern(base: number, kind: PatternKind, rng: Rng): Pattern {
  const p = new Uint32Array(PATTERN_PX * PATTERN_PX);
  for (let y = 0; y < PATTERN_PX; y++) {
    for (let x = 0; x < PATTERN_PX; x++) {
      let f = 1;
      const n = rng.next();
      switch (kind) {
        case 'grass': f = n < 0.15 ? 0.88 : n > 0.9 ? 1.1 : 1; break;
        case 'stripe_a': f = (n < 0.08 ? 0.95 : 1) * 1.06; break;
        case 'stripe_b': f = (n < 0.08 ? 1.03 : 1) * 0.94; break;
        case 'green': f = n < 0.06 ? 0.96 : 1.02; break;
        case 'sand': f = n < 0.12 ? 0.9 : n > 0.95 ? 1.06 : 1; break;
        case 'water': f = (y % 8 === 3 && (x + y) % 6 < 3) ? 1.25 : n < 0.05 ? 0.92 : 1; break;
        case 'rock': f = ((x >> 2) + (y >> 2)) % 2 === 0 ? 1.08 : 0.9; if (n < 0.1) f *= 0.8; break;
        case 'gravel': f = n < 0.3 ? 0.85 : n > 0.85 ? 1.12 : 1; break;
        case 'asphalt': f = (y === 7 || y === 8) && x % 8 < 4 ? 2.4 : n < 0.1 ? 0.9 : 1; break;
        case 'roof': f = y % 4 === 0 ? 0.8 : 1; break;
        case 'reeds': f = x % 3 === 0 && n < 0.5 ? 0.75 : 1; break;
        case 'flat': f = 1; break;
      }
      p[y * PATTERN_PX + x] = rgba(shade(base, f));
    }
  }
  return p;
}

/** Tree canopy: transparent outside a circle, outlined, with a highlight. */
function makeCanopy(base: number, rng: Rng): Pattern {
  const p = new Uint32Array(PATTERN_PX * PATTERN_PX);
  const c = 7.5, r = 7.2;
  for (let y = 0; y < PATTERN_PX; y++) {
    for (let x = 0; x < PATTERN_PX; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > r) { p[y * PATTERN_PX + x] = 0; continue; }
      let f = d > r - 1.2 ? 0.6 : 1;
      if (x + y < 11 && d < r - 2) f = 1.2;
      if (rng.next() < 0.12) f *= 0.85;
      p[y * PATTERN_PX + x] = rgba(shade(base, f));
    }
  }
  return p;
}

/** Tiny pixel-art sprite from string rows; '.' is transparent, other chars index `colors`. */
export interface SpriteArt { w: number; h: number; px: Uint32Array }
function art(rows: string[], colors: Record<string, number>): SpriteArt {
  const h = rows.length, w = rows[0]!.length;
  const px = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[y]![x]!;
    px[y * w + x] = ch === '.' ? 0 : rgba(colors[ch] ?? 0xff00ff);
  }
  return { w, h, px };
}

const GOLFER_COLORS = { h: 0xf0c8a0, s: 0x3060c0, p: 0x303040, k: 0x202020, c: 0xc0c0c0, w: 0xffffff };
const SPRITES: Record<string, SpriteArt[]> = {
  golfer_walk: [
    ['..ww..', '..hh..', '.ssss.', 's.ss.s', '..ss..', '..pp..', '.p..p.', '.k..k.'],
    ['..ww..', '..hh..', '.ssss.', '.ssss.', '..ss..', '..pp..', '..pp..', '..kk..'],
    ['..ww..', '..hh..', '.ssss.', 's.ss.s', '..ss..', '..pp..', '.p..p.', 'k....k'],
    ['..ww..', '..hh..', '.ssss.', '.ssss.', '..ss..', '..pp..', '..pp..', '..kk..'],
  ].map(r => art(r, GOLFER_COLORS)),
  golfer_swing: [
    art(['c.ww..', '.chh..', '.ssss.', '..ss..', '..ss..', '..pp..', '.p..p.', '.k..k.'], GOLFER_COLORS),
    art(['..ww.c', '..hhc.', '.ssss.', '..ss..', '..ss..', '..pp..', '.p..p.', '.k..k.'], GOLFER_COLORS),
  ],
  cart: [art(['.wwwwww.', 'wkkkkkkw', 'wccccccw', 'wccccccw', '.k....k.'], { w: 0xf0f0f0, k: 0x303030, c: 0xd8d8d8 })],
  mower: [art(['.rrrr.', 'rrkkrr', 'rrrrrr', 'k....k'], { r: 0xd03030, k: 0x202020 })],
  flag: [art(['pr..', 'prrr', 'prr.', 'p...', 'p...', 'p...', 'p...', 'k...'], { p: 0xf0f0f0, r: 0xe23b3b, k: 0x202020 })],
  tee_marker: [art(['ww', 'ww'], { w: 0xffffff })],
  ball: [art(['w'], { w: 0xffffff })],
};

export class Atlas {
  private patterns = new Map<string, Pattern>();

  constructor(palette: Record<Surface, number>, treeColors: number[], featureColors: Partial<Record<number, number>>) {
    const rng = new Rng(1234);
    const kindFor: Partial<Record<Surface, PatternKind>> = {
      [Surface.Green]: 'green', [Surface.Bunker]: 'sand', [Surface.Waste]: 'sand', [Surface.Water]: 'water',
      [Surface.Path]: 'gravel', [Surface.Building]: 'roof', [Surface.Tee]: 'green', [Surface.Fringe]: 'green',
    };
    for (const key of Object.keys(palette)) {
      const s = Number(key) as Surface;
      this.patterns.set(`surface_${s}`, makePattern(palette[s], kindFor[s] ?? 'grass', rng));
    }
    this.patterns.set('fairway_stripe_a', makePattern(palette[Surface.Fairway], 'stripe_a', rng));
    this.patterns.set('fairway_stripe_b', makePattern(palette[Surface.Fairway], 'stripe_b', rng));
    this.patterns.set('rock', makePattern(featureColors[1] ?? 0x888888, 'rock', rng));
    this.patterns.set('road', makePattern(featureColors[5] ?? 0x444444, 'asphalt', rng));
    this.patterns.set('wetland', makePattern(featureColors[3] ?? 0x4f7a5a, 'reeds', rng));
    this.patterns.set('neighbor', makePattern(featureColors[6] ?? 0xa0a080, 'grass', rng));
    for (let s = 1; s < treeColors.length; s++) this.patterns.set(`tree_${s}`, makeCanopy(treeColors[s]!, rng));
  }

  pattern(name: string): Pattern {
    const p = this.patterns.get(name);
    if (!p) throw new Error(`Atlas: unknown pattern ${name}`);
    return p;
  }
  /** Average colour of a pattern (for low-detail baking). */
  average(name: string): number {
    const p = this.pattern(name);
    let r = 0, g = 0, b = 0, n = 0;
    for (const v of p) { if (v >>> 24 === 0) continue; r += v & 255; g += (v >> 8) & 255; b += (v >> 16) & 255; n++; }
    if (n === 0) return 0;
    return ((255 << 24) | (Math.round(b / n) << 16) | (Math.round(g / n) << 8) | Math.round(r / n)) >>> 0;
  }
  sprite(name: string, frame = 0): SpriteArt {
    const frames = SPRITES[name];
    if (!frames) throw new Error(`Atlas: unknown sprite ${name}`);
    return frames[frame % frames.length]!;
  }
  spriteFrames(name: string): number {
    return SPRITES[name]?.length ?? 0;
  }
}
