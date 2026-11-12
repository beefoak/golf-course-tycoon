import { planPenHole, commitPenHole, PenInput } from '../../../src/sim/course/pen';
import { holePar } from '../../../src/sim/course/yardage';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame, countSurface } from '../../helpers';

const big = () => newOwnedGame({ size: 200, parcels: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]] });
const input = (courseId: number, route: { x: number; y: number }[]): PenInput => ({ courseId, route, fairwayWidthYd: 35, roughWidthYd: 15, greenRadiusYd: 14 });

test('straight par 4 has tee, fairway, green and suggested par 4', () => {
  const g = big(); const c = g.courses.create('Main');
  const r = commitPenHole(g, input(c.id, [{ x: 50, y: 10 }, { x: 50, y: 190 }]));
  expect(r.ok).toBe(true); if (!r.ok) return;
  const h = r.value; expect(holePar(h)).toBe(4); expect(h.state).toBe('construction'); expect(h.number).toBe(1);
  expect(countSurface(g, Surface.Tee)).toBeGreaterThan(20); expect(countSurface(g, Surface.Fairway)).toBeGreaterThan(500);
  expect(countSurface(g, Surface.Green)).toBeGreaterThan(100); expect(countSurface(g, Surface.Rough)).toBeGreaterThan(0);
  expect(g.world.surface[g.world.idx(50, 10)]).toBe(Surface.Tee); expect(g.world.surface[g.world.idx(50, 190)]).toBe(Surface.Green);
  expect(h.teeBoxes).toEqual([{ kind: 'back', center: { x: 50, y: 10 }, marker: { x: 50, y: 10 } }]);
  expect(h.pins.length).toBe(4); for (const p of h.pins) expect(g.world.surface[g.world.idx(p.x, p.y)]).toBe(Surface.Green);
  expect(g.world.holeId[g.world.idx(50, 100)]).toBe(h.id);
});
test('par-3 route has no fairway tiles', () => {
  const g = big(); const c = g.courses.create('Main');
  const r = commitPenHole(g, input(c.id, [{ x: 50, y: 10 }, { x: 50, y: 110 }]));
  expect(r.ok).toBe(true); if (r.ok) expect(holePar(r.value)).toBe(3); expect(countSurface(g, Surface.Fairway)).toBe(0);
});
test('dogleg corridor follows waypoint', () => {
  const g = big(); const c = g.courses.create('Main');
  commitPenHole(g, input(c.id, [{ x: 30, y: 10 }, { x: 30, y: 110 }, { x: 80, y: 170 }]));
  expect(g.world.surface[g.world.idx(30, 110)]).toBe(Surface.Fairway); expect(g.world.surface[g.world.idx(80, 30)]).toBe(Surface.Natural);
});
test('warns when crossing rock and does not paint rock tiles', () => {
  const g = big(); const c = g.courses.create('Main'); g.world.feature[g.world.idx(50, 100)] = Feature.Rock;
  const d = planPenHole(g, input(c.id, [{ x: 50, y: 10 }, { x: 50, y: 190 }]));
  expect(d.warnings).toContain('crosses rock'); expect(d.plan.changes.some(ch => ch.i === g.world.idx(50, 100))).toBe(false);
});
test('warns on overlap with existing hole buffer', () => {
  const g = big(); const c = g.courses.create('Main');
  commitPenHole(g, input(c.id, [{ x: 30, y: 10 }, { x: 30, y: 190 }]));
  const d = planPenHole(g, input(c.id, [{ x: 70, y: 10 }, { x: 70, y: 190 }]));
  expect(d.warnings.some(w => /overlaps Hole 1/.test(w))).toBe(true);
});
test('warns when landing zone near out-of-bounds', () => {
  const g = big(); const c = g.courses.create('Main');
  const d = planPenHole(g, input(c.id, [{ x: 92, y: 10 }, { x: 92, y: 190 }]));
  expect(d.warnings.some(w => /out-of-bounds/.test(w))).toBe(true);
});
test('fails atomically when unaffordable', () => {
  const g = big(); const c = g.courses.create('Main'); g.ledger.cash = 1000;
  const r = commitPenHole(g, input(c.id, [{ x: 50, y: 10 }, { x: 50, y: 190 }]));
  expect(r.ok).toBe(false); expect(c.holes.length).toBe(0); expect(countSurface(g, Surface.Fairway)).toBe(0); expect(g.ledger.cash).toBe(1000);
});
test('rejects routes with fewer than 2 or more than 4 points', () => {
  const g = big(); const c = g.courses.create('Main');
  expect(commitPenHole(g, input(c.id, [{ x: 50, y: 10 }])).ok).toBe(false);
  expect(g.dispatch({ t: 'penHole', input: input(c.id, [{ x: 50, y: 10 }, { x: 50, y: 50 }, { x: 50, y: 90 }, { x: 50, y: 130 }, { x: 50, y: 170 }]) }).ok).toBe(false);
});
test('a default pin that lands on rock is replaced from the rest of the green', () => {
  const g = big(); const c = g.courses.create('Main');
  const route = [{ x: 50, y: 10 }, { x: 50, y: 110 }];
  const p0 = planPenHole(g, input(c.id, route)).draftHole.pins[0]!;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) g.world.feature[g.world.idx(p0.x + dx, p0.y + dy)] = Feature.Rock;
  const r = commitPenHole(g, input(c.id, route));
  expect(r.ok).toBe(true); if (!r.ok) return;
  expect(r.value.pins.length).toBe(4);
  for (const p of r.value.pins) expect(g.world.surface[g.world.idx(p.x, p.y)]).toBe(Surface.Green);
  expect(r.value.pins.some(p => p.x === p0.x && p.y === p0.y)).toBe(false);
});
