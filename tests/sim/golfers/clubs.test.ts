import { clubSet } from '../../../src/sim/golfers/clubs';
import { LIE_EFFECT, lieAt } from '../../../src/sim/golfers/lie';
import { Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

test('better players hit the driver further and straighter', () => {
  const scratch = clubSet(0, 35), mid = clubSet(20, 35);
  expect(scratch[0]!.id).toBe('D');
  expect(scratch[0]!.carryM).toBeGreaterThan(mid[0]!.carryM);
  expect(mid[0]!.sdAngleDeg).toBeGreaterThan(scratch[0]!.sdAngleDeg);
  expect(mid[0]!.sdDistPct).toBeGreaterThan(scratch[0]!.sdDistPct);
});

test('the bag is ordered by carry, longest first, putter last', () => {
  const bag = clubSet(12, 40);
  for (let i = 1; i < bag.length; i++) expect(bag[i]!.carryM).toBeLessThan(bag[i - 1]!.carryM);
  expect(bag[bag.length - 1]!.id).toBe('P');
});

test('seniors and juniors carry it shorter', () => {
  expect(clubSet(10, 65)[0]!.carryM).toBeLessThan(clubSet(10, 40)[0]!.carryM);
  expect(clubSet(10, 14)[0]!.carryM).toBeLessThan(clubSet(10, 65)[0]!.carryM);
});

test('lies come from the surface, trees override', () => {
  const g = newOwnedGame();
  const w = g.world;
  w.surface[w.idx(5, 5)] = Surface.Bunker;
  w.surface[w.idx(6, 5)] = Surface.Fairway;
  w.treeSpecies[w.idx(6, 5)] = 1;
  expect(lieAt(w, { x: 5.5, y: 5.5 })).toBe('bunker');
  expect(lieAt(w, { x: 6.2, y: 5.9 })).toBe('trees');
  expect(LIE_EFFECT.deepRough.distMult).toBeLessThan(LIE_EFFECT.rough.distMult);
});
