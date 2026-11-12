import { Vec2 } from '../core/geom';
import { Rng } from '../core/rng';
import { TILE_M } from '../core/units';
import { Hole, TeeKind } from '../sim/course/course';
import { holePar } from '../sim/course/yardage';
import type { Game } from '../sim/game';
import { ClubSpec, clubSet } from '../sim/golfers/clubs';
import { teeSheetFor } from '../sim/golfers/demand';
import { Lie, lieAt } from '../sim/golfers/lie';
import { registerSaveable } from '../sim/saveRegistry';
import { Surface } from '../sim/world/tiles';
import { SwingMeter, playerShot, rollPutt } from './swing';

export interface PlayerHoleScore { holeId: number; number: number; par: number; strokes: number }
export interface PlayerRound { day: number; courseId: number; tee: TeeKind; handicap: number; scores: PlayerHoleScore[]; total: number; toPar: number }

export interface PlayOptions { handicap: number; tee: TeeKind; holeIds?: number[] }

/** Club difficulty: long clubs make the meter run faster. */
export function meterSpeed(club: ClubSpec): number {
  return club.id === 'P' ? 0.8 : 0.9 + 0.35 * Math.min(1, club.carryM / 230);
}

/** One round of the player's own golf on a course they built. */
export class PlayMode {
  readonly holes: Hole[];
  readonly clubs: ClubSpec[];
  idx = 0;
  strokes = 0;
  pos: Vec2 = { x: 0, y: 0 };
  lie: Lie = 'tee';
  aim: Vec2 | null = null;
  club: ClubSpec;
  meter: SwingMeter;
  /** the last ball flight and roll, for drawing */
  lastPath: Vec2[] = [];
  lastText = '';
  scores: PlayerHoleScore[] = [];
  done = false;
  teeTime: number | null = null;
  /** the saved card, once the round is over */
  private carded: PlayerRound | null = null;
  private rng: Rng;

  constructor(private g: Game, readonly courseId: number, readonly opts: PlayOptions) {
    const course = g.courses.get(courseId);
    const open = (course?.holes ?? []).filter(h => h.state === 'open' && h.teeBoxes.length).sort((a, b) => a.number - b.number);
    this.holes = opts.holeIds ? open.filter(h => opts.holeIds!.includes(h.id)) : open;
    this.clubs = clubSet(opts.handicap, 35);
    this.club = this.clubs[0]!;
    this.meter = new SwingMeter(meterSpeed(this.club));
    this.rng = new Rng((g.seed ^ Math.imul(g.day, 7919) ^ courseId) >>> 0);
    // the player's group takes a tee time like anyone else
    const sheet = teeSheetFor(g, courseId);
    const len = this.holes.length || 1;
    this.teeTime = sheet.nearestFree(g.day, g.clock.minuteOfDay + 10, len);
    if (this.teeTime !== null) sheet.book(g.day, this.teeTime, -1, len, 1);
    if (!this.holes.length) this.done = true;
    else this.startHole();
  }

  hole(): Hole | undefined { return this.holes[this.idx]; }
  pin(): Vec2 { const h = this.hole()!; return h.pins[h.activePin] ?? h.greenCenter; }
  par(): number { return holePar(this.hole()!); }
  isPutting(): boolean { return this.lie === 'green' || this.g.world.surface[this.g.world.idx(Math.floor(this.pos.x), Math.floor(this.pos.y))] === Surface.Green; }
  distanceM(): number { const p = this.pin(); return Math.hypot(p.x - this.pos.x, p.y - this.pos.y) * TILE_M; }

  private startHole(): void {
    const h = this.hole()!;
    const order: TeeKind[] = ['championship', 'back', 'middle', 'forward'];
    const tee = h.teeBoxes.slice().sort((a, b) => Math.abs(order.indexOf(a.kind) - order.indexOf(this.opts.tee)) - Math.abs(order.indexOf(b.kind) - order.indexOf(this.opts.tee)))[0]!;
    this.pos = { x: tee.center.x + 0.5, y: tee.center.y + 0.5 };
    this.lie = 'tee';
    this.strokes = 0;
    this.aim = { ...this.pin() };
    this.lastPath = [];
    this.pickClub();
  }

  /** The shortest club that still reaches the aim point (the putter on the green). */
  pickClub(): void {
    if (this.isPutting()) this.club = this.clubs.find(c => c.id === 'P')!;
    else {
      const want = this.aim ? Math.hypot(this.aim.x - this.pos.x, this.aim.y - this.pos.y) * TILE_M : this.distanceM();
      const full = this.clubs.filter(c => c.id !== 'P' && !(this.lie !== 'tee' && c.id === 'D'));
      this.club = full.slice().reverse().find(c => c.carryM >= want) ?? full[0]!;
    }
    this.meter = new SwingMeter(meterSpeed(this.club));
  }
  setClub(id: string): void {
    const c = this.clubs.find(x => x.id === id);
    if (c) { this.club = c; this.meter = new SwingMeter(meterSpeed(c)); }
  }
  setAim(t: Vec2): void { this.aim = { ...t }; if (!this.isPutting()) this.pickClub(); }

  /** Feed a meter press; the swing happens when the meter is done. Returns true when a shot was played. */
  press(): boolean {
    if (this.done) return false;
    this.meter.press();
    if (this.meter.phase !== 'done') return false;
    this.swing(this.meter);
    this.meter = new SwingMeter(meterSpeed(this.club));
    return true;
  }

  swing(meter: SwingMeter): void {
    const g = this.g;
    const aim = this.aim ?? this.pin();
    this.strokes++;
    if (this.isPutting() || this.club.id === 'P') {
      const r = rollPutt(g, this.pos, aim, meter.power, this.pin());
      this.lastPath = r.path;
      this.pos = r.final;
      this.lastText = r.holed ? 'In the hole!' : `${(this.distanceM()).toFixed(1)} m left`;
      if (r.holed) return this.holeOut();
    } else {
      const from = { ...this.pos };
      const out = playerShot(g, { handicap: this.opts.handicap, pos: from, lie: this.lie, wind: g.weather.wind, rng: this.rng }, aim, this.club, meter);
      this.lastPath = [from, ...out.path];
      if (out.result === 'water') { this.strokes++; this.pos = from; this.lastText = 'Splash — one-stroke penalty, play again'; }
      else if (out.result === 'ob' || out.result === 'lost') { this.strokes++; this.pos = from; this.lastText = 'Out of bounds — stroke and distance'; }
      else if (out.result === 'unplayable') { this.strokes++; this.pos = from; this.lastText = 'Unplayable — penalty stroke'; }
      else {
        this.pos = out.final;
        this.lastText = `${Math.round(out.carryM)} m carry · ${Math.round(this.distanceM())} m to go`;
        if (this.distanceM() < 0.06) { this.lastText = 'Holed it!'; return this.holeOut(); }
      }
    }
    this.lie = lieAt(g.world, this.pos);
    // double par: pick up
    if (this.strokes >= this.par() * 2) { this.lastText = 'Picked up at double par'; this.strokes = this.par() * 2; return this.holeOut(); }
    this.aim = { ...this.pin() };
    this.pickClub();
  }

  private holeOut(): void {
    const h = this.hole()!;
    this.scores.push({ holeId: h.id, number: h.number, par: this.par(), strokes: this.strokes });
    this.idx++;
    if (this.idx >= this.holes.length) this.finish();
    else this.startHole();
  }

  /** Card in: the round is kept on the course's records. */
  finish(): PlayerRound | null {
    this.done = true;
    if (this.carded || !this.scores.length) return this.carded;
    
    const total = this.scores.reduce((s, x) => s + x.strokes, 0);
    const par = this.scores.reduce((s, x) => s + x.par, 0);
    const r: PlayerRound = { day: this.g.day, courseId: this.courseId, tee: this.opts.tee, handicap: this.opts.handicap, scores: this.scores.slice(), total, toPar: total - par };
    this.g.playerRounds.push(r);
    this.carded = r;
    return r;
  }
}

registerSaveable({
  key: 'playerRounds',
  save: g => g.playerRounds,
  load: (g, d) => { g.playerRounds = (d as PlayerRound[]) ?? []; },
});
