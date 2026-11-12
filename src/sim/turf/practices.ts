import { Result, fail, ok } from '../../core/result';
import type { Game, System } from '../game';
import { Surface } from '../world/tiles';
import { TILE_FLAG } from '../world/world';
import { Grass, grassSpec } from './grasses';
import { mowTargetMm, scalpDamage, turfSettings } from './turf';
import { sprayAllowed } from '../staff/equipment';

export type Practice = 'mow' | 'roll' | 'aerate' | 'topdress' | 'spray' | 'fertilize' | 'handWater' | 'rakeBunker' | 'changeCup' | 'fixDivots' | 'moveTeeMarkers';
export const PRACTICES: Practice[] = ['mow', 'roll', 'aerate', 'topdress', 'spray', 'fertilize', 'handWater', 'rakeBunker', 'changeCup', 'fixDivots', 'moveTeeMarkers'];

/** Days an aeration keeps greens bumpy; days a feed keeps lifting health. */
export const AERATION_DAYS = 7;
export const FEED_DAYS = 14;
export const BUNKER_DAILY_DECAY = 15;
export const BUNKER_ENTRY_DECAY = 8;
export const UNRAKED_BELOW = 50;

export interface PracticeOpts {
  /** mow to this height instead of the course setting */
  mm?: number;
  /** for changeCup / moveTeeMarkers */
  holeId?: number;
}

/** Tile-level effect of one maintenance practice. */
export function applyPractice(g: Game, practice: Practice, tiles: number[], opts: PracticeOpts = {}): void {
  const w = g.world;
  const day = g.day;
  if (practice === 'changeCup') {
    const h = opts.holeId ? g.courses.hole(opts.holeId) : undefined;
    if (h && h.pins.length && h.pinMode !== 'manual') h.activePin = (h.activePin + 1) % h.pins.length;
    return;
  }
  if (practice === 'moveTeeMarkers') {
    const h = opts.holeId ? g.courses.hole(opts.holeId) : undefined;
    if (!h) return;
    // shuffle markers across the pad so wear spreads: left, centre, right in turn
    for (const tb of h.teeBoxes) {
      const off = tb.marker.x - tb.center.x;
      const next = off >= 1 ? -1 : off + 1;
      tb.marker = { x: tb.center.x + next, y: tb.center.y };
    }
    return;
  }
  for (const i of tiles) {
    const gr = w.grass[i] as Grass;
    const s = w.surface[i] as Surface;
    switch (practice) {
      case 'mow': {
        if (gr === Grass.None) break;
        const cid = w.courseId[i]!;
        const t = opts.mm ?? mowTargetMm(turfSettings(g, cid, w.holeId[i]!), s);
        if (t === null || t === undefined) break;
        w.mowHeight[i] = Math.round(t * 10);
        const dmg = scalpDamage(t, grassSpec(gr)!.minMowMm);
        if (dmg) w.health[i] = Math.max(0, Math.round(w.health[i]! - dmg));
        // alternating 2-row bands that flip each day: the classic mowing stripe
        const y = Math.floor(i / w.size);
        const band = (Math.floor(y / 2) + day) & 1;
        w.flags[i] = band ? w.flags[i]! | TILE_FLAG.stripe : w.flags[i]! & ~TILE_FLAG.stripe;
        break;
      }
      case 'roll': if (gr !== Grass.None) w.rolledDay[i] = day; break;
      case 'aerate':
        if (gr === Grass.None) break;
        w.thatch[i] = Math.max(0, w.thatch[i]! - 30);
        w.health[i] = Math.max(0, w.health[i]! - 10);
        w.firmness[i] = Math.max(0, w.firmness[i]! - 10);
        w.aeratedDay[i] = day;
        break;
      case 'topdress':
        if (gr === Grass.None) break;
        w.firmness[i] = Math.min(100, w.firmness[i]! + 10);
        w.thatch[i] = Math.max(0, w.thatch[i]! - 10);
        break;
      case 'spray': w.flags[i] = w.flags[i]! & ~TILE_FLAG.disease; break;
      case 'fertilize': if (gr !== Grass.None) w.fedDay[i] = day; break;
      case 'handWater': if (gr !== Grass.None) w.moisture[i] = Math.min(100, w.moisture[i]! + 25); break;
      case 'rakeBunker': if (s === Surface.Bunker) w.health[i] = 100; break;
      case 'fixDivots': w.wear[i] = Math.max(0, w.wear[i]! - 30); break;
    }
    w.markDirty(i % w.size, Math.floor(i / w.size));
  }
}

/** Health-target modifier from practices and disease (added in the turf pass). */
export function practiceModifier(g: Game, i: number): number {
  const w = g.world;
  let m = 0;
  if (w.flags[i]! & TILE_FLAG.disease) m -= 40;
  const th = w.thatch[i]!;
  if (th > 30) m -= (th - 30) * 0.3;
  const fed = w.fedDay[i]!;
  if (fed && g.day - fed < FEED_DAYS) m += 10;
  return m;
}

/** Stimp change from practices: rolled today +0.5 (in stimpFor), aerated recently −1.5. */
export function recentlyAerated(g: Game, i: number): boolean {
  const a = g.world.aeratedDay[i]!;
  return a !== 0 && g.day - a < AERATION_DAYS;
}

function hash01(i: number, day: number, salt: number): number {
  return ((Math.imul(i ^ Math.imul(day + salt * 7919, 0x9e3779b1), 0x85ebca6b) >>> 8) & 0xffff) / 65536;
}

/** Daily chance a healthy-looking tile picks up disease. */
export function diseaseChance(g: Game, i: number): number {
  const w = g.world;
  const spec = grassSpec(w.grass[i] as Grass);
  if (!spec) return 0;
  const humid = g.weather.kind === 'rain' || g.weather.kind === 'storm' ? 2.5 : g.weather.kind === 'heatwave' ? 1.5 : 1;
  const wet = w.moisture[i]! > 75 ? 2 : 1;
  const weak = w.health[i]! < 60 ? 2 : 1;
  return 0.00004 * spec.diseaseRisk * humid * wet * weak;
}

export const SPREAD_CHANCE = 0.08;
/** Daily chance an untreated patch burns out by itself (doubled when the turf is drying out). */
export const SELF_CLEAR_CHANCE = 0.04;
/** Daily chance a tile gains a point of thatch. */
export const THATCH_CHANCE = 0.25;

export const practicesSystem: System = {
  name: 'practices',
  onDay(g) {
    const w = g.world;
    const n = w.grass.length;
    const day = g.day;
    const spreadTo: number[] = [];
    let outbreaks = 0;
    let firstAt: { x: number; y: number } | undefined;
    for (let i = 0; i < n; i++) {
      const gr = w.grass[i]!;
      if (gr === Grass.None) {
        // bunkers lose their raked finish every day
        if (w.surface[i] === Surface.Bunker && w.health[i]! > 0) w.health[i] = Math.max(0, w.health[i]! - BUNKER_DAILY_DECAY);
        continue;
      }
      // thatch builds up slowly under living turf
      if (w.thatch[i]! < 100 && hash01(i, day, 1) < THATCH_CHANCE) w.thatch[i]!++;
      if (w.flags[i]! & TILE_FLAG.disease) {
        if (hash01(i, day, 4) < SELF_CLEAR_CHANCE * (w.moisture[i]! < 60 ? 2 : 1)) { w.flags[i] = w.flags[i]! & ~TILE_FLAG.disease; continue; }
        const x = i % w.size, y = Math.floor(i / w.size);
        if (x > 0) spreadTo.push(i - 1);
        if (x < w.size - 1) spreadTo.push(i + 1);
        if (y > 0) spreadTo.push(i - w.size);
        if (y < w.size - 1) spreadTo.push(i + w.size);
      } else if (w.courseId[i] && hash01(i, day, 2) < diseaseChance(g, i)) {
        w.flags[i] = w.flags[i]! | TILE_FLAG.disease;
        outbreaks++;
        firstAt ??= { x: i % w.size, y: Math.floor(i / w.size) };
      }
    }
    for (const j of spreadTo) {
      if (w.grass[j] === Grass.None || w.flags[j]! & TILE_FLAG.disease) continue;
      if (hash01(j, day, 3) < SPREAD_CHANCE) w.flags[j] = w.flags[j]! | TILE_FLAG.disease;
    }
    if (outbreaks) g.notify('warn', `Disease spotted on the course (${outbreaks} new patch${outbreaks > 1 ? 'es' : ''}) — spray it before it spreads`, firstAt);
  },
};

/** Golfers trample the bunker they play out of. */
export function bunkerEntry(g: Game, x: number, y: number): void {
  const w = g.world;
  if (!w.inBounds(x, y)) return;
  const i = w.idx(Math.floor(x), Math.floor(y));
  if (w.surface[i] === Surface.Bunker) w.health[i] = Math.max(0, w.health[i]! - BUNKER_ENTRY_DECAY);
}

/** Bunker quality (0..100) at a spot; non-bunker tiles count as fine. */
export function bunkerQuality(g: Game, x: number, y: number): number {
  const w = g.world;
  if (!w.inBounds(x, y)) return 100;
  const i = w.idx(Math.floor(x), Math.floor(y));
  return w.surface[i] === Surface.Bunker ? w.health[i]! : 100;
}

export function practiceCommand(g: Game, practice: Practice, tiles: number[], opts?: PracticeOpts): Result {
  if (!PRACTICES.includes(practice)) return fail('Unknown practice');
  const n = g.world.grass.length;
  if (tiles.some(i => !Number.isInteger(i) || i < 0 || i >= n)) return fail('Tiles out of range');
  if (practice === 'spray' && tiles.length && !sprayAllowed(g, g.world.courseId[tiles[0]!]! || g.courses.list[0]?.id || 0)) return fail('Spraying needs a chemical store at the maintenance building');
  applyPractice(g, practice, tiles, opts);
  return ok(undefined);
}
