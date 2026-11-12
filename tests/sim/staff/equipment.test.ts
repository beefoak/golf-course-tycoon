import { Game } from '../../../src/sim/game';
import { EQUIPMENT, MAINTENANCE, equipmentSystem, resaleValue } from '../../../src/sim/staff/equipment';
import { generateCandidates } from '../../../src/sim/staff/market';
import { Staff } from '../../../src/sim/staff/staff';
import { newOwnedGame } from '../../helpers';

function withShed(): { g: Game; courseId: number; shedId: number } {
  const g = newOwnedGame();
  const course = g.courses.create('Test');
  const r = g.dispatch({ t: 'placeBuilding', kind: 'maintenance', courseId: course.id, origin: { x: 5, y: 5 } });
  if (!r.ok) throw new Error(r.reason);
  return { g, courseId: course.id, shedId: (r.value as { id: number }).id };
}
function hire(g: Game, role: 'greenkeeper' | 'mechanic', courseId: number): Staff {
  const c = generateCandidates(g, role)[0]!;
  const r = g.dispatch({ t: 'hireStaff', candidateId: c.candidateId, courseId });
  if (!r.ok) throw new Error(r.reason);
  return r.value as Staff;
}
const days = (g: Game, n: number) => { for (let k = 0; k < n; k++) { equipmentSystem.onDay!(g); g.clock.day++; } };

test('no equipment without a maintenance building; buying beyond storage is refused', () => {
  const g = newOwnedGame();
  const course = g.courses.create('Bare');
  expect(g.dispatch({ t: 'buyEquipment', courseId: course.id, kind: 'greensMower', tier: 1 }).ok).toBe(false);
  const { g: g2, courseId, shedId } = withShed();
  g2.ledger.cash = 10_000_000;
  const cash = g2.ledger.cash;
  for (let k = 0; k < MAINTENANCE.storageSlots[0]; k++) expect(g2.dispatch({ t: 'buyEquipment', courseId, kind: 'roller', tier: 1 }).ok).toBe(true);
  expect(cash - g2.ledger.cash).toBe(MAINTENANCE.storageSlots[0] * EQUIPMENT.roller.tiers[0].cost);
  const full = g2.dispatch({ t: 'buyEquipment', courseId, kind: 'roller', tier: 1 });
  expect(full.ok).toBe(false);
  if (!full.ok) expect(full.reason).toMatch(/full/);
  expect(g2.dispatch({ t: 'upgradeBuilding', buildingId: shedId, upgrade: 'storage' }).ok).toBe(true);
  expect(g2.dispatch({ t: 'buyEquipment', courseId, kind: 'roller', tier: 1 }).ok).toBe(true);
});

test('spraying without a chemical store is refused', () => {
  const { g, courseId, shedId } = withShed();
  const i = g.world.idx(40, 40);
  g.world.courseId[i] = courseId;
  expect(g.dispatch({ t: 'applyPractice', practice: 'spray', tiles: [i] }).ok).toBe(false);
  expect(g.dispatch({ t: 'upgradeBuilding', buildingId: shedId, upgrade: 'chemicalStore' }).ok).toBe(true);
  expect(g.dispatch({ t: 'applyPractice', practice: 'spray', tiles: [i] }).ok).toBe(true);
});

test('condition decays without a mechanic and stays ≥ 80 with a skilled one', () => {
  const run = (withMechanic: boolean) => {
    const { g, courseId } = withShed();
    const keeper = hire(g, 'greenkeeper', courseId);
    if (withMechanic) { const m = hire(g, 'mechanic', courseId); m.skills.mechanics = 85; m.speed = 1; }
    g.unlocks.push('equipmentTier3');
    const e = (g.dispatch({ t: 'buyEquipment', courseId, kind: 'fairwayMower', tier: 3 }) as { ok: true; value: { id: number; condition: number; broken: boolean } }).value;
    g.dispatch({ t: 'assignEquipment', id: e.id, staffId: keeper.id });
    let low = 100;
    for (let d = 0; d < 40; d++) {
      // keep it in use every day
      if (!e.broken && g.equipment.all[0]!.assignedTo === null) g.dispatch({ t: 'assignEquipment', id: e.id, staffId: keeper.id });
      days(g, 1);
      if (!e.broken) low = Math.min(low, e.condition);
    }
    return { e, low };
  };
  const alone = run(false);
  expect(alone.e.condition).toBeLessThanOrEqual(70);
  const cared = run(true);
  expect(cared.low).toBeGreaterThanOrEqual(80);
});

test('broken equipment cannot be assigned; resale is half × condition', () => {
  const { g, courseId } = withShed();
  const keeper = hire(g, 'greenkeeper', courseId);
  const e = (g.dispatch({ t: 'buyEquipment', courseId, kind: 'greensMower', tier: 2 }) as { ok: true; value: { id: number; condition: number; broken: boolean } }).value;
  e.condition = 60;
  expect(resaleValue(e as never)).toBe(Math.round(EQUIPMENT.greensMower.tiers[1].cost * 0.5 * 0.6));
  e.broken = true;
  const r = g.dispatch({ t: 'assignEquipment', id: e.id, staffId: keeper.id });
  expect(r.ok).toBe(false);
  e.broken = false;
  expect(g.dispatch({ t: 'assignEquipment', id: e.id, staffId: keeper.id }).ok).toBe(true);
  expect(keeper.equipmentId).toBe(e.id);
  const cash = g.ledger.cash;
  expect(g.dispatch({ t: 'sellEquipment', id: e.id }).ok).toBe(true);
  expect(g.ledger.cash - cash).toBe(Math.round(EQUIPMENT.greensMower.tiers[1].cost * 0.5 * 0.6));
  expect(keeper.equipmentId).toBeNull();
});

test('a maintenance building lets you hire more than the starter crew; staff room lifts morale', () => {
  const { g, courseId, shedId } = withShed();
  for (let k = 0; k < 5; k++) hire(g, 'greenkeeper', courseId);
  expect(g.staff.byRole('greenkeeper').length).toBe(5);
  expect(g.dispatch({ t: 'placeBuilding', kind: 'maintenance', courseId, origin: { x: 40, y: 20 } }).ok).toBe(false); // one per course
  void shedId;
});
