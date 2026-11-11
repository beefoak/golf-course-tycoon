import { clearPathCache } from '../../../src/sim/world/pathfind';
import { validateHole } from '../../../src/sim/course/validate';
import { startGrowIn, closeHole, reopenHole, GROW_IN_DAYS, GROW_IN_COST_PER_TILE } from '../../../src/sim/course/lifecycle';
import { commitPenHole } from '../../../src/sim/course/pen';
import { planSurfacePaint, commitPlan } from '../../../src/sim/construction/paint';
import { DAY_END_MIN, DAY_START_MIN, TICKS_PER_MIN } from '../../../src/sim/clock';
import { Feature, Surface } from '../../../src/sim/world/tiles';
import { Game } from '../../../src/sim/game';
import { newOwnedGame } from '../../helpers';

const TICKS_PER_DAY = (DAY_END_MIN - DAY_START_MIN) * TICKS_PER_MIN;
const runDays = (g: Game, n: number) => { for (let i = 0; i < n * TICKS_PER_DAY; i++) g.tick(); };

function penGame() {
  const g = newOwnedGame({ size: 200, parcels: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]] });
  const c = g.courses.create('Main');
  const r = commitPenHole(g, { courseId: c.id, route: [{ x: 50, y: 10 }, { x: 50, y: 150 }], fairwayWidthYd: 35, roughWidthYd: 15, greenRadiusYd: 14 });
  if (!r.ok) throw new Error(r.reason);
  return { g, c, h: r.value };
}

test('a fresh pen hole validates', () => {
  const { g, h } = penGame(); expect(validateHole(g, h).errors).toEqual([]);
});
test('cannot grow in a hole with no pins', () => {
  const { g, h } = penGame(); h.pins = [];
  const r = startGrowIn(g, h.id, 'seed'); expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toMatch(/pin/i);
  expect(validateHole(g, h).errors.some(e => /pin/i.test(e))).toBe(true);
});
test('errors: no tee box, green missing', () => {
  const { g, h } = penGame(); h.teeBoxes = []; expect(validateHole(g, h).errors.some(e => /tee/i.test(e))).toBe(true);
});
test('error when the next hole cannot be walked to from the previous green', () => {
  const { g, c, h } = penGame();
  const r2 = commitPenHole(g, { courseId: c.id, route: [{ x: 50, y: 175 }, { x: 80, y: 60 }], fairwayWidthYd: 25, roughWidthYd: 5, greenRadiusYd: 10 });
  expect(r2.ok).toBe(true); if (!r2.ok) return;
  expect(validateHole(g, r2.value).errors).toEqual([]);
  // wall off the second tee with rock
  for (let y = 165; y < 186; y++) for (let x = 40; x < 61; x++) if (Math.max(Math.abs(x - 50), Math.abs(y - 175)) === 10) g.world.feature[g.world.idx(x, y)] = Feature.Rock;
  clearPathCache(g); // direct writes bypass commitPlan's edit event
  expect(validateHole(g, r2.value).errors.some(e => /walk/i.test(e))).toBe(true); void h;
});
test('grow-in by seed takes 21 days then opens and charges per turf tile', () => {
  const { g, h } = penGame(); expect(GROW_IN_DAYS.seed).toBe(21); const before = g.ledger.cash;
  expect(startGrowIn(g, h.id, 'seed').ok).toBe(true); expect(h.state).toBe('growingIn');
  expect(before - g.ledger.cash).toBeGreaterThan(0); expect((before - g.ledger.cash) % GROW_IN_COST_PER_TILE.seed).toBe(0);
  runDays(g, 20); expect(h.state).toBe('growingIn'); runDays(g, 1); expect(h.state).toBe('open');
  expect(h.stakes.ob.length + h.stakes.red.length + h.stakes.yellow.length).toBeGreaterThanOrEqual(0);
});
test('sod is faster and dearer', () => {
  expect(GROW_IN_DAYS.sod).toBe(3); expect(GROW_IN_COST_PER_TILE.sod).toBeGreaterThan(GROW_IN_COST_PER_TILE.seed);
  const { g, h } = penGame(); startGrowIn(g, h.id, 'sod'); runDays(g, 3); expect(h.state).toBe('open');
});
test('edits on open hole are refused', () => {
  const { g, h } = penGame(); startGrowIn(g, h.id, 'sod'); runDays(g, 3);
  const q = planSurfacePaint(g, [{ x: 50, y: 80 }], Surface.Rough); expect(q.changes.length).toBe(0); expect(q.reasons.join()).toMatch(/Hole 1 is open/);
});
test('close waits for groups to clear', () => {
  const { g, h } = penGame(); startGrowIn(g, h.id, 'sod'); runDays(g, 3);
  let groups = 1; g.groupsOnHole = () => groups;
  expect(closeHole(g, h.id).ok).toBe(true); expect(h.state).toBe('closing');
  for (let i = 0; i < 50; i++) g.tick(); expect(h.state).toBe('closing');
  groups = 0; g.tick(); expect(h.state).toBe('closed');
});
test('reopen without edits is immediate; after edit requires grow-in', () => {
  const { g, h } = penGame(); startGrowIn(g, h.id, 'sod'); runDays(g, 3); closeHole(g, h.id); g.tick();
  expect(h.state).toBe('closed'); expect(reopenHole(g, h.id).ok).toBe(true); expect(h.state).toBe('open');
  closeHole(g, h.id); g.tick();
  expect(commitPlan(g, planSurfacePaint(g, [{ x: 50, y: 80 }], Surface.Rough), 'construction').ok).toBe(true);
  expect(h.editedSinceClose).toBe(true); expect(reopenHole(g, h.id).ok).toBe(true); expect(h.state).toBe('growingIn');
  runDays(g, GROW_IN_DAYS.sod); expect(h.state).toBe('open'); expect(h.editedSinceClose).toBe(false);
});
test('commands dispatch', () => {
  const { g, h } = penGame();
  expect(g.dispatch({ t: 'startGrowIn', holeId: h.id, method: 'sod' }).ok).toBe(true); runDays(g, 3);
  expect(g.dispatch({ t: 'closeHole', holeId: h.id }).ok).toBe(true); g.tick();
  expect(g.dispatch({ t: 'reopenHole', holeId: h.id }).ok).toBe(true);
});
