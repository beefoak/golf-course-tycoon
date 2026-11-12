import { PlayMode } from '../../src/play/playMode';
import { SwingMeter } from '../../src/play/swing';
import { teeSheetFor } from '../../src/sim/golfers/demand';
import { threeHoleCourse } from '../sim/golfers/courseFixture';

test('a round played with the meter is carded and saved, and takes a tee time', () => {
  const { g, course } = threeHoleCourse();
  g.weather.wind = { x: 0, y: 0 };
  const p = new PlayMode(g, course.id, { handicap: 5, tee: 'middle' });
  expect(p.teeTime).not.toBeNull();
  expect(teeSheetFor(g, course.id).booked.get(g.day)?.get(p.teeTime!)).toBe(-1);
  let guard = 0;
  while (!p.done && guard++ < 200) {
    if (p.isPutting()) {
      // pace for the distance: v² = 2·a·d with a ≈ 0.055·g on a Stimp-10 green, plus a little
      const v = Math.sqrt(2 * 0.055 * 9.81 * p.distanceM()) + 0.4;
      p.swing(SwingMeter.locked(Math.min(1.1, v / 5), 0));
    } else p.swing(SwingMeter.locked(1, 0));
  }
  expect(p.done).toBe(true);
  expect(g.playerRounds.length).toBe(1);
  // carding in again (the panel's Quit button) doesn't save a second copy
  p.finish();
  expect(g.playerRounds.length).toBe(1);
  const r = g.playerRounds[0]!;
  expect(r.scores.length).toBe(3);
  for (const s of r.scores) { expect(s.strokes).toBeGreaterThanOrEqual(1); expect(s.strokes).toBeLessThanOrEqual(s.par * 2); }
  expect(r.toPar).toBe(r.total - r.scores.reduce((a, s) => a + s.par, 0));
});
