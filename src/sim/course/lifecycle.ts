import { Result, fail, ok } from '../../core/result';
import { computeStakes } from '../construction/hazards';
import type { Game, System } from '../game';
import { Surface } from '../world/tiles';
import { validateHole } from './validate';

export type GrowMethod = 'seed' | 'sod';
export const GROW_IN_DAYS: Record<GrowMethod, number> = { seed: 21, sod: 3 };
export const GROW_IN_COST_PER_TILE: Record<GrowMethod, number> = { seed: 2, sod: 12 };
const TURF = new Set<Surface>([Surface.Tee, Surface.Fairway, Surface.Green, Surface.Fringe, Surface.FirstCut]);

function turfTileCount(g: Game, holeId: number): number {
  const w = g.world;
  let n = 0;
  for (let i = 0; i < w.holeId.length; i++) if (w.holeId[i] === holeId && TURF.has(w.surface[i] as Surface)) n++;
  return n;
}

export function startGrowIn(g: Game, holeId: number, method: GrowMethod): Result {
  const h = g.courses.hole(holeId);
  if (!h) return fail('No such hole');
  if (h.state !== 'construction' && h.state !== 'closed') return fail(`${h.name} is already ${h.state === 'growingIn' ? 'growing in' : h.state}`);
  const v = validateHole(g, h);
  if (v.errors.length) return fail(v.errors[0]!);
  const cost = turfTileCount(g, holeId) * GROW_IN_COST_PER_TILE[method];
  if (!g.ledger.spend(cost, 'construction', g.day, h.courseId)) return fail(`Not enough money ($${cost.toLocaleString()} needed)`);
  h.state = 'growingIn';
  h.growInDaysLeft = GROW_IN_DAYS[method];
  h.editedSinceClose = false;
  return ok(undefined);
}

export function closeHole(g: Game, holeId: number): Result {
  const h = g.courses.hole(holeId);
  if (!h) return fail('No such hole');
  if (h.state !== 'open') return fail(`${h.name} is not open`);
  h.state = 'closing';
  h.editedSinceClose = false;
  return ok(undefined);
}

export function reopenHole(g: Game, holeId: number, method: GrowMethod = 'sod'): Result {
  const h = g.courses.hole(holeId);
  if (!h) return fail('No such hole');
  if (h.state !== 'closed') return fail(`${h.name} is not closed`);
  if (h.editedSinceClose) return startGrowIn(g, holeId, method);
  const v = validateHole(g, h);
  if (v.errors.length) return fail(v.errors[0]!);
  h.state = 'open';
  h.stakes = computeStakes(g, h);
  return ok(undefined);
}

export const lifecycleSystem: System = {
  name: 'lifecycle',
  onTick(g) {
    for (const c of g.courses.list) for (const h of c.holes) {
      if (h.state === 'closing' && g.groupsOnHole(h.id) === 0) {
        h.state = 'closed';
        g.notify('info', `${h.name} is now closed`);
      }
    }
  },
  onDay(g) {
    for (const c of g.courses.list) for (const h of c.holes) {
      if (h.state !== 'growingIn') continue;
      h.growInDaysLeft = Math.max(0, h.growInDaysLeft - 1);
      if (h.growInDaysLeft === 0) {
        h.state = 'open';
        h.editedSinceClose = false;
        h.stakes = computeStakes(g, h);
        g.notify('info', `${h.name} has grown in and is open for play`, h.greenCenter);
      }
    }
  },
};

/** Mark closed holes as edited when their tiles change. */
export function attachLifecycle(g: Game): void {
  g.registerSystem(lifecycleSystem);
  g.events.on('edit', ({ tiles }) => {
    for (const i of tiles) {
      const id = g.world.holeId[i];
      if (!id) continue;
      const h = g.courses.hole(id);
      if (h && h.state === 'closed') h.editedSinceClose = true;
    }
  });
}
