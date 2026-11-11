import { Game } from '../../../src/sim/game';
import { Grass } from '../../../src/sim/turf/grasses';
import { createGroup } from '../../../src/sim/golfers/groups';
import { CREW_PAUSE_TILES, staffActivity, staffAgentSystem } from '../../../src/sim/staff/agents';
import { generateCandidates } from '../../../src/sim/staff/market';
import { RoleId } from '../../../src/sim/staff/roles';
import { Staff } from '../../../src/sim/staff/staff';
import { WorkOrder } from '../../../src/sim/staff/workOrders';
import { Surface } from '../../../src/sim/world/tiles';
import { addClubhouse, spawnGolfers, threeHoleCourse } from '../golfers/courseFixture';

function hire(g: Game, role: RoleId, courseId: number): Staff {
  const c = generateCandidates(g, role).find(x => !g.staff.hiredCandidates.has(x.candidateId))!;
  const r = g.dispatch({ t: 'hireStaff', candidateId: c.candidateId, courseId });
  if (!r.ok) throw new Error(r.reason);
  return r.value as Staff;
}

/** A green-mowing order on hole 1 handed straight to someone. */
function greenOrder(g: Game, courseId: number, holeId: number, staffId: number): WorkOrder {
  const w = g.world;
  const tiles: number[] = [];
  for (let i = 0; i < w.surface.length; i++) {
    if (w.holeId[i] === holeId && w.surface[i] === Surface.Green) { tiles.push(i); w.grass[i] = Grass.Bent; w.mowHeight[i] = 60; }
  }
  const o: WorkOrder = {
    id: g.workOrders.nextId++, courseId, practice: 'mow', surface: Surface.Green, holeId, tiles, zone: null, priority: 1, due: g.day,
    laborHours: 1, status: 'assigned', urgent: false, params: { mowMm: 3 }, assignedTo: staffId, progress: 0,
  };
  g.workOrders.all.push(o);
  return o;
}

test('a greenkeeper on the 05:00 shift reaches the green and mows it before the first tee time', () => {
  const { g, course, holes } = threeHoleCourse();
  const gk = hire(g, 'greenkeeper', course.id);
  gk.speed = 1; gk.skills.mowing = 60; gk.morale = 80; gk.traits = [];
  g.equipment.all.push({ id: g.equipment.nextId++, courseId: course.id, kind: 'greensMower', tier: 1, condition: 100, broken: false, assignedTo: null, hoursToday: 0 });
  const o = greenOrder(g, course.id, holes[0]!.id, gk.id);
  expect(g.clock.minuteOfDay).toBe(300);
  while (o.status !== 'done' && g.clock.minuteOfDay < 360) g.tick();
  expect(o.status).toBe('done');
  expect(g.clock.minuteOfDay).toBeLessThan(360);
  // cut to 3.0 mm (a few tenths of regrowth since is fine; it started at 6.0)
  for (const i of o.tiles) { expect(g.world.mowHeight[i]).toBeGreaterThanOrEqual(30); expect(g.world.mowHeight[i]).toBeLessThan(33); }
  // the machine went back on the shelf
  expect(gk.equipmentId).toBeNull();
  expect(g.equipment.all[0]!.hoursToday).toBeGreaterThan(0);
});

test('the crew stands aside while a group is close, and the group grumbles once', () => {
  const { g, course, holes } = threeHoleCourse();
  const gk = hire(g, 'greenkeeper', course.id);
  const o = greenOrder(g, course.id, holes[0]!.id, gk.id);
  gk.pos = { x: holes[0]!.greenCenter.x + 0.5, y: holes[0]!.greenCenter.y + 0.5 };
  const grp = createGroup(g, course.id, spawnGolfers(g, 2), g.day, 900);
  grp.started = true; grp.phase = 'walkingToBall';
  grp.pos = { ...holes[0]!.greenCenter }; // every green tile is within reach
  for (let k = 0; k < 50; k++) staffAgentSystem.onTick!(g);
  expect(o.progress).toBe(0);
  expect(gk.agent!.waiting).toBe(true);
  expect(staffActivity(g, gk)).toMatch(/Waiting/);
  const grumbles = (g.roundThoughts.get(grp.id) ?? []).filter(t => t.key === 'crewInWay');
  expect(grumbles.length).toBe(2);
  // the group moves on: work resumes
  grp.pos = { x: gk.pos.x + CREW_PAUSE_TILES * 2, y: gk.pos.y };
  for (let k = 0; k < 50; k++) staffAgentSystem.onTick!(g);
  expect(o.progress).toBeGreaterThan(0);
  expect(gk.agent!.waiting).toBe(false);
});

test('a marshal cuts the waiting on a congested course', () => {
  const run = (marshal: boolean) => {
    const { g, course } = threeHoleCourse();
    addClubhouse(g, course);
    if (marshal) hire(g, 'marshal', course.id);
    g.clock.minuteOfDay = 420; // marshal shift starts at 07:00
    const groups = Array.from({ length: 6 }, (_, k) => createGroup(g, course.id, spawnGolfers(g, 4, k + 1), g.day, 421 + k * 2));
    let rounds = 0;
    g.events.on('roundComplete', () => rounds++);
    let n = 0;
    while (rounds < groups.length && n++ < 60000) g.tick();
    expect(rounds).toBe(groups.length);
    return groups.reduce((s, x) => s + x.waitingMin, 0) / groups.length;
  };
  const without = run(false), withMarshal = run(true);
  expect(without).toBeGreaterThan(0);
  expect(withMarshal).toBeLessThan(without);
});

test('off shift the crew heads home and puts machines away', () => {
  const { g, course } = threeHoleCourse();
  const gk = hire(g, 'greenkeeper', course.id);
  gk.shift = { startMin: 300, endMin: 301 };
  gk.pos = { x: 60, y: 200 };
  for (let k = 0; k < 2000; k++) g.tick();
  expect(staffActivity(g, gk)).toBe('Off shift');
  expect(Math.hypot(gk.pos.x - 150, gk.pos.y - 150)).toBeLessThan(2);
});
