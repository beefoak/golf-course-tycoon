import { brushTiles } from '../../../src/sim/construction/paint';
import { lastStroke } from '../../../src/sim/construction/undo';
import { Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

test('undo puts a paint stroke back and refunds it in full', () => {
  const g = newOwnedGame();
  const cash = g.ledger.cash;
  const i = g.world.idx(25, 25);
  expect(g.dispatch({ t: 'paint', tiles: brushTiles(25, 25, 2), surface: Surface.Fairway }).ok).toBe(true);
  expect(g.world.surface[i]).toBe(Surface.Fairway);
  expect(g.ledger.cash).toBeLessThan(cash);
  expect(g.dispatch({ t: 'undoStroke' }).ok).toBe(true);
  expect(g.world.surface[i]).toBe(Surface.Natural);
  expect(g.ledger.cash).toBe(cash);
  // only once
  expect(g.dispatch({ t: 'undoStroke' }).ok).toBe(false);
});

test('a stroke from an earlier day cannot be undone', () => {
  const g = newOwnedGame();
  g.dispatch({ t: 'paint', tiles: brushTiles(25, 25, 1), surface: Surface.Rough });
  const day = g.day;
  while (g.day === day) g.tick();
  const r = g.dispatch({ t: 'undoStroke' });
  expect(r.ok).toBe(false);
  expect(g.world.surface[g.world.idx(25, 25)]).toBe(Surface.Rough);
});

test('undoing a penned hole removes the hole until it is seeded', () => {
  const parcels: [number, number][] = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) parcels.push([x, y]);
  const g = newOwnedGame({ size: 200, parcels });
  g.dispatch({ t: 'createCourse', name: 'C' });
  const course = g.courses.list[0]!;
  const cash = g.ledger.cash;
  const r = g.dispatch({ t: 'penHole', input: { courseId: course.id, route: [{ x: 60, y: 150 }, { x: 60, y: 80 }], fairwayWidthYd: 30, roughWidthYd: 10, greenRadiusYd: 12 } });
  expect(r.ok).toBe(true);
  expect(course.holes.length).toBe(1);
  expect(g.world.holeId[g.world.idx(60, 80)]).not.toBe(0);
  expect(g.dispatch({ t: 'undoStroke' }).ok).toBe(true);
  expect(course.holes.length).toBe(0);
  expect(g.world.holeId[g.world.idx(60, 80)]).toBe(0);
  expect(g.world.surface[g.world.idx(60, 80)]).toBe(Surface.Natural);
  expect(g.ledger.cash).toBe(cash);
  // the next stroke becomes the one to undo
  g.dispatch({ t: 'paint', tiles: [{ x: 10, y: 10 }], surface: Surface.Rough });
  expect(lastStroke(g)).not.toBeNull();
});
