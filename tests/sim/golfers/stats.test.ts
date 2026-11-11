import { HoleResult } from '../../../src/sim/golfers/hole';
import { CourseStats } from '../../../src/sim/golfers/stats';
import { createGroup } from '../../../src/sim/golfers/groups';
import { golferWith } from './holeFixture';
import { spawnGolfers, threeHoleCourse } from './courseFixture';

const r = (holeId: number, strokes: number, putts = 2, extra: Partial<HoleResult> = {}): HoleResult => ({
  holeId, tee: 'back', strokes, putts, shots: [], pickedUp: false, penalties: 0, gir: false, fairwayHit: null, ...extra,
});

test('holeAverage, vs par, three-putt rate and hardest holes', () => {
  const s = new CourseStats(100);
  const p = golferWith(10);
  s.record(r(1, 4), p, 1, 4); s.record(r(1, 5, 3), p, 1, 4); s.record(r(1, 6), p, 2, 4);
  s.record(r(2, 3), p, 2, 3); s.record(r(2, 3), p, 2, 3);
  expect(s.holeAverage(1)).toBe(5);
  expect(s.holeAvgVsPar(1)).toBe(1);
  expect(s.holeAvgVsPar(2)).toBe(0);
  expect(s.threePuttRate(1)).toBeCloseTo(1 / 3);
  expect(s.hardestHoles(2)).toEqual([1, 2]);
});

test('the rolling window drops results older than 28 days', () => {
  const s = new CourseStats(100);
  const p = golferWith(10);
  s.record(r(1, 9), p, 1, 4);
  s.record(r(1, 4), p, 20, 4);
  s.recordRound(1, 300);
  s.roll(29);
  expect(s.holeAverage(1)).toBe(4);
  expect(s.avgRoundMinutes()).toBe(0);
});

test('lost-ball hotspots and landing heat come from shots', () => {
  const s = new CourseStats(100);
  const p = golferWith(10);
  const shot = (x: number, y: number, result: 'ok' | 'ob') => ({ from: { x: 0, y: 0 }, landing: { x, y }, final: { x, y }, next: { x, y }, club: '7I' as const, result, penalty: result === 'ok' ? 0 : 1 });
  s.record(r(1, 5, 2, { shots: [shot(55, 55, 'ob'), shot(56, 54, 'ob'), shot(10, 10, 'ok')] }), p, 1, 4);
  expect(s.lostBallHotspots(1)[0]).toEqual({ x: 55, y: 55 });
  expect(s.landingHeat[5 * s.heatSide + 5]).toBe(1);
});

test('a played round feeds stats, thoughts and opinion', () => {
  const { g, course } = threeHoleCourse();
  const grp = createGroup(g, course.id, spawnGolfers(g, 3), g.day, g.clock.minuteOfDay + 1);
  let done = false;
  g.events.on('roundComplete', () => { done = true; });
  for (let i = 0; i < 40000 && !done; i++) g.tick();
  const stats = g.stats.get(course.id)!;
  expect(stats.playedCount(course.holes[0]!.id)).toBe(3);
  expect(stats.avgRoundMinutes()).toBeGreaterThan(10);
  for (const id of grp.golferIds) {
    const golfer = g.golfers.all.get(id)!;
    expect(golfer.lastSatisfaction).toBeDefined();
    expect(golfer.opinion[course.id]).toBeDefined();
  }
});
