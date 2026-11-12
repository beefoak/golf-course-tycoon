import { Vec2 } from '../../core/geom';
import { PARCEL_TILES } from '../../core/units';
import { BUILDING_DEFS, placeBuilding } from '../business/buildings';
import { Course, Hole } from '../course/course';
import type { Game } from '../game';
import { Grass } from '../turf/grasses';
import { Feature, Surface, isTurfSurface } from '../world/tiles';

export interface PrebuiltOptions {
  name: string;
  holes: number;
  /** turf health range for the course's grass (0..100) */
  health: [number, number];
}

const CELL_W = 30;
const CLUB_STRIP = 24;

/**
 * Lay out a simple ready-made course for a scenario: holes in three rows of side-by-side
 * corridors above the road, a clubhouse on the road, and the land bought. Free of charge.
 */
export function buildPrebuiltCourse(g: Game, o: PrebuiltOptions): Course {
  const w = g.world;
  const mid = Math.floor(w.size / 2);
  let roadTop = w.size;
  while (roadTop > 0 && w.feature[w.idx(mid, roadTop - 1)] === Feature.Road) roadTop--;
  const perRow = Math.ceil(o.holes / 3);
  const x0 = Math.max(CELL_W, Math.floor(mid - (perRow * CELL_W) / 2));
  const rowsTop = roadTop - CLUB_STRIP;
  const rowH = Math.min(170, Math.floor((rowsTop - 40) / 3));
  const top = rowsTop - 3 * rowH;

  // buy the land under it all
  const ps = g.parcels.perSide;
  for (let py = Math.floor(top / PARCEL_TILES); py < ps; py++) for (let px = Math.floor(x0 / PARCEL_TILES); px <= Math.floor((x0 + perRow * CELL_W) / PARCEL_TILES) && px < ps; px++) g.parcels.owner[py * ps + px] = 1;

  const course = g.courses.create(o.name);
  const painted: number[] = [];
  const hash = (i: number) => { let x = (i ^ g.seed) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

  for (let k = 0; k < o.holes; k++) {
    const r = Math.floor(k / perRow), c = r % 2 === 0 ? k % perRow : perRow - 1 - (k % perRow);
    const cx0 = x0 + c * CELL_W, cy0 = rowsTop - (r + 1) * rowH;
    const up = k % 2 === 0;
    const len = k % 4 === 2 ? Math.min(80, Math.floor(rowH * 0.5)) : rowH - 24;
    const midX = cx0 + CELL_W / 2;
    const tee: Vec2 = { x: midX, y: up ? cy0 + rowH - 10 : cy0 + 10 };
    const green: Vec2 = { x: midX, y: up ? tee.y - len : tee.y + len };
    const hole: Hole = g.courses.addHole(course.id, {
      route: [tee, green], greenCenter: green, state: 'open', pins: [green],
      teeBoxes: (['championship', 'back', 'middle', 'forward'] as const).map(kind => ({ kind, center: tee, marker: tee })),
    });
    // raise any water in the corridor to the corridor's dry ground
    let sum = 0, n = 0;
    for (let y = cy0; y < cy0 + rowH; y++) for (let x = cx0; x < cx0 + CELL_W; x++) { const i = w.idx(x, y); if (w.surface[i] !== Surface.Water) { sum += w.elevation[i]!; n++; } }
    const dry = n ? sum / n : 10;
    const lo = Math.min(tee.y, green.y), hi = Math.max(tee.y, green.y);
    for (let y = cy0; y < cy0 + rowH; y++) for (let x = cx0; x < cx0 + CELL_W; x++) {
      const i = w.idx(x, y);
      if (w.surface[i] === Surface.Water) w.elevation[i] = dry;
      const dg = Math.hypot(x - green.x, y - green.y);
      let s = Surface.Rough;
      if (Math.abs(x - tee.x) <= 3 && Math.abs(y - tee.y) <= 1) s = Surface.Tee;
      else if (dg <= 7) s = Surface.Green;
      else if (dg <= 9) s = Surface.Fringe;
      else if (Math.abs(x - green.x - 11) <= 1 && Math.abs(y - green.y) <= 2) s = Surface.Bunker;
      else if (Math.abs(x - midX) <= 6 && y > lo + 10 && y < hi - 10) s = Surface.Fairway;
      w.surface[i] = s;
      w.feature[i] = w.feature[i] === Feature.SpecimenTree && s === Surface.Rough ? Feature.SpecimenTree : Feature.None;
      if (s !== Surface.Rough || Math.abs(x - midX) <= 8) w.treeSpecies[i] = 0;
      w.grass[i] = Grass.None;
      w.holeId[i] = hole.id;
      w.courseId[i] = course.id;
      painted.push(i);
    }
  }
  // the clubhouse on the road below the first row (free for a scenario)
  const def = BUILDING_DEFS.clubhouse;
  const cash = g.ledger.cash, tx = g.ledger.tx.slice();
  const origin = { x: x0, y: roadTop - def.h };
  for (let y = origin.y; y < roadTop; y++) for (let x = origin.x; x < origin.x + def.w; x++) {
    const i = w.idx(x, y);
    w.surface[i] = Surface.Natural; w.feature[i] = Feature.None; w.treeSpecies[i] = 0;
  }
  g.ledger.cash = Number.isFinite(cash) ? 1e12 : cash;
  const club = placeBuilding(g, 'clubhouse', course.id, origin);
  if (!club.ok) course.clubhouse = { x: origin.x + Math.floor(def.w / 2), y: origin.y - 1 };
  g.ledger.restore(cash, tx);

  g.events.emit('edit', { tiles: painted });
  const [hLo, hHi] = o.health;
  for (const i of painted) if (isTurfSurface(w.surface[i] as Surface)) w.health[i] = Math.round(hLo + (hHi - hLo) * hash(i));
  w.markAllDirty();
  return course;
}
