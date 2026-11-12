import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { Result, fail, ok } from '../core/result';
import { Rng } from '../core/rng';
import { Course } from './course/course';
import { Game, NewGameOptions } from './game';
import { Golfer } from './golfers/golfer';
import { Group } from './golfers/groups';
import { HolePlay, HoleResult } from './golfers/hole';
import { CourseStats } from './golfers/stats';
import { TeeSheet } from './golfers/teeSheet';
import { Thought } from './golfers/thoughts';
import { World } from './world/world';
import { saveRegistry } from './saveRegistry';

export const SAVE_VERSION = 1;
const MAGIC = 'GCTS';

export { registerSaveable } from './saveRegistry';
export type { Saveable } from './saveRegistry';
const registry = saveRegistry;

/** Upgrades a header from version v to v + 1. */
export const MIGRATIONS: Record<number, (json: SaveHeader) => SaveHeader> = {};

const WORLD_FIELDS = ['elevation', 'surface', 'feature', 'treeSpecies', 'treeAgeDays', 'grass', 'health', 'moisture', 'wear', 'firmness', 'mowHeight', 'holeId', 'courseId', 'thatch', 'flags', 'rolledDay', 'aeratedDay', 'fedDay'] as const;

type Typed = Float32Array | Uint8Array | Uint16Array | Int32Array;
const CTORS = { Float32Array, Uint8Array, Uint16Array, Int32Array } as const;
type TypedName = keyof typeof CTORS;
interface BufRef { $buf: number }
interface BufDesc { type: TypedName; offset: number; length: number }

interface SavedGroup extends Omit<Group, 'balls' | 'scores' | 'rng'> {
  balls: [number, HolePlay][];
  scores: [number, HoleResult[]][];
  rng: number;
}
export interface SaveHeader {
  version: number;
  savedAt: number;
  options: NewGameOptions & { size: number };
  clock: ReturnType<Game['clock']['save']>;
  rng: number;
  notifySeq: number;
  ledger: { cash: number; tx: Game['ledger']['tx'] };
  soil: number;
  parcels: { price: BufRef; owner: BufRef };
  world: Record<(typeof WORLD_FIELDS)[number], BufRef>;
  courses: { list: Course[]; nextCourse: number; nextHole: number };
  structures: Game['structures'];
  pendingReputationEvents: Game['pendingReputationEvents'];
  golfers: { all: Golfer[]; nextId: number };
  groups: SavedGroup[];
  nextGroupId: number;
  buildings: Game['buildings'];
  nextBuildingId: number;
  teeSheets: [number, { interval: number; firstTee: number; booked: [number, [number, number][]][]; golfers: [number, number][]; reserved?: [number, number[]][] }][];
  pricing: [number, unknown][];
  thoughts: Thought[];
  roundThoughts: [number, Thought[]][];
  stats: [number, { entries: CourseStats['entries']; rounds: CourseStats['rounds']; holeTimes: CourseStats['holeTimes']; losses: CourseStats['losses']; heat: BufRef }][];
  footfall: BufRef;
  ext: Record<string, unknown>;
  buffers: BufDesc[];
}

/** Game → gzip(magic | u32 header length | header JSON | raw typed-array bytes). */
export function serialize(g: Game): Uint8Array {
  const arrays: Typed[] = [];
  const buf = (a: Typed): BufRef => { arrays.push(a); return { $buf: arrays.length - 1 }; };
  const header: Omit<SaveHeader, 'buffers'> = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    options: { seed: g.seed, terrain: g.terrain, difficulty: g.difficulty, size: g.world.size, options: { ...g.opts, startingCash: Number.isFinite(g.opts.startingCash) ? g.opts.startingCash : undefined } },
    clock: g.clock.save(),
    rng: g.rng.getState(),
    notifySeq: g.notifySeq,
    ledger: { cash: g.ledger.cash, tx: g.ledger.tx },
    soil: g.soilStockpileM3,
    parcels: { price: buf(g.parcels.price), owner: buf(g.parcels.owner) },
    world: Object.fromEntries(WORLD_FIELDS.map(f => [f, buf(g.world[f])])) as SaveHeader['world'],
    courses: { list: g.courses.list, ...g.courses.counters() },
    structures: g.structures,
    pendingReputationEvents: g.pendingReputationEvents,
    golfers: { all: [...g.golfers.all.values()], nextId: g.golfers.nextId },
    groups: g.groups.map(grp => ({ ...grp, balls: [...grp.balls], scores: [...grp.scores], rng: grp.rng.getState() })),
    nextGroupId: g.nextGroupId,
    buildings: g.buildings,
    nextBuildingId: g.nextBuildingId,
    teeSheets: [...g.teeSheets].map(([id, t]) => [id, { interval: t.intervalMin, firstTee: t.firstTee, booked: [...t.booked].map(([d, m]) => [d, [...m]]), golfers: [...t.golfers], reserved: [...t.reserved].map(([d, m]) => [d, [...m]]) }]),
    pricing: [...g.pricing],
    thoughts: g.thoughts,
    roundThoughts: [...g.roundThoughts],
    stats: [...g.stats].map(([id, s]) => [id, { entries: s.entries, rounds: s.rounds, holeTimes: s.holeTimes, losses: s.losses, heat: buf(s.landingHeat) }]),
    footfall: buf(g.footfall),
    ext: Object.fromEntries([...registry.values()].map(s => [s.key, s.save(g)])),
  };
  let offset = 0;
  const buffers: BufDesc[] = arrays.map(a => {
    const d = { type: a.constructor.name as TypedName, offset, length: a.length };
    offset += a.byteLength;
    return d;
  });
  const json = strToU8(JSON.stringify({ ...header, buffers }));
  const out = new Uint8Array(8 + json.length + offset);
  out.set(strToU8(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  let p = 8 + json.length;
  for (const a of arrays) { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), p); p += a.byteLength; }
  return gzipSync(out, { level: 6 });
}

/** Read just the header (for save lists) without rebuilding the game. */
export function readHeader(bytes: Uint8Array): Result<SaveHeader> {
  let raw: Uint8Array;
  try { raw = gunzipSync(bytes); } catch { return fail('Not a Golf Course Tycoon save (bad compression)'); }
  if (raw.length < 8 || strFromU8(raw.subarray(0, 4)) !== MAGIC) return fail('Not a Golf Course Tycoon save');
  const len = new DataView(raw.buffer, raw.byteOffset).getUint32(4, true);
  try {
    const h = JSON.parse(strFromU8(raw.subarray(8, 8 + len))) as SaveHeader;
    (h as SaveHeader & { __raw?: Uint8Array; __base?: number }).__raw = raw;
    (h as SaveHeader & { __base?: number }).__base = 8 + len;
    return ok(h);
  } catch {
    return fail('Save header is corrupt');
  }
}

export function deserialize(bytes: Uint8Array): Result<Game> {
  const hr = readHeader(bytes);
  if (!hr.ok) return hr;
  let h = hr.value;
  const raw = (h as SaveHeader & { __raw: Uint8Array }).__raw;
  const base = (h as SaveHeader & { __base: number }).__base;
  if (typeof h.version !== 'number') return fail('Save has no version');
  if (h.version > SAVE_VERSION) return fail(`Save is from a newer version (${h.version}); this game reads up to ${SAVE_VERSION}`);
  for (let v = h.version; v < SAVE_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (!m) return fail(`No migration from save version ${v}`);
    h = { ...m(h), version: v + 1 };
  }
  const get = <T extends Typed>(r: BufRef): T => {
    const d = h.buffers[r.$buf]!;
    const C = CTORS[d.type];
    const bytesPer = C.BYTES_PER_ELEMENT;
    const copy = raw.slice(base + d.offset, base + d.offset + d.length * bytesPer);
    return new C(copy.buffer, 0, d.length) as T;
  };
  try {
    const world = new World(h.options.size);
    // fields added after a save was written stay zero
    for (const f of WORLD_FIELDS) if (h.world[f]) (world[f] as Typed).set(get(h.world[f]));
    world.markAllDirty();
    const g = Game.fromSave(h.options, world);
    g.clock.load(h.clock);
    g.rng.setState(h.rng);
    g.notifySeq = h.notifySeq;
    g.ledger.restore(h.ledger.cash, h.ledger.tx);
    g.soilStockpileM3 = h.soil;
    g.parcels.price.set(get(h.parcels.price));
    g.parcels.owner.set(get(h.parcels.owner));
    g.courses.restore(h.courses.list, h.courses.nextCourse, h.courses.nextHole);
    g.structures = h.structures;
    g.pendingReputationEvents = h.pendingReputationEvents;
    g.golfers.all = new Map(h.golfers.all.map(x => [x.id, x]));
    g.golfers.nextId = h.golfers.nextId;
    g.groups = h.groups.map(s => {
      const rng = new Rng(0);
      rng.setState(s.rng);
      return { ...s, balls: new Map(s.balls), scores: new Map(s.scores), rng } as Group;
    });
    g.nextGroupId = h.nextGroupId;
    g.buildings = h.buildings;
    g.nextBuildingId = h.nextBuildingId;
    g.teeSheets = new Map(h.teeSheets.map(([id, t]) => {
      const sheet = new TeeSheet();
      sheet.intervalMin = t.interval;
      sheet.firstTee = t.firstTee;
      sheet.booked = new Map(t.booked.map(([d, m]) => [d, new Map(m)]));
      sheet.golfers = new Map(t.golfers);
      sheet.reserved = new Map((t.reserved ?? []).map(([d, m]) => [d, new Set(m)]));
      return [id, sheet];
    }));
    g.pricing = new Map(h.pricing as [number, Game['pricing'] extends Map<number, infer P> ? P : never][]);
    g.thoughts = h.thoughts;
    g.roundThoughts = new Map(h.roundThoughts);
    g.stats = new Map(h.stats.map(([id, s]) => {
      const st = new CourseStats(h.options.size);
      st.entries = s.entries; st.rounds = s.rounds; st.holeTimes = s.holeTimes; st.losses = s.losses;
      st.landingHeat = new Uint16Array(get<Uint16Array>(s.heat));
      return [id, st];
    }));
    g.footfall = new Uint16Array(get<Uint16Array>(h.footfall));
    for (const s of registry.values()) if (s.key in h.ext) s.load(g, h.ext[s.key], h.version);
    return ok(g);
  } catch (e) {
    return fail(`Save could not be loaded: ${(e as Error).message}`);
  }
}
