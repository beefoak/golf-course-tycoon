import { Rng } from '../../../src/core/rng';
import { Game } from '../../../src/sim/game';
import { createGroup } from '../../../src/sim/golfers/groups';
import { dailyDemand } from '../../../src/sim/golfers/demand';
import { CLIMATES, DayWeather, FROST_CLEAR_MIN, ambientMoisture, rollDay, seasonOfDay, weatherDemandFactor } from '../../../src/sim/turf/weather';
import { ClimateId } from '../../../src/sim/world/terrainTypes';
import { addClubhouse, spawnGolfers, threeHoleCourse } from '../golfers/courseFixture';

function year(seed: number, climate: ClimateId): DayWeather[] {
  const rng = new Rng(seed);
  const out: DayWeather[] = [];
  let prev: DayWeather['kind'] | null = null;
  for (let day = 1; day <= 112; day++) { const d = rollDay(rng, CLIMATES[climate], seasonOfDay(day), prev); out.push(d); prev = d.kind; }
  return out;
}

test('same seed gives the same weather, in the game too', () => {
  expect(JSON.stringify(year(9, 'temperate'))).toBe(JSON.stringify(year(9, 'temperate')));
  const a = Game.create({ seed: 4, terrain: 'parkland', difficulty: 'normal', size: 100 });
  const b = Game.create({ seed: 4, terrain: 'parkland', difficulty: 'normal', size: 100 });
  for (let i = 0; i < 9600 * 3; i++) { a.tick(); b.tick(); }
  expect(b.weather).toEqual(a.weather);
  expect(a.weather.forecast.length).toBe(3);
});

test('forecast becomes the weather', () => {
  const g = Game.create({ seed: 8, terrain: 'parkland', difficulty: 'normal', size: 100 });
  const tomorrow = g.weather.forecast[0]!;
  const day = g.day;
  while (g.day === day) g.tick();
  expect(g.weather.kind).toBe(tomorrow.kind);
  expect(g.weather.highC).toBe(tomorrow.highC);
});

test('arid sees far fewer rain days than temperate over a year', () => {
  const wet = (d: DayWeather) => d.rainMm > 0;
  let arid = 0, temperate = 0;
  for (const seed of [1, 2, 3]) { arid += year(seed, 'arid').filter(wet).length; temperate += year(seed, 'temperate').filter(wet).length; }
  expect(arid * 4).toBeLessThan(temperate);
  // and the desert is hotter and drier on the ground
  const hot = year(1, 'arid'), mild = year(1, 'temperate');
  const avgHigh = (ys: DayWeather[]) => ys.reduce((s, d) => s + d.highC, 0) / ys.length;
  expect(avgHigh(hot)).toBeGreaterThan(avgHigh(mild) + 8);
  expect(ambientMoisture({ ...hot[40]!, tempC: 0, forecast: [] })).toBeLessThan(ambientMoisture({ ...mild[40]!, kind: 'rain', tempC: 0, forecast: [] }));
});

test('demand factor ranks the weather', () => {
  expect(weatherDemandFactor({ kind: 'sunny' })).toBeGreaterThan(weatherDemandFactor({ kind: 'rain' }));
  expect(weatherDemandFactor({ kind: 'storm' })).toBeLessThan(0.1);
});

test('a storm stops play until it passes', () => {
  const { g, course } = threeHoleCourse();
  const grp = createGroup(g, course.id, spawnGolfers(g, 4), g.day, g.clock.minuteOfDay + 1);
  g.weather = { ...g.weather, kind: 'sunny', stormFrom: 0, stormTo: 0 };
  while (!(grp.started && grp.balls.size && [...grp.balls.values()].some(b => b.strokes > 0))) g.tick();
  const now = g.clock.minuteOfDay;
  g.weather = { ...g.weather, kind: 'storm', stormFrom: now, stormTo: now + 45 };
  const snap = JSON.stringify([grp.pos, [...grp.balls.values()].map(b => [b.pos, b.strokes]), grp.phase]);
  const waited = grp.waitingMin;
  for (let i = 0; i < 40 * 10; i++) g.tick();
  expect(JSON.stringify([grp.pos, [...grp.balls.values()].map(b => [b.pos, b.strokes]), grp.phase])).toBe(snap);
  expect(grp.waitingMin - waited).toBeGreaterThanOrEqual(39);
  for (let i = 0; i < 30 * 10; i++) g.tick();
  expect(JSON.stringify([grp.pos, [...grp.balls.values()].map(b => [b.pos, b.strokes]), grp.phase])).not.toBe(snap);
});

test('frost delays the first tee until 9:00', () => {
  const { g, course } = threeHoleCourse();
  g.weather = { ...g.weather, kind: 'frost', stormFrom: 0, stormTo: 0 };
  const grp = createGroup(g, course.id, spawnGolfers(g, 2), g.day, g.clock.minuteOfDay + 10);
  while (g.clock.minuteOfDay < FROST_CLEAR_MIN - 1) g.tick();
  expect(grp.started).toBe(false);
  for (let i = 0; i < 30; i++) g.tick();
  expect(grp.started).toBe(true);
});

test('an alpine winter closes the course: no rounds', () => {
  const { g, course } = threeHoleCourse();
  addClubhouse(g, course);
  (g as unknown as { terrain: string }).terrain = 'mountain';
  g.clock.day = 84; // last day of autumn
  let started = 0;
  g.events.on('roundStart', () => started++);
  const end = g.day + 4;
  while (g.day < end) g.tick();
  expect(g.clock.season).toBe('winter');
  expect(started).toBe(0);
  expect(dailyDemand(g, course)).toBe(0);
});
