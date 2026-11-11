import { REAL_MS_PER_TICK_1X } from './clock';
import { Game } from './game';

export const MAX_TICKS_PER_FRAME = 200;
export type Speed = 0 | 1 | 2 | 4 | 8;

/** Converts real elapsed time into fixed sim ticks. */
export class GameLoop {
  speed: Speed = 1;
  private acc = 0;
  constructor(private game: Game) {}

  advance(realMs: number): number {
    if (this.speed === 0) { this.acc = 0; return 0; }
    this.acc += realMs * this.speed;
    let ticks = Math.floor(this.acc / REAL_MS_PER_TICK_1X);
    if (ticks > MAX_TICKS_PER_FRAME) { ticks = MAX_TICKS_PER_FRAME; this.acc = 0; }
    else this.acc -= ticks * REAL_MS_PER_TICK_1X;
    for (let i = 0; i < ticks; i++) this.game.tick();
    return ticks;
  }
}
