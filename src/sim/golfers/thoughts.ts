import { Hole } from '../course/course';
import { holePar, longestYards } from '../course/yardage';
import type { Game } from '../game';
import { Golfer, Segment } from './golfer';
import { greenStimp } from './greenSpeed';
import { HoleResult } from './hole';
import { holeCondition } from '../turf/turf';
import { UNRAKED_BELOW, bunkerQuality } from '../turf/practices';
import { lieAt } from './lie';

export type ThoughtKey =
  | 'greenFast' | 'greenSlow' | 'waited' | 'lostBall' | 'water' | 'beautifulView' | 'tooHard' | 'tooEasy'
  | 'goodValue' | 'overpriced' | 'longWalk' | 'greatShot' | 'poorCondition' | 'bunkerUnraked' | 'crewInWay' | 'emptyShelves';

export const THOUGHT_TEXT: Record<ThoughtKey, (ctx: { hole: number }) => string> = {
  greenFast: ({ hole }) => `Green was way too fast on ${hole}`,
  greenSlow: ({ hole }) => `Greens are slow — the putt on ${hole} never got there`,
  waited: ({ hole }) => `Waited forever on the ${ordinal(hole)} tee`,
  lostBall: ({ hole }) => `Lost a ball on ${hole}. Annoying.`,
  water: ({ hole }) => `Found the water on ${hole}`,
  beautifulView: ({ hole }) => `What a view on ${hole}!`,
  tooHard: ({ hole }) => `${hole} is just too hard for me`,
  tooEasy: ({ hole }) => `${hole} is a bit of a pushover`,
  goodValue: () => `Great value for the money`,
  overpriced: () => `Way too expensive for what you get`,
  longWalk: ({ hole }) => `Long walk to the ${ordinal(hole + 1)} tee`,
  greatShot: ({ hole }) => `Birdie on ${hole}! What a shot!`,
  poorCondition: ({ hole }) => `The course is in rough shape around ${hole}`,
  bunkerUnraked: ({ hole }) => `Nobody raked the bunker on ${hole}`,
  crewInWay: ({ hole }) => `Maintenance crew in the way on ${hole}`,
  emptyShelves: () => `The pro shop was sold out of what I wanted`,
};

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

export interface Thought {
  golferId: number;
  day: number;
  minute: number;
  key: ThoughtKey;
  holeNumber?: number;
  /** -3..3 */
  mood: number;
}

export const THOUGHT_MOOD: Record<ThoughtKey, number> = {
  greenFast: -1, greenSlow: -1, waited: -1, lostBall: -1, water: -1, beautifulView: 1, tooHard: -2, tooEasy: -1,
  goodValue: 1, overpriced: -2, longWalk: -1, greatShot: 2, poorCondition: -2, bunkerUnraked: -1, crewInWay: -1, emptyShelves: -1,
};

export function thoughtText(t: Thought): string {
  return THOUGHT_TEXT[t.key]({ hole: t.holeNumber ?? 0 });
}

/** Thoughts a golfer has after finishing a hole. */
export function evaluateHoleThoughts(g: Game, golfer: Golfer, hole: Hole, result: HoleResult, waitedMin: number): Thought[] {
  const out: Thought[] = [];
  const add = (key: ThoughtKey) => out.push({ golferId: golfer.id, day: g.day, minute: g.clock.minuteOfDay, key, holeNumber: hole.number, mood: THOUGHT_MOOD[key] });
  const par = holePar(hole);
  const stimp = greenStimp(g, hole.id);
  if (waitedMin >= 10) add('waited');
  if (result.shots.some(s => s.result === 'water')) add('water');
  if (result.shots.some(s => s.result === 'ob' || s.result === 'lost')) add('lostBall');
  if (!result.pickedUp && result.strokes <= par - 1) add('greatShot');
  if ((result.pickedUp || result.strokes >= par + 3) && golfer.traits.challenge < 0.5) add('tooHard');
  if (golfer.traits.challenge > 0.75 && !result.pickedUp && result.strokes <= par && par >= 4 && longestYards(hole) < 300) add('tooEasy');
  const condition = holeCondition(g, hole.id);
  if (condition !== null && condition < 45) add('poorCondition');
  if (result.shots.some(s => lieAt(g.world, s.from) === 'bunker' && bunkerQuality(g, s.from.x, s.from.y) < UNRAKED_BELOW)) add('bunkerUnraked');
  if (result.putts >= 3 && stimp > 11) add('greenFast');
  if (result.putts >= 3 && stimp < 8) add('greenSlow');
  if (golfer.traits.aesthetics > 0.6 && hole.stakes.red.length + hole.stakes.yellow.length > 0 && g.rng.chance(0.25 * golfer.traits.aesthetics)) add('beautifulView');
  return out;
}

/** What a golfer of this segment thinks 18 holes is worth. */
export const WILLINGNESS_PER_18: Record<Segment, number> = { budget: 30, mid: 55, premium: 110 };

export function valueRatio(golfer: Golfer, feePaid: number, holes: number): number {
  if (feePaid <= 0) return 2;
  return WILLINGNESS_PER_18[golfer.segment] / ((feePaid * 18) / Math.max(1, holes));
}

/** 0..100 round satisfaction from the round's thoughts and the value for money. */
export function roundSatisfaction(thoughts: Thought[], golfer: Golfer, ratio: number): number {
  let s = 55;
  for (const t of thoughts) s += t.mood * 6;
  s += Math.max(-30, Math.min(20, (ratio - 1) * 25));
  void golfer;
  return Math.max(0, Math.min(100, s));
}

/** Satisfaction moves the golfer's opinion of the course; loyal golfers move more slowly. */
export function applySatisfaction(golfer: Golfer, courseId: number, satisfaction: number): void {
  const cur = golfer.opinion[courseId] ?? 0;
  const k = 0.5 - 0.3 * golfer.traits.loyalty;
  golfer.opinion[courseId] = Math.max(-100, Math.min(100, Math.round(cur + (satisfaction - 50) * k)));
}
