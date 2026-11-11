/** Deterministic seeded PRNG (mulberry32). All sim randomness must come from here. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  private state: number;
  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, maxIncl: number): number {
    return min + Math.floor(this.next() * (maxIncl - min + 1));
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  normal(mean: number, sd: number): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(a: readonly T[]): T {
    if (a.length === 0) throw new Error('pick from empty array');
    return a[Math.floor(this.next() * a.length)] as T;
  }
  fork(label: string): Rng {
    return new Rng((hashString(label) ^ this.state) >>> 0);
  }
  getState(): number {
    return this.state;
  }
  setState(s: number): void {
    this.state = s >>> 0;
  }
}
