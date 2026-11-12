import { DAYS_PER_YEAR } from '../../../src/sim/clock';
import { resolveDifficulty } from '../../../src/sim/difficulty';
import { takeLoan } from '../../../src/sim/economy/loans';
import { Game } from '../../../src/sim/game';
import { SCENARIOS, checkScenario, daysLeft, scenarioOptions, startScenario } from '../../../src/sim/modes/scenarios';
import { deserialize, serialize } from '../../../src/sim/save';
import { nightlyCapacity } from '../../../src/sim/turf/irrigation';
import { Surface, isTurfSurface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

test('restoreNeglected sets up 18 open holes with poor turf and $400k', () => {
  const g = Game.create({ ...scenarioOptions('restoreNeglected'), size: 600 });
  const course = g.courses.list[0]!;
  expect(course.holes.length).toBe(18);
  expect(course.holes.every(h => h.state === 'open' && h.teeBoxes.length === 4)).toBe(true);
  expect(g.ledger.cash).toBe(400_000);
  expect(g.ledger.tx.length).toBe(0);
  expect(g.buildings.some(b => b.kind === 'clubhouse')).toBe(true);
  const w = g.world;
  let turf = 0, sum = 0;
  for (let i = 0; i < w.surface.length; i++) if (w.courseId[i] === course.id && isTurfSurface(w.surface[i] as Surface)) { turf++; sum += w.health[i]!; }
  expect(turf).toBeGreaterThan(1000);
  expect(sum / turf).toBeLessThan(45);
  // every hole sits on land the player owns
  for (const h of course.holes) expect(g.parcels.tileOwned(h.greenCenter.x, h.greenCenter.y)).toBe(true);
  expect(g.scenario?.status).toBe('active');
  expect(daysLeft(g)).toBe(2 * DAYS_PER_YEAR);
});

test('a goal check wins the scenario', () => {
  const g = newOwnedGame();
  SCENARIOS.testWin = { id: 'testWin', name: 'Test', description: '', seed: 1, terrain: 'parkland', difficulty: 'normal', setup: () => {},
    goals: [{ id: 'rich', text: 'Have $5M', check: x => x.ledger.cash >= 5_000_000 }], timeLimitDays: 10 };
  startScenario(g, 'testWin');
  checkScenario(g);
  expect(g.scenario!.status).toBe('active');
  g.ledger.cash = 6_000_000;
  checkScenario(g);
  expect(g.scenario!.status).toBe('won');
  expect(g.scenario!.met.rich).toBe(g.day);
  delete SCENARIOS.testWin;
});

test('running out of time fails the scenario and ends the game', () => {
  const g = newOwnedGame();
  SCENARIOS.testLose = { id: 'testLose', name: 'Test', description: '', seed: 1, terrain: 'parkland', difficulty: 'normal', setup: () => {},
    goals: [{ id: 'never', text: 'Never', check: () => false }], timeLimitDays: 3 };
  startScenario(g, 'testLose');
  let over = '';
  g.events.on('gameOver', ({ reason }) => { over = reason; });
  g.scenario!.startDay = g.day - 2;
  checkScenario(g);
  expect(g.scenario!.status).toBe('active');
  expect(daysLeft(g)).toBe(1);
  g.scenario!.startDay = g.day - 3;
  checkScenario(g);
  expect(g.scenario!.status).toBe('failed');
  expect(over).toContain('Out of time');
  delete SCENARIOS.testLose;
});

test('the desert scenario caps irrigation at 60% of the pump', () => {
  const g = Game.create({ ...scenarioOptions('desertWaterCrisis'), size: 400 });
  expect(g.terrain).toBe('desert');
  expect(g.opts.droughtCap).toBe(0.6);
  expect(g.courses.list[0]!.holes.length).toBe(9);
  g.irrigation.pump = { capacityM3PerNight: 100 } as NonNullable<typeof g.irrigation.pump>;
  expect(nightlyCapacity(g)).toBe(60);
  // a drought on top halves it again, but the cap still binds first
  g.irrigation.droughtUntilDay = g.day + 5;
  expect(nightlyCapacity(g)).toBe(50);
});

test('difficulty options: land prices, loan rate and the scenario survive a save', () => {
  const base = Game.create({ seed: 9, terrain: 'parkland', difficulty: 'normal', size: 200 });
  const dear = Game.create({ seed: 9, terrain: 'parkland', difficulty: 'normal', size: 200, options: { landPriceMult: 1.4, loanRate: 0.12, startingCash: 777_000 } });
  expect(dear.ledger.cash).toBe(777_000);
  expect(dear.parcels.price[5]!).toBeGreaterThan(base.parcels.price[5]! * 1.3);
  for (const g of [dear]) { g.parcels.owner[0] = 1; }
  const r = takeLoan(dear, 10_000, DAYS_PER_YEAR);
  expect(r.ok && r.value.ratePerYear).toBe(0.12);
  // presets and clamping
  expect(resolveDifficulty('hard').loanRate).toBe(0.09);
  expect(resolveDifficulty('easy').landPriceMult).toBe(0.7);
  expect(resolveDifficulty('normal', { pickiness: 9 }).pickiness).toBe(1.5);
  expect(resolveDifficulty('sandbox').startingCash).toBe(Infinity);
  // a save keeps the knobs and the scenario
  dear.scenario = { id: 'restoreNeglected', startDay: 1, met: {}, status: 'active' };
  const back = deserialize(serialize(dear));
  expect(back.ok).toBe(true);
  if (!back.ok) return;
  expect(back.value.opts.loanRate).toBe(0.12);
  expect(back.value.opts.landPriceMult).toBe(1.4);
  expect(back.value.scenario?.id).toBe('restoreNeglected');
});

test('pickier golfers are less satisfied by the same round', async () => {
  const { roundSatisfaction } = await import('../../../src/sim/golfers/thoughts');
  const thoughts = [{ golferId: 1, day: 1, minute: 0, key: 'slowPlay', mood: -1 }, { golferId: 1, day: 1, minute: 0, key: 'niceView', mood: 1 }] as never[];
  const golfer = {} as never;
  expect(roundSatisfaction(thoughts, golfer, 1, 1.4)).toBeLessThan(roundSatisfaction(thoughts, golfer, 1, 1));
  expect(roundSatisfaction(thoughts, golfer, 1, 0.6)).toBeGreaterThan(roundSatisfaction(thoughts, golfer, 1, 1));
});
