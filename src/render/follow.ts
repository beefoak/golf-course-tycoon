import { Game } from '../sim/game';
import { golferPosition } from '../sim/golfers/positions';
import { Camera } from './camera';

export const FOLLOW_LERP = 0.15;

/** Keeps the camera centred on a golfer, smoothed. Clears itself when the golfer leaves the course. */
export class FollowCam {
  target: { kind: 'golfer'; id: number } | null = null;

  update(camera: Camera, g: Game): void {
    if (!this.target) return;
    const p = golferPosition(g, this.target.id);
    if (!p) { this.target = null; return; }
    camera.x += (p.x - camera.x) * FOLLOW_LERP;
    camera.y += (p.y - camera.y) * FOLLOW_LERP;
  }
}
