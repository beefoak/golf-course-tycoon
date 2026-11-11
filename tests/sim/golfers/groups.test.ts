import { createGroup } from '../../../src/sim/golfers/groups';
import { spawnGolfers, threeHoleCourse } from './courseFixture';

function runUntil(g: ReturnType<typeof threeHoleCourse>['g'], done: () => boolean, maxTicks = 40000): number {
  let n = 0;
  while (!done() && n < maxTicks) { g.tick(); n++; }
  return n;
}

test('a group plays a 3-hole course: 3 holeComplete events then roundComplete', () => {
  const { g, course } = threeHoleCourse();
  const holeEvents: number[] = [];
  let rounds = 0;
  g.events.on('holeComplete', e => holeEvents.push(e.holeId));
  g.events.on('roundComplete', () => rounds++);
  const grp = createGroup(g, course.id, spawnGolfers(g, 4), g.day, g.clock.minuteOfDay + 1);
  runUntil(g, () => rounds > 0);
  expect(holeEvents).toEqual(course.holes.map(h => h.id));
  expect(rounds).toBe(1);
  expect(grp.phase).toBe('done');
  for (const id of grp.golferIds) {
    const cards = grp.scores.get(id)!;
    expect(cards.length).toBe(3);
    for (const c of cards) expect(c.strokes).toBeGreaterThanOrEqual(1);
  }
  expect(g.groups.length).toBe(0);
});

test('a group teeing off 2 minutes behind has to wait', () => {
  const { g, course } = threeHoleCourse();
  const t = g.clock.minuteOfDay + 1;
  createGroup(g, course.id, spawnGolfers(g, 4, 1), g.day, t);
  const second = createGroup(g, course.id, spawnGolfers(g, 4, 2), g.day, t + 2);
  let rounds = 0;
  g.events.on('roundComplete', () => rounds++);
  runUntil(g, () => rounds >= 2);
  expect(rounds).toBe(2);
  expect(second.waitingMin).toBeGreaterThan(0);
});

test('groupsOnHole reflects where groups are', () => {
  const { g, course, holes } = threeHoleCourse();
  const grp = createGroup(g, course.id, spawnGolfers(g, 2), g.day, g.clock.minuteOfDay + 1);
  expect(g.groupsOnHole(holes[0]!.id)).toBe(0); // not started yet
  runUntil(g, () => grp.started);
  expect(g.groupsOnHole(holes[0]!.id)).toBe(1);
  expect(g.groupsOnHole(holes[1]!.id)).toBe(0);
  runUntil(g, () => grp.holeIdx === 1);
  expect(g.groupsOnHole(holes[0]!.id)).toBe(0);
  expect(g.groupsOnHole(holes[1]!.id)).toBe(1);
});

test('a closing hole closes once the group has left it', () => {
  const { g, course, holes } = threeHoleCourse();
  const grp = createGroup(g, course.id, spawnGolfers(g, 2), g.day, g.clock.minuteOfDay + 1);
  runUntil(g, () => grp.started);
  g.dispatch({ t: 'closeHole', holeId: holes[0]!.id });
  g.tick();
  expect(holes[0]!.state).toBe('closing');
  runUntil(g, () => grp.holeIdx >= 1);
  g.tick();
  expect(holes[0]!.state).toBe('closed');
});

test('groups still out at the end of the day finish headless', () => {
  const { g, course } = threeHoleCourse();
  let rounds = 0;
  g.events.on('roundComplete', () => rounds++);
  createGroup(g, course.id, spawnGolfers(g, 4), g.day, 1255); // 20:55, cannot finish before 21:00
  const day = g.day;
  runUntil(g, () => g.day > day);
  expect(rounds).toBe(1);
  expect(g.groups.length).toBe(0);
});
