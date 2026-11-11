export interface Vec2 {
  x: number;
  y: number;
}
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const angleOf = (v: Vec2): number => Math.atan2(v.y, v.x);
export const fromAngle = (rad: number, l: number): Vec2 => ({ x: Math.cos(rad) * l, y: Math.sin(rad) * l });
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
