import 'fake-indexeddb/auto';
import { gunzipSync, gzipSync } from 'fflate';
import { Game } from '../../src/sim/game';
import { SAVE_VERSION, deserialize, registerSaveable, serialize } from '../../src/sim/save';
import { SaveStore } from '../../src/sim/saveStore';
import { addClubhouse, threeHoleCourse } from './golfers/courseFixture';

/** 3 open holes, a clubhouse, and a group mid-round. */
function buildPlayingGame(): Game {
  const { g, course } = threeHoleCourse();
  addClubhouse(g, course);
  g.dispatch({ t: 'setGreenFee', courseId: course.id, holes: 3, fee: 6 });
  let n = 0;
  const midRound = () => g.groups.some(x => x.started && x.phase !== 'done' && x.holeIdx >= 1);
  while (!midRound() && n++ < 100000) g.tick();
  return g;
}

const fingerprint = (g: Game) => JSON.stringify({
  groups: g.groups.map(x => ({ id: x.id, pos: x.pos, phase: x.phase, hole: x.holeIdx, wait: x.waitingMin, balls: [...x.balls.values()].map(b => [b.pos, b.strokes]) })),
  golfers: [...g.golfers.all.values()].map(x => [x.id, x.opinion, x.visits]),
  time: g.clock.save(),
  thoughts: g.thoughts.length,
});

test('round-trip is deterministic', () => {
  const g = buildPlayingGame();
  expect(g.groups.some(x => x.started && x.phase !== 'done')).toBe(true);
  const h = deserialize(serialize(g));
  expect(h.ok).toBe(true);
  const g2 = (h as { ok: true; value: Game }).value;
  expect(fingerprint(g2)).toBe(fingerprint(g));
  for (let i = 0; i < 3000; i++) { g.tick(); g2.tick(); }
  expect(g2.ledger.cash).toBe(g.ledger.cash);
  expect(g2.world.wear).toEqual(g.world.wear);
  expect(g2.rng.getState()).toBe(g.rng.getState());
  expect(fingerprint(g2)).toBe(fingerprint(g));
  // and across a day boundary (demand + headless finishes)
  const day = g.day;
  while (g.day < day + 2) { g.tick(); g2.tick(); }
  expect(fingerprint(g2)).toBe(fingerprint(g));
  expect(g2.ledger.cash).toBe(g.ledger.cash);
});

test('rejects unknown version', () => {
  const g = threeHoleCourse().g;
  const raw = gunzipSync(serialize(g));
  const len = new DataView(raw.buffer, raw.byteOffset).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + len)));
  header.version = 999;
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(8 + json.length + raw.length - 8 - len);
  out.set(raw.subarray(0, 4), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  out.set(raw.subarray(8 + len), 8 + json.length);
  const r = deserialize(gzipSync(out));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toMatch(/newer/);
  expect(SAVE_VERSION).toBe(1);
});

test('garbage is rejected cleanly', () => {
  expect(deserialize(new Uint8Array([1, 2, 3])).ok).toBe(false);
  expect(deserialize(gzipSync(new TextEncoder().encode('hello world'))).ok).toBe(false);
});

test('registered Saveables round-trip their state', () => {
  const g = threeHoleCourse().g;
  const bag = new WeakMap<Game, { n: number }>();
  bag.set(g, { n: 42 });
  registerSaveable({ key: 'test.bag', save: x => bag.get(x), load: (x, d) => { bag.set(x, d as { n: number }); } });
  const r = deserialize(serialize(g));
  expect(r.ok && bag.get(r.value)).toEqual({ n: 42 });
});

test('SaveStore put/get/list/delete with fake-indexeddb', async () => {
  const store = new SaveStore();
  const g = threeHoleCourse().g;
  const bytes = serialize(g);
  const meta = await store.put('slot 1', bytes);
  expect(meta.bytes).toBe(bytes.byteLength);
  expect(meta.day).toBe(g.day);
  await store.put('slot 2', bytes);
  expect((await store.list()).map(m => m.name).sort()).toEqual(['slot 1', 'slot 2']);
  const back = await store.get('slot 1');
  expect(back).toEqual(bytes);
  expect(deserialize(back!).ok).toBe(true);
  await store.delete('slot 1');
  expect((await store.list()).map(m => m.name)).toEqual(['slot 2']);
  expect(await store.get('nope')).toBeNull();
});

test('full-size save under 8 MB compressed', () => {
  const g = Game.create({ seed: 77, terrain: 'parkland', difficulty: 'normal' });
  const bytes = serialize(g);
  expect(bytes.byteLength).toBeLessThan(8 * 1024 * 1024);
  const r = deserialize(bytes);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.world.elevation).toEqual(g.world.elevation);
    expect(r.value.parcels.price).toEqual(g.parcels.price);
  }
}, 30000);
