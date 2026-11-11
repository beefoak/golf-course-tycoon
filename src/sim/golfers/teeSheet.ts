import { Course } from '../course/course';
import { DAY_END_MIN } from '../clock';

/** Round lengths offered for a course with N open holes. */
export function roundOptions(course: Course): number[] {
  const n = course.holes.filter(h => h.state === 'open').length;
  if (n === 0) return [];
  if (n < 9) return [n];
  if (n < 18) return [9];
  return [9, 18];
}

/** The holes a round of `len` plays: open holes in number order, the first `len` of them. */
export function roundHoles(course: Course, len: number): number[] {
  return course.holes.filter(h => h.state === 'open').sort((a, b) => a.number - b.number).slice(0, len).map(h => h.id);
}

export interface Pricing {
  /** fee per golfer by round length (holes) */
  greenFee: Record<number, number>;
}
export const DEFAULT_FEE_PER_HOLE = 8;
export function greenFee(p: Pricing | undefined, holes: number): number {
  return p?.greenFee[holes] ?? DEFAULT_FEE_PER_HOLE * holes;
}

export interface TeeSlot { minute: number; groupId: number | null }

/** Minutes a group needs per hole, used to stop booking rounds that can't finish before dark. */
export const MIN_PER_HOLE = 13;

export class TeeSheet {
  intervalMin = 10;
  firstTee = 360; // 06:00
  /** day → minute → group id */
  booked = new Map<number, Map<number, number>>();
  /** day → golfers booked */
  golfers = new Map<number, number>();

  lastTee(roundHoles: number): number {
    return DAY_END_MIN - MIN_PER_HOLE * roundHoles;
  }
  slots(day: number, roundHoles = 9): TeeSlot[] {
    const b = this.booked.get(day);
    const out: TeeSlot[] = [];
    for (let m = this.firstTee; m <= this.lastTee(roundHoles); m += this.intervalMin) out.push({ minute: m, groupId: b?.get(m) ?? null });
    return out;
  }
  isFree(day: number, minute: number, roundHoles: number): boolean {
    if (minute < this.firstTee || minute > this.lastTee(roundHoles)) return false;
    if ((minute - this.firstTee) % this.intervalMin !== 0) return false;
    return !this.booked.get(day)?.has(minute);
  }
  book(day: number, minute: number, groupId: number, roundHoles = 9, size = 0): boolean {
    if (!this.isFree(day, minute, roundHoles)) return false;
    this.golfers.set(day, (this.golfers.get(day) ?? 0) + size);
    let b = this.booked.get(day);
    if (!b) { b = new Map(); this.booked.set(day, b); }
    b.set(minute, groupId);
    return true;
  }
  /** First free slot at or after `prefer` (then before it), or null when the day is full. */
  nearestFree(day: number, prefer: number, roundHoles: number): number | null {
    const last = this.lastTee(roundHoles);
    const start = Math.max(this.firstTee, Math.min(last, this.firstTee + Math.round((prefer - this.firstTee) / this.intervalMin) * this.intervalMin));
    for (let m = start; m <= last; m += this.intervalMin) if (this.isFree(day, m, roundHoles)) return m;
    for (let m = start - this.intervalMin; m >= this.firstTee; m -= this.intervalMin) if (this.isFree(day, m, roundHoles)) return m;
    return null;
  }
  prune(beforeDay: number): void {
    for (const d of this.booked.keys()) if (d < beforeDay) this.booked.delete(d);
    for (const d of this.golfers.keys()) if (d < beforeDay) this.golfers.delete(d);
  }
}
