import { HoleResult } from '../../../src/sim/golfers/hole';
import { Thought, THOUGHT_TEXT, evaluateHoleThoughts, roundSatisfaction } from '../../../src/sim/golfers/thoughts';
import { golferWith, straightHole } from './holeFixture';

const result = (over: Partial<HoleResult> = {}): HoleResult => ({
  holeId: 1, tee: 'back', strokes: 4, putts: 2, shots: [], pickedUp: false, penalties: 0, gir: true, fairwayHit: true, ...over,
});
const keys = (ts: Thought[]) => ts.map(t => t.key);

test('waiting 12 minutes produces a waited thought', () => {
  const { g, hole } = straightHole();
  expect(keys(evaluateHoleThoughts(g, golferWith(10), hole, result(), 12))).toContain('waited');
  expect(keys(evaluateHoleThoughts(g, golferWith(10), hole, result(), 5))).not.toContain('waited');
});

test('a water penalty produces a water thought; a birdie a greatShot', () => {
  const { g, hole } = straightHole();
  const wet = result({ penalties: 1, shots: [{ from: { x: 0, y: 0 }, landing: { x: 0, y: 0 }, final: { x: 0, y: 0 }, next: { x: 0, y: 0 }, club: '7I', result: 'water', penalty: 1 }] });
  expect(keys(evaluateHoleThoughts(g, golferWith(10), hole, wet, 0))).toContain('water');
  expect(keys(evaluateHoleThoughts(g, golferWith(10), hole, result({ strokes: 3 }), 0))).toContain('greatShot');
});

test('a high-handicapper who hates a challenge finds a triple too hard', () => {
  const { g, hole } = straightHole();
  expect(keys(evaluateHoleThoughts(g, golferWith(25, { traits: { challenge: 0.2 } }), hole, result({ strokes: 7 }), 0))).toContain('tooHard');
  expect(keys(evaluateHoleThoughts(g, golferWith(25, { traits: { challenge: 0.9 } }), hole, result({ strokes: 7 }), 0))).not.toContain('tooHard');
});

test('every thought has text', () => {
  for (const f of Object.values(THOUGHT_TEXT)) expect(f({ hole: 7 }).length).toBeGreaterThan(5);
  expect(THOUGHT_TEXT.greenFast({ hole: 7 })).toBe('Green was way too fast on 7');
});

test('satisfaction is lower with more negative thoughts and worse value', () => {
  const golfer = golferWith(12);
  const t = (key: Thought['key'], mood: number): Thought => ({ golferId: 1, day: 1, minute: 600, key, mood });
  const good = roundSatisfaction([t('greatShot', 2)], golfer, 1);
  const bad = roundSatisfaction([t('water', -1), t('waited', -1), t('tooHard', -2)], golfer, 1);
  expect(bad).toBeLessThan(good);
  expect(roundSatisfaction([], golfer, 0.5)).toBeLessThan(roundSatisfaction([], golfer, 1.5));
});
