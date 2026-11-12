import type { Game } from '../game';
import { Golfer, GolferType, Segment } from '../golfers/golfer';
import { Thought, thoughtText } from '../golfers/thoughts';

export interface Review {
  golferId: number;
  courseId: number;
  day: number;
  /** 1..5 */
  stars: number;
  segment: Segment;
  type: GolferType;
  /** 0..100 round satisfaction behind the stars */
  satisfaction: number;
  text: string;
}

/** About a quarter of golfers write a review. */
export const REVIEW_CHANCE = 0.25;
export const MAX_REVIEWS = 4000;

/** How a golfer type feels about a tough course (slope above 113): + likes it, − doesn't. */
const CHALLENGE_TASTE: Record<GolferType, number> = { competitive: 1, regular: 0.2, corporate: -0.2, tourist: -0.3, casual: -0.7, junior: -0.6, senior: -0.5 };

function hash01(a: number, b: number, c: number): number {
  return ((Math.imul(a ^ Math.imul(b + c * 7919, 0x9e3779b1), 0x85ebca6b) >>> 8) & 0xffff) / 65536;
}

/** Stars from a round's satisfaction, tilted by how the golfer's type takes to the course's difficulty. */
export function starsFor(g: Game, gf: Golfer, courseId: number, satisfaction: number): number {
  const slope = g.ratings.get(courseId)?.slope ?? 113;
  const taste = CHALLENGE_TASTE[gf.type] * (slope - 113) / 25 + (gf.traits.challenge - 0.5) * (slope - 113) / 40;
  return Math.max(1, Math.min(5, Math.round(1 + satisfaction / 25 + taste)));
}

/** The review's words: the golfer's two strongest thoughts from the round. */
export function reviewText(thoughts: Thought[], stars: number): string {
  const top = thoughts.slice().sort((a, b) => Math.abs(b.mood) - Math.abs(a.mood)).slice(0, 2);
  if (!top.length) return stars >= 4 ? 'Lovely round.' : stars <= 2 ? 'Not for me.' : 'Fine round, nothing special.';
  return top.map(t => thoughtText(t)).join('. ') + '.';
}

/** After the round: maybe write a review. */
export function maybeReview(g: Game, gf: Golfer, courseId: number, satisfaction: number, thoughts: Thought[]): Review | null {
  if (hash01(gf.id, g.day, 51) >= REVIEW_CHANCE) return null;
  const stars = starsFor(g, gf, courseId, satisfaction);
  const r: Review = { golferId: gf.id, courseId, day: g.day, stars, segment: gf.segment, type: gf.type, satisfaction: Math.round(satisfaction), text: reviewText(thoughts, stars) };
  g.reviews.push(r);
  if (g.reviews.length > MAX_REVIEWS) g.reviews.splice(0, g.reviews.length - MAX_REVIEWS);
  return r;
}
