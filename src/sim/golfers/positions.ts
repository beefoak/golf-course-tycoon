import { Vec2 } from '../../core/geom';
import type { Game } from '../game';
import { Group } from './groups';

/** Where each member of a group stands right now (tile coords). */
export function memberPositions(grp: Group): Map<number, Vec2> {
  const out = new Map<number, Vec2>();
  const n = grp.golferIds.length;
  grp.golferIds.forEach((id, k) => {
    if (grp.current === id) {
      const b = grp.balls.get(id);
      if (b) { out.set(id, { x: b.pos.x - 0.4, y: b.pos.y + 0.2 }); return; }
    }
    // stand in a small arc around the group position
    const a = (k / Math.max(1, n)) * Math.PI * 2 + 0.6;
    out.set(id, { x: grp.pos.x + Math.cos(a) * 0.9, y: grp.pos.y + Math.sin(a) * 0.9 });
  });
  return out;
}

export function groupOf(g: Game, golferId: number): Group | undefined {
  return g.groups.find(x => x.started && x.phase !== 'done' && x.golferIds.includes(golferId));
}

export function golferPosition(g: Game, golferId: number): Vec2 | null {
  const grp = groupOf(g, golferId);
  return grp ? memberPositions(grp).get(golferId) ?? null : null;
}
