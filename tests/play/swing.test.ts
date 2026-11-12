import { Rng } from '../../src/core/rng';
import { ACCURACY_ZONE, METER_MAX, SwingMeter, playerShot, rollPutt } from '../../src/play/swing';
import { clubSet } from '../../src/sim/golfers/clubs';
import { Surface } from '../../src/sim/world/tiles';
import { newOwnedGame } from '../helpers';

function field() {
  const g = newOwnedGame({ size: 200 });
  g.world.surface.fill(Surface.Fairway);
  return g;
}
const sevenIron = clubSet(10, 40).find(c => c.id === '7I')!;

function missAvg(acc: number, power = 1) {
  const g = field();
  const from = { x: 20, y: 100 }, aim = { x: 20 + sevenIron.carryM / 2, y: 100 };
  let miss = 0, dist = 0;
  for (let k = 0; k < 300; k++) {
    const out = playerShot(g, { handicap: 10, pos: from, lie: 'fairway', wind: { x: 0, y: 0 }, rng: new Rng(100 + k) }, aim, sevenIron, SwingMeter.locked(power, acc));
    miss += Math.hypot(out.landing.x - aim.x, out.landing.y - aim.y);
    dist += out.carryM;
  }
  return { miss: miss / 300, carry: dist / 300 };
}

test('a perfect accuracy press misses less than one at 0.8', () => {
  expect(missAvg(0).miss).toBeLessThan(missAvg(0.8).miss);
  // and the miss curves: a positive (early) press hooks one way, a late one the other
  const g = field();
  const shot = (acc: number) => playerShot(g, { handicap: 0, pos: { x: 20, y: 100 }, lie: 'fairway', wind: { x: 0, y: 0 }, rng: new Rng(1) }, { x: 80, y: 100 }, sevenIron, SwingMeter.locked(1, acc)).landing.y;
  expect(Math.sign(shot(0.9) - 100)).toBe(-Math.sign(shot(-0.9) - 100));
});

test('over-power adds distance', () => {
  expect(missAvg(0, 1.1).carry).toBeGreaterThan(missAvg(0, 1).carry * 1.05);
});

test('the meter sweeps, locks power on the first press and accuracy on the second', () => {
  const m = new SwingMeter();
  m.press();
  m.update(500);
  expect(m.t).toBeCloseTo(METER_MAX / 2, 5);
  m.update(450);
  m.press();
  expect(m.power).toBeCloseTo(METER_MAX * 0.95, 5);
  expect(m.phase).toBe('accuracy');
  // fall straight to the zone and press bang on it
  m.update(950);
  expect(Math.abs(m.t)).toBeLessThan(ACCURACY_ZONE);
  m.press();
  expect(m.phase).toBe('done');
  expect(Math.abs(m.accuracy)).toBeLessThan(0.2);
  // never pressing a second time is a full miss
  const n = new SwingMeter(); n.press(); n.update(400); n.press(); n.update(2000);
  expect(n.phase).toBe('done');
  expect(n.accuracy).toBe(-1);
});

test('a putt on a sloped green breaks downhill', () => {
  const g = newOwnedGame({ size: 100 });
  const w = g.world;
  for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) {
    const i = w.idx(x, y);
    w.surface[i] = Surface.Green;
    // rises toward +y: downhill is −y
    w.elevation[i] = 10 + y * 0.04;
  }
  const r = rollPutt(g, { x: 20, y: 50 }, { x: 40, y: 50 }, 0.6, { x: 90, y: 90 });
  expect(r.holed).toBe(false);
  expect(r.final.x).toBeGreaterThan(22);
  expect(r.final.y).toBeLessThan(49.5);
  // the same putt on the flat runs straight
  for (let i = 0; i < w.elevation.length; i++) w.elevation[i] = 10;
  const flat = rollPutt(g, { x: 20, y: 50 }, { x: 40, y: 50 }, 0.6, { x: 90, y: 90 });
  expect(Math.abs(flat.final.y - 50)).toBeLessThan(0.01);
  // a putt hit at the cup at a sensible pace drops
  const holed = rollPutt(g, { x: 20, y: 50 }, { x: 24, y: 50 }, 0.62, { x: 24, y: 50 });
  expect(holed.holed).toBe(true);
});
