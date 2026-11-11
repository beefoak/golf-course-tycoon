import { EventBus } from '../core/events';
import { Vec2 } from '../core/geom';
import { Result, fail, ok } from '../core/result';
import { Rng } from '../core/rng';
import { GameClock } from './clock';
import { Command } from './commands';
import { Difficulty, STARTING_CASH } from './difficulty';
import { Ledger } from './economy/ledger';
import { ParcelGrid } from './land/parcels';
import { commitPlan } from './construction/plan';
import { planSurfacePaint } from './construction/paint';
import { planTerrain } from './construction/terrain';
import { CourseRegistry } from './course/course';
import { handleCourseCommand, isCourseCommand } from './course/courseCommands';
import { commitPenHole } from './course/pen';
import { attachLifecycle, closeHole, reopenHole, startGrowIn } from './course/lifecycle';
import { computeStakes, planBunker, planDigWater, planFillWater, planRemoveTrees, planTrees } from './construction/hazards';
import { Structure, placeStructure, planBridge, planPath } from './construction/paths';
import { Surface } from './world/tiles';
import { PARCEL_TILES } from '../core/units';
import { generateWorld } from './world/mapgen';
import { TerrainType } from './world/terrainTypes';
import { World } from './world/world';

export interface NewGameOptions {
  seed: number;
  terrain: TerrainType;
  difficulty: Difficulty;
  size?: number;
}

export interface Notification {
  id: number;
  kind: 'info' | 'warn' | 'bad';
  text: string;
  at?: Vec2;
}

export type GameEvents = {
  day: { day: number };
  minute: { minute: number };
  notify: Notification;
  cash: { cash: number };
  edit: { tiles: number[] };
};

export interface System {
  name: string;
  onTick?(g: Game): void;
  onMinute?(g: Game): void;
  onDay?(g: Game): void;
}

export class Game {
  readonly seed: number;
  readonly terrain: TerrainType;
  readonly difficulty: Difficulty;
  world: World;
  parcels: ParcelGrid;
  ledger: Ledger;
  clock = new GameClock();
  rng: Rng;
  events = new EventBus<GameEvents>();
  soilStockpileM3 = 0;
  courses = new CourseRegistry();
  structures: Structure[] = [];
  /** consumed by the reputation system (Task 40) */
  pendingReputationEvents: { kind: 'specimenRemoved'; at: Vec2 }[] = [];
  private systems: System[] = [];
  private notifySeq = 0;

  private constructor(o: NewGameOptions, world: World) {
    this.seed = o.seed;
    this.terrain = o.terrain;
    this.difficulty = o.difficulty;
    this.world = world;
    this.rng = new Rng(o.seed).fork('sim');
    this.parcels = ParcelGrid.fromWorld(world, new Rng(o.seed).fork('parcels'));
    this.ledger = new Ledger(STARTING_CASH[o.difficulty]);
  }

  static create(o: NewGameOptions): Game {
    const g = new Game(o, generateWorld(o.seed, o.terrain, o.size));
    attachLifecycle(g);
    return g;
  }

  /** Number of golfer groups currently on a hole (replaced by the group system, Task 20). */
  groupsOnHole: (holeId: number) => number = () => 0;

  get day(): number {
    return this.clock.day;
  }

  registerSystem(s: System): void {
    this.systems.push(s);
  }

  dispatch(c: Command): Result<unknown> {
    const before = this.ledger.cash;
    const r = this.handle(c);
    if (this.ledger.cash !== before) this.events.emit('cash', { cash: this.ledger.cash });
    return r;
  }

  private handle(c: Command): Result<unknown> {
    switch (c.t) {
      case 'buyParcel':
        return this.parcels.buy(c.px, c.py, this.ledger, this.day);
      case 'sellParcel':
        return this.parcels.sell(c.px, c.py, this.ledger, this.day, this.sellBlockedReason(c.px, c.py));
      case 'paint':
        return commitPlan(this, planSurfacePaint(this, c.tiles, c.surface), 'construction');
      case 'terrain':
        return commitPlan(this, planTerrain(this, c.tiles, c.op), 'earthworks');
      case 'penHole':
        return commitPenHole(this, c.input);
      case 'bunker':
        return commitPlan(this, planBunker(this, c.tiles, c.sand), 'construction');
      case 'digWater':
        return commitPlan(this, planDigWater(this, c.tiles), 'earthworks');
      case 'fillWater':
        return commitPlan(this, planFillWater(this, c.tiles), 'earthworks');
      case 'plantTrees':
        return commitPlan(this, planTrees(this, c.tiles, c.species, c.density), 'construction');
      case 'removeTrees':
        return commitPlan(this, planRemoveTrees(this, c.tiles), 'construction');
      case 'path':
        return commitPlan(this, planPath(this, c.tiles, c.tier), 'construction');
      case 'bridge':
        return commitPlan(this, planBridge(this, c.tiles), 'construction');
      case 'placeStructure':
        return placeStructure(this, c.kind, c.at);
      case 'startGrowIn':
        return startGrowIn(this, c.holeId, c.method);
      case 'closeHole':
        return closeHole(this, c.holeId);
      case 'reopenHole':
        return reopenHole(this, c.holeId, c.method);
      case 'refreshStakes': {
        const h = this.courses.hole(c.holeId);
        if (!h) return fail('No such hole');
        h.stakes = computeStakes(this, h);
        return ok(h.stakes);
      }
      case 'setStakeOverride': {
        const h = this.courses.hole(c.holeId);
        if (!h) return fail('No such hole');
        h.stakeOverrides.add.push({ kind: c.kind, at: { x: Math.round(c.at.x), y: Math.round(c.at.y) } });
        h.stakes = computeStakes(this, h);
        return ok(h.stakes);
      }
      default:
        if (isCourseCommand(c)) return handleCourseCommand(this, c);
        return fail(`Unknown command ${(c as { t: string }).t}`);
    }
  }

  /** A parcel can't be sold while a hole or a building sits on it. */
  protected sellBlockedReason(px: number, py: number): string | undefined {
    const w = this.world;
    for (let y = py * PARCEL_TILES; y < Math.min(w.size, (py + 1) * PARCEL_TILES); y++) {
      for (let x = px * PARCEL_TILES; x < Math.min(w.size, (px + 1) * PARCEL_TILES); x++) {
        const i = w.idx(x, y);
        const hid = w.holeId[i]!;
        if (hid) return `hole ${this.courses.hole(hid)?.number ?? '?'} is on this parcel`;
        if (w.surface[i] === Surface.Building) return 'a building is on this parcel';
      }
    }
    return undefined;
  }

  /** Why tiles of this hole can't be edited right now (open/closing), or null. */
  holeLockReason(holeId: number): string | null {
    const h = this.courses.hole(holeId);
    if (!h) return null;
    if (h.state === 'open' || h.state === 'closing') return `${h.name} is open (close it to edit)`;
    return null;
  }

  tick(): void {
    const { newMinute, newDay } = this.clock.step();
    for (const s of this.systems) s.onTick?.(this);
    if (newMinute) {
      for (const s of this.systems) s.onMinute?.(this);
      this.events.emit('minute', { minute: this.clock.minuteOfDay });
    }
    if (newDay) {
      for (const s of this.systems) s.onDay?.(this);
      this.events.emit('day', { day: this.clock.day });
    }
  }

  notify(kind: Notification['kind'], text: string, at?: Vec2): void {
    this.events.emit('notify', { id: ++this.notifySeq, kind, text, at });
  }
}
