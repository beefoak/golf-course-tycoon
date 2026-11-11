export type Segment = 'budget' | 'mid' | 'premium';
export type GolferType = 'casual' | 'regular' | 'competitive' | 'tourist' | 'junior' | 'senior' | 'corporate';
export const SEGMENTS: Segment[] = ['budget', 'mid', 'premium'];
export const GOLFER_TYPES: GolferType[] = ['casual', 'regular', 'competitive', 'tourist', 'junior', 'senior', 'corporate'];

/** Each trait is 0..1. */
export interface Traits {
  pace: number;
  challenge: number;
  aesthetics: number;
  loyalty: number;
  social: number;
  gear: number;
  food: number;
}

export interface Golfer {
  id: number;
  name: string;
  age: number;
  home: string;
  /** -4 (plus 4) .. 36 */
  handicap: number;
  segment: Segment;
  type: GolferType;
  traits: Traits;
  /** courseId → -100..100 */
  opinion: Record<number, number>;
  visits: number;
  totalSpend: number;
  lastVisitDay: number;
  memberOf: number | null;
  /** 0..100 satisfaction from the last round (undefined until they play) */
  lastSatisfaction?: number;
}

export function formatHandicap(h: number): string {
  const r = Math.round(h * 10) / 10;
  return r < 0 ? `+${Math.abs(r).toFixed(1)}` : r.toFixed(1);
}
