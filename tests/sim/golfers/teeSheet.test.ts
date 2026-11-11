import { Course, Hole } from '../../../src/sim/course/course';
import { TeeSheet, roundOptions } from '../../../src/sim/golfers/teeSheet';

const courseWith = (n: number, closed = 0): Course => ({
  id: 1, name: 'C', clubhouse: null,
  holes: Array.from({ length: n + closed }, (_, i) => ({ id: i + 1, number: i + 1, state: i < n ? 'open' : 'closed' }) as Hole),
});

test('round options by number of open holes', () => {
  expect(roundOptions(courseWith(0))).toEqual([]);
  expect(roundOptions(courseWith(3))).toEqual([3]);
  expect(roundOptions(courseWith(3, 2))).toEqual([3]);
  expect(roundOptions(courseWith(9))).toEqual([9]);
  expect(roundOptions(courseWith(12))).toEqual([9]);
  expect(roundOptions(courseWith(18))).toEqual([9, 18]);
});

test('no double booking, no off-interval slots, nothing after the last tee time', () => {
  const t = new TeeSheet();
  expect(t.book(1, 600, 1)).toBe(true);
  expect(t.book(1, 600, 2)).toBe(false);
  expect(t.book(1, 605, 2)).toBe(false);
  expect(t.book(2, 600, 2)).toBe(true);
  const last = t.lastTee(18);
  expect(t.slots(1, 18).every(s => s.minute <= last)).toBe(true);
  const after = t.slots(1, 18).at(-1)!.minute + t.intervalMin;
  expect(t.book(1, after, 3, 18)).toBe(false);
  expect(t.slots(1).find(s => s.minute === 600)!.groupId).toBe(1);
});

test('nearestFree finds the next open slot', () => {
  const t = new TeeSheet();
  t.book(1, 600, 1); t.book(1, 610, 2);
  expect(t.nearestFree(1, 603, 9)).toBe(620);
});
