import { GameClock, TICKS_PER_MIN, DAY_START_MIN, DAY_END_MIN, REAL_MS_PER_TICK_1X } from '../../src/sim/clock';

test('starts on day 1 at dawn', () => {
  const c = new GameClock(); expect(c.day).toBe(1); expect(c.minuteOfDay).toBe(DAY_START_MIN); expect(c.season).toBe('spring');
});
test('a minute passes every 10 ticks', () => {
  const c = new GameClock(); let r = c.step();
  for (let i = 1; i < TICKS_PER_MIN - 1; i++) { r = c.step(); expect(r.newMinute).toBe(false); }
  r = c.step(); expect(r.newMinute).toBe(true); expect(c.minuteOfDay).toBe(DAY_START_MIN + 1);
});
test('clock skips night', () => {
  const c = new GameClock(); c.minuteOfDay = DAY_END_MIN - 1;
  let r = c.step(); for (let i = 1; i < TICKS_PER_MIN; i++) r = c.step();
  expect(r.newDay).toBe(true); expect(c.day).toBe(2); expect(c.minuteOfDay).toBe(DAY_START_MIN);
});
test('season advances every 28 days and year after 112', () => {
  const c = new GameClock(); c.day = 29; expect(c.season).toBe('summer');
  c.day = 85; expect(c.season).toBe('winter'); c.day = 113; expect(c.season).toBe('spring'); expect(c.year).toBe(2);
});
test('12 real minutes per day at 1x', () => {
  expect(REAL_MS_PER_TICK_1X).toBe(75);
  expect((DAY_END_MIN - DAY_START_MIN) * TICKS_PER_MIN * REAL_MS_PER_TICK_1X).toBe(720_000);
});
test('format time', () => {
  const c = new GameClock(); c.minuteOfDay = 7 * 60 + 42; expect(c.timeString()).toBe('7:42 AM');
  c.minuteOfDay = 13 * 60 + 5; expect(c.timeString()).toBe('1:05 PM');
});
