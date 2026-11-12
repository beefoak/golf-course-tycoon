import { registerSaveable } from '../saveRegistry';
import type { Game } from '../game';

/** The course the panels show: the one picked in the HUD, else the first. 0 when there is none yet. */
export function activeCourseId(g: Game): number {
  if (g.activeCourseId && g.courses.get(g.activeCourseId)) return g.activeCourseId;
  return g.courses.list[0]?.id ?? 0;
}

registerSaveable({
  key: 'activeCourse',
  save: g => g.activeCourseId,
  load: (g, d) => { g.activeCourseId = Number(d) || 0; },
});
