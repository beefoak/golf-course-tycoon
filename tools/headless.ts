/**
 * Headless balance runner: a scripted player builds a course and the sim runs flat out.
 *
 *   npx tsx tools/headless.ts --seed 1 --days 365 --terrain parkland [--holes 18] [--size 1000]
 *
 * The "basic18" script buys a block of land above the road, pens the holes in three rows of
 * corridors, seeds them, lays irrigation, builds a clubhouse and maintenance shed, buys the basic
 * fleet, hires a default crew and leaves the prices alone. It then reports money, rounds, scoring
 * by handicap band, reputation, staff shortfall and turf health.
 */
import { PARCEL_TILES, yardsToTiles } from '../src/core/units';
import { Vec2 } from '../src/core/geom';
import { holePar } from '../src/sim/course/yardage';
import { Difficulty } from '../src/sim/difficulty';
import { statementFor } from '../src/sim/economy/reports';
import { LOAN_TERMS, loanLimit, outstanding, takeLoan } from '../src/sim/economy/loans';
import { planPenHole } from '../src/sim/course/pen';
import { GROW_IN_COST_PER_TILE } from '../src/sim/course/lifecycle';
import { SPRINKLER_COST } from '../src/sim/turf/irrigation';
import { Game } from '../src/sim/game';
import { reputation } from '../src/sim/rating/reputation';
import { ratingOf } from '../src/sim/rating/courseRating';
import { generateCandidates } from '../src/sim/staff/market';
import { RoleId } from '../src/sim/staff/roles';
import { skillAvg } from '../src/sim/staff/staff';
import { shortfallReport } from '../src/sim/staff/workOrders';
import { EquipmentKind } from '../src/sim/staff/equipment';
import { DAYS_PER_YEAR } from '../src/sim/clock';
import { BuildingKind } from '../src/sim/business/buildings';
import { Feature, Surface, isTurfSurface } from '../src/sim/world/tiles';
import { TerrainType } from '../src/sim/world/terrainTypes';

export interface HeadlessOptions {
  seed: number;
  days: number;
  terrain?: TerrainType;
  difficulty?: Difficulty;
  size?: number;
  holes?: number;
  /** print one line per game day to stderr */
  progress?: boolean;
}

export interface BandScore { rounds: number; avgOverPar18: number; target: number }

export interface HeadlessSummary {
  seed: number;
  terrain: TerrainType;
  days: number;
  holesBuilt: number;
  holesOpen: number;
  buildFailures: string[];
  loansTaken: number;
  debt: number;
  startCash: number;
  buildCost: number;
  cash: number;
  minCash: number;
  rounds: number;
  roundsPerDay: number;
  /** operating profit per year of play */
  profitByYear: number[];
  /** the last year's revenue and running costs by category */
  lastYear: { revenue: Record<string, number>; operating: Record<string, number> };
  scoreByBand: Record<string, BandScore>;
  courseRating: number | null;
  slope: number | null;
  reputation: number;
  staffShortfallHours: number;
  turfHealth: number;
  msPerDay: number;
}

const CORRIDOR = 50;
/** Par 72, laid out so the long holes share the last row (rows are as tall as their longest hole). */
const PAR_PATTERN = [4, 3, 4, 4, 3, 4, 4, 4, 4, 4, 4, 3, 5, 4, 5, 3, 5, 5];
const LEN_YD: Record<number, number> = { 3: 165, 4: 390, 5: 510 };
const EQUIPMENT: EquipmentKind[] = ['greensMower', 'teeMower', 'fairwayMower', 'roughMower', 'bunkerRake', 'roller', 'utilityVehicle'];
/** cash the scripted player keeps back for wages and bills */
const RESERVE = 150_000;

interface PlannedHole { k: number; tee: Vec2; green: Vec2; id?: number; failed?: string }

/**
 * The "basic18" scripted player. setup() buys the land, builds the clubhouse, maintenance shed,
 * pump and pipe trunk, buys the fleet and hires a starting crew; daily() pens, irrigates and seeds
 * the next holes whenever the money (or the bank) allows, and grows the crew with the course.
 */
export class ScriptedPlayer {
  courseId = 0;
  readonly planned: PlannedHole[] = [];
  readonly failures: string[] = [];
  private loans = 0;
  private parkingAt: Vec2[] = [];
  private extrasAt: Vec2[] = [];
  private extras = false;

  constructor(private g: Game, readonly holes: number) {}

  private run(c: Parameters<Game['dispatch']>[0], what: string) {
    const r = this.g.dispatch(c);
    if (!r.ok) this.failures.push(`day ${this.g.day} ${what}: ${r.reason}`);
    return r;
  }

  /** Place a building at `at` or the nearest spot along the road that works (rock, creeks and trees get in the way). */
  private place(kind: BuildingKind, at: Vec2, what: string): Vec2 | null {
    for (let k = 0; k <= 30; k++) {
      const dx = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 3;
      for (const dy of [0, -3, -6]) {
        const origin = { x: at.x + dx, y: at.y + dy };
        if (this.g.dispatch({ t: 'placeBuilding', kind, courseId: this.courseId, origin }).ok) return origin;
      }
    }
    this.run({ t: 'placeBuilding', kind, courseId: this.courseId, origin: at }, what);
    return null;
  }

  get built(): number[] { return this.planned.filter(p => p.id !== undefined).map(p => p.id!); }

  setup(): void {
    const g = this.g, w = g.world;
    const mid = Math.floor(w.size / 2);
    let roadTop = w.size;
    while (roadTop > 0 && w.feature[w.idx(mid, roadTop - 1)] === Feature.Road) roadTop--;
    const perRow = Math.max(1, Math.min(6, Math.floor((w.size - 80) / CORRIDOR)));
    const rows = Math.ceil(this.holes / perRow);
    const rowsBottom = roadTop - 40;
    // each row as tall as its longest hole, shrunk to fit small maps
    const want = Array.from({ length: rows }, (_, r) => Math.max(...PAR_PATTERN.slice(r * perRow, (r + 1) * perRow).map(p => yardsToTiles(LEN_YD[p]!))) + 28);
    const fit = Math.min(1, (rowsBottom - 30) / want.reduce((s, x) => s + x, 0));
    const rowH = want.map(h => Math.floor(h * fit));
    const rowTop = (r: number) => rowsBottom - rowH.slice(0, r + 1).reduce((s, x) => s + x, 0);
    const top = rowTop(rows - 1);
    const x0 = Math.max(40, Math.floor(mid - (perRow * CORRIDOR) / 2));
    const x1 = x0 + perRow * CORRIDOR;
    const ps = g.parcels.perSide;
    for (let py = Math.max(0, Math.floor((top - 5) / PARCEL_TILES)); py < ps; py++)
      for (let px = Math.max(0, Math.floor((x0 - 5) / PARCEL_TILES)); px <= Math.min(ps - 1, Math.floor((x1 + 5) / PARCEL_TILES)); px++)
        if (!g.parcels.isOwned(px, py)) this.run({ t: 'buyParcel', px, py }, 'land');
    const r = this.run({ t: 'createCourse', name: 'Scripted Links' }, 'course');
    this.courseId = r.ok ? g.courses.list[g.courses.list.length - 1]!.id : g.courses.create('Scripted Links').id;
    for (let k = 0; k < this.holes; k++) {
      const row = Math.floor(k / perRow), col = row % 2 === 0 ? k % perRow : perRow - 1 - (k % perRow);
      const cx = x0 + col * CORRIDOR + CORRIDOR / 2;
      const len = Math.min(rowH[row]! - 28, yardsToTiles(LEN_YD[PAR_PATTERN[k % 18]!]!));
      const up = k % 2 === 0;
      const t = rowTop(row);
      const tee: Vec2 = { x: cx, y: up ? t + rowH[row]! - 14 : t + 14 };
      this.planned.push({ k, tee, green: { x: cx, y: Math.round(up ? tee.y - len : tee.y + len) } });
    }
    this.place('clubhouse', { x: x0, y: roadTop - 10 }, 'clubhouse');
    this.place('proShop', { x: x0 + 15, y: roadTop - 6 }, 'pro shop');
    this.place('parking', { x: x0 + 24, y: roadTop - 10 }, 'parking');
    let pumpX = x0 + 52;
    const pumpTier = this.holes > 9 ? 2 : 1;
    for (let k = 0; k <= 30; k++) {
      const x = x0 + 52 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 3;
      if (g.dispatch({ t: 'placePump', at: { x, y: roadTop - 6 }, tier: pumpTier }).ok) { pumpX = x; break; }
      if (k === 30) this.run({ t: 'placePump', at: { x: pumpX, y: roadTop - 6 }, tier: pumpTier }, 'pump');
    }
    this.place('maintenance', { x: x0 + 58, y: roadTop - 9 }, 'maintenance');
    this.extrasAt = [{ x: x0 + 100, y: roadTop - 9 }, { x: x0 + 112, y: roadTop - 8 }];
    this.place('halfwayHouse', this.extrasAt[1]!, 'halfway house');
    this.parkingAt = [{ x: x0 + 37, y: roadTop - 10 }, { x: x0 + 71, y: roadTop - 10 }, { x: x0 + 84, y: roadTop - 10 }];
    const trunkY = roadTop - 25;
    const trunk: Vec2[] = [];
    for (let y = roadTop - 8; y >= trunkY; y--) trunk.push({ x: pumpX, y });
    for (let x = x0; x < x1; x++) trunk.push({ x, y: trunkY });
    this.run({ t: 'placePipe', tiles: trunk }, 'pipe trunk');
    for (let col = 0; col < perRow; col++) {
      const cx = x0 + col * CORRIDOR + CORRIDOR / 2;
      const branch: Vec2[] = [];
      for (let y = trunkY; y >= top; y--) if (w.surface[w.idx(cx, y)] !== Surface.Water) branch.push({ x: cx, y });
      if (branch.length) this.run({ t: 'placePipe', tiles: branch }, 'pipe branch');
    }
    for (const kind of EQUIPMENT) this.run({ t: 'buyEquipment', courseId: this.courseId, kind, tier: 1 }, kind);
    this.staff();
  }

  /** Hire up to the crew this many open-or-growing holes needs. */
  private staff(): void {
    const g = this.g;
    const n = Math.max(3, this.built.length);
    const crew: [RoleId, number][] = [['superintendent', 1], ['greenkeeper', Math.ceil(n / 3)], ['mechanic', n >= 9 ? 1 : 0], ['irrigationTech', n >= 9 ? 1 : 0], ['starter', 1], ['generalManager', n >= 9 ? 1 : 0], ['proShopStaff', 1], ['cartAttendant', this.extras ? 1 : 0], ];
    for (const [role, want] of crew) {
      const have = g.staff.all.filter(s => s.role === role && s.courseId === this.courseId).length;
      if (have >= want) continue;
      const cands = generateCandidates(g, role).sort((a, b) => skillAvg(b) - skillAvg(a));
      for (let i = 0; i < want - have && i < cands.length; i++) this.run({ t: 'hireStaff', candidateId: cands[i]!.candidateId, courseId: this.courseId }, role);
    }
  }

  private estimate(p: PlannedHole): number {
    const plan = planPenHole(this.g, this.input(p)).plan;
    return plan.cost + plan.changes.length * GROW_IN_COST_PER_TILE.seed + 20 * SPRINKLER_COST;
  }
  private input(p: PlannedHole) {
    return { courseId: this.courseId, route: [p.tee, p.green], fairwayWidthYd: 35, roughWidthYd: 15, greenRadiusYd: 14 };
  }

  /** Build what the money allows, borrowing when the bank will lend. */
  daily(): void {
    const g = this.g;
    let progressed = false;
    // the fleet comes before more holes (it may not have been affordable on day one)
    for (const kind of EQUIPMENT) if (!g.equipment.all.some(e => e.kind === kind && e.courseId === this.courseId) && g.ledger.cash > RESERVE) g.dispatch({ t: 'buyEquipment', courseId: this.courseId, kind, tier: 1 });
    for (const p of this.planned) {
      if (p.id !== undefined || p.failed) continue;
      const cost = this.estimate(p);
      if (g.ledger.cash < cost + RESERVE) {
        const need = Math.ceil((cost + RESERVE - g.ledger.cash) / 1000) * 1000;
        const limit = loanLimit(g);
        if (limit < need) break;
        const r = takeLoan(g, Math.max(need, Math.min(limit, 500_000)), LOAN_TERMS[2]!);
        if (!r.ok) break;
        this.loans++;
      }
      const res = this.run({ t: 'penHole', input: this.input(p) }, `hole ${p.k + 1}`);
      if (!res.ok) { p.failed = res.reason; continue; }
      p.id = (res.value as { id: number }).id;
      for (let y = Math.min(p.tee.y, p.green.y); y <= Math.max(p.tee.y, p.green.y); y += 14) g.dispatch({ t: 'placeSprinkler', at: { x: p.tee.x, y }, zone: Math.min(32, p.k + 1) });
      this.run({ t: 'startGrowIn', holeId: p.id, method: 'seed' }, `seed hole ${p.k + 1}`);
      progressed = true;
    }
    if (progressed) this.staff();
    // another car park whenever golfers are being sent home
    // carts and a halfway house once the course is earning (both pay their way)
    const open = g.courses.get(this.courseId)?.holes.filter(h => h.state === 'open').length ?? 0;
    if (open >= 9 && !this.extras) {
      const need = 200_000 + RESERVE - g.ledger.cash;
      if (need > 0 && loanLimit(g) >= need) { if (takeLoan(g, Math.ceil(need / 1000) * 1000, LOAN_TERMS[2]!).ok) this.loans++; }
      if (g.ledger.cash > 200_000) {
        this.extras = true;
        this.place('cartBarn', this.extrasAt[0]!, 'cart barn');
        this.run({ t: 'buyCarts', courseId: this.courseId, n: 20 }, 'carts');
        this.staff();
      }
    }
    if (this.noParking && this.parkingAt.length && g.ledger.cash > RESERVE + 40_000) {
      this.place('parking', this.parkingAt.shift()!, 'parking');
    }
    this.noParking = false;
  }
  /** set by the runner when golfers drove away */
  noParking = false;

  get loansTaken(): number { return this.loans; }
}

const BANDS: [string, number, number][] = [['0-9', -99, 9.99], ['10-19', 10, 19.99], ['20+', 20, 99]];

export function runHeadless(o: HeadlessOptions): HeadlessSummary {
  const terrain = o.terrain ?? 'parkland';
  const g = Game.create({ seed: o.seed, terrain, difficulty: o.difficulty ?? 'normal', size: o.size });
  const startCash = g.ledger.cash;
  const player = new ScriptedPlayer(g, o.holes ?? 18);
  player.setup();
  player.daily();
  const courseId = player.courseId;
  let spent = 0;
  const startDay = g.day;
  let rounds = 0, minCash = g.ledger.cash, shortfall = 0;
  const band = new Map<string, { overPar: number; holes: number; hcp: number; rounds: number }>();
  g.events.on('noParking', () => { player.noParking = true; });
  g.events.on('roundComplete', ({ groupId }) => { rounds += g.groups.find(x => x.id === groupId)?.golferIds.length ?? 1; });
  g.events.on('holeComplete', ({ holeId, results }) => {
    const h = g.courses.hole(holeId);
    if (!h) return;
    const par = holePar(h);
    for (const r of results) {
      const gf = g.golfers.all.get(r.golferId);
      if (!gf) continue;
      const b = BANDS.find(([, lo, hi]) => gf.handicap >= lo && gf.handicap <= hi)![0];
      const acc = band.get(b) ?? { overPar: 0, holes: 0, hcp: 0, rounds: 0 };
      acc.overPar += r.result.strokes - par; acc.holes++; acc.hcp += gf.handicap;
      band.set(b, acc);
    }
  });
  g.events.on('day', ({ day }) => {
    if (o.progress) process.stderr.write(`day ${day} ${Math.round(performance.now() - t0)}ms golfers=${g.golfers.all.size} groups=${g.groups.length}\n`);
    player.daily();
    minCash = Math.min(minCash, g.ledger.cash);
    shortfall += shortfallReport(g, courseId, day - 1).hoursShort;
  });
  const t0 = performance.now();
  const end = startDay + o.days;
  while (g.day < end) g.tick();
  const ms = performance.now() - t0;
  for (const t of g.ledger.tx) if (t.cat === 'land' || t.cat === 'construction' || t.cat === 'equipment' || t.cat === 'earthworks') spent += t.out - t.in;
  const built = player.built;

  const profitByYear: number[] = [];
  for (let y = startDay; y < end; y += DAYS_PER_YEAR) profitByYear.push(Math.round(statementFor(g, null, y, Math.min(end - 1, y + DAYS_PER_YEAR - 1)).operatingProfit));
  const scoreByBand: Record<string, BandScore> = {};
  for (const [name] of BANDS) {
    const a = band.get(name);
    scoreByBand[name] = a ? { rounds: Math.round(a.holes / 18), avgOverPar18: Math.round((a.overPar / a.holes) * 18 * 10) / 10, target: Math.round((a.hcp / a.holes) * 0.9 * 10) / 10 } : { rounds: 0, avgOverPar18: 0, target: 0 };
  }
  const w = g.world;
  let hs = 0, hn = 0;
  for (let i = 0; i < w.surface.length; i++) if (w.courseId[i] === courseId && isTurfSurface(w.surface[i] as Surface) && w.holeId[i]) { hs += w.health[i]!; hn++; }
  const rating = ratingOf(g, courseId);
  const course = g.courses.get(courseId);
  return {
    seed: o.seed, terrain, days: o.days,
    holesBuilt: built.length,
    holesOpen: course?.holes.filter(h => h.state === 'open').length ?? 0,
    buildFailures: player.failures.slice(0, 20),
    loansTaken: player.loansTaken,
    debt: Math.round(outstanding(g)),
    startCash, buildCost: Math.round(spent), cash: Math.round(g.ledger.cash), minCash: Math.round(minCash),
    rounds, roundsPerDay: Math.round((rounds / o.days) * 10) / 10,
    profitByYear, scoreByBand,
    lastYear: (() => { const st = statementFor(g, null, Math.max(startDay, end - DAYS_PER_YEAR), end - 1); const r = (o: Partial<Record<string, number>>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v ?? 0)])); return { revenue: r(st.revenue), operating: r(st.operating) }; })(),
    courseRating: rating?.courseRating ?? null, slope: rating?.slope ?? null,
    reputation: Math.round(reputation(g, courseId).overall * 100) / 100,
    staffShortfallHours: Math.round(shortfall),
    turfHealth: hn ? Math.round(hs / hn) : 0,
    msPerDay: Math.round(ms / o.days),
  };
}

// CLI
const isMain = typeof process !== 'undefined' && process.argv[1] && /headless\.ts$/.test(process.argv[1]);
if (isMain) {
  const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
  const s = runHeadless({ seed: Number(arg('seed', '1')), days: Number(arg('days', '365')), terrain: arg('terrain', 'parkland') as TerrainType, holes: Number(arg('holes', '18')), size: Number(arg('size', '1000')), difficulty: arg('difficulty', 'normal') as Difficulty, progress: process.argv.includes('--progress') });
  console.log(JSON.stringify(s, null, 2));
}
