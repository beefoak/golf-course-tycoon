import { Camera } from '../render/camera';
import { Game } from '../sim/game';
import { golferPosition } from '../sim/golfers/positions';
import { Thought, thoughtText } from '../sim/golfers/thoughts';
import { h } from './dom';

const LIFE_MS = 4000;
const MAX_BUBBLES = 6;

/** Short speech bubbles over golfers when a thought fires (4 real seconds). */
export class ThoughtBubbles {
  readonly el = h('div', { style: 'position:absolute;inset:0;pointer-events:none;overflow:hidden' });
  private items: { golferId: number; node: HTMLElement; until: number }[] = [];

  constructor(private g: Game, private priority: () => number | null) {
    g.events.on('thought', t => this.add(t));
  }

  private add(t: Thought): void {
    if (!golferPosition(this.g, t.golferId)) return;
    const mine = t.golferId === this.priority();
    if (this.items.length >= MAX_BUBBLES && !mine) return;
    const node = h('div', { class: 'px', style: `position:absolute;transform:translate(-50%,-100%);background:#fffbe8;color:#222;border:2px solid #222;padding:4px 6px;font-size:8px;line-height:1.4;max-width:180px;white-space:normal;${mine ? 'z-index:2' : 'opacity:0.92'}` }, thoughtText(t));
    this.el.appendChild(node);
    this.items.push({ golferId: t.golferId, node, until: performance.now() + LIFE_MS });
  }

  update(camera: Camera, viewW: number, viewH: number): void {
    const now = performance.now();
    this.items = this.items.filter(b => {
      const p = golferPosition(this.g, b.golferId);
      if (now > b.until || !p) { b.node.remove(); return false; }
      const s = camera.tileToScreen(p.x, p.y - 1.4 / Math.max(0.25, camera.zoom), viewW, viewH);
      b.node.style.left = `${Math.round(s.x)}px`;
      b.node.style.top = `${Math.round(s.y - 18)}px`;
      return true;
    });
  }
}
