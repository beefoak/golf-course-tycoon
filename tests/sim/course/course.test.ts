import { Hole } from '../../../src/sim/course/course';
import { holePar, suggestPar, teeYards, routeLengthTiles } from '../../../src/sim/course/yardage';
import { Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

function addHole(g: ReturnType<typeof newOwnedGame>, courseId: number): Hole {
  const h = g.courses.addHole(courseId, { route: [{ x: 10, y: 10 }, { x: 10, y: 80 }], greenCenter: { x: 10, y: 80 } });
  return h;
}

test('suggestPar thresholds', () => {
  expect(suggestPar(250)).toBe(3); expect(suggestPar(251)).toBe(4); expect(suggestPar(470)).toBe(4); expect(suggestPar(471)).toBe(5);
});
test('routeLengthTiles sums legs', () => { expect(routeLengthTiles([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 10 }])).toBe(11); });
test('teeYards follows doglegs', () => {
  const g = newOwnedGame(); const c = g.courses.create('Main');
  const h = g.courses.addHole(c.id, { route: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], greenCenter: { x: 100, y: 100 } });
  h.teeBoxes.push({ kind: 'back', center: { x: 0, y: 0 }, marker: { x: 0, y: 0 } });
  expect(teeYards(h, 'back')).toBeCloseTo(437.4, 1); expect(holePar(h)).toBe(4);
  h.parOverride = 5; expect(holePar(h)).toBe(5);
});
test('holes get sequential numbers and unique ids', () => {
  const g = newOwnedGame(); const c = g.courses.create('Main');
  const a = addHole(g, c.id), b = addHole(g, c.id);
  expect([a.number, b.number]).toEqual([1, 2]); expect(a.id).not.toBe(b.id); expect(a.state).toBe('construction'); expect(a.name).toBe('Hole 1');
  expect(g.courses.hole(b.id)).toBe(b);
});
test('fifth tee box refused, duplicate kind refused', () => {
  const g = newOwnedGame(); const c = g.courses.create('Main'); const h = addHole(g, c.id);
  for (const kind of ['championship', 'back', 'middle', 'forward'] as const) expect(g.dispatch({ t: 'addTeeBox', holeId: h.id, kind, center: { x: 10, y: 12 } }).ok).toBe(true);
  expect(h.teeBoxes.length).toBe(4);
  expect(g.dispatch({ t: 'addTeeBox', holeId: h.id, kind: 'back', center: { x: 10, y: 14 } }).ok).toBe(false);
});
test('tee box can be moved and removed', () => {
  const g = newOwnedGame(); const c = g.courses.create('Main'); const h = addHole(g, c.id);
  g.dispatch({ t: 'addTeeBox', holeId: h.id, kind: 'middle', center: { x: 10, y: 12 } });
  expect(g.dispatch({ t: 'moveTeeBox', holeId: h.id, kind: 'middle', center: { x: 12, y: 15 } }).ok).toBe(true);
  expect(h.teeBoxes[0]!.center).toEqual({ x: 12, y: 15 });
  expect(g.dispatch({ t: 'removeTeeBox', holeId: h.id, kind: 'middle' }).ok).toBe(true); expect(h.teeBoxes.length).toBe(0);
});
test('pin must be on green, at most 6', () => {
  const g = newOwnedGame(); const c = g.courses.create('Main'); const h = addHole(g, c.id);
  for (let y = 75; y <= 85; y++) for (let x = 5; x <= 15; x++) g.world.surface[g.world.idx(x, y)] = Surface.Green;
  expect(g.dispatch({ t: 'setPins', holeId: h.id, pins: [{ x: 10, y: 80 }, { x: 30, y: 30 }] }).ok).toBe(false);
  expect(g.dispatch({ t: 'setPins', holeId: h.id, pins: [{ x: 10, y: 80 }, { x: 8, y: 78 }] }).ok).toBe(true);
  const seven = Array.from({ length: 7 }, (_, k) => ({ x: 6 + k, y: 80 }));
  expect(g.dispatch({ t: 'setPins', holeId: h.id, pins: seven }).ok).toBe(false);
  expect(g.dispatch({ t: 'setActivePin', holeId: h.id, index: 1 }).ok).toBe(true); expect(h.activePin).toBe(1);
  expect(g.dispatch({ t: 'setActivePin', holeId: h.id, index: 5 }).ok).toBe(false);
});
test('renumber reorders and keeps ids', () => {
  const g = newOwnedGame(); const c = g.courses.create('Main'); const a = addHole(g, c.id), b = addHole(g, c.id), d = addHole(g, c.id);
  expect(g.dispatch({ t: 'renumberHoles', courseId: c.id, order: [d.id, a.id, b.id] }).ok).toBe(true);
  expect([d.number, a.number, b.number]).toEqual([1, 2, 3]); expect(c.holes.map(h => h.id)).toEqual([d.id, a.id, b.id]);
  expect(g.dispatch({ t: 'renumberHoles', courseId: c.id, order: [a.id, b.id] }).ok).toBe(false);
});
test('holes are grouped by courseId', () => {
  const g = newOwnedGame(); const c1 = g.courses.create('North'), c2 = g.courses.create('South');
  addHole(g, c1.id); addHole(g, c1.id); const s = addHole(g, c2.id);
  expect(g.courses.allHoles().filter(h => h.courseId === c1.id).length).toBe(2); expect(s.number).toBe(1);
});
test('dispatch createCourse and setPar', () => {
  const g = newOwnedGame(); const r = g.dispatch({ t: 'createCourse', name: 'Pines' }); expect(r.ok).toBe(true);
  const c = g.courses.list[0]!; const h = addHole(g, c.id);
  expect(g.dispatch({ t: 'setPar', holeId: h.id, par: 6 }).ok).toBe(false);
  expect(g.dispatch({ t: 'setPar', holeId: h.id, par: 3 }).ok).toBe(true); expect(h.parOverride).toBe(3);
});
test('open holes lock their tiles and block parcel sale', () => {
  const g = newOwnedGame(); const c = g.courses.create('Main'); const h = addHole(g, c.id);
  g.world.holeId[g.world.idx(10, 10)] = h.id;
  expect(g.holeLockReason(h.id)).toBeNull(); h.state = 'open'; expect(g.holeLockReason(h.id)).toMatch(/Hole 1 is open/);
  const r = g.dispatch({ t: 'sellParcel', px: 0, py: 0 }); expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toMatch(/hole 1/);
});
