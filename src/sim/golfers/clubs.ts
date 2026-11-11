export type ClubId = 'D' | '3W' | '5W' | '4H' | '5I' | '6I' | '7I' | '8I' | '9I' | 'PW' | 'GW' | 'SW' | 'LW' | 'P';
export const CLUB_ORDER: ClubId[] = ['D', '3W', '5W', '4H', '5I', '6I', '7I', '8I', '9I', 'PW', 'GW', 'SW', 'LW', 'P'];

export interface ClubSpec {
  id: ClubId;
  /** metres */
  carryM: number;
  /** distance sd as a fraction of carry */
  sdDistPct: number;
  sdAngleDeg: number;
  launch: 'low' | 'mid' | 'high';
}

/** Carry as a fraction of the driver. */
const FRACTION: Record<ClubId, number> = {
  D: 1, '3W': 0.9, '5W': 0.84, '4H': 0.78, '5I': 0.72, '6I': 0.67, '7I': 0.62, '8I': 0.57, '9I': 0.52,
  PW: 0.47, GW: 0.42, SW: 0.36, LW: 0.29, P: 0,
};
const LAUNCH: Record<ClubId, ClubSpec['launch']> = {
  D: 'mid', '3W': 'mid', '5W': 'mid', '4H': 'mid', '5I': 'mid', '6I': 'mid', '7I': 'high', '8I': 'high', '9I': 'high',
  PW: 'high', GW: 'high', SW: 'high', LW: 'high', P: 'low',
};

export const SCRATCH_DRIVER_M = 230;

/** Driver carry from handicap and age; every other club is a fixed fraction of it. */
export function driverCarry(handicap: number, age: number): number {
  let d = SCRATCH_DRIVER_M - 2.2 * handicap;
  if (age >= 60) d *= 0.88;
  if (age < 18) d *= 0.8;
  return d;
}

/** The golfer's bag, ordered by carry (longest first, putter last). */
export function clubSet(handicap: number, age: number): ClubSpec[] {
  const d = driverCarry(handicap, age);
  const h = Math.max(0, handicap);
  return CLUB_ORDER.map(id => ({
    id,
    carryM: Math.round(d * FRACTION[id] * 10) / 10,
    sdDistPct: 0.04 + 0.006 * h,
    sdAngleDeg: 2 + 0.22 * h,
    launch: LAUNCH[id],
  }));
}

/** True if `a` is a longer club than `b` (D longest). */
export function longerThan(a: ClubId, b: ClubId): boolean {
  return CLUB_ORDER.indexOf(a) < CLUB_ORDER.indexOf(b);
}
