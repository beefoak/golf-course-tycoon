import { Vec2 } from '../../core/geom';
import { Rng } from '../../core/rng';
import { DAY_END_MIN, DAY_START_MIN, DAYS_PER_SEASON, DAYS_PER_YEAR, Season } from '../clock';
import type { Game, System } from '../game';
import { registerSaveable } from '../saveRegistry';
import { ClimateId, TERRAINS } from '../world/terrainTypes';

export type WeatherKind = 'sunny' | 'cloudy' | 'rain' | 'storm' | 'heatwave' | 'frost' | 'windy';

export interface DayWeather {
  kind: WeatherKind;
  lowC: number;
  highC: number;
  rainMm: number;
  /** m/s, direction the wind blows toward */
  wind: Vec2;
  /** storm window (minutes of day), 0/0 when none */
  stormFrom: number;
  stormTo: number;
}

export interface WeatherState extends DayWeather {
  tempC: number;
  /** next 3 days */
  forecast: DayWeather[];
}

export interface Climate {
  seasonTempC: Record<Season, [number, number]>;
  rainChance: Record<Season, number>;
  windMean: number;
  windyChance: number;
  heatwaveChance: Record<Season, number>;
  frostChance: Record<Season, number>;
  closedSeasons?: Season[];
}

const S = <T>(spring: T, summer: T, autumn: T, winter: T): Record<Season, T> => ({ spring, summer, autumn, winter });

export const CLIMATES: Record<ClimateId, Climate> = {
  temperate: { seasonTempC: S([6, 16], [14, 27], [7, 17], [-2, 7]), rainChance: S(0.35, 0.25, 0.35, 0.3), windMean: 4, windyChance: 0.1, heatwaveChance: S(0, 0.08, 0, 0), frostChance: S(0.08, 0, 0.08, 0.35) },
  maritime: { seasonTempC: S([7, 14], [12, 20], [9, 15], [3, 9]), rainChance: S(0.4, 0.3, 0.45, 0.5), windMean: 7, windyChance: 0.3, heatwaveChance: S(0, 0.02, 0, 0), frostChance: S(0.02, 0, 0.02, 0.1) },
  arid: { seasonTempC: S([14, 30], [24, 42], [15, 32], [6, 20]), rainChance: S(0.05, 0.02, 0.04, 0.05), windMean: 4, windyChance: 0.12, heatwaveChance: S(0.05, 0.25, 0.05, 0), frostChance: S(0, 0, 0, 0.05) },
  alpine: { seasonTempC: S([0, 12], [9, 22], [1, 12], [-12, -1]), rainChance: S(0.35, 0.35, 0.3, 0.25), windMean: 5, windyChance: 0.12, heatwaveChance: S(0, 0.03, 0, 0), frostChance: S(0.3, 0, 0.3, 1), closedSeasons: ['winter'] },
};

export function climateOf(g: Game): Climate {
  return CLIMATES[TERRAINS[g.terrain].climate];
}

/** Demand multiplier for today's weather. */
export function weatherDemandFactor(w: { kind: WeatherKind }): number {
  return { sunny: 1.1, cloudy: 1, rain: 0.4, storm: 0.05, heatwave: 0.7, frost: 0.6, windy: 0.85 }[w.kind];
}

export const FROST_CLEAR_MIN = 540; // 09:00

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];
export function seasonOfDay(day: number): Season {
  return SEASONS[Math.floor(((day - 1) % DAYS_PER_YEAR) / DAYS_PER_SEASON)]!;
}

function pickKind(rng: Rng, c: Climate, season: Season, prev: WeatherKind | null): WeatherKind {
  // fronts linger: often the same as yesterday (storms and heatwaves less so, frost by season)
  if (prev && prev !== 'storm' && rng.chance(prev === 'heatwave' ? 0.5 : 0.3)) {
    if (prev !== 'frost' || c.frostChance[season] > 0) if (prev !== 'heatwave' || c.heatwaveChance[season] > 0) return prev;
  }
  const rain = c.rainChance[season];
  let r = rng.next();
  const take = (p: number) => { r -= p; return r < 0; };
  if (take(c.frostChance[season] * (1 - rain))) return 'frost';
  if (take(rain * 0.15)) return 'storm';
  if (take(rain * 0.85)) return 'rain';
  if (take(c.heatwaveChance[season])) return 'heatwave';
  if (take(c.windyChance)) return 'windy';
  if (take(0.25)) return 'cloudy';
  return 'sunny';
}

/** Roll one day's weather. */
export function rollDay(rng: Rng, c: Climate, season: Season, prev: WeatherKind | null): DayWeather {
  const kind = pickKind(rng, c, season, prev);
  const [lo, hi] = c.seasonTempC[season];
  let mean = (lo + hi) / 2 + rng.normal(0, 2.5);
  if (kind === 'heatwave') mean += 8;
  if (kind === 'frost') mean = Math.min(mean, lo + 2);
  if (kind === 'rain' || kind === 'storm') mean -= 2;
  const span = (hi - lo) * (kind === 'cloudy' || kind === 'rain' ? 0.5 : 0.8);
  const lowC = Math.round((kind === 'frost' ? Math.min(-1, mean - span / 2) : mean - span / 2) * 10) / 10;
  const highC = Math.round((mean + span / 2) * 10) / 10;
  const rainMm = kind === 'rain' ? Math.round(rng.range(3, 20)) : kind === 'storm' ? Math.round(rng.range(20, 50)) : 0;
  const speed = Math.max(0, c.windMean * (kind === 'windy' ? 2.2 : kind === 'storm' ? 2 : 1) + rng.normal(0, 1.5));
  const ang = rng.range(0, Math.PI * 2);
  const wind = { x: Math.round(Math.cos(ang) * speed * 10) / 10, y: Math.round(Math.sin(ang) * speed * 10) / 10 };
  let stormFrom = 0, stormTo = 0;
  if (kind === 'storm') { stormFrom = 660 + rng.int(0, 36) * 10; stormTo = stormFrom + rng.int(6, 15) * 10; }
  return { kind, lowC, highC, rainMm, wind, stormFrom, stormTo };
}

/** Temperature through the day: coldest at dawn, warmest mid-afternoon. */
export function tempAt(d: DayWeather, minuteOfDay: number): number {
  const f = Math.max(0, Math.sin((Math.PI * (minuteOfDay - DAY_START_MIN)) / ((DAY_END_MIN - DAY_START_MIN) * 1.2)));
  return Math.round((d.lowC + (d.highC - d.lowC) * f) * 10) / 10;
}

export function initialWeather(g: Game): WeatherState {
  const c = climateOf(g);
  const today = rollDay(g.weatherRng, c, seasonOfDay(g.day), null);
  const forecast: DayWeather[] = [];
  let prev = today.kind;
  for (let k = 1; k <= 3; k++) { const d = rollDay(g.weatherRng, c, seasonOfDay(g.day + k), prev); forecast.push(d); prev = d.kind; }
  return { ...today, tempC: tempAt(today, g.clock.minuteOfDay), forecast };
}

export function isClosedSeason(g: Game): boolean {
  return climateOf(g).closedSeasons?.includes(g.clock.season) ?? false;
}

export function stormActive(g: Game): boolean {
  const w = g.weather;
  return w.kind === 'storm' && g.clock.minuteOfDay >= w.stormFrom && g.clock.minuteOfDay < w.stormTo;
}

/** First tee time allowed today (frost delays play until it clears). */
export function firstTeeAllowed(g: Game): number {
  return g.weather.kind === 'frost' ? FROST_CLEAR_MIN : 0;
}

/** Where untreated soil moisture drifts today: rain wets it, heat and wind dry it. */
export function ambientMoisture(w: WeatherState): number {
  const base = { sunny: 42, cloudy: 52, rain: 76, storm: 88, heatwave: 24, frost: 58, windy: 36 }[w.kind];
  return Math.max(5, Math.min(95, base - Math.max(0, w.highC - 24) * 1.2));
}

export const weatherSystem: System = {
  name: 'weather',
  onMinute(g) {
    const w = g.weather;
    w.tempC = tempAt(w, g.clock.minuteOfDay);
    if (w.kind === 'storm') {
      if (g.clock.minuteOfDay === w.stormFrom) g.notify('warn', 'Lightning! Play is suspended until the storm passes');
      if (g.clock.minuteOfDay === w.stormTo) g.notify('info', 'The storm has passed — play resumes');
    }
  },
  onDay(g) {
    const c = climateOf(g);
    const prevSeason = seasonOfDay(g.day - 1);
    const next = g.weather.forecast.shift() ?? rollDay(g.weatherRng, c, g.clock.season, g.weather.kind);
    const last = g.weather.forecast[g.weather.forecast.length - 1]?.kind ?? next.kind;
    g.weather.forecast.push(rollDay(g.weatherRng, c, seasonOfDay(g.day + 3), last));
    g.weather = { ...next, tempC: tempAt(next, g.clock.minuteOfDay), forecast: g.weather.forecast };
    if (prevSeason !== g.clock.season) {
      if (c.closedSeasons?.includes(g.clock.season)) g.notify('warn', `${g.clock.season[0]!.toUpperCase()}${g.clock.season.slice(1)} has closed the course for the season`);
      else if (c.closedSeasons?.includes(prevSeason)) g.notify('info', 'The course reopens for the new season');
    }
    if (g.weather.kind === 'frost') g.notify('info', 'Frost this morning — first tee times delayed until 9:00');
  },
};

export function attachWeather(g: Game): void {
  g.weather = initialWeather(g);
  g.registerSystem(weatherSystem);
}

registerSaveable({
  key: 'weather',
  save: g => ({ state: g.weather, rng: g.weatherRng.getState() }),
  load: (g, d) => {
    const s = d as { state: WeatherState; rng: number };
    g.weather = s.state;
    g.weatherRng.setState(s.rng);
  },
});
