import type { Practice } from '../turf/practices';

export type RoleId =
  | 'superintendent' | 'assistantSuper' | 'greenkeeper' | 'irrigationTech' | 'sprayTech' | 'arborist' | 'mechanic'
  | 'generalManager' | 'starter' | 'marshal' | 'cartAttendant' | 'proShopStaff' | 'headPro' | 'fnbStaff' | 'chef';

export type SkillId = 'mowing' | 'greens' | 'bunkers' | 'irrigation' | 'spraying' | 'trees' | 'mechanics' | 'management' | 'sales' | 'teaching' | 'service' | 'cooking' | 'pace';
export const SKILLS: SkillId[] = ['mowing', 'greens', 'bunkers', 'irrigation', 'spraying', 'trees', 'mechanics', 'management', 'sales', 'teaching', 'service', 'cooking', 'pace'];

export type StaffTrait = 'earlyRiser' | 'perfectionist' | 'careless' | 'fast' | 'grumpy' | 'mentor' | 'loyal';
export const TRAITS: StaffTrait[] = ['earlyRiser', 'perfectionist', 'careless', 'fast', 'grumpy', 'mentor', 'loyal'];

export type Dept = 'maintenance' | 'operations' | 'proShop' | 'hospitality';

/** Building a role needs before it can be hired ('maintenance', 'proShop', 'restaurant' arrive in Tasks 30/34). */
export type RequiredBuilding = 'clubhouse' | 'maintenance' | 'proShop' | 'restaurant';

export interface RoleSpec {
  name: string;
  dept: Dept;
  baseWagePerDay: number;
  skills: SkillId[];
  practices?: Practice[];
  requires?: RequiredBuilding;
  /** default shift */
  shift: { startMin: number; endMin: number };
}

const EARLY = { startMin: 300, endMin: 810 }; // 05:00–13:30
const DAY = { startMin: 420, endMin: 1020 }; // 07:00–17:00

export const ROLES: Record<RoleId, RoleSpec> = {
  superintendent: { name: 'Superintendent', dept: 'maintenance', baseWagePerDay: 320, skills: ['management', 'greens', 'mowing', 'spraying'], shift: EARLY },
  assistantSuper: { name: 'Assistant superintendent', dept: 'maintenance', baseWagePerDay: 220, skills: ['management', 'greens', 'mowing'], practices: ['mow', 'roll', 'changeCup'], shift: EARLY },
  greenkeeper: { name: 'Greenkeeper', dept: 'maintenance', baseWagePerDay: 140, skills: ['mowing', 'greens', 'bunkers'], practices: ['mow', 'roll', 'rakeBunker', 'changeCup', 'fixDivots', 'moveTeeMarkers', 'handWater', 'topdress', 'aerate', 'fertilize'], shift: EARLY },
  irrigationTech: { name: 'Irrigation tech', dept: 'maintenance', baseWagePerDay: 190, skills: ['irrigation'], practices: ['handWater'], shift: EARLY },
  sprayTech: { name: 'Spray tech', dept: 'maintenance', baseWagePerDay: 200, skills: ['spraying'], practices: ['spray', 'fertilize'], requires: 'maintenance', shift: EARLY },
  arborist: { name: 'Arborist', dept: 'maintenance', baseWagePerDay: 180, skills: ['trees'], shift: DAY },
  mechanic: { name: 'Mechanic', dept: 'maintenance', baseWagePerDay: 200, skills: ['mechanics'], requires: 'maintenance', shift: DAY },
  generalManager: { name: 'General manager', dept: 'operations', baseWagePerDay: 380, skills: ['management', 'sales'], requires: 'clubhouse', shift: DAY },
  starter: { name: 'Starter', dept: 'operations', baseWagePerDay: 120, skills: ['pace', 'service'], requires: 'clubhouse', shift: { startMin: 330, endMin: 900 } },
  marshal: { name: 'Marshal', dept: 'operations', baseWagePerDay: 120, skills: ['pace'], requires: 'clubhouse', shift: { startMin: 420, endMin: 1140 } },
  cartAttendant: { name: 'Cart attendant', dept: 'operations', baseWagePerDay: 100, skills: ['service'], requires: 'clubhouse', shift: DAY },
  proShopStaff: { name: 'Pro shop staff', dept: 'proShop', baseWagePerDay: 120, skills: ['sales', 'service'], requires: 'proShop', shift: DAY },
  headPro: { name: 'Head pro', dept: 'proShop', baseWagePerDay: 300, skills: ['teaching', 'sales'], requires: 'proShop', shift: DAY },
  fnbStaff: { name: 'F&B staff', dept: 'hospitality', baseWagePerDay: 110, skills: ['service'], requires: 'restaurant', shift: { startMin: 600, endMin: 1200 } },
  chef: { name: 'Chef', dept: 'hospitality', baseWagePerDay: 220, skills: ['cooking'], requires: 'restaurant', shift: { startMin: 600, endMin: 1200 } },
};
export const ROLE_IDS = Object.keys(ROLES) as RoleId[];

/** Greenkeepers you can hire before there is a maintenance building (§7 starter crew). */
export const STARTER_CREW = 3;

/** Going rate for a role at a given average skill (0..100). */
export function marketWage(role: RoleId, skillAvg: number): number {
  return Math.round(ROLES[role].baseWagePerDay * (0.7 + (skillAvg / 100) * 0.8));
}
