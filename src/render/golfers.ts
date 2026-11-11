import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { Vec2 } from '../core/geom';
import { Game } from '../sim/game';
import { Group } from '../sim/golfers/groups';
import { memberPositions } from '../sim/golfers/positions';
import { Atlas, SpriteArt } from './atlas';
import { Camera, TILE_PX } from './camera';

const texCache = new Map<string, Texture>();
function artTexture(name: string, frame: number, art: SpriteArt): Texture {
  const key = `${name}:${frame}`;
  let t = texCache.get(key);
  if (!t) {
    const canvas = document.createElement('canvas');
    canvas.width = art.w; canvas.height = art.h;
    const ctx = canvas.getContext('2d')!;
    const px = new Uint32Array(art.px);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), art.w, art.h), 0, 0);
    t = Texture.from(canvas);
    t.source.scaleMode = 'nearest';
    texCache.set(key, t);
  }
  return t;
}

/** Real seconds a ball takes to fly (scaled down at high game speed). */
const FLIGHT_SEC = 1.2;

interface Flight { from: Vec2; to: Vec2; rest: Vec2; t0: number; dur: number; height: number; golferId: number }

/**
 * Golfers, balls and shots: members drawn with the walk/swing sprites, resting balls of the current
 * hole, balls in flight on a parabola (real time), and a tracer for the followed golfer's shots.
 */
export class GolferLayer {
  readonly container = new Container();
  private sprites: Sprite[] = [];
  private gfx = new Graphics();
  private flights: Flight[] = [];
  private seen = new WeakMap<Group, unknown>();
  private tracer: { pts: Vec2[]; until: number } | null = null;
  followed: () => number | null = () => null;
  speed: () => number = () => 1;

  constructor(private g: Game, private atlas: Atlas) {
    this.container.addChild(this.gfx);
  }

  /** Visible members' screen-independent positions, for hit-testing clicks. */
  hits: { id: number; at: Vec2 }[] = [];

  update(camera: Camera, viewW: number, viewH: number, nowMs: number): void {
    const now = nowMs / 1000;
    const gfx = this.gfx.clear();
    const a = camera.screenToTile(0, 0, viewW, viewH), b = camera.screenToTile(viewW, viewH, viewW, viewH);
    const inView = (p: Vec2) => p.x >= a.x - 4 && p.y >= a.y - 4 && p.x <= b.x + 4 && p.y <= b.y + 4;
    const scale = Math.max(2, 2 / camera.zoom);
    const s = Math.max(1, 1 / camera.zoom);
    let used = 0;
    this.hits = [];
    const walkFrame = Math.floor(now * 6) % 4;

    for (const grp of this.g.groups) {
      if (!grp.started || grp.phase === 'done') continue;
      // new shot → start a flight
      if (grp.lastShot && this.seen.get(grp) !== grp.lastShot) {
        this.seen.set(grp, grp.lastShot);
        const r = grp.lastShot.rec;
        const putt = r.club === 'P';
        const dist = Math.hypot(r.landing.x - r.from.x, r.landing.y - r.from.y);
        const dur = (putt ? 0.8 : FLIGHT_SEC) / Math.max(1, this.speed());
        this.flights.push({ from: r.from, to: r.landing, rest: r.final, t0: now, dur, height: putt ? 0 : Math.min(40, dist * 0.25), golferId: grp.lastShot.golferId });
        if (grp.lastShot.golferId === this.followed()) this.tracer = { pts: [r.from, r.landing, r.final], until: now + 6 };
      }
      const pos = memberPositions(grp);
      const walking = grp.path.length > 0;
      for (const id of grp.golferIds) {
        const p = pos.get(id)!;
        if (!inView(p)) continue;
        this.hits.push({ id, at: p });
        const swinging = grp.current === id && grp.busySec > 0 && grp.busySec <= 12;
        const art = swinging ? this.atlas.sprite('golfer_swing', grp.busySec > 6 ? 0 : 1) : this.atlas.sprite('golfer_walk', walking ? walkFrame : 1);
        const tex = artTexture(swinging ? 'swing' : 'walk', swinging ? (grp.busySec > 6 ? 0 : 1) : walking ? walkFrame : 1, art);
        let sp = this.sprites[used];
        if (!sp) { sp = new Sprite(tex); sp.anchor.set(0.5, 1); this.sprites.push(sp); this.container.addChild(sp); }
        sp.texture = tex;
        sp.visible = true;
        sp.scale.set(scale);
        sp.position.set(p.x * TILE_PX, p.y * TILE_PX);
        sp.tint = id === this.followed() ? 0xffff80 : 0xffffff;
        used++;
      }
      // resting balls on this hole (not the one in the air)
      for (const ball of grp.balls.values()) {
        if (ball.done || this.flights.some(f => f.golferId === ball.golferId)) continue;
        if (!inView(ball.pos)) continue;
        gfx.circle(ball.pos.x * TILE_PX, ball.pos.y * TILE_PX, 2.2 * s).fill(0xffffff).stroke({ width: 0.6 * s, color: 0x000000 });
      }
    }
    for (let i = used; i < this.sprites.length; i++) this.sprites[i]!.visible = false;

    // flights
    this.flights = this.flights.filter(f => now - f.t0 < f.dur + 0.6);
    for (const f of this.flights) {
      const t = Math.min(1, (now - f.t0) / f.dur);
      let x: number, y: number;
      if (t < 1) {
        x = f.from.x + (f.to.x - f.from.x) * t;
        y = f.from.y + (f.to.y - f.from.y) * t - (f.height * 4 * t * (1 - t)) / TILE_PX * 2;
        gfx.circle(f.from.x * TILE_PX + (f.to.x - f.from.x) * t * TILE_PX, (f.from.y + (f.to.y - f.from.y) * t) * TILE_PX, 1.8 * s).fill({ color: 0x000000, alpha: 0.35 });
      } else {
        const u = Math.min(1, (now - f.t0 - f.dur) / 0.6);
        x = f.to.x + (f.rest.x - f.to.x) * u;
        y = f.to.y + (f.rest.y - f.to.y) * u;
      }
      gfx.circle(x * TILE_PX, y * TILE_PX, 2.4 * s).fill(0xffffff).stroke({ width: 0.6 * s, color: 0x000000 });
    }
    if (this.tracer && now < this.tracer.until) {
      const [p0, p1, p2] = this.tracer.pts as [Vec2, Vec2, Vec2];
      gfx.moveTo(p0.x * TILE_PX, p0.y * TILE_PX).lineTo(p1.x * TILE_PX, p1.y * TILE_PX).stroke({ width: 1.5 * s, color: 0xffe066, alpha: 0.9 });
      gfx.moveTo(p1.x * TILE_PX, p1.y * TILE_PX).lineTo(p2.x * TILE_PX, p2.y * TILE_PX).stroke({ width: 1 * s, color: 0xffffff, alpha: 0.7 });
    } else this.tracer = null;
  }

  /** Golfer under a tile-space point (within ~1.5 tiles at zoom 1). */
  pick(t: Vec2, zoom: number): number | null {
    let best: number | null = null, bestD = Math.max(1.5, 1.5 / zoom);
    for (const h of this.hits) {
      const d = Math.hypot(h.at.x - t.x, h.at.y - 0.6 - t.y);
      if (d < bestD) { bestD = d; best = h.id; }
    }
    return best;
  }
}
