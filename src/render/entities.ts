import { Container, Graphics } from 'pixi.js';
import { TeeKind } from '../sim/course/course';
import { Game } from '../sim/game';
import { TILE_PX } from './camera';
import { UI_COLORS } from './palette';

const TEE_HEX: Record<TeeKind, number> = { championship: 0x202020, back: 0x4a7ad8, middle: 0xf0f0f0, forward: 0xe23b3b };
const STRUCT_HEX = { shelter: 0x8a5a30, restroom: 0xc0c0d0, ballWasher: 0x3060c0, bench: 0x7a5030, drinkStation: 0x30a0a0 } as const;

/**
 * Course furniture drawn in world-pixel space: flags at active pins, tee markers, stake dots,
 * structures, and (for the selected hole) its route and all pin positions.
 * Redrawn only when something changes (edits, commands) or the selection changes.
 */
export class EntityLayer {
  readonly container = new Container();
  private gfx = new Graphics();
  private dirty = true;

  constructor(private g: Game, private selected: () => number | null) {
    this.container.addChild(this.gfx);
    for (const ev of ['edit', 'cash', 'day', 'notify'] as const) g.events.on(ev, () => { this.dirty = true; });
  }
  invalidate(): void { this.dirty = true; }

  update(pxPerTile: number): void {
    // cheap at course scale; redraw every frame so course commands (pins, tees) show at once
    void this.dirty;
    this.dirty = false;
    this.lastScale = pxPerTile;
    const gfx = this.gfx.clear();
    const s = Math.max(1, TILE_PX / pxPerTile); // keep markers readable when zoomed out
    const c = (v: { x: number; y: number }) => ({ x: (v.x + 0.5) * TILE_PX, y: (v.y + 0.5) * TILE_PX });
    const sel = this.selected();

    for (const st of this.g.structures) {
      const p = c(st.at);
      gfx.rect(p.x - 6 * s, p.y - 6 * s, 12 * s, 12 * s).fill(STRUCT_HEX[st.kind]).stroke({ width: s, color: 0x000000 });
    }
    for (const ho of this.g.courses.allHoles()) {
      const isSel = ho.id === sel;
      if (isSel) {
        const r = ho.route.map(c);
        gfx.moveTo(r[0]!.x, r[0]!.y);
        for (const p of r.slice(1)) gfx.lineTo(p.x, p.y);
        gfx.stroke({ width: 2 * s, color: 0xffffff, alpha: 0.6 });
        ho.pins.forEach((pin, i) => {
          const p = c(pin);
          gfx.circle(p.x, p.y, 4 * s).fill({ color: i === ho.activePin ? UI_COLORS.flag : 0xffffff, alpha: 0.9 }).stroke({ width: s, color: 0x000000 });
        });
      }
      for (const t of ho.teeBoxes) {
        const p = c(t.marker);
        for (const dx of [-12, 12]) gfx.circle(p.x + dx * s * 0.5, p.y, 3 * s).fill(TEE_HEX[t.kind]).stroke({ width: s * 0.5, color: 0x000000 });
      }
      for (const [kind, color] of [['ob', UI_COLORS.ob], ['red', UI_COLORS.red], ['yellow', UI_COLORS.yellow]] as const) {
        for (const at of ho.stakes[kind]) { const p = c(at); gfx.rect(p.x - 2 * s, p.y - 2 * s, 4 * s, 4 * s).fill(color); }
      }
      const pin = ho.pins[ho.activePin];
      if (pin && ho.state !== 'construction') {
        const p = c(pin);
        gfx.moveTo(p.x, p.y).lineTo(p.x, p.y - 28 * s).stroke({ width: 2 * s, color: 0xf0f0f0 });
        gfx.poly([p.x, p.y - 28 * s, p.x + 14 * s, p.y - 23 * s, p.x, p.y - 18 * s]).fill(UI_COLORS.flag);
        gfx.circle(p.x, p.y, 2 * s).fill(0x101010);
      } else if (pin) {
        const p = c(pin);
        gfx.circle(p.x, p.y, 3 * s).fill({ color: UI_COLORS.flag, alpha: 0.8 });
      }
    }
  }
  private lastScale = 0;
}
