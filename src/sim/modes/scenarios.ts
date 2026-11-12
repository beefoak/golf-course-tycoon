import { DAYS_PER_YEAR } from '../clock';
import { Difficulty, DifficultyOptions } from '../difficulty';
import { statementFor } from '../economy/reports';
import type { Game, NewGameOptions, System } from '../game';
import { reputation } from '../rating/reputation';
import { registerSaveable } from '../saveRegistry';
import { TerrainType } from '../world/terrainTypes';
import { buildPrebuiltCourse } from './prebuilt';

export interface ScenarioGoal { id: string; text: string; check: (g: Game) => boolean }

export interface Scenario {
  id: string;
  name: string;
  description: string;
  seed: number;
  terrain: TerrainType;
  difficulty: Difficulty;
  options?: Partial<DifficultyOptions>;
  /** build whatever the scenario starts with (runs once, on a new game) */
  setup: (g: Game) => void;
  goals: ScenarioGoal[];
  /** a reason the scenario is lost, checked daily */
  failIf?: (g: Game) => string | null;
  /** every goal must be met within this many days */
  timeLimitDays?: number;
}

export interface ScenarioState {
  id: string;
  startDay: number;
  /** goal id → day it was met */
  met: Record<string, number>;
  status: 'active' | 'won' | 'failed';
  reason?: string;
}

const firstCourse = (g: Game) => g.courses.list[0];
const since = (g: Game) => g.day - (g.scenario?.startDay ?? 1);

export const SCENARIOS: Record<string, Scenario> = {
  restoreNeglected: {
    id: 'restoreNeglected',
    name: 'Restore a neglected 18',
    description: 'An old parkland 18 gone to seed: thin, sick turf and $400,000 in the bank. Bring it back to three stars within two years.',
    seed: 1847,
    terrain: 'parkland',
    difficulty: 'normal',
    options: { startingCash: 400_000 },
    setup: g => { buildPrebuiltCourse(g, { name: 'Old Mill Golf Club', holes: 18, health: [18, 40] }); },
    goals: [{ id: 'threeStars', text: 'Reach a 3-star reputation', check: g => { const c = firstCourse(g); return !!c && reputation(g, c.id).overall >= 3; } }],
    timeLimitDays: 2 * DAYS_PER_YEAR,
  },
  desertWaterCrisis: {
    id: 'desertWaterCrisis',
    name: 'Desert water crisis',
    description: 'A desert nine under permanent water restrictions: irrigation is capped at 60% of the pump. Stay profitable over your first year.',
    seed: 5150,
    terrain: 'desert',
    difficulty: 'normal',
    options: { startingCash: 1_200_000, droughtCap: 0.6 },
    setup: g => { buildPrebuiltCourse(g, { name: 'Mirage Wells', holes: 9, health: [65, 85] }); },
    goals: [{
      id: 'profitableYear', text: 'Make an operating profit over the first year',
      check: g => since(g) >= DAYS_PER_YEAR && statementFor(g, null, g.scenario!.startDay, g.scenario!.startDay + DAYS_PER_YEAR - 1).operatingProfit > 0,
    }],
    failIf: g => since(g) >= DAYS_PER_YEAR && statementFor(g, null, g.scenario!.startDay, g.scenario!.startDay + DAYS_PER_YEAR - 1).operatingProfit <= 0 ? 'The first year ran at a loss' : null,
    timeLimitDays: DAYS_PER_YEAR,
  },
  championshipOnBudget: {
    id: 'championshipOnBudget',
    name: 'Championship on a budget',
    description: 'Bare land, hard money and dear loans. Build a course good enough to host a Regional Amateur within four years.',
    seed: 2718,
    terrain: 'parkland',
    difficulty: 'hard',
    setup: () => {},
    goals: [{ id: 'regionalAmateur', text: 'Host a Regional Amateur', check: g => g.golfEvents.some(e => e.kind === 'regionalAmateur' && e.status === 'done') }],
    timeLimitDays: 4 * DAYS_PER_YEAR,
  },
};
export const SCENARIO_IDS = Object.keys(SCENARIOS);

/** The new-game options a scenario plays with. */
export function scenarioOptions(id: string): NewGameOptions {
  const s = SCENARIOS[id];
  if (!s) throw new Error(`No scenario ${id}`);
  return { seed: s.seed, terrain: s.terrain, difficulty: s.difficulty, options: s.options, scenario: id };
}

/** Set the scenario up on a fresh game and start its clock. */
export function startScenario(g: Game, id: string): void {
  const s = SCENARIOS[id];
  if (!s) throw new Error(`No scenario ${id}`);
  s.setup(g);
  g.scenario = { id, startDay: g.day, met: {}, status: 'active' };
  g.notify('info', `${s.name}: ${s.goals.map(x => x.text).join('; ')}${s.timeLimitDays ? ` — within ${Math.round(s.timeLimitDays / DAYS_PER_YEAR * 10) / 10} year(s)` : ''}`);
}

/** Days left on the scenario's clock (null: no limit or not in a scenario). */
export function daysLeft(g: Game): number | null {
  const st = g.scenario, s = st && SCENARIOS[st.id];
  if (!st || !s?.timeLimitDays) return null;
  return Math.max(0, st.startDay + s.timeLimitDays - g.day);
}

function lose(g: Game, reason: string): void {
  const st = g.scenario!;
  st.status = 'failed';
  st.reason = reason;
  const text = `Scenario failed: ${reason}`;
  g.notify('bad', text);
  if (!g.finance.gameOver) { g.finance.gameOver = text; g.events.emit('gameOver', { reason: text }); }
}

/** Daily: tick off goals, then the win, the fail conditions and the clock. */
export function checkScenario(g: Game): void {
  const st = g.scenario;
  if (!st || st.status !== 'active') return;
  const s = SCENARIOS[st.id];
  if (!s) return;
  for (const goal of s.goals) if (st.met[goal.id] === undefined && goal.check(g)) {
    st.met[goal.id] = g.day;
    g.notify('info', `Goal complete: ${goal.text}`);
  }
  if (s.goals.every(x => st.met[x.id] !== undefined)) {
    st.status = 'won';
    g.notify('info', `Scenario complete: ${s.name}! Keep playing as long as you like.`);
    return;
  }
  const why = s.failIf?.(g);
  if (why) return lose(g, why);
  if (s.timeLimitDays && g.day - st.startDay >= s.timeLimitDays) lose(g, 'Out of time');
}

export const scenarioSystem: System = { name: 'scenario', onDay: checkScenario };

registerSaveable({
  key: 'scenario',
  save: g => g.scenario,
  load: (g, d) => { g.scenario = (d as ScenarioState | null) ?? null; },
});
