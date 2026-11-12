import { Game } from '../../../src/sim/game';
import { award } from '../../../src/sim/rating/milestones';
import { isUnlocked } from '../../../src/sim/rating/unlocks';
import { checkSolvency } from '../../../src/sim/economy/loans';
import { lodgingHooks } from '../../../src/sim/business/buildings';
import { Grass } from '../../../src/sim/turf/grasses';
import { Surface } from '../../../src/sim/world/tiles';
import { blockCourse } from '../staff/blockFixture';

test('unlocks are earned in career and free in sandbox', () => {
  const { g, courseId } = blockCourse(2);
  expect(isUnlocked(g, 'lodging')).toBe(false);
  expect(lodgingHooks.unlocked(g, courseId)).toBe(false);
  const r = g.dispatch({ t: 'buyEquipment', courseId, kind: 'fairwayMower', tier: 3 });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(/4-star/);
  award(g, 'reputation4');
  expect(isUnlocked(g, 'lodging')).toBe(true);
  expect(isUnlocked(g, 'equipmentTier3')).toBe(true);
  const sb = Game.create({ seed: 3, terrain: 'parkland', difficulty: 'sandbox', size: 100 });
  for (const k of ['lodging', 'proTour', 'exoticGrass', 'premiumSand', 'equipmentTier3', 'multiCourse'] as const) expect(isUnlocked(sb, k)).toBe(true);
});

test('warm grasses off their climate wait for the unlock', () => {
  const { g } = blockCourse(1);
  g.world.surface[g.world.idx(200, 250)] = Surface.Rough;
  // parkland is temperate: Paspalum doesn't suit it
  const r = g.dispatch({ t: 'setGrass', tiles: [{ x: 200, y: 250 }], grass: Grass.Paspalum, method: 'sod' });
  expect(r.ok ? '' : r.reason).toMatch(/climate/);
  g.unlocks.push('exoticGrass');
  const r2 = g.dispatch({ t: 'setGrass', tiles: [{ x: 200, y: 250 }], grass: Grass.Paspalum, method: 'sod' });
  expect(r2.ok ? '' : r2.reason).toBe('');
});

test('a second course needs 18 holes first, and numbers its own holes from 1', () => {
  const { g } = blockCourse(18);
  const r = g.dispatch({ t: 'createCourse', name: 'The Annex' });
  expect(r.ok).toBe(false);
  award(g, 'open18');
  const r2 = g.dispatch({ t: 'createCourse', name: 'The Annex' });
  expect(r2.ok).toBe(true);
  const annex = g.courses.list.find(c => c.name === 'The Annex')!;
  expect(g.activeCourseId).toBe(annex.id);
  const h = g.courses.addHole(annex.id, { route: [{ x: 10, y: 280 }, { x: 60, y: 280 }], greenCenter: { x: 60, y: 280 } });
  expect(h.number).toBe(1);
});

test('bankruptcy ends a career game, never a sandbox one', () => {
  const { g } = blockCourse(1);
  const over: string[] = [];
  g.events.on('gameOver', e => over.push(e.reason));
  g.ledger.cash = -50_000_000;
  checkSolvency(g);
  expect(over.length).toBe(1);
  expect(g.finance.gameOver).toMatch(/Bankrupt/);
  const sb = Game.create({ seed: 3, terrain: 'parkland', difficulty: 'sandbox', size: 100 });
  sb.events.on('gameOver', e => over.push(e.reason));
  sb.ledger.cash = -50_000_000;
  checkSolvency(sb);
  expect(over.length).toBe(1);
});
