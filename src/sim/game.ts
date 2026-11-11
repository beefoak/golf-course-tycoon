import { EventBus } from '../core/events';
import { Vec2 } from '../core/geom';
import { Result, fail } from '../core/result';
import { Rng } from '../core/rng';
import { GameClock } from './clock';
import { Command } from './commands';
import { Difficulty, STARTING_CASH } from './difficulty';
import { Ledger } from './economy/ledger';
import { ParcelGrid } from './land/parcels';
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
    return new Game(o, generateWorld(o.seed, o.terrain, o.size));
  }

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
      default:
        return fail(`Unknown command ${(c as { t: string }).t}`);
    }
  }

  /** Extended by later tasks (holes, buildings on the parcel). */
  protected sellBlockedReason(_px: number, _py: number): string | undefined {
    return undefined;
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
