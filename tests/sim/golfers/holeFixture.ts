import { Vec2 } from '../../../src/core/geom';
import { Rng } from '../../../src/core/rng';
import { Hole } from '../../../src/sim/course/course';
import { Game } from '../../../src/sim/game';
import { generateGolfer } from '../../../src/sim/golfers/generate';
import { Golfer } from '../../../src/sim/golfers/golfer';
import { Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

/** A straight hole on a 300×300 fully owned map: rough everywhere, 16-tile fairway, radius-8 green. */
export function straightHole(lengthTiles = 183): { g: Game; hole: Hole; tee: Vec2; green: Vec2 } {
  const parcels: [number, number][] = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) parcels.push([x, y]);
  const g = newOwnedGame({ size: 300, parcels });
  const w = g.world;
  w.surface.fill(Surface.Rough);
  const tee = { x: 150, y: 270 }, green = { x: 150, y: 270 - lengthTiles };
  for (let y = green.y; y <= tee.y - 25; y++) for (let x = 142; x < 158; x++) w.surface[w.idx(x, y)] = Surface.Fairway;
  for (let y = -11; y <= 11; y++) for (let x = -11; x <= 11; x++) {
    const d = Math.hypot(x, y);
    if (d <= 8) w.surface[w.idx(green.x + x, green.y + y)] = Surface.Green;
    else if (d <= 10) w.surface[w.idx(green.x + x, green.y + y)] = Surface.Fringe;
  }
  for (let y = -2; y <= 2; y++) for (let x = -3; x <= 3; x++) w.surface[w.idx(tee.x + x, tee.y + y)] = Surface.Tee;
  const c = g.courses.create('Test');
  const hole = g.courses.addHole(c.id, {
    route: [tee, green], greenCenter: green,
    teeBoxes: (['championship', 'back', 'middle', 'forward'] as const).map((kind) => ({ kind, center: tee, marker: tee })),
    pins: [green], state: 'open',
  });
  return { g, hole, tee, green };
}

export const golferWith = (handicap: number, extra: Partial<Golfer> = {}): Golfer => {
  const base = generateGolfer(new Rng(11), 1);
  return { ...base, handicap, age: 35, type: 'regular', ...extra, traits: { ...base.traits, challenge: 0.5, ...(extra.traits ?? {}) } };
};
