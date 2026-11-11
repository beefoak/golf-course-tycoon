import { createGroup, finishRoundHeadless } from '../../../src/sim/golfers/groups';
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

test('a hole closed (and stripped) after booking is skipped, not played', () => {
  const { g, course, holes } = threeHoleCourse();
  const played: number[] = [];
  let rounds = 0;
  g.events.on('holeComplete', e => played.push(e.holeId));
  g.events.on('roundComplete', () => rounds++);
  const grp = createGroup(g, course.id, spawnGolfers(g, 4), g.day, g.clock.minuteOfDay + 1);
  runUntil(g, () => grp.started);
  const r = g.dispatch({ t: 'closeHole', holeId: holes[1]!.id });
  expect(r.ok).toBe(true);
  runUntil(g, () => holes[1]!.state === 'closed', 600);
  expect(holes[1]!.state).toBe('closed');
  expect(grp.holeIdx).toBe(0);
  holes[1]!.teeBoxes = [];
  expect(() => runUntil(g, () => rounds > 0)).not.toThrow();
  expect(rounds).toBe(1);
  expect(played).toEqual([holes[0]!.id, holes[2]!.id]);
});

test('a group whose every hole closed before tee-off ends its round without playing', () => {
  const { g, course, holes } = threeHoleCourse();
  let rounds = 0, played = 0;
  g.events.on('roundComplete', () => rounds++);
  g.events.on('holeComplete', () => played++);
  createGroup(g, course.id, spawnGolfers(g, 2), g.day, g.clock.minuteOfDay + 5);
  for (const h of holes) expect(g.dispatch({ t: 'closeHole', holeId: h.id }).ok).toBe(true);
  expect(() => runUntil(g, () => rounds > 0, 2000)).not.toThrow();
  expect(rounds).toBe(1);
  expect(played).toBe(0);
});

test('headless finish of a group walking back to the clubhouse', () => {
  const { g, course } = threeHoleCourse();
  const grp = createGroup(g, course.id, spawnGolfers(g, 4), g.day, g.clock.minuteOfDay + 1);
  runUntil(g, () => grp.phase === 'toClubhouse');
  expect(grp.phase).toBe('toClubhouse');
  let rounds = 0;
  g.events.on('roundComplete', () => rounds++);
  expect(() => finishRoundHeadless(g, grp)).not.toThrow();
  expect(grp.phase).toBe('done');
  expect(rounds).toBe(1);
});
