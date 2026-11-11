import { Rng } from './rng';

/** Seeded 2D simplex noise in [-1, 1]. */
export function createNoise2D(rng: Rng): (x: number, y: number) => number {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = p[i]!; p[i] = p[j]!; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;
  const grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const corner = (gi: number, x: number, y: number): number => {
    const t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    const g = grad[gi % 8]!;
    const t2 = t * t;
    return t2 * t2 * (g[0] * x + g[1] * y);
  };
  return (xin: number, yin: number): number => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const n0 = corner(perm[ii + perm[jj]!]!, x0, y0);
    const n1 = corner(perm[ii + i1 + perm[jj + j1]!]!, x1, y1);
    const n2 = corner(perm[ii + 1 + perm[jj + 1]!]!, x2, y2);
    const v = 70 * (n0 + n1 + n2);
    return v > 1 ? 1 : v < -1 ? -1 : v;
  };
}

/** Fractal Brownian motion, normalised to [-1, 1]. */
export function fbm(n: (x: number, y: number) => number, x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * n(x * freq, y * freq);
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}
