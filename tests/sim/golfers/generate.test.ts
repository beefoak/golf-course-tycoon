import { Rng } from '../../../src/core/rng';
import { GOLFER_TYPES, SEGMENTS } from '../../../src/sim/golfers/golfer';
import { GolferPool, generateGolfer } from '../../../src/sim/golfers/generate';
import { FIRST_NAMES, LAST_NAMES, TOWNS } from '../../../src/sim/golfers/names';

test('name lists are big enough and unique', () => {
  expect(new Set(FIRST_NAMES).size).toBeGreaterThanOrEqual(150);
  expect(new Set(LAST_NAMES).size).toBeGreaterThanOrEqual(200);
  expect(new Set(TOWNS).size).toBeGreaterThanOrEqual(30);
});

test('generation is deterministic for the same seed', () => {
  const a = generateGolfer(new Rng(7), 1);
  const b = generateGolfer(new Rng(7), 1);
  expect(a).toEqual(b);
});

test('10,000 golfers: handicap distribution, every type and segment, names from the lists', () => {
  const rng = new Rng(42);
  const gs = Array.from({ length: 10000 }, (_, i) => generateGolfer(rng, i + 1));
  const mean = gs.reduce((s, g) => s + g.handicap, 0) / gs.length;
  expect(mean).toBeGreaterThan(15);
  expect(mean).toBeLessThan(17);
  for (const g of gs) {
    expect(g.handicap).toBeGreaterThanOrEqual(-4);
    expect(g.handicap).toBeLessThanOrEqual(36);
    const [first, ...rest] = g.name.split(' ');
    expect(FIRST_NAMES).toContain(first);
    expect(LAST_NAMES).toContain(rest.join(' '));
    expect(TOWNS).toContain(g.home);
    for (const v of Object.values(g.traits)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  }
  for (const t of GOLFER_TYPES) expect(gs.some(g => g.type === t)).toBe(true);
  for (const s of SEGMENTS) expect(gs.some(g => g.segment === s)).toBe(true);
  const avg = (t: string) => { const xs = gs.filter(g => g.type === t); return xs.reduce((s, g) => s + g.handicap, 0) / xs.length; };
  expect(avg('competitive')).toBeLessThan(avg('casual'));
  expect(gs.filter(g => g.type === 'junior').every(g => g.age < 18)).toBe(true);
  expect(gs.filter(g => g.type === 'senior').every(g => g.age >= 60)).toBe(true);
});

test('bias forces type/segment; pool assigns ids', () => {
  const pool = new GolferPool();
  const rng = new Rng(3);
  const g1 = pool.spawn(rng, { type: 'corporate', segment: 'premium' });
  const g2 = pool.spawn(rng);
  expect(g1.type).toBe('corporate');
  expect(g1.segment).toBe('premium');
  expect(g2.id).toBe(g1.id + 1);
  expect(pool.all.get(g2.id)).toBe(g2);
});
