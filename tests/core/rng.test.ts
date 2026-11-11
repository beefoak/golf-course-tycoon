import { Rng, hashString } from '../../src/core/rng';

test('same seed gives same sequence', () => {
  const a = new Rng(42), b = new Rng(42);
  expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
});
test('fork is independent and deterministic', () => {
  const a = new Rng(1).fork('golfers'), b = new Rng(1).fork('golfers');
  expect(a.next()).toBe(b.next());
  expect(new Rng(1).fork('x').next()).not.toBe(new Rng(1).fork('y').next());
});
test('fork does not advance parent', () => {
  const a = new Rng(5), b = new Rng(5);
  a.fork('z');
  expect(a.next()).toBe(b.next());
});
test('state round-trips', () => {
  const r = new Rng(7); r.next(); const s = r.getState(); const v = r.next();
  r.setState(s); expect(r.next()).toBe(v);
});
test('int is inclusive and in range', () => {
  const r = new Rng(3); const seen = new Set<number>();
  for (let i = 0; i < 1000; i++) { const v = r.int(2, 4); seen.add(v); expect(v).toBeGreaterThanOrEqual(2); expect(v).toBeLessThanOrEqual(4); }
  expect(seen.size).toBe(3);
});
test('next is in [0,1)', () => {
  const r = new Rng(11); for (let i = 0; i < 1000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
});
test('normal has roughly correct mean', () => {
  const r = new Rng(9); let s = 0; for (let i = 0; i < 5000; i++) s += r.normal(10, 2);
  expect(s / 5000).toBeCloseTo(10, 0);
});
test('hashString is stable and differs', () => {
  expect(hashString('abc')).toBe(hashString('abc'));
  expect(hashString('abc')).not.toBe(hashString('abd'));
});
