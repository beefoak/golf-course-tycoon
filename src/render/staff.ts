import { Container, Sprite, Texture } from 'pixi.js';
import { Vec2 } from '../core/geom';
import { Game } from '../sim/game';
import { isWorking } from '../sim/staff/staff';
import { Atlas, SpriteArt } from './atlas';
import { Camera, TILE_PX } from './camera';

const texCache = new Map<string, Texture>();
function artTexture(key: string, art: SpriteArt): Texture {
  let t = texCache.get(key);
  if (!t) {
    const canvas = document.createElement('canvas');
    canvas.width = art.w; canvas.height = art.h;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(new Uint32Array(art.px).buffer), art.w, art.h), 0, 0);
    t = Texture.from(canvas);
    t.source.scaleMode = 'nearest';
    texCache.set(key, t);
  }
  return t;
}

/** Grounds crew and operations staff on the map (walking, or riding a mower). */
export class StaffLayer {
  readonly container = new Container();
  private sprites: Sprite[] = [];
  private last = new Map<number, Vec2>();
  hits: { id: number; at: Vec2 }[] = [];
  followed: () => number | null = () => null;

  constructor(private g: Game, private atlas: Atlas) {}

  update(camera: Camera, viewW: number, viewH: number, nowMs: number): void {
    const a = camera.screenToTile(0, 0, viewW, viewH), b = camera.screenToTile(viewW, viewH, viewW, viewH);
    const scale = Math.max(2, 2 / camera.zoom);
    const frame = Math.floor((nowMs / 1000) * 6) % 4;
    let used = 0;
    this.hits = [];
    const take = (tex: Texture) => {
      let sp = this.sprites[used];
      if (!sp) { sp = new Sprite(tex); sp.anchor.set(0.5, 1); this.sprites.push(sp); this.container.addChild(sp); }
      sp.texture = tex; sp.visible = true; sp.scale.set(scale); used++;
      return sp;
    };
    for (const s of this.g.staff.all) {
      if (s.trainingUntilDay > this.g.day) continue;
      const p = s.pos;
      if (p.x < a.x - 4 || p.y < a.y - 4 || p.x > b.x + 4 || p.y > b.y + 4) continue;
      // off-shift crew at the shed are not drawn
      if (!isWorking(this.g, s) && !s.agent?.path.length) continue;
      const prev = this.last.get(s.id);
      const moving = !!prev && (prev.x !== p.x || prev.y !== p.y);
      this.last.set(s.id, { ...p });
      this.hits.push({ id: s.id, at: p });
      const tint = s.id === this.followed() ? 0xffff80 : 0xffffff;
      if (s.equipmentId !== null) {
        const m = take(artTexture('mower', this.atlas.sprite('mower', 0)));
        m.position.set(p.x * TILE_PX, (p.y + 0.3) * TILE_PX);
        m.tint = tint;
      }
      const f = moving ? frame : 1;
      const sp = take(artTexture(`staff:${f}`, this.atlas.sprite('staff_walk', f)));
      sp.position.set(p.x * TILE_PX, p.y * TILE_PX);
      sp.tint = tint;
    }
    for (let i = used; i < this.sprites.length; i++) this.sprites[i]!.visible = false;
  }

  pick(t: Vec2, zoom: number): number | null {
    let best: number | null = null, bestD = Math.max(1.5, 1.5 / zoom);
    for (const h of this.hits) {
      const d = Math.hypot(h.at.x - t.x, h.at.y - 0.6 - t.y);
      if (d < bestD) { bestD = d; best = h.id; }
    }
    return best;
  }
}
