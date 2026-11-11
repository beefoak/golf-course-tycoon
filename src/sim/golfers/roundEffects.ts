import type { Game } from '../game';
import { holePar } from '../course/yardage';
import { CourseStats } from './stats';
import { Thought, THOUGHT_MOOD, applySatisfaction, evaluateHoleThoughts, roundSatisfaction, valueRatio } from './thoughts';

export const MAX_THOUGHTS = 3000;
/** walking more than this many tiles (300 m) from a green to the next tee is a long walk */
export const LONG_WALK_TILES = 150;

export function statsFor(g: Game, courseId: number): CourseStats {
  let s = g.stats.get(courseId);
  if (!s) { s = new CourseStats(g.world.size); g.stats.set(courseId, s); }
  return s;
}

function pushThought(g: Game, t: Thought, roundThoughts: Thought[]): void {
  roundThoughts.push(t);
  g.thoughts.push(t);
  if (g.thoughts.length > MAX_THOUGHTS) g.thoughts.splice(0, g.thoughts.length - MAX_THOUGHTS);
  g.events.emit('thought', t);
}

/** Thoughts after each hole, stats, and opinion changes at the end of the round. */
export function attachRoundEffects(g: Game): void {
  const perGroup = g.roundThoughts;
  g.events.on('holeComplete', ({ groupId, holeId, results }) => {
    const grp = g.groups.find(x => x.id === groupId);
    const hole = g.courses.hole(holeId);
    if (!grp || !hole) return;
    const waited = grp.waitingMin - grp.holeWaitStart;
    const list = perGroup.get(groupId) ?? [];
    perGroup.set(groupId, list);
    const stats = statsFor(g, grp.courseId);
    stats.recordHoleTime(g.day, holeId, g.clock.absMinute - grp.holeStartAbsMin);
    const par = holePar(hole);
    const nextId = grp.holeOrder[grp.holeIdx + 1];
    const next = nextId ? g.courses.hole(nextId) : undefined;
    const walk = next?.teeBoxes[0] ? Math.hypot(next.teeBoxes[0].center.x - hole.greenCenter.x, next.teeBoxes[0].center.y - hole.greenCenter.y) : 0;
    for (const { golferId, result } of results) {
      const golfer = g.golfers.all.get(golferId);
      if (!golfer) continue;
      stats.record(result, golfer, g.day, par);
      for (const t of evaluateHoleThoughts(g, golfer, hole, result, waited)) pushThought(g, t, list);
      if (walk > LONG_WALK_TILES && golfer.traits.pace > 0.6) {
        pushThought(g, { golferId, day: g.day, minute: g.clock.minuteOfDay, key: 'longWalk', holeNumber: hole.number, mood: THOUGHT_MOOD.longWalk }, list);
      }
    }
  });
  g.events.on('roundComplete', ({ groupId }) => {
    const grp = g.groups.find(x => x.id === groupId);
    const list = perGroup.get(groupId) ?? [];
    perGroup.delete(groupId);
    if (!grp) return;
    statsFor(g, grp.courseId).recordRound(g.day, g.clock.absMinute - grp.startAbsMin);
    for (const id of grp.golferIds) {
      const golfer = g.golfers.all.get(id);
      if (!golfer) continue;
      const ratio = valueRatio(golfer, grp.feePerGolfer, grp.holeOrder.length);
      const mine = list.filter(t => t.golferId === id);
      if (ratio > 1.3) pushThought(g, { golferId: id, day: g.day, minute: g.clock.minuteOfDay, key: 'goodValue', mood: THOUGHT_MOOD.goodValue }, mine);
      else if (ratio < 0.7) pushThought(g, { golferId: id, day: g.day, minute: g.clock.minuteOfDay, key: 'overpriced', mood: THOUGHT_MOOD.overpriced }, mine);
      const sat = roundSatisfaction(mine, golfer, ratio);
      applySatisfaction(golfer, grp.courseId, sat);
      golfer.lastSatisfaction = sat;
    }
  });
  g.registerSystem({
    name: 'stats',
    onDay(game) {
      for (const s of game.stats.values()) s.roll(game.day);
      for (let i = 0; i < game.footfall.length; i++) if (game.footfall[i]) game.footfall[i] = Math.floor(game.footfall[i]! * 0.9);
    },
  });
}
