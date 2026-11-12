import { Result, fail, ok } from '../../core/result';
import { Building } from '../business/buildings';
import type { Game, System } from '../game';
import { registerSaveable } from '../saveRegistry';
import type { Practice } from '../turf/practices';
import { moraleHooks } from './morale';
import { Staff } from './staff';

export type EquipmentKind = 'greensMower' | 'teeMower' | 'fairwayMower' | 'roughMower' | 'roller' | 'aerator' | 'sprayer' | 'bunkerRake' | 'utilityVehicle' | 'topdresser';

export interface EquipmentTier { cost: number; tilesPerHour: number; breakdownPerDay: number; fuelPerHour: number }
export interface EquipmentSpec { name: string; practice: Practice; tiers: [EquipmentTier, EquipmentTier, EquipmentTier] }

const T = (cost: number, tilesPerHour: number, breakdownPerDay: number, fuelPerHour: number): EquipmentTier => ({ cost, tilesPerHour, breakdownPerDay, fuelPerHour });

export const EQUIPMENT: Record<EquipmentKind, EquipmentSpec> = {
  greensMower: { name: 'Greens mower', practice: 'mow', tiers: [T(9_000, 500, 0.02, 4), T(28_000, 1100, 0.012, 6), T(55_000, 1800, 0.006, 7)] },
  teeMower: { name: 'Tee mower', practice: 'mow', tiers: [T(8_000, 600, 0.02, 4), T(24_000, 1200, 0.012, 6), T(48_000, 2000, 0.006, 7)] },
  fairwayMower: { name: 'Fairway mower', practice: 'mow', tiers: [T(30_000, 2500, 0.02, 10), T(65_000, 4500, 0.012, 14), T(110_000, 7000, 0.006, 16)] },
  roughMower: { name: 'Rough mower', practice: 'mow', tiers: [T(25_000, 3000, 0.02, 10), T(55_000, 5500, 0.012, 14), T(95_000, 8500, 0.006, 16)] },
  roller: { name: 'Greens roller', practice: 'roll', tiers: [T(7_000, 900, 0.015, 3), T(16_000, 1600, 0.01, 4), T(30_000, 2500, 0.005, 5)] },
  aerator: { name: 'Aerator', practice: 'aerate', tiers: [T(15_000, 400, 0.03, 6), T(35_000, 900, 0.02, 8), T(70_000, 1600, 0.01, 9)] },
  sprayer: { name: 'Sprayer', practice: 'spray', tiers: [T(12_000, 1500, 0.02, 5), T(30_000, 3000, 0.012, 7), T(60_000, 5000, 0.006, 8)] },
  bunkerRake: { name: 'Bunker rake', practice: 'rakeBunker', tiers: [T(14_000, 300, 0.02, 4), T(26_000, 600, 0.012, 5), T(45_000, 1000, 0.006, 6)] },
  utilityVehicle: { name: 'Utility vehicle', practice: 'fixDivots', tiers: [T(10_000, 4000, 0.015, 4), T(20_000, 6000, 0.01, 5), T(35_000, 9000, 0.005, 6)] },
  topdresser: { name: 'Topdresser', practice: 'topdress', tiers: [T(18_000, 600, 0.02, 5), T(38_000, 1200, 0.012, 7), T(65_000, 2000, 0.006, 8)] },
};
export const EQUIPMENT_KINDS = Object.keys(EQUIPMENT) as EquipmentKind[];
/** Push mowers, hand rakes and the like: always available, at a quarter of tier-1 speed. */
export const HAND_TOOL_RATE = 0.25;

export interface Equipment {
  id: number;
  courseId: number;
  kind: EquipmentKind;
  tier: 1 | 2 | 3;
  condition: number;
  broken: boolean;
  assignedTo: number | null;
  /** hours of work today (agents add; fuel is charged and it resets nightly) */
  hoursToday: number;
}

export interface Fleet { all: Equipment[]; nextId: number }
export function newFleet(): Fleet { return { all: [], nextId: 1 }; }

// --- maintenance building and its upgrades ---
export type MaintenanceUpgrade = 'storage' | 'workshop' | 'staffRoom' | 'chemicalStore';
export const MAINTENANCE = {
  storageSlots: [20, 40] as const,
  upgradeCost: { storage: 80_000, workshop: 120_000, staffRoom: 60_000, chemicalStore: 45_000 } as Record<MaintenanceUpgrade, number>,
};

export function maintenanceOf(g: Game, courseId: number): Building | undefined {
  return g.buildings.find(b => b.kind === 'maintenance' && b.courseId === courseId);
}
export function hasUpgrade(b: Building | undefined, u: MaintenanceUpgrade): boolean {
  return !!b?.upgrades?.includes(u);
}
export function storageSlots(g: Game, courseId: number): number {
  const b = maintenanceOf(g, courseId);
  if (!b) return 0;
  return MAINTENANCE.storageSlots[hasUpgrade(b, 'storage') ? 1 : 0];
}

export function upgradeBuilding(g: Game, buildingId: number, upgrade: MaintenanceUpgrade): Result {
  const b = g.buildings.find(x => x.id === buildingId);
  if (!b) return fail('No such building');
  if (b.kind !== 'maintenance') return fail('Only the maintenance building has these upgrades');
  if (!(upgrade in MAINTENANCE.upgradeCost)) return fail('Unknown upgrade');
  if (hasUpgrade(b, upgrade)) return fail('Already built');
  const cost = MAINTENANCE.upgradeCost[upgrade];
  if (!g.ledger.spend(cost, 'construction', g.day, b.courseId)) return fail(`Not enough money ($${cost.toLocaleString()} needed)`);
  b.upgrades = [...(b.upgrades ?? []), upgrade];
  return ok(undefined);
}

/** Spraying chemicals needs a chemical store on the maintenance building. */
export function sprayAllowed(g: Game, courseId: number): boolean {
  return hasUpgrade(maintenanceOf(g, courseId), 'chemicalStore');
}

// --- fleet ---
export function buyEquipment(g: Game, courseId: number, kind: EquipmentKind, tier: 1 | 2 | 3): Result<Equipment> {
  const spec = EQUIPMENT[kind];
  if (!spec) return fail('Unknown equipment');
  if (tier !== 1 && tier !== 2 && tier !== 3) return fail('Tier must be 1–3');
  const slots = storageSlots(g, courseId);
  if (!slots) return fail('Build a maintenance building to store equipment');
  const owned = g.equipment.all.filter(e => e.courseId === courseId).length;
  if (owned >= slots) return fail(`The maintenance building is full (${slots} slots)${slots < MAINTENANCE.storageSlots[1] ? ' — upgrade its storage' : ''}`);
  const cost = spec.tiers[tier - 1]!.cost;
  if (!g.ledger.spend(cost, 'equipment', g.day, courseId)) return fail(`Not enough money ($${cost.toLocaleString()} needed)`);
  const e: Equipment = { id: g.equipment.nextId++, kind, tier, condition: 100, broken: false, assignedTo: null, hoursToday: 0, courseId };
  g.equipment.all.push(e);
  return ok(e);
}

/** Resale: half the price, scaled by condition. */
export function resaleValue(e: Equipment): number {
  return Math.round(EQUIPMENT[e.kind].tiers[e.tier - 1]!.cost * 0.5 * (e.condition / 100) * (e.broken ? 0.5 : 1));
}

export function sellEquipment(g: Game, id: number): Result<number> {
  const e = g.equipment.all.find(x => x.id === id);
  if (!e) return fail('No such equipment');
  const value = resaleValue(e);
  g.ledger.earn(value, 'equipment', g.day, e.courseId);
  if (e.assignedTo !== null) { const s = g.staff.get(e.assignedTo); if (s) s.equipmentId = null; }
  g.equipment.all = g.equipment.all.filter(x => x !== e);
  return ok(value);
}

export function assignEquipment(g: Game, equipmentId: number, staffId: number | null): Result {
  const e = g.equipment.all.find(x => x.id === equipmentId);
  if (!e) return fail('No such equipment');
  if (staffId !== null) {
    if (e.broken) return fail(`The ${EQUIPMENT[e.kind].name.toLowerCase()} is broken — a mechanic has to fix it first`);
    const s = g.staff.get(staffId);
    if (!s) return fail('No such staff member');
    if (s.courseId !== e.courseId) return fail('That equipment belongs to another course');
    // one machine per person
    for (const o of g.equipment.all) if (o.assignedTo === staffId) o.assignedTo = null;
    s.equipmentId = e.id;
  }
  if (e.assignedTo !== null) { const prev = g.staff.get(e.assignedTo); if (prev && prev.equipmentId === e.id) prev.equipmentId = null; }
  e.assignedTo = staffId;
  return ok(undefined);
}

/** Work rate (tiles/hour) for a practice: the best working machine in hand, else hand tools. */
export function workRate(g: Game, s: Staff, practice: Practice): number {
  const e = s.equipmentId !== null ? g.equipment.all.find(x => x.id === s.equipmentId) : undefined;
  if (e && !e.broken && EQUIPMENT[e.kind].practice === practice) return EQUIPMENT[e.kind].tiers[e.tier - 1]!.tilesPerHour;
  const base = EQUIPMENT_KINDS.filter(k => EQUIPMENT[k].practice === practice).map(k => EQUIPMENT[k].tiers[0].tilesPerHour);
  return (base.length ? Math.min(...base) : 400) * HAND_TOOL_RATE;
}

export const equipmentSystem: System = {
  name: 'equipment',
  onDay(g) {
    const fleet = g.equipment.all;
    // fuel for yesterday's hours
    for (const e of fleet) {
      const fuel = e.hoursToday * EQUIPMENT[e.kind].tiers[e.tier - 1]!.fuelPerHour;
      if (fuel) g.ledger.charge(fuel, 'supplies', g.day, e.courseId);
    }
    // wear and breakdowns on machines in use
    for (const e of fleet) {
      const used = e.assignedTo !== null || e.hoursToday > 0;
      e.hoursToday = 0;
      if (!used || e.broken) continue;
      const p = EQUIPMENT[e.kind].tiers[e.tier - 1]!.breakdownPerDay * (1 + (100 - e.condition) / 50);
      e.condition = Math.max(0, e.condition - 1);
      if (g.staffRng.chance(p)) {
        e.broken = true;
        if (e.assignedTo !== null) { const s = g.staff.get(e.assignedTo); if (s) s.equipmentId = null; e.assignedTo = null; }
        g.notify('warn', `A ${EQUIPMENT[e.kind].name.toLowerCase()} broke down`);
      }
    }
    // mechanics: fix broken machines first, then lift the worst condition
    const courses = new Set(fleet.map(e => e.courseId));
    for (const cid of courses) {
      const mechanics = g.staff.all.filter(s => s.role === 'mechanic' && s.courseId === cid && s.trainingUntilDay <= g.day);
      if (!mechanics.length) continue;
      const shop = hasUpgrade(maintenanceOf(g, cid), 'workshop') ? 1.5 : 1;
      let points = mechanics.reduce((a, m) => a + ((m.skills.mechanics ?? 20) / 10) * m.speed * shop * 4, 0);
      const mine = fleet.filter(e => e.courseId === cid);
      for (const e of mine.filter(x => x.broken)) {
        if (points < 15) break;
        points -= 15; e.broken = false; e.condition = Math.max(e.condition, 50);
      }
      while (points > 0) {
        const worst = mine.filter(x => !x.broken && x.condition < 100).sort((a, b) => a.condition - b.condition)[0];
        if (!worst) break;
        const add = Math.min(points, 100 - worst.condition, 5);
        worst.condition += add; points -= add;
      }
    }
  },
};

export function attachEquipment(g: Game): void {
  g.registerSystem(equipmentSystem);
  moraleHooks.equipment = (gm, s) => {
    const e = s.equipmentId !== null ? gm.equipment.all.find(x => x.id === s.equipmentId) : undefined;
    if (!e) return 0;
    return e.condition < 40 ? -1 : 0;
  };
  // a staff room lifts everyone's settled morale by 10 (drift is 5%/day of the gap)
  moraleHooks.staffRoom = (gm, s) => (hasUpgrade(maintenanceOf(gm, s.courseId), 'staffRoom') ? 0.5 : 0);
}

registerSaveable({
  key: 'equipment',
  save: g => g.equipment,
  load: (g, d) => { g.equipment = d as Fleet; },
});
