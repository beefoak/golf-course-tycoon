// @vitest-environment happy-dom
import { TUTORIAL_STEPS, startTutorial } from '../../src/ui/tutorial';
import { Game } from '../../src/sim/game';
import { generateCandidates } from '../../src/sim/staff/market';

test('the tutorial waits for each step and moves on when it is done', () => {
  const g = Game.create({ seed: 3, terrain: 'parkland', difficulty: 'normal', size: 200 });
  const t = startTutorial(document.body, g);
  expect(t.step()).toBe(0);
  expect(document.body.textContent).toContain('Buy some land');
  // step 1: two parcels by the road
  const py = g.parcels.perSide - 1;
  g.dispatch({ t: 'buyParcel', px: 1, py });
  expect(t.step()).toBe(0);
  g.dispatch({ t: 'buyParcel', px: 2, py });
  expect(t.step()).toBe(1);
  // step 2: a hole (forced in here; the UI pens one)
  g.dispatch({ t: 'createCourse', name: 'C' });
  const c = g.courses.list[0]!;
  const h = g.courses.addHole(c.id, { route: [{ x: 75, y: 190 }, { x: 75, y: 160 }], greenCenter: { x: 75, y: 160 } });
  t.check();
  expect(t.step()).toBe(2);
  // step 3 needs the setPins command to have worked
  g.dispatch({ t: 'setPins', holeId: 9999, pins: [] });
  expect(t.step()).toBe(2);
  h.state = 'growingIn';
  g.events.emit('command', { cmd: { t: 'setPins', holeId: h.id, pins: [] }, ok: true });
  // pins done, and seeding is already done too: two steps at once
  expect(t.step()).toBe(4);
  const cand = generateCandidates(g, 'greenkeeper')[0]!;
  g.dispatch({ t: 'hireStaff', candidateId: cand.candidateId, courseId: c.id });
  expect(t.step()).toBe(5);
  g.buildings.push({ id: 99, kind: 'clubhouse', courseId: c.id, tier: 1, origin: { x: 0, y: 0 }, w: 1, h: 1, door: { x: 0, y: 0 } });
  h.state = 'open';
  g.events.emit('minute', { minute: 0 });
  expect(t.step()).toBe(TUTORIAL_STEPS.length);
  expect(document.body.textContent).toContain('Tutorial complete');
  t.close();
  expect(document.body.querySelector('.tutorial')).toBeNull();
});
