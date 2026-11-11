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
import { GolferPool } from './golfers/generate';
import { Group, countGroupsOnHole, groupSystem } from './golfers/groups';
import { attachDemand } from './golfers/demand';
import { attachRoundEffects } from './golfers/roundEffects';
import { attachTurf, newTurfState, setGrass, TurfState } from './turf/turf';
import { attachWeather, WeatherState } from './turf/weather';
import { practiceCommand, practicesSystem } from './turf/practices';
import { StaffRoster, setShift, setWage, train } from './staff/staff';
import { moraleSystem } from './staff/morale';
import { findCandidate } from './staff/market';
import { MaintenanceProgram, assignZone, createZone, removeProgramRule, setProgramRule } from './staff/program';
import { WorkOrderBook, createUrgentOrder, newOrderBook, pauseOrder, programSystem } from './staff/workOrders';
import { staffAgentSystem } from './staff/agents';
import { Fleet, assignEquipment, attachEquipment, buyEquipment, newFleet, sellEquipment, upgradeBuilding } from './staff/equipment';
import { attachIrrigation, IrrigationSystem, newIrrigation, placePipe, placePump, placeSprinkler, removeSprinkler, repairSprinkler, setSchedule } from './turf/irrigation';
import type { CourseStats } from './golfers/stats';
import type { Thought } from './golfers/thoughts';
import { Pricing, TeeSheet } from './golfers/teeSheet';
import { Building, placeBuilding } from './business/buildings';
import type { HoleResult } from './golfers/hole';
import { handleCourseCommand, isCourseCommand } from './course/courseCommands';
import { commitPenHole } from './course/pen';
import { planGreenShape } from './course/green';
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
  land: { px: number; py: number };
  holeComplete: { groupId: number; holeId: number; results: { golferId: number; result: HoleResult }[] };
  roundComplete: { groupId: number };
  roundStart: { groupId: number };
  thought: Thought;
  staff: { id: number };
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
  golfers = new GolferPool();
  /** groups booked or on course (finished groups are dropped) */
  groups: Group[] = [];
  nextGroupId = 1;
  buildings: Building[] = [];
  nextBuildingId = 1;
  teeSheets = new Map<number, TeeSheet>();
  /** courseId → pricing (absent = defaults) */
  pricing = new Map<number, Pricing>();
  /** most recent golfer thoughts (capped) */
  thoughts: Thought[] = [];
  /** thoughts of groups still on course (scored at round end) */
  roundThoughts = new Map<number, Thought[]>();
  /** courseId → rolling stats */
  stats = new Map<number, CourseStats>();
  /** walking traffic per 2×2-tile cell (fades daily) */
  footfall = new Uint16Array(0);
  turf: TurfState = newTurfState();
  weather!: WeatherState;
  weatherRng: Rng;
  irrigation: IrrigationSystem;
  staff = new StaffRoster();
  staffRng: Rng;
  equipment: Fleet = newFleet();
  programs = new Map<number, MaintenanceProgram>();
  workOrders: WorkOrderBook = newOrderBook();
  /** shot-time multiplier per course from starter/marshal (recomputed each minute) */
  pacePush = new Map<number, number>();
  /** group:hole keys that already grumbled about crew today */
  crewGrumbles = new Set<string>();
  structures: Structure[] = [];
  /** consumed by the reputation system (Task 40) */
  pendingReputationEvents: { kind: 'specimenRemoved'; at: Vec2 }[] = [];
  private systems: System[] = [];
  notifySeq = 0;

  private constructor(o: NewGameOptions, world: World) {
    this.seed = o.seed;
    this.terrain = o.terrain;
    this.difficulty = o.difficulty;
    this.world = world;
    this.rng = new Rng(o.seed).fork('sim');
    this.weatherRng = new Rng(o.seed).fork('weather');
    this.irrigation = newIrrigation(new Rng(o.seed));
    this.staffRng = new Rng(o.seed).fork('staff');
    this.parcels = ParcelGrid.fromWorld(world, new Rng(o.seed).fork('parcels'));
    this.ledger = new Ledger(STARTING_CASH[o.difficulty]);
  }

  static create(o: NewGameOptions): Game {
    return Game.wire(new Game(o, generateWorld(o.seed, o.terrain, o.size)));
  }

  /** A game around an existing world (save/load fills in the rest). */
  static fromSave(o: NewGameOptions, world: World): Game {
    return Game.wire(new Game(o, world));
  }

  private static wire(g: Game): Game {
    attachLifecycle(g);
    attachWeather(g);
    g.registerSystem(groupSystem);
    attachDemand(g);
    attachRoundEffects(g);
    attachTurf(g);
    attachIrrigation(g);
    g.registerSystem(practicesSystem);
    g.registerSystem(moraleSystem);
    attachEquipment(g);
    g.registerSystem(programSystem);
    g.registerSystem(staffAgentSystem);
    g.groupsOnHole = id => countGroupsOnHole(g, id);
    return g;
  }

  /** Number of golfer groups currently on a hole (wired to the group system in create()). */
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
      case 'buyParcel': {
        const r = this.parcels.buy(c.px, c.py, this.ledger, this.day);
        if (r.ok) this.events.emit('land', { px: c.px, py: c.py });
        return r;
      }
      case 'sellParcel': {
        const r = this.parcels.sell(c.px, c.py, this.ledger, this.day, this.sellBlockedReason(c.px, c.py));
        if (r.ok) this.events.emit('land', { px: c.px, py: c.py });
        return r;
      }
      case 'paint':
        return commitPlan(this, planSurfacePaint(this, c.tiles, c.surface), 'construction');
      case 'terrain':
        return commitPlan(this, planTerrain(this, c.tiles, c.op), 'earthworks');
      case 'shapeGreen': {
        const h = this.courses.hole(c.holeId);
        if (!h) return fail('No such hole');
        return commitPlan(this, planGreenShape(this, h, c.op, c.tiles), 'earthworks');
      }
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
      case 'placeBuilding':
        return placeBuilding(this, c.kind, c.courseId, c.origin);
      case 'setProgramRule':
        return setProgramRule(this, c.courseId, c.rule, c.index);
      case 'removeProgramRule':
        return removeProgramRule(this, c.courseId, c.index);
      case 'createZone':
        return createZone(this, c.courseId, c.name, c.holeIds);
      case 'assignZone':
        return assignZone(this, c.staffId, c.zone);
      case 'createUrgentOrder':
        return createUrgentOrder(this, c.courseId, c.practice, c.tiles);
      case 'pauseOrder':
        return pauseOrder(this, c.id, c.paused ?? true);
      case 'buyEquipment':
        return buyEquipment(this, c.courseId, c.kind, c.tier);
      case 'sellEquipment':
        return sellEquipment(this, c.id);
      case 'assignEquipment':
        return assignEquipment(this, c.id, c.staffId);
      case 'upgradeBuilding':
        return upgradeBuilding(this, c.buildingId, c.upgrade);
      case 'hireStaff': {
        const cand = findCandidate(this, c.candidateId);
        if (!cand) return fail('That candidate is no longer available');
        return this.staff.hire(this, cand, c.courseId);
      }
      case 'fireStaff':
        return this.staff.fire(this, c.id);
      case 'trainStaff':
        return train(this, c.id, c.skill);
      case 'setWage':
        return setWage(this, c.id, c.wagePerDay);
      case 'setShift':
        return setShift(this, c.id, c.startMin, c.endMin);
      case 'applyPractice':
        return practiceCommand(this, c.practice, c.tiles, c.opts);
      case 'placePump':
        return placePump(this, c.at, c.tier);
      case 'placeSprinkler':
        return placeSprinkler(this, c.at, c.zone);
      case 'removeSprinkler':
        return removeSprinkler(this, c.id);
      case 'repairSprinkler':
        return repairSprinkler(this, c.id);
      case 'placePipe':
        return placePipe(this, c.tiles);
      case 'setIrrigationSchedule':
        return setSchedule(this, c.schedule);
      case 'setGrass':
        return setGrass(this, c.tiles, c.grass, c.method);
      case 'setGreenFee': {
        if (!this.courses.get(c.courseId)) return fail('No such course');
        if (!Number.isInteger(c.holes) || c.holes < 1 || c.holes > 36) return fail('Round length must be 1–36 holes');
        if (!(c.fee >= 0) || c.fee > 1000) return fail('Fee must be between $0 and $1,000');
        const p = this.pricing.get(c.courseId) ?? { greenFee: {} };
        p.greenFee[c.holes] = Math.round(c.fee);
        this.pricing.set(c.courseId, p);
        return ok(p);
      }
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
