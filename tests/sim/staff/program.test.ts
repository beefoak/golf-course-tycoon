import { Game } from '../../../src/sim/game';
import { generateCandidates } from '../../../src/sim/staff/market';
import { defaultRules, programFor, ruleDue } from '../../../src/sim/staff/program';
import { RoleId } from '../../../src/sim/staff/roles';
import { Staff, shiftHours } from '../../../src/sim/staff/staff';
import { assignOrders, generateDailyOrders, holeRanges, shortfallReport } from '../../../src/sim/staff/workOrders';
import { Surface } from '../../../src/sim/world/tiles';
import { newOwnedGame } from '../../helpers';

/** N compact open holes in 50×50 cells: tee 5×3, fairway 20×8, green 10×10, bunker 3×3. */
export function blockCourse(n: number): { g: Game; courseId: number; holeIds: number[] } {
  const parcels: [number, number][] = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) parcels.push([x, y]);
  const g = newOwnedGame({ size: 300, parcels });
  const course = g.courses.create('Blocks');
  const w = g.world;
  const holeIds: number[] = [];
  const paint = (x0: number, y0: number, wdt: number, ht: number, s: Surface, hid: number) => {
    for (let y = y0; y < y0 + ht; y++) for (let x = x0; x < x0 + wdt; x++) { const i = w.idx(x, y); w.surface[i] = s; w.holeId[i] = hid; w.courseId[i] = course.id; }
  };
  for (let k = 0; k < n; k++) {
    const ox = (k % 6) * 50, oy = Math.floor(k / 6) * 50;
    const h = g.courses.addHole(course.id, { route: [{ x: ox + 5, y: oy + 25 }, { x: ox + 40, y: oy + 25 }], greenCenter: { x: ox + 40, y: oy + 25 }, state: 'open', pins: [{ x: ox + 40, y: oy + 25 }] });
    paint(ox + 3, oy + 24, 5, 3, Surface.Tee, h.id);
    paint(ox + 12, oy + 21, 20, 8, Surface.Fairway, h.id);
    paint(ox + 35, oy + 20, 10, 10, Surface.Green, h.id);
    paint(ox + 36, oy + 31, 3, 3, Surface.Bunker, h.id);
    holeIds.push(h.id);
  }
  return { g, courseId: course.id, holeIds };
}
function hire(g: Game, role: RoleId, courseId: number): Staff {
  const c = generateCandidates(g, role).find(x => !g.staff.hiredCandidates.has(x.candidateId))!;
  const r = g.dispatch({ t: 'hireStaff', candidateId: c.candidateId, courseId });
  if (!r.ok) throw new Error(r.reason);
  return r.value as Staff;
}

test('frequencies spread evenly through the week', () => {
  for (const r of defaultRules()) {
    let n = 0;
    for (let d = 1; d <= 112; d++) if (ruleDue(r, d)) n++;
    expect(n).toBe(Math.round(r.frequency.perWeek * 16));
  }
});

test('the default program on a 3-hole course creates the expected order set over a week', () => {
  const { g, courseId } = blockCourse(3);
  const sup = hire(g, 'superintendent', courseId);
  sup.skills.management = 0;
  const count = new Map<string, number>();
  for (let d = 1; d <= 7; d++) {
    g.clock.day = d;
    for (const o of generateDailyOrders(g, courseId)) count.set(`${o.practice}:${o.surface}`, (count.get(`${o.practice}:${o.surface}`) ?? 0) + 1);
  }
  // per hole: greens mowed 7×, cups 7×, fairways 3×, bunkers 7×, greens rolled 3×, tees 3×; no rough/fringe tiles here
  expect(count.get(`mow:${Surface.Green}`)).toBe(21);
  expect(count.get(`changeCup:${Surface.Green}`)).toBe(21);
  expect(count.get(`mow:${Surface.Fairway}`)).toBe(9);
  expect(count.get(`rakeBunker:${Surface.Bunker}`)).toBe(21);
  expect(count.get(`roll:${Surface.Green}`)).toBe(9);
  expect(count.get(`mow:${Surface.Tee}`)).toBe(9);
  expect(count.get(`fixDivots:${Surface.Fairway}`)).toBe(6);
  expect(count.has(`mow:${Surface.Rough}`)).toBe(false);
  // labour comes from tiles ÷ rate (hand tools here)
  const o = g.workOrders.all.find(x => x.practice === 'mow' && x.surface === Surface.Green)!;
  expect(o.laborHours).toBeCloseTo(100 / (500 * 0.25), 2);
});

test('with no superintendent only priority-1 orders are generated', () => {
  const { g, courseId } = blockCourse(3);
  hire(g, 'greenkeeper', courseId);
  const orders = generateDailyOrders(g, courseId);
  expect(orders.length).toBeGreaterThan(0);
  expect(orders.every(o => o.priority === 1)).toBe(true);
  expect(orders.some(o => o.practice === 'rakeBunker')).toBe(false);
});

test('a superintendent cuts labour by up to 20%', () => {
  const a = blockCourse(1), b = blockCourse(1);
  const s1 = hire(a.g, 'superintendent', a.courseId); s1.skills.management = 0;
  const s2 = hire(b.g, 'superintendent', b.courseId); s2.skills.management = 100;
  const h1 = generateDailyOrders(a.g, a.courseId).reduce((s, o) => s + o.laborHours, 0);
  const h2 = generateDailyOrders(b.g, b.courseId).reduce((s, o) => s + o.laborHours, 0);
  expect(h2 / h1).toBeCloseTo(0.8, 1);
});

test('1 greenkeeper on 18 holes: the shortfall report names skipped bunker raking and hours short', () => {
  const { g, courseId } = blockCourse(18);
  hire(g, 'superintendent', courseId);
  const gk = hire(g, 'greenkeeper', courseId);
  gk.speed = 1;
  generateDailyOrders(g, courseId);
  assignOrders(g, courseId);
  const rep = shortfallReport(g, courseId, g.day);
  expect(rep.hoursShort).toBeGreaterThan(5);
  const line = rep.text.find(t => t.startsWith('Bunkers'));
  expect(line).toBeDefined();
  expect(line).toMatch(/Bunkers on 1–18 not raked: \d+ labour-hours? short/);
  // what was assigned fits in the shift
  const assigned = g.workOrders.all.filter(o => o.assignedTo === gk.id).reduce((s, o) => s + o.laborHours, 0);
  expect(assigned).toBeLessThanOrEqual(shiftHours(gk) + 1e-9);
  // the next rollover turns leftovers into skipped orders with a reason
  const day = g.day;
  g.clock.day++;
  const sys = (g as unknown as { systems: { name: string; onDay?: (g: Game) => void }[] }).systems.find(s => s.name === 'program')!;
  sys.onDay!(g);
  expect(shortfallReport(g, courseId, day).skipped.every(o => o.status === 'skipped' && !!o.skipReason)).toBe(true);
});

test('urgent orders are assigned first', () => {
  const { g, courseId } = blockCourse(18);
  hire(g, 'superintendent', courseId);
  const gk = hire(g, 'greenkeeper', courseId);
  generateDailyOrders(g, courseId);
  assignOrders(g, courseId);
  const before = g.workOrders.all.filter(o => o.assignedTo === gk.id).length;
  expect(before).toBeGreaterThan(0);
  // reset the plan and add an urgent hand-watering job: it must be taken first
  for (const o of g.workOrders.all) { o.status = 'open'; o.assignedTo = null; }
  const tiles = Array.from({ length: 300 }, (_, k) => g.world.idx(100 + (k % 20), 120 + Math.floor(k / 20)));
  const r = g.dispatch({ t: 'createUrgentOrder', courseId, practice: 'handWater', tiles });
  expect(r.ok).toBe(true);
  const urgent = g.workOrders.all.find(o => o.urgent)!;
  expect(urgent.status).toBe('assigned');
  expect(urgent.assignedTo).toBe(gk.id);
});

test('zone assignment restricts who takes an order', () => {
  const { g, courseId, holeIds } = blockCourse(4);
  hire(g, 'superintendent', courseId);
  const front = hire(g, 'greenkeeper', courseId), back = hire(g, 'greenkeeper', courseId);
  const z1 = g.dispatch({ t: 'createZone', courseId, name: 'Front', holeIds: holeIds.slice(0, 2) });
  const z2 = g.dispatch({ t: 'createZone', courseId, name: 'Back', holeIds: holeIds.slice(2) });
  g.dispatch({ t: 'assignZone', staffId: front.id, zone: (z1 as { ok: true; value: { id: number } }).value.id });
  g.dispatch({ t: 'assignZone', staffId: back.id, zone: (z2 as { ok: true; value: { id: number } }).value.id });
  generateDailyOrders(g, courseId);
  assignOrders(g, courseId);
  for (const o of g.workOrders.all.filter(x => x.status === 'assigned')) {
    const idx = holeIds.indexOf(o.holeId);
    expect(o.assignedTo).toBe(idx < 2 ? front.id : back.id);
  }
  expect(programFor(g, courseId).zones.length).toBe(2);
});

test('hole ranges read naturally', () => {
  expect(holeRanges([10, 11, 12, 1, 2, 3, 7, 18, 17, 16, 15, 14, 13])).toBe('1–3, 7, 10–18');
});

test('a crew hired mid-day gets today’s plan within a few minutes, once', () => {
  const { g, courseId } = blockCourse(2);
  for (let k = 0; k < 10 * 10; k++) g.tick();
  expect(g.workOrders.all.length).toBe(0);
  hire(g, 'greenkeeper', courseId);
  for (let k = 0; k < 6 * 10; k++) g.tick();
  const today = g.workOrders.all.filter(o => o.due === g.day);
  expect(today.length).toBeGreaterThan(0);
  expect(today.some(o => o.status === 'assigned')).toBe(true);
  for (let k = 0; k < 30 * 10; k++) g.tick();
  expect(g.workOrders.all.filter(o => o.due === g.day).length).toBe(today.length);
});
