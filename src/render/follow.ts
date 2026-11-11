import { Game } from '../sim/game';
import { golferPosition } from '../sim/golfers/positions';
import { Camera } from './camera';

export const FOLLOW_LERP = 0.15;

/** Keeps the camera centred on a golfer or crew member, smoothed. Clears itself when they leave. */
export class FollowCam {
  target: { kind: 'golfer' | 'staff'; id: number } | null = null;

  update(camera: Camera, g: Game): void {
    if (!this.target) return;
    const p = this.target.kind === 'staff' ? g.staff.get(this.target.id)?.pos ?? null : golferPosition(g, this.target.id);
    if (!p) { this.target = null; return; }
    camera.x += (p.x - camera.x) * FOLLOW_LERP;
    camera.y += (p.y - camera.y) * FOLLOW_LERP;
  }
}
