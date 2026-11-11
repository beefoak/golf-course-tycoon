import { Rng } from '../../core/rng';
import { GOLFER_TYPES, Golfer, GolferType, SEGMENTS, Segment, Traits } from './golfer';
import { FIRST_NAMES, LAST_NAMES, TOWNS } from './names';

/** Population mix (weights) by type and segment. */
const TYPE_WEIGHTS: Record<GolferType, number> = { casual: 30, regular: 25, competitive: 10, tourist: 10, junior: 7, senior: 12, corporate: 6 };
const SEGMENT_WEIGHTS: Record<GolferType, Record<Segment, number>> = {
  casual: { budget: 50, mid: 40, premium: 10 },
  regular: { budget: 30, mid: 50, premium: 20 },
  competitive: { budget: 20, mid: 45, premium: 35 },
  tourist: { budget: 20, mid: 45, premium: 35 },
  junior: { budget: 60, mid: 35, premium: 5 },
  senior: { budget: 35, mid: 45, premium: 20 },
  corporate: { budget: 0, mid: 30, premium: 70 },
};

function weighted<T extends string>(rng: Rng, w: Record<T, number>): T {
  const keys = Object.keys(w) as T[];
  let total = 0;
  for (const k of keys) total += w[k];
  let r = rng.next() * total;
  for (const k of keys) { r -= w[k]; if (r < 0) return k; }
  return keys[keys.length - 1]!;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clampHcp = (v: number) => Math.max(-4, Math.min(36, Math.round(v * 10) / 10));

function ageFor(rng: Rng, type: GolferType): number {
  switch (type) {
    case 'junior': return rng.int(10, 17);
    case 'senior': return rng.int(60, 84);
    case 'corporate': return rng.int(28, 59);
    case 'competitive': return rng.int(18, 55);
    default: return rng.int(18, 59);
  }
}

/**
 * Handicap ~ N(16, 8) for most adults. Competitive N(8, 5), juniors N(22, 9). Casual players skew
 * a little higher and regulars a little lower, keeping the population mean near 16.
 */
function handicapFor(rng: Rng, type: GolferType): number {
  switch (type) {
    case 'competitive': return clampHcp(rng.normal(8, 5));
    case 'junior': return clampHcp(rng.normal(22, 9));
    case 'casual': return clampHcp(rng.normal(19, 7));
    case 'regular': return clampHcp(rng.normal(14, 7));
    case 'senior': return clampHcp(rng.normal(18, 7));
    default: return clampHcp(rng.normal(16, 8));
  }
}

function traitsFor(rng: Rng, type: GolferType, segment: Segment): Traits {
  const n = (mean: number) => clamp01(rng.normal(mean, 0.18));
  const rich = segment === 'premium' ? 0.2 : segment === 'budget' ? -0.2 : 0;
  return {
    pace: n(type === 'corporate' ? 0.7 : type === 'senior' ? 0.35 : 0.5),
    challenge: n(type === 'competitive' ? 0.8 : type === 'casual' || type === 'junior' ? 0.35 : 0.5),
    aesthetics: n(type === 'tourist' ? 0.75 : 0.5),
    loyalty: n(type === 'regular' ? 0.75 : type === 'tourist' ? 0.2 : 0.5),
    social: n(type === 'corporate' ? 0.75 : 0.5),
    gear: n(0.5 + rich),
    food: n(0.5 + rich / 2),
  };
}

export function generateGolfer(rng: Rng, id: number, bias?: Partial<{ type: GolferType; segment: Segment }>): Golfer {
  const type = bias?.type ?? weighted(rng, TYPE_WEIGHTS);
  const segment = bias?.segment ?? weighted(rng, SEGMENT_WEIGHTS[type]);
  const age = ageFor(rng, type);
  return {
    id,
    name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
    age,
    home: rng.pick(TOWNS),
    handicap: handicapFor(rng, type),
    segment,
    type,
    traits: traitsFor(rng, type, segment),
    opinion: {},
    visits: 0,
    totalSpend: 0,
    lastVisitDay: -1,
    memberOf: null,
  };
}

export class GolferPool {
  all = new Map<number, Golfer>();
  nextId = 1;
  spawn(rng: Rng, bias?: Partial<{ type: GolferType; segment: Segment }>): Golfer {
    const g = generateGolfer(rng, this.nextId++, bias);
    this.all.set(g.id, g);
    return g;
  }
}

export { GOLFER_TYPES, SEGMENTS };
