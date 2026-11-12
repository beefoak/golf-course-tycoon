import { holePar, longestYards } from '../course/yardage';
import type { Game } from '../game';
import { avgFeePer18 } from '../golfers/demand';
import { Segment } from '../golfers/golfer';
import { greenStimp } from '../golfers/greenSpeed';
import { WILLINGNESS_PER_18 } from '../golfers/thoughts';
import { bunkerQuality } from '../turf/practices';
import { holeCondition, holeTiles, turfSettings } from '../turf/turf';
import { TILE_FLAG } from '../world/world';
import { Feature, Surface } from '../world/tiles';

const clamp = (v: number) => Math.max(0, Math.min(100, v));

function openHoles(g: Game, courseId: number) {
  return (g.courses.get(courseId)?.holes ?? []).filter(h => h.state === 'open');
}

/** 0..100: turf health on the playable tiles (wear shows as lost health), raked bunkers, and greens at their target speed. */
export function conditionScore(g: Game, courseId: number): number {
  const holes = openHoles(g, courseId);
  if (!holes.length) return 50;
  const w = g.world;
  let health = 0, hn = 0, bunkers = 0, bn = 0, speed = 0;
  for (const h of holes) {
    const c = holeCondition(g, h.id);
    if (c !== null) { health += c; hn++; }
    const tiles = holeTiles(g, h.id).turf;
    // wear the turf hasn't shrugged off yet
    let worn = 0;
    for (let k = 0; k < tiles.length; k += 5) if (w.wear[tiles[k]!]! > 60) worn++;
    health -= Math.min(15, (worn / Math.max(1, tiles.length / 5)) * 60);
    speed += Math.max(0, 100 - 18 * Math.abs(greenStimp(g, h.id) - turfSettings(g, courseId, h.id).greenStimpTarget));
  }
  for (let i = 0; i < w.holeId.length; i += 3) {
    if (!w.holeId[i] || w.surface[i] !== Surface.Bunker) continue;
    const h = g.courses.hole(w.holeId[i]!);
    if (!h || h.courseId !== courseId || h.state !== 'open') continue;
    bunkers += bunkerQuality(g, i % w.size, Math.floor(i / w.size)); bn++;
  }
  const turf = hn ? health / hn : 50;
  return Math.round(clamp(0.65 * turf + 0.15 * (bn ? bunkers / bn : 80) + 0.2 * (speed / holes.length)) * 10) / 10;
}

/** Points lost to specimen trees cut down (decays over time). */
export function specimenPenalty(g: Game, courseId: number): number {
  const half = 60;
  return g.repState.penalties.filter(p => p.courseId === courseId).reduce((s, p) => s + p.points * Math.pow(0.5, (g.day - p.day) / half), 0);
}

/**
 * 0..100: variety of hole lengths and pars, water and trees by the holes, elevation change,
 * natural features kept on the course, mowing stripes and the clubhouse; felled specimen trees cost points.
 */
export function aestheticsScore(g: Game, courseId: number): number {
  const holes = openHoles(g, courseId);
  if (!holes.length) return 50;
  const w = g.world;
  // variety: different pars and a spread of lengths
  const pars = new Set(holes.map(h => holePar(h)));
  const yards = holes.map(h => longestYards(h));
  const mean = yards.reduce((s, y) => s + y, 0) / yards.length;
  const cv = Math.sqrt(yards.reduce((s, y) => s + (y - mean) ** 2, 0) / yards.length) / Math.max(1, mean);
  let score = 10 * (pars.size / 3) + Math.min(12, cv * 30);
  // scenery near each hole: water, trees and natural features within ~40 m of the line of play
  let scenic = 0, natural = 0, elev = 0;
  for (const h of holes) {
    let water = false, trees = 0;
    const pts = h.route.length ? h.route : [h.greenCenter];
    for (let k = 0; k + 1 < pts.length || k === 0; k++) {
      const a = pts[k]!, b = pts[Math.min(k + 1, pts.length - 1)]!;
      const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      for (let t = 0; t <= len; t += 8) {
        const cx = a.x + (b.x - a.x) * t / len, cy = a.y + (b.y - a.y) * t / len;
        for (let dy = -20; dy <= 20; dy += 5) for (let dx = -20; dx <= 20; dx += 5) {
          const x = Math.round(cx + dx), y = Math.round(cy + dy);
          if (!w.inBounds(x, y)) continue;
          const i = w.idx(x, y);
          if (w.surface[i] === Surface.Water || w.feature[i] === Feature.Creek) water = true;
          if (w.treeSpecies[i]) trees++;
          const f = w.feature[i];
          if (f === Feature.SpecimenTree || f === Feature.Rock || f === Feature.Wetland || f === Feature.Creek) natural++;
        }
      }
    }
    scenic += (water ? 0.6 : 0) + Math.min(0.4, trees / 60);
    const tee = h.teeBoxes[0]?.center ?? pts[0]!;
    elev += Math.min(1, Math.abs(w.elevation[w.idx(Math.round(tee.x), Math.round(tee.y))]! - w.elevation[w.idx(Math.round(h.greenCenter.x), Math.round(h.greenCenter.y))]!) / 10);
  }
  score += 30 * (scenic / holes.length) + 10 * (elev / holes.length) + Math.min(14, natural * 0.5);
  // stripes on the fairways and greens
  let striped = 0, mown = 0;
  for (const h of holes) {
    const t = holeTiles(g, h.id).turf;
    for (let k = 0; k < t.length; k += 9) { mown++; if (w.flags[t[k]!]! & TILE_FLAG.stripe) striped++; }
  }
  score += 10 * (mown ? striped / mown : 0);
  const club = g.buildings.find(b => b.kind === 'clubhouse' && b.courseId === courseId);
  score += club ? 4 * club.tier : 0;
  return Math.round(clamp(score - specimenPenalty(g, courseId)) * 10) / 10;
}

/** 0..100: average round time against 4h15 for 18 holes (scaled to the round length). */
export function paceScore(g: Game, courseId: number): number {
  const st = g.stats.get(courseId);
  const avg = st?.avgRoundMinutes() ?? 0;
  if (!avg) return 70;
  const course = g.courses.get(courseId);
  const holes = Math.max(1, Math.min(18, course?.holes.filter(h => h.state === 'open').length ?? 18));
  const par = 255 * holes / 18;
  return Math.round(clamp(100 - Math.max(0, avg / par - 0.85) * 160) * 10) / 10;
}

/** 0..100: how happy golfers leave (recent satisfaction) against what they pay. */
export function valueScore(g: Game, courseId: number, segment: Segment = 'mid'): number {
  const course = g.courses.get(courseId);
  if (!course) return 50;
  const fee = avgFeePer18(g, course);
  const ratio = fee > 0 ? WILLINGNESS_PER_18[segment] / fee : 2;
  const recent = g.reviews.filter(r => r.courseId === courseId && g.day - r.day <= 28);
  const sat = recent.length ? recent.reduce((s, r) => s + r.satisfaction, 0) / recent.length : 60;
  return Math.round(clamp(50 + 30 * Math.log2(Math.max(0.25, ratio)) + (sat - 60) * 0.6) * 10) / 10;
}
