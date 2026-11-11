export const TICKS_PER_MIN = 10;
export const DAY_START_MIN = 300; // 05:00
export const DAY_END_MIN = 1260; // 21:00
export const DAYS_PER_SEASON = 28;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;
/** 960 game minutes × 10 ticks = 12 real minutes at 1× (GDD §17). */
export const REAL_MS_PER_TICK_1X = 720_000 / ((DAY_END_MIN - DAY_START_MIN) * TICKS_PER_MIN);

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export class GameClock {
  tick = 0;
  day = 1;
  minuteOfDay = DAY_START_MIN;
  private sub = 0;

  get season(): Season {
    return SEASONS[Math.floor(((this.day - 1) % DAYS_PER_YEAR) / DAYS_PER_SEASON)]!;
  }
  get year(): number {
    return Math.floor((this.day - 1) / DAYS_PER_YEAR) + 1;
  }
  get dayOfSeason(): number {
    return ((this.day - 1) % DAYS_PER_SEASON) + 1;
  }
  /** Absolute minute counter (day × 1440 + minuteOfDay) for ordering events. */
  get absMinute(): number {
    return this.day * 1440 + this.minuteOfDay;
  }
  step(): { newMinute: boolean; newDay: boolean } {
    this.tick++;
    this.sub++;
    if (this.sub < TICKS_PER_MIN) return { newMinute: false, newDay: false };
    this.sub = 0;
    this.minuteOfDay++;
    if (this.minuteOfDay >= DAY_END_MIN) {
      this.day++;
      this.minuteOfDay = DAY_START_MIN;
      return { newMinute: true, newDay: true };
    }
    return { newMinute: true, newDay: false };
  }
  timeString(): string {
    const h = Math.floor(this.minuteOfDay / 60), m = this.minuteOfDay % 60;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }
  save(): { tick: number; day: number; minuteOfDay: number; sub: number } {
    return { tick: this.tick, day: this.day, minuteOfDay: this.minuteOfDay, sub: this.sub };
  }
  load(s: { tick: number; day: number; minuteOfDay: number; sub: number }): void {
    this.tick = s.tick; this.day = s.day; this.minuteOfDay = s.minuteOfDay; this.sub = s.sub;
  }
}
