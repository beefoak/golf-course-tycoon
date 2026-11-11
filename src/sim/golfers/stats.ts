import { Vec2 } from '../../core/geom';
import { Golfer } from './golfer';
import { HoleResult } from './hole';

export const STATS_WINDOW_DAYS = 28;
/** landing heat cells are 2×2 tiles (4 m) */
export const HEAT_CELL = 2;
const HOTSPOT_CELL = 10;

interface Entry { day: number; holeId: number; par: number; strokes: number; putts: number; pickedUp: boolean; handicap: number }

/** Rolling 28-day per-course statistics. */
export class CourseStats {
  entries: Entry[] = [];
  rounds: { day: number; minutes: number }[] = [];
  holeTimes: { day: number; holeId: number; minutes: number }[] = [];
  /** day → list of OB/lost/water positions */
  losses: { day: number; at: Vec2 }[] = [];
  landingHeat: Uint16Array;
  readonly heatSide: number;

  constructor(worldSize: number) {
    this.heatSide = Math.ceil(worldSize / HEAT_CELL);
    this.landingHeat = new Uint16Array(this.heatSide * this.heatSide);
  }

  record(r: HoleResult, golfer: Golfer, day: number, par: number): void {
    this.entries.push({ day, holeId: r.holeId, par, strokes: r.strokes, putts: r.putts, pickedUp: r.pickedUp, handicap: golfer.handicap });
    for (const s of r.shots) {
      if (s.club !== 'P') {
        const cx = Math.floor(s.landing.x / HEAT_CELL), cy = Math.floor(s.landing.y / HEAT_CELL);
        if (cx >= 0 && cy >= 0 && cx < this.heatSide && cy < this.heatSide) {
          const i = cy * this.heatSide + cx;
          if (this.landingHeat[i]! < 65535) this.landingHeat[i]!++;
        }
      }
      if (s.result === 'ob' || s.result === 'lost' || s.result === 'water') this.losses.push({ day, at: { ...s.final } });
    }
  }
  recordHoleTime(day: number, holeId: number, minutes: number): void {
    this.holeTimes.push({ day, holeId, minutes });
  }
  /** Average minutes groups take on a hole (0 = no data). */
  holeMinutes(holeId: number): number {
    const xs = this.holeTimes.filter(h => h.holeId === holeId);
    return xs.length ? xs.reduce((s, h) => s + h.minutes, 0) / xs.length : 0;
  }
  recordRound(day: number, minutes: number): void {
    this.rounds.push({ day, minutes });
  }
  /** Drop anything older than the window and fade the heat map. */
  roll(today: number): void {
    const cutoff = today - STATS_WINDOW_DAYS;
    this.entries = this.entries.filter(e => e.day > cutoff);
    this.rounds = this.rounds.filter(e => e.day > cutoff);
    this.losses = this.losses.filter(e => e.day > cutoff);
    this.holeTimes = this.holeTimes.filter(e => e.day > cutoff);
    for (let i = 0; i < this.landingHeat.length; i++) if (this.landingHeat[i]) this.landingHeat[i] = Math.floor(this.landingHeat[i]! * 0.96);
  }

  private forHole(holeId: number): Entry[] {
    return this.entries.filter(e => e.holeId === holeId);
  }
  playedCount(holeId: number): number {
    return this.forHole(holeId).length;
  }
  holeAverage(holeId: number): number {
    const xs = this.forHole(holeId);
    return xs.length ? xs.reduce((s, e) => s + e.strokes, 0) / xs.length : 0;
  }
  holeAvgVsPar(holeId: number): number {
    const xs = this.forHole(holeId);
    return xs.length ? xs.reduce((s, e) => s + e.strokes - e.par, 0) / xs.length : 0;
  }
  threePuttRate(holeId: number): number {
    const xs = this.forHole(holeId).filter(e => e.putts > 0);
    return xs.length ? xs.filter(e => e.putts >= 3).length / xs.length : 0;
  }
  /** Hole ids sorted hardest first (average over par). */
  hardestHoles(n: number): number[] {
    const ids = [...new Set(this.entries.map(e => e.holeId))];
    return ids.sort((a, b) => this.holeAvgVsPar(b) - this.holeAvgVsPar(a)).slice(0, n);
  }
  avgRoundMinutes(): number {
    return this.rounds.length ? this.rounds.reduce((s, r) => s + r.minutes, 0) / this.rounds.length : 0;
  }
  /** Centres of the 20 m buckets with the most lost balls, busiest first. */
  lostBallHotspots(top = 5): Vec2[] {
    const m = new Map<string, number>();
    for (const l of this.losses) {
      const k = `${Math.floor(l.at.x / HOTSPOT_CELL)},${Math.floor(l.at.y / HOTSPOT_CELL)}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k]) => {
      const [x, y] = k.split(',').map(Number) as [number, number];
      return { x: (x + 0.5) * HOTSPOT_CELL, y: (y + 0.5) * HOTSPOT_CELL };
    });
  }
}
