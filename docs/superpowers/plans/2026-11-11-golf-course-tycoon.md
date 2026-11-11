# Golf Course Tycoon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-based, top-down pixel-art golf course tycoon game: generated land, a hole-building toolset, handicap-driven AI golfers, a turf and staff simulation, business depth, reputation, and an arcade play mode. The work runs through roadmap phases M0–M7.

**Architecture:** A deterministic simulation (`src/sim/`, plain TypeScript, no DOM or Pixi imports) runs on a fixed tick and stores tile data in typed arrays. All changes to it go through `Game.dispatch(command)`. A PixiJS renderer (`src/render/`) draws only visible 50×50-tile chunks and re-draws dirty chunks. A plain-DOM UI (`src/ui/`) sits over the canvas and turns tool input into commands. The sim is unit-tested headless with Vitest; rendering and UI are checked in the browser preview.

**Tech Stack:** TypeScript 5 (strict), Vite 5, PixiJS 8, Vitest 2, fake-indexeddb (tests only). No UI framework.

**Spec:** `docs/game-design-document.md` (v0.2). Read it before starting any task; section numbers below (§n) refer to it.

## Global Constraints

- Tile = 2 m × 2 m; parcel = 1 ha = 50 × 50 tiles; map = 2 km × 2 km = 1,000 × 1,000 tiles = 20 × 20 parcels (§4).
- Render chunk = one parcel (50 × 50 tiles).
- Par suggestion: ≤ 250 yd → par 3; 251–470 → par 4; 471+ → par 5 (§5.1), measured from the longest tee box.
- Each hole has 1–4 tee boxes, kinds `championship | back | middle | forward` (§5.4); each green has 4–6 candidate pins (§5.5).
- Hole states: `construction → growingIn → open → closing → closed`. A hole that is `open` or `closing` cannot be edited (§18).
- Starting cash: easy $5,000,000 · normal $3,000,000 · hard $1,500,000 · sandbox unlimited (§12). Parcel price $20,000–$150,000 (§12).
- Green speed target range: Stimp 8–13 (§6).
- Time: day runs 05:00–21:00 (960 game minutes) in about 12 real minutes at 1×. Night is skipped. 10 sim ticks per game minute. Speeds: pause, 1×, 2×, 4×, 8× (§11, §17).
- The sim must be deterministic: same seed + same command sequence ⇒ identical state. Every random draw comes from `Rng`, never `Math.random`.
- `src/sim/**` must not import from `src/render/**`, `src/ui/**`, `pixi.js`, or touch `window`/`document`.
- Data model groups holes, tee sheet, ratings, reputation, staff zones and finances by `courseId` from the start (§17).
- Programmer art only: every sprite and tile comes from `src/render/atlas.ts`, keyed by name, so it can be replaced later (§18).
- Money is stored as integer dollars (`number`, rounded with `Math.round`) to avoid float drift.

## Review Focus

1. **Brushes and the pen at the map edge or over unowned land.** Out-of-range tiles are clipped and unowned tiles are skipped and not charged. No index errors. → Task 8 `clips to map bounds and skips unowned tiles`.
2. **Not enough money for an edit or purchase.** The whole operation is refused: no partial tile changes, cash unchanged. → Task 8 `refuses whole plan when unaffordable`, Task 4 `buy fails without funds`.
3. **Editing or closing a hole with golfers on it.** Edits to open holes are refused with a reason. Closing moves the hole to `closing` until groups on it have finished, then to `closed`. → Task 14 `close waits for groups to clear`.
4. **A golfer can't finish a hole** (ball on rock, island green, unreachable lie). Pickup at double par, and the sim never loops forever. → Task 19 `picks up at double par on impossible hole`.
5. **Save/load round-trip mid-round and old save versions.** Loading restores identical state (further ticks produce identical results), and an unknown or older `version` is migrated or refused with a message, never crashes. → Task 24 `round-trip is deterministic` and `rejects unknown version`.

---

## File Structure

```
index.html, package.json, tsconfig.json, vite.config.ts, vitest.config.ts
src/
  main.ts                         boot: new-game screen → Game + renderer + UI
  core/   units.ts rng.ts noise.ts result.ts events.ts geom.ts
  sim/
    game.ts commands.ts clock.ts difficulty.ts save.ts
    world/      tiles.ts world.ts terrainTypes.ts mapgen.ts slope.ts pathfind.ts
    land/       parcels.ts
    economy/    ledger.ts loans.ts reports.ts
    construction/ costs.ts plan.ts paint.ts terrain.ts hazards.ts paths.ts
    course/     course.ts pen.ts yardage.ts green.ts validate.ts lifecycle.ts
    golfers/    golfer.ts names.ts generate.ts clubs.ts lie.ts ballPhysics.ts shot.ts
                putting.ts ai.ts hole.ts groups.ts teeSheet.ts demand.ts thoughts.ts stats.ts
    turf/       grasses.ts turf.ts weather.ts irrigation.ts practices.ts
    staff/      roles.ts staff.ts market.ts equipment.ts program.ts workOrders.ts agents.ts morale.ts
    business/   buildings.ts proShop.ts fnb.ts carts.ts pricing.ts memberships.ts
    rating/     courseRating.ts scores.ts reviews.ts reputation.ts rivals.ts events.ts milestones.ts unlocks.ts
    modes/      scenarios.ts
  render/  pixiApp.ts camera.ts atlas.ts palette.ts chunks.ts shading.ts overlays.ts entities.ts follow.ts
  ui/      dom.ts hud.ts toolbar.ts inspector.ts overlayBar.ts notifications.ts newGame.ts
           tools/ toolController.ts landTool.ts penTool.ts paintTool.ts terrainTool.ts greenTool.ts hazardTool.ts pathTool.ts
           panels/ holePanel.ts golferPanel.ts staffPanel.ts programPanel.ts financePanel.ts proShopPanel.ts statsPanel.ts buildPanel.ts
  play/    swing.ts playMode.ts
tests/   mirrors src/ (e.g. tests/sim/world/world.test.ts)
tools/   headless.ts   (headless balance runner, Task 45)
```

Rule: each file has one responsibility, and the sim systems are plain functions or classes that take `Game` (or the slices they need) as arguments.

---

# Phase M0 — Tech foundation

### Task 1: Project scaffold, units, seeded RNG

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.ts`, `.gitignore`, `src/core/units.ts`, `src/core/rng.ts`, `src/core/result.ts`, `src/core/geom.ts`
- Test: `tests/core/rng.test.ts`, `tests/core/units.test.ts`

**Interfaces:**
- Produces:
  - `units.ts`: `TILE_M = 2`, `PARCEL_TILES = 50`, `MAP_TILES = 1000`, `PARCELS_PER_SIDE = 20`, `M_TO_YD = 1.0936133`, `tilesToYards(t: number): number`, `yardsToTiles(y: number): number`
  - `rng.ts`: `class Rng { constructor(seed: number); next(): number /* [0,1) */; int(min: number, maxIncl: number): number; range(min: number, max: number): number; normal(mean: number, sd: number): number; chance(p: number): boolean; pick<T>(a: readonly T[]): T; fork(label: string): Rng; getState(): number; setState(s: number): void }`, `hashString(s: string): number`
  - `result.ts`: `type Result<T = void> = { ok: true; value: T } | { ok: false; reason: string }`, `ok<T>(v: T)`, `fail(reason: string)`
  - `geom.ts`: `interface Vec2 { x: number; y: number }`, `dist(a,b)`, `sub`, `add`, `scale`, `norm`, `lerp`, `angleOf(v)`, `fromAngle(rad, len)`

- [ ] **Step 1:** `git init`. Create `package.json` (scripts: `dev: vite`, `build: tsc --noEmit && vite build`, `test: vitest run`), and install `pixi.js@8 typescript@5 vite@5 vitest@2 fake-indexeddb@6`. Turn on `strict`, `noUncheckedIndexedAccess` and `"moduleResolution": "bundler"` in tsconfig. `index.html` has `<canvas id="game">` and `<div id="ui">`.
- [ ] **Step 2: Write failing tests**

```ts
// tests/core/rng.test.ts
test('same seed gives same sequence', () => {
  const a = new Rng(42), b = new Rng(42);
  expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
});
test('fork is independent and deterministic', () => {
  const a = new Rng(1).fork('golfers'), b = new Rng(1).fork('golfers');
  expect(a.next()).toBe(b.next());
  expect(new Rng(1).fork('x').next()).not.toBe(new Rng(1).fork('y').next());
});
test('state round-trips', () => {
  const r = new Rng(7); r.next(); const s = r.getState(); const v = r.next();
  r.setState(s); expect(r.next()).toBe(v);
});
test('int is inclusive and in range', () => {
  const r = new Rng(3); for (let i = 0; i < 1000; i++) { const v = r.int(2, 4); expect(v).toBeGreaterThanOrEqual(2); expect(v).toBeLessThanOrEqual(4); }
});
test('normal has roughly correct mean', () => {
  const r = new Rng(9); let s = 0; for (let i = 0; i < 5000; i++) s += r.normal(10, 2);
  expect(s / 5000).toBeCloseTo(10, 0);
});
// tests/core/units.test.ts
test('tile/yard conversion', () => {
  expect(tilesToYards(50)).toBeCloseTo(109.36, 1);
  expect(yardsToTiles(tilesToYards(123))).toBeCloseTo(123, 6);
});
```

- [ ] **Step 3:** Run `npx vitest run tests/core` → FAIL (modules missing).
- [ ] **Step 4:** Implement. `Rng` uses mulberry32 with a single 32-bit state; `fork(label)` seeds a new Rng from `hashString(label) ^ state` without advancing the parent; `normal` uses Box–Muller.
- [ ] **Step 5:** Run `npx vitest run tests/core` → PASS. Run `npm run dev` and confirm the page loads with no console errors.
- [ ] **Step 6:** Commit `feat: scaffold project with units, rng, geometry`.

### Task 2: Noise and the World tile store

**Files:**
- Create: `src/core/noise.ts`, `src/sim/world/tiles.ts`, `src/sim/world/world.ts`, `src/sim/world/slope.ts`
- Test: `tests/core/noise.test.ts`, `tests/sim/world/world.test.ts`

**Interfaces:**
- Consumes: `Rng`, `MAP_TILES`, `PARCEL_TILES`
- Produces:
  - `noise.ts`: `createNoise2D(rng: Rng): (x: number, y: number) => number /* [-1,1] */`, `fbm(n, x, y, octaves: number, lacunarity = 2, gain = 0.5): number`
  - `tiles.ts`: `enum Surface { Natural, Tee, Fairway, Green, Fringe, FirstCut, Rough, DeepRough, Native, Bunker, Waste, Water, Path, Building }`; `enum Feature { None, Rock, Creek, Wetland, SpecimenTree, Road, Neighbor }`; `isPlayableSurface(s)`, `isBlockingFeature(f)` (Rock, Creek, Wetland, Road, Neighbor)
  - `world.ts`: `class World { readonly size: number; elevation: Float32Array /*m*/; surface: Uint8Array; feature: Uint8Array; treeSpecies: Uint8Array /*0=none*/; treeAgeDays: Uint16Array; grass: Uint8Array; health: Uint8Array; moisture: Uint8Array; wear: Uint8Array; firmness: Uint8Array; mowHeight: Uint16Array /*0.1 mm*/; holeId: Uint16Array /*0=none*/; courseId: Uint8Array; constructor(size = MAP_TILES); idx(x,y): number; inBounds(x,y): boolean; markDirty(x,y): void; takeDirtyChunks(): number[] /*chunk index = cy*chunksPerSide+cx*/; readonly chunksPerSide: number }`
  - `slope.ts`: `slopeAt(w: World, x: number, y: number): { gradient: number /*rise/run*/; dir: Vec2 /*downhill unit*/ }`, `elevationAt(w, x: number, y: number): number` (bilinear)

- [ ] **Step 1: Write failing tests**

```ts
test('noise is deterministic and bounded', () => {
  const n1 = createNoise2D(new Rng(5)), n2 = createNoise2D(new Rng(5));
  for (let i = 0; i < 100; i++) { const v = n1(i * 0.37, i * 0.11); expect(v).toBe(n2(i * 0.37, i * 0.11)); expect(Math.abs(v)).toBeLessThanOrEqual(1); }
});
test('world idx/inBounds', () => {
  const w = new World(100);
  expect(w.idx(3, 2)).toBe(203); expect(w.inBounds(-1, 0)).toBe(false); expect(w.inBounds(99, 99)).toBe(true);
});
test('dirty chunks are collected once', () => {
  const w = new World(100); w.markDirty(0, 0); w.markDirty(1, 1); w.markDirty(60, 10);
  expect(w.takeDirtyChunks().sort()).toEqual([0, 1]); expect(w.takeDirtyChunks()).toEqual([]);
});
test('slope points downhill', () => {
  const w = new World(10); for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) w.elevation[w.idx(x, y)] = x * 0.2; // rises to +x
  const s = slopeAt(w, 5, 5); expect(s.gradient).toBeCloseTo(0.1, 3); expect(s.dir.x).toBeLessThan(0);
});
```

(The gradient is 0.2 m per 2 m tile, so 0.1.)

- [ ] **Step 2:** Run `npx vitest run tests/core/noise.test.ts tests/sim/world` → FAIL.
- [ ] **Step 3:** Implement. Noise is seeded 2D simplex noise built from a permutation table shuffled by `rng`. The World allocates all arrays as `size*size`; the dirty set is a `Uint8Array(chunksPerSide²)` plus a list.
- [ ] **Step 4:** Run the tests → PASS.
- [ ] **Step 5:** Commit `feat: noise and typed-array world store`.

### Task 3: Terrain types and procedural map generation

**Files:**
- Create: `src/sim/world/terrainTypes.ts`, `src/sim/world/mapgen.ts`
- Test: `tests/sim/world/mapgen.test.ts`

**Interfaces:**
- Consumes: `World`, `Rng`, `createNoise2D`, `fbm`, `Surface`, `Feature`
- Produces:
  - `type TerrainType = 'parkland' | 'links' | 'desert' | 'mountain'`
  - `interface TerrainConfig { elevationAmpM: number; pondCount: [number, number]; creekCount: [number, number]; rockDensity: number; treeDensity: number; wetlandDensity: number; specimenTreeCount: [number, number]; treeSpecies: number[]; climate: ClimateId; naturalSurface: Surface }`. Values: parkland amp 25 m, links 12 m (dunes: high-frequency noise), desert 15 m, mountain 120 m; desert `naturalSurface = Waste`, the others `Natural`.
  - `TERRAINS: Record<TerrainType, TerrainConfig>`
  - `type ClimateId = 'temperate' | 'maritime' | 'arid' | 'alpine'` (used by Task 26)
  - `generateWorld(seed: number, terrain: TerrainType, size = MAP_TILES): World`
  - `ROAD_EDGE`: the road runs along the full south edge (y = size-3..size-1, `Feature.Road`). One neighbouring-property strip runs along a random other edge (`Feature.Neighbor`, 2 tiles deep).

- [ ] **Step 1: Write failing tests** (use `size = 200` for speed)

```ts
test('same seed → identical world', () => {
  const a = generateWorld(11, 'parkland', 200), b = generateWorld(11, 'parkland', 200);
  expect(a.elevation).toEqual(b.elevation); expect(a.feature).toEqual(b.feature);
});
test('different seeds differ', () => {
  expect(generateWorld(1, 'parkland', 200).elevation).not.toEqual(generateWorld(2, 'parkland', 200).elevation);
});
test('has road on south edge and some rocks, water, trees', () => {
  const w = generateWorld(3, 'parkland', 200);
  expect(w.feature[w.idx(100, 199)]).toBe(Feature.Road);
  const count = (pred: (i: number) => boolean) => { let c = 0; for (let i = 0; i < w.size ** 2; i++) if (pred(i)) c++; return c; };
  expect(count(i => w.feature[i] === Feature.Rock)).toBeGreaterThan(0);
  expect(count(i => w.surface[i] === Surface.Water)).toBeGreaterThan(0);
  expect(count(i => w.treeSpecies[i] !== 0)).toBeGreaterThan(0);
});
test('mountain is steeper than links', () => {
  const range = (w: World) => Math.max(...w.elevation) - Math.min(...w.elevation);
  expect(range(generateWorld(4, 'mountain', 200))).toBeGreaterThan(range(generateWorld(4, 'links', 200)));
});
test('creeks are continuous water with Creek feature and reach a map edge', () => { /* flood-fill from one creek tile reaches an edge row/col */ });
test('full-size generation under 3s', () => { const t = performance.now(); generateWorld(5, 'parkland'); expect(performance.now() - t).toBeLessThan(3000); });
```

- [ ] **Step 2:** Run `npx vitest run tests/sim/world/mapgen.test.ts` → FAIL.
- [ ] **Step 3:** Implement `generateWorld`. Order: fbm elevation → creeks (downhill walk from a high point to an edge; tiles become `Surface.Water` + `Feature.Creek`, 2–3 tiles wide) → ponds (fill local minima to a water level, keeping ponds of 50–2,000 tiles) → wetlands (low, wet areas next to water) → rock outcrops (noise threshold on steep tiles) → trees (noise-clustered, avoiding water and rock) → specimen trees (`Feature.SpecimenTree` + species) → road and neighbour edges. Grass and health start at defaults (health 70, moisture 50, mowHeight 1000 = 100 mm natural). Use `rng.fork('creeks')` and similar for each stage.
- [ ] **Step 4:** Run the tests → PASS.
- [ ] **Step 5:** Commit `feat: seeded procedural map generation with terrain types`.

### Task 4: Ledger and land parcels

**Files:**
- Create: `src/sim/economy/ledger.ts`, `src/sim/land/parcels.ts`
- Test: `tests/sim/economy/ledger.test.ts`, `tests/sim/land/parcels.test.ts`

**Interfaces:**
- Produces:
  - `type TxCategory = 'land' | 'construction' | 'earthworks' | 'wages' | 'equipment' | 'water' | 'supplies' | 'greenFees' | 'proShop' | 'fnb' | 'carts' | 'range' | 'lessons' | 'simulator' | 'memberships' | 'events' | 'loan' | 'interest' | 'tax' | 'utilities' | 'insurance' | 'other'`
  - `class Ledger { cash: number; readonly unlimited: boolean; constructor(startCash: number /* Infinity = sandbox */); canAfford(amt: number): boolean; spend(amt: number, cat: TxCategory, day: number, courseId?: number): boolean; earn(amt: number, cat: TxCategory, day: number, courseId?: number): void; totals(fromDay: number, toDay: number, courseId?: number): Record<TxCategory, { in: number; out: number }>; readonly tx: Transaction[] }`. Daily rollups only: `Transaction { day; cat; amount /* +in, -out */; courseId }`, merged by `(day, cat, courseId)`.
  - `class ParcelGrid { readonly perSide: number; price: Int32Array; owner: Uint8Array /*0 none, 1 player*/; constructor(perSide); static priceFor(world: World, px, py, rng: Rng): number; isOwned(px, py): boolean; tileOwned(x, y): boolean; buy(px, py, ledger, day): Result; sell(px, py, ledger, day, blockedReason?: string): Result; adjacentToRoad(world, px, py): boolean }`
  - `SELL_BACK_RATE = 0.7`
  - Price formula (proposal): base $20,000 + $60,000 × fraction of buildable tiles + $40,000 if within 2 parcels of the road + $30,000 × water-frontage fraction, clamped to [20,000, 150,000] and rounded to $1,000.

- [ ] **Step 1: Write failing tests**

```ts
test('buy deducts price and marks owned', () => {
  const l = new Ledger(100_000); const g = new ParcelGrid(20); g.price[0] = 40_000;
  expect(g.buy(0, 0, l, 1).ok).toBe(true); expect(l.cash).toBe(60_000); expect(g.tileOwned(10, 10)).toBe(true);
});
test('buy fails without funds and changes nothing', () => {
  const l = new Ledger(10_000); const g = new ParcelGrid(20); g.price[0] = 40_000;
  const r = g.buy(0, 0, l, 1); expect(r.ok).toBe(false); expect(l.cash).toBe(10_000); expect(g.isOwned(0, 0)).toBe(false);
});
test('cannot buy twice; sell refunds 70%', () => { /* buy, buy again fails; sell → cash += 28_000 */ });
test('sell refused with reason when blockedReason given', () => { expect(g.sell(0, 0, l, 1, 'hole 3 is on this parcel').ok).toBe(false); });
test('prices within bounds for generated map', () => { /* every parcel of generateWorld(1,'parkland',1000) price in [20000,150000] */ });
test('ledger totals by category and day range', () => { /* spend 100 land d1, earn 50 greenFees d2 → totals(1,2).land.out==100, greenFees.in==50 */ });
test('sandbox ledger always affords', () => { expect(new Ledger(Infinity).canAfford(1e12)).toBe(true); });
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: ledger and parcel purchasing`.

### Task 5: Clock, Game container, commands, fixed-tick loop

**Files:**
- Create: `src/core/events.ts`, `src/sim/clock.ts`, `src/sim/difficulty.ts`, `src/sim/commands.ts`, `src/sim/game.ts`
- Test: `tests/sim/clock.test.ts`, `tests/sim/game.test.ts`

**Interfaces:**
- Produces:
  - `events.ts`: `class EventBus<E extends Record<string, unknown>> { on<K extends keyof E>(k: K, fn: (p: E[K]) => void): () => void; emit<K extends keyof E>(k: K, p: E[K]): void }`
  - `clock.ts`: `TICKS_PER_MIN = 10`, `DAY_START_MIN = 300`, `DAY_END_MIN = 1260`, `DAYS_PER_SEASON = 28`, `type Season = 'spring' | 'summer' | 'autumn' | 'winter'`, `class GameClock { tick: number; day: number /*from 1*/; minuteOfDay: number; get season(): Season; get year(): number; step(): { newMinute: boolean; newDay: boolean } }`. When the minute reaches `DAY_END_MIN`, `step` jumps to the next day at `DAY_START_MIN` (night skipped) and returns `newDay: true`.
  - `REAL_MS_PER_TICK_1X = 720_000 / (960 * 10) = 75`
  - `difficulty.ts`: `type Difficulty = 'easy' | 'normal' | 'hard' | 'sandbox'`, `STARTING_CASH: Record<Difficulty, number> = { easy: 5_000_000, normal: 3_000_000, hard: 1_500_000, sandbox: Infinity }`
  - `commands.ts`: `type Command = { t: 'buyParcel'; px: number; py: number } | { t: 'sellParcel'; px: number; py: number } | ...` (later tasks add members to this union).
  - `game.ts`: `interface NewGameOptions { seed: number; terrain: TerrainType; difficulty: Difficulty; size?: number }`, `type GameEvents = { day: { day: number }; minute: { minute: number }; notify: Notification; cash: { cash: number } }`, `interface Notification { id: number; kind: 'info' | 'warn' | 'bad'; text: string; at?: Vec2 }`, `class Game { seed; terrain; difficulty; world: World; parcels: ParcelGrid; ledger: Ledger; clock: GameClock; rng: Rng; courses: Course[] /* Task 10 */; events: EventBus<GameEvents>; soilStockpileM3: number; static create(o: NewGameOptions): Game; dispatch(c: Command): Result<unknown>; tick(): void; registerSystem(s: System): void; notify(kind, text, at?): void }`, `interface System { name: string; onTick?(g: Game): void; onMinute?(g: Game): void; onDay?(g: Game): void }`
  - The order systems run in is the order they were registered, which keeps the sim deterministic.

- [ ] **Step 1: Write failing tests**

```ts
test('clock skips night', () => {
  const c = new GameClock(); c.minuteOfDay = DAY_END_MIN - 1;
  let r; for (let i = 0; i < TICKS_PER_MIN; i++) r = c.step();
  expect(r!.newDay).toBe(true); expect(c.day).toBe(2); expect(c.minuteOfDay).toBe(DAY_START_MIN);
});
test('season advances every 28 days', () => { const c = new GameClock(); c.day = 29; expect(c.season).toBe('summer'); });
test('Game.create gives starting cash by difficulty', () => {
  expect(Game.create({ seed: 1, terrain: 'parkland', difficulty: 'hard', size: 100 }).ledger.cash).toBe(1_500_000);
});
test('dispatch buyParcel', () => {
  const g = Game.create({ seed: 1, terrain: 'parkland', difficulty: 'normal', size: 100 });
  const before = g.ledger.cash; expect(g.dispatch({ t: 'buyParcel', px: 0, py: 0 }).ok).toBe(true);
  expect(g.ledger.cash).toBeLessThan(before);
});
test('systems fire onDay once per day in registration order', () => { /* register two systems logging names; tick through a day; log == ['a','b'] */ });
test('determinism: two games same seed + same commands + 5000 ticks → equal cash and rng state', () => {});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: game container, clock, commands and systems`.

### Task 6: Renderer — Pixi app, camera, programmer-art atlas, chunk drawing, hill shading

**Files:**
- Create: `src/render/pixiApp.ts`, `src/render/camera.ts`, `src/render/palette.ts`, `src/render/atlas.ts`, `src/render/shading.ts`, `src/render/chunks.ts`
- Modify: `src/main.ts`
- Test: `tests/render/camera.test.ts`, `tests/render/shading.test.ts`

**Interfaces:**
- Consumes: `World`, `Surface`, `Feature`, `TerrainType`
- Produces:
  - `TILE_PX = 16`
  - `class Camera { x: number; y: number /* world tile coords at screen centre */; zoom: 0.25 | 0.5 | 1 | 2 | 3 | 4; screenToTile(sx, sy, viewW, viewH): Vec2; tileToScreen(tx, ty, viewW, viewH): Vec2; visibleChunks(viewW, viewH, chunksPerSide): number[]; zoomAt(dir: 1 | -1, sx, sy, viewW, viewH): void }`. Zoom steps are integers ≥ 1; zoom levels below 1 use a pre-rendered overview.
  - `palette.ts`: `PALETTES: Record<TerrainType, Record<Surface, number>>` (hex colours) plus feature and tree colours.
  - `atlas.ts`: `buildAtlas(renderer): Atlas` → `class Atlas { tile(name: string): Texture; sprite(name: string, frame = 0): Texture }`. Generates 16×16 pixel textures in code: surface tiles with dithering, mowing stripes (`fairway_stripe_a/b`), rock, tree species, golfer (4 walk frames + a swing frame), cart, mower, flag. Every name used anywhere must be registered here.
  - `shading.ts`: `hillshade(w: World, x, y, sunDir = { x: -1, y: -1 }): number /* 0.6..1.25 multiplier */`
  - `class ChunkRenderer { constructor(app, atlas, world, terrain); update(camera): void /* draws visible chunks, re-bakes dirty ones into RenderTextures */; setOverlay(fn: OverlayFn | null): void }` with `type OverlayFn = (x: number, y: number) => number | null` (RGBA colour or null)
  - `main.ts` temporarily boots `Game.create({ seed: Date.now(), terrain: 'parkland', difficulty: 'normal' })` and renders it. WASD/arrows/edge-drag pan, wheel zoom.

- [ ] **Step 1: Write failing tests**

```ts
test('screenToTile inverts tileToScreen', () => {
  const c = new Camera(); c.x = 500; c.y = 500; c.zoom = 2;
  const s = c.tileToScreen(510, 490, 800, 600); const t = c.screenToTile(s.x, s.y, 800, 600);
  expect(t.x).toBeCloseTo(510); expect(t.y).toBeCloseTo(490);
});
test('visibleChunks only includes on-screen chunks', () => { /* camera at 25,25 zoom 4 view 800x600 → includes 0, excludes chunk 399 */ });
test('hillshade brighter on sun-facing slope', () => { /* slope facing -x,-y > flat > facing +x,+y */ });
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Browser check.** Run `npm run dev`, open it in the browser preview, and confirm that: the map shows hills, water, creeks, rocks and trees; panning and zooming stay smooth (at least 55 fps per the browser performance panel at zoom 1 on a full map); and there are no console errors.
- [ ] **Step 6:** Commit `feat: chunked pixi renderer with programmer-art atlas and hill shading`.

### Task 7: UI shell, new-game screen, land tool

**Files:**
- Create: `src/ui/dom.ts`, `src/ui/newGame.ts`, `src/ui/hud.ts`, `src/ui/toolbar.ts`, `src/ui/inspector.ts`, `src/ui/overlayBar.ts`, `src/ui/notifications.ts`, `src/ui/tools/toolController.ts`, `src/ui/tools/landTool.ts`, `src/render/overlays.ts`, `src/ui/style.css`
- Modify: `src/main.ts`, `src/sim/game.ts` (add `speed` and the real-time driver)
- Test: `tests/ui/landTool.test.ts`, `tests/sim/loop.test.ts`

**Interfaces:**
- Consumes: `Game`, `Camera`, `ChunkRenderer`
- Produces:
  - `dom.ts`: `h(tag, attrs, ...children): HTMLElement` (tiny element helper), `mount(parent, el)`
  - `class GameLoop { speed: 0 | 1 | 2 | 4 | 8; constructor(game); advance(realMs: number): number /* ticks run; caps at 200 ticks per frame */ }`
  - `interface Tool { id: string; cursor: string; onPointerDown?(t: Vec2, e: PointerEvent): void; onPointerMove?(t: Vec2, e: PointerEvent): void; onPointerUp?(t: Vec2, e: PointerEvent): void; onKey?(e: KeyboardEvent): void; preview?(): OverlayFn | null; panel?(): HTMLElement | null }`
  - `class ToolController { setTool(t: Tool | null); }`
  - `landTool(game): Tool`. Hovering a parcel shows its price and features; clicking dispatches `buyParcel`, shift-click dispatches `sellParcel`.
  - `overlays.ts`: `OVERLAYS: Record<OverlayId, (game: Game) => OverlayFn>` with `type OverlayId = 'elevation' | 'slope' | 'land' | ...` (later tasks add more). `land` tints owned parcels green and shades unowned ones by price.
  - `newGame.ts`: a form for seed (number or text, hashed with `hashString`), terrain, difficulty → `Game.create`.
  - `hud.ts`: cash, date ("Day 34 · Spring · 7:42 AM"), speed buttons, and keyboard shortcuts `Space` (pause), `1`–`4` (1×/2×/4×/8×).
  - The layout follows §14 (left toolbar, right inspector, bottom overlay bar).

- [ ] **Step 1: Write failing tests**

```ts
test('GameLoop runs ticks proportional to speed', () => {
  const g = Game.create({ seed: 1, terrain: 'parkland', difficulty: 'normal', size: 100 }); const L = new GameLoop(g);
  L.speed = 1; expect(L.advance(750)).toBe(10); L.speed = 4; expect(L.advance(750)).toBe(40); L.speed = 0; expect(L.advance(750)).toBe(0);
});
test('land tool click buys parcel under cursor', () => { /* call tool.onPointerDown({x:75,y:10}) → parcels.isOwned(1,0) */ });
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Browser check.** Start a new game, buy three parcels (cash drops by the shown price), toggle the Land and Elevation overlays, and change speed so the clock advances.
- [ ] **Step 6:** Commit `feat: UI shell, new-game screen, land purchasing tool`. **M0 complete.**

---

# Phase M1 — Build a hole

### Task 8: Construction costs and atomic edit plans

**Files:**
- Create: `src/sim/construction/costs.ts`, `src/sim/construction/plan.ts`, `src/sim/construction/paint.ts`
- Modify: `src/sim/commands.ts`, `src/sim/game.ts`
- Test: `tests/sim/construction/paint.test.ts`

**Interfaces:**
- Produces:
  - `COSTS` (proposal values, all per tile unless stated): `surface: Record<Surface, number>` = Tee 120, Fairway 40, Green 400, Fringe 150, FirstCut 25, Rough 15, DeepRough 10, Native 8, Bunker 250, Waste 60, Path 0 (see Task 12), Natural 5 (reverting); `cutPerM3 = 6`, `fillFromStockPerM3 = 4`, `importFillPerM3 = 22`, `treePlant: Record<number /*species*/, number>` (default 350), `treeRemove = 400`, `specimenRemove = 12_000`, `digWaterPerM3 = 9`, `pondLinerPerTile = 30`, `fillWaterPerM3 = 40`
  - `interface TileChange { i: number; surface?: Surface; elevation?: number; treeSpecies?: number; feature?: Feature }`
  - `interface EditPlan { changes: TileChange[]; cost: number; skipped: number; stockpileDelta: number /*m3*/; reasons: string[] }`
  - `brushTiles(cx: number, cy: number, radius: number, shape: 'circle' | 'square' = 'circle'): Vec2[]`
  - `editableTile(g: Game, x: number, y: number): string | null` returns a reason why the tile can't be edited, or null if it can: off the map, unowned, `isBlockingFeature`, or belongs to a hole in state `open` or `closing`.
  - `planSurfacePaint(g: Game, tiles: Vec2[], s: Surface): EditPlan`. Tiles that already have that surface cost nothing.
  - `commitPlan(g: Game, p: EditPlan, cat: TxCategory): Result`. Spends `cost` once, applies every change, adjusts `soilStockpileM3`, and marks dirty chunks. If `!canAfford`, nothing changes.
  - Command: `{ t: 'paint'; tiles: Vec2[]; surface: Surface }`

- [ ] **Step 1: Write failing tests**

```ts
// helper: newOwnedGame() → 100-size game, parcels (0,0) and (1,0) owned, cash 3M
test('paint charges per tile and sets surface', () => {
  const g = newOwnedGame(); const p = planSurfacePaint(g, brushTiles(25, 25, 2), Surface.Fairway);
  expect(p.cost).toBe(p.changes.length * 40); expect(commitPlan(g, p, 'construction').ok).toBe(true);
  expect(g.world.surface[g.world.idx(25, 25)]).toBe(Surface.Fairway);
});
test('clips to map bounds and skips unowned tiles', () => {
  const g = newOwnedGame(); const p = planSurfacePaint(g, brushTiles(0, 0, 5), Surface.Rough);
  expect(p.changes.every(c => c.i >= 0)).toBe(true);
  const q = planSurfacePaint(g, brushTiles(99, 0, 3), Surface.Rough); expect(q.changes.length).toBe(0); expect(q.skipped).toBeGreaterThan(0);
});
test('refuses whole plan when unaffordable', () => {
  const g = newOwnedGame(); g.ledger.cash = 100; const p = planSurfacePaint(g, brushTiles(25, 25, 4), Surface.Green);
  const snapshot = g.world.surface.slice(); expect(commitPlan(g, p, 'construction').ok).toBe(false);
  expect(g.world.surface).toEqual(snapshot); expect(g.ledger.cash).toBe(100);
});
test('rock tiles are skipped with a reason', () => { /* set feature Rock at 25,25 → plan skips it, reasons includes 'rock' */ });
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit `feat: atomic construction edit plans and surface paint`.

### Task 9: Terrain shaping with cut/fill stockpile

**Files:**
- Create: `src/sim/construction/terrain.ts`
- Modify: `src/sim/commands.ts`
- Test: `tests/sim/construction/terrain.test.ts`

**Interfaces:**
- Consumes: `EditPlan`, `commitPlan`, `editableTile`, `COSTS`
- Produces:
  - `type TerrainOp = { op: 'raise' | 'lower'; amountM: number } | { op: 'smooth'; strength: number /*0..1*/ } | { op: 'flatten'; targetM: number } | { op: 'slopeLine'; from: Vec2; to: Vec2; fromM: number; toM: number; widthTiles: number }`
  - `planTerrain(g: Game, tiles: Vec2[], op: TerrainOp): EditPlan`. Volume per tile = |Δh| × 4 m². Cut adds to the stockpile at `cutPerM3`; fill draws from the stockpile at `fillFromStockPerM3` first, and anything beyond that is imported at `importFillPerM3`. Raise and lower use a soft falloff toward the brush edge (proposal: cosine).
  - Water tiles can't be raised or lowered with this tool (Task 12 handles water).
  - Command: `{ t: 'terrain'; tiles: Vec2[]; op: TerrainOp }`

- [ ] **Step 1: Write failing tests**

```ts
test('lower adds to stockpile and costs cut', () => { /* flat owned area, lower 1m radius 0 tile → stockpileDelta 4, cost 24 */ });
test('raise uses stockpile before importing', () => {
  const g = newOwnedGame(); g.soilStockpileM3 = 2; const p = planTerrain(g, [{ x: 25, y: 25 }], { op: 'raise', amountM: 1 });
  expect(p.cost).toBe(2 * 4 + 2 * 22); expect(p.stockpileDelta).toBe(-2);
});
test('flatten moves all tiles to target', () => {});
test('smooth reduces max gradient', () => {});
test('slopeLine produces linear profile along line', () => {});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit `feat: terrain shaping with cut/fill balance`.

### Task 10: Course and hole model

**Files:**
- Create: `src/sim/course/course.ts`, `src/sim/course/yardage.ts`
- Modify: `src/sim/game.ts` (`courses`, `createCourse`), `src/sim/commands.ts`
- Test: `tests/sim/course/course.test.ts`, `tests/sim/course/yardage.test.ts`

**Interfaces:**
- Produces:
  - `type HoleState = 'construction' | 'growingIn' | 'open' | 'closing' | 'closed'`
  - `type TeeKind = 'championship' | 'back' | 'middle' | 'forward'`, `TEE_ORDER: TeeKind[]`
  - `interface TeeBox { kind: TeeKind; center: Vec2; marker: Vec2 }`
  - `interface Hole { id: number /*unique per game, ≥1; written to world.holeId*/; courseId: number; number: number; name: string; state: HoleState; route: Vec2[] /* tee → waypoints → green centre */; teeBoxes: TeeBox[]; greenCenter: Vec2; pins: Vec2[]; activePin: number; parOverride: number | null; strokeIndex: number | null; growInDaysLeft: number }`
  - `interface Course { id: number; name: string; holes: Hole[]; clubhouse: Vec2 | null }`
  - `class CourseRegistry` (on `Game` as `g.courses`) with `create(name): Course`, `get(id)`, `hole(id): Hole | undefined`, `allHoles(): Hole[]`, `nextHoleId()`
  - `renumber(course: Course, orderedHoleIds: number[]): void`
  - `yardage.ts`: `routeLengthTiles(route: Vec2[]): number`, `teeYards(h: Hole, kind: TeeKind): number` (from tee centre through the waypoints after the tee to the green centre, in yards), `suggestPar(yards: number): 3 | 4 | 5` (≤250 → 3, ≤470 → 4, else 5), `holePar(h: Hole): number` (override, otherwise suggested from the longest tee)
  - `Game.dispatch` for `sellParcel` now passes a `blockedReason` when any tile in the parcel has a `holeId` or `Surface.Building` (e.g. `"hole 3 is on this parcel"`).
  - Commands: `createCourse`, `renumberHoles`, `setPar`, `addTeeBox`, `moveTeeBox`, `removeTeeBox`, `setPins`, `setActivePin`. Max 4 tee boxes, max one per kind. Pins: 4–6 when opening (checked in Task 14), and each pin must be on a Green tile.

- [ ] **Step 1: Write failing tests**

```ts
test('suggestPar thresholds', () => { expect(suggestPar(250)).toBe(3); expect(suggestPar(251)).toBe(4); expect(suggestPar(470)).toBe(4); expect(suggestPar(471)).toBe(5); });
test('teeYards follows doglegs', () => { /* route tee(0,0)→(100,0)→(100,100): 200 tiles = 437.4 yd */ });
test('fifth tee box refused, duplicate kind refused', () => {});
test('pin must be on green', () => {});
test('renumber reorders and keeps ids', () => {});
test('holes are grouped by courseId', () => { /* two courses, allHoles filter by courseId */ });
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit `feat: course, hole, tee box and pin model`.

### Task 11: Fairway Pen

**Files:**
- Create: `src/sim/course/pen.ts`
- Modify: `src/sim/commands.ts`
- Test: `tests/sim/course/pen.test.ts`

**Interfaces:**
- Consumes: `planSurfacePaint`, `commitPlan`, `CourseRegistry`, `suggestPar`
- Produces:
  - `interface PenInput { courseId: number; route: Vec2[] /* 2–4 points: tee, ≤2 waypoints, green */; fairwayWidthYd: number /* default 35 */; roughWidthYd: number /* default 15 each side */; greenRadiusYd: number /* default 14 */ }`
  - `planPenHole(g: Game, input: PenInput): { plan: EditPlan; draftHole: Omit<Hole, 'id' | 'number'>; warnings: string[] }`. Builds a tee (8×4-tile pad, kind `back`), a fairway corridor along the route that starts 30% of the way to the first leg (proposal: 60 yd for par 3 = none), first cut and rough strips, a fringe ring (1 tile) and a green disc, plus 4 default pins spread over the green. A par-3 route (≤250 yd) gets no fairway.
  - Warnings (non-blocking): `"crosses rock"`, `"crosses creek"` (if not bridged), `"overlaps hole N corridor"` (the 30 m safety buffer around another hole's tiles), `"landing zone within 20 m of out-of-bounds"`.
  - `commitPenHole(g, input): Result<Hole>`. Commits the plan, registers the hole (`state = 'construction'`, next number in the course) and writes `world.holeId` for every painted tile.
  - Command: `{ t: 'penHole'; input: PenInput }`

- [ ] **Step 1: Write failing tests**

```ts
test('straight par 4 draft has tee, fairway, green and suggested par 4', () => { /* route 0→180 tiles (393yd) on owned land; count surfaces; holePar == 4 */ });
test('par-3 route has no fairway tiles', () => {});
test('dogleg corridor follows waypoint', () => { /* waypoint tile is Fairway */ });
test('warns when crossing rock and does not paint rock tiles', () => {});
test('warns on overlap with existing hole buffer', () => {});
test('fails atomically when unaffordable', () => {});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit `feat: fairway pen hole drafting`.

### Task 12: Hazards, water, trees, stakes, paths

**Files:**
- Create: `src/sim/construction/hazards.ts`, `src/sim/construction/paths.ts`
- Modify: `src/sim/commands.ts`, `src/sim/construction/costs.ts`
- Test: `tests/sim/construction/hazards.test.ts`, `tests/sim/construction/paths.test.ts`

**Interfaces:**
- Produces:
  - `type SandType = 'standard' | 'premium' | 'native'` (cost multipliers 1 / 1.6 / 0.7; raking need 1 / 0.8 / 1.3; stored per tile in `firmness` for bunkers, proposal)
  - `planBunker(g, tiles: Vec2[], sand: SandType, depthM = 0.6): EditPlan`. Sets the surface to Bunker and lowers elevation by `depthM` (earthworks cost included).
  - `planDigWater(g, tiles, depthM = 1.5): EditPlan`. Sets Water, lowers elevation, charges dig + liner. Existing water can be enlarged.
  - `planFillWater(g, tiles): EditPlan`. Turns water back into Natural at the surrounding grade, charging `fillWaterPerM3` (§4: expensive). Creek tiles are refused.
  - `planTrees(g, tiles, species: number, density: number /*0..1*/): EditPlan` and `planRemoveTrees(g, tiles): EditPlan`. Removing a specimen tree costs `specimenRemove` and adds a reputation penalty event `{ kind: 'specimenRemoved' }` to `g.pendingReputationEvents` (consumed in Task 40).
  - `computeStakes(g, hole: Hole): { ob: Vec2[]; red: Vec2[]; yellow: Vec2[] }`. OB along unowned, road or neighbour boundaries within 40 m of the hole; red stakes for water lying beside the line of play, yellow for water crossing it. Stored on `Hole.stakes` (add the field), with overrides through command `setStakeOverride`.
  - `paths.ts`: `type PathTier = 'gravel' | 'asphalt' | 'concrete'`, costs 20 / 45 / 70 per tile; `planPath(g, tiles, tier)`; `planBridge(g, tiles)` costs 600 per tile, is allowed over Water/Creek, and makes the tiles walkable (`Surface.Path`, keeps the `Feature.Creek` flag).
  - Small structures: `type StructureKind = 'shelter' | 'restroom' | 'ballWasher' | 'bench' | 'drinkStation'`, `placeStructure(g, kind, at: Vec2): Result` (costs proposal 8000 / 25000 / 300 / 400 / 15000), stored in `g.structures: Structure[]`.
  - Commands for each of the above.

- [ ] **Step 1: Write failing tests** covering: bunker lowers terrain and charges sand × multiplier; water dig charges dig + liner; filling a creek is refused; removing a specimen tree queues a reputation event; stakes put OB next to an unowned parcel and red stakes beside a lateral pond; a bridge over a creek is walkable (`isWalkable(world, x, y)`, which this task adds to `tiles.ts`).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit `feat: bunkers, water, trees, stakes, paths and structures`.

### Task 13: Green shaper, slope analysis, pinnable area

**Files:**
- Create: `src/sim/course/green.ts`
- Test: `tests/sim/course/green.test.ts`

**Interfaces:**
- Consumes: `slopeAt`, `planTerrain`
- Produces:
  - `MAX_PIN_SLOPE(stimp: number): number`. The maximum gradient allowed at a pin: 0.03 at Stimp 8 falling linearly to 0.015 at Stimp 13 (proposal).
  - `greenTiles(g, hole): number[]` (tile indices reached by flood fill from `greenCenter` through Green tiles)
  - `pinnableTiles(g, hole, stimp: number): number[]` (green tiles at least 2 tiles from the fringe with gradient ≤ `MAX_PIN_SLOPE`)
  - `pinDifficulty(g, hole, pin: Vec2, stimp): number /*0..1*/` (from slope at the pin and distance to the edge)
  - `planGreenShape(g, hole, op: TerrainOp, tiles: Vec2[]): EditPlan` (only allowed on that hole's green and fringe tiles, otherwise skipped)
  - `autoPins(g, hole, stimp, count = 4): Vec2[]` (spread pinnable spots using farthest-point sampling)

- [ ] **Step 1: Write failing tests**: a flat green is fully pinnable except the 2-tile edge band; tilting the green above the max slope leaves zero pinnable tiles; a higher stimp reduces the pinnable count; `autoPins` returns spread-out pins (min pairwise distance ≥ 4 tiles on a 20-tile-radius green); shaping outside the green is skipped.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: green shaper and pinnable area analysis`.

### Task 14: Hole validation and lifecycle (grow-in, open, close-to-edit)

**Files:**
- Create: `src/sim/course/validate.ts`, `src/sim/course/lifecycle.ts`
- Modify: `src/sim/commands.ts`, `src/sim/game.ts` (register `lifecycleSystem`)
- Test: `tests/sim/course/lifecycle.test.ts`

**Interfaces:**
- Produces:
  - `validateHole(g, hole): { errors: string[]; warnings: string[] }`. Errors: no tee box; no green; fewer than 4 or more than 6 pins (§5.5); a pin not on green; tee or green on unowned land; no walkable route from the previous hole's green (uses `findPath` from Task 20. **Before Task 20 exists, this check uses straight-line walkability; Task 20 swaps it in.**). Warnings: the pen warnings again, plus "hole 1/10 far from clubhouse" (> 150 m).
  - `GROW_IN_DAYS = { seed: 21, sod: 3 }` (proposal), `GROW_IN_COST_PER_TILE = { seed: 2, sod: 12 }`
  - `startGrowIn(g, holeId, method: 'seed' | 'sod'): Result`. Validates, charges grow-in cost for that hole's Tee/Fairway/Green/Fringe/FirstCut tiles, and sets `state = 'growingIn'`.
  - `lifecycleSystem: System` with `onDay` decrementing `growInDaysLeft`; at 0 the state becomes `open`. While a hole is `closing`, each tick it checks `g.groupsOnHole(holeId) === 0` (Task 20 adds this; until then it returns 0) and then sets `closed`.
  - `closeHole(g, id)`: `open` → `closing`. `reopenHole(g, id)`: `closed` → `open` if valid, with no grow-in unless a turf surface was edited while closed, in which case → `growingIn` (edited tiles are tracked in `hole.editedSinceClose`).
  - Commands: `startGrowIn`, `closeHole`, `reopenHole`

- [ ] **Step 1: Write failing tests**

```ts
test('cannot grow in a hole with no pins', () => {});
test('grow-in by seed takes 21 days then opens', () => {});
test('edits on open hole are refused', () => { /* planSurfacePaint on its tiles → changes 0, reasons includes 'hole 1 is open' */ });
test('close waits for groups to clear', () => { /* stub g.groupsOnHole → 1 then 0; state closing then closed */ });
test('reopen after edit requires grow-in', () => {});
```

- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: hole validation and lifecycle with grow-in`.

### Task 15: Building tools UI and design overlays

**Files:**
- Create: `src/ui/tools/penTool.ts`, `paintTool.ts`, `terrainTool.ts`, `greenTool.ts`, `hazardTool.ts`, `pathTool.ts`, `src/ui/panels/holePanel.ts`, `src/ui/panels/buildPanel.ts`
- Modify: `src/ui/toolbar.ts`, `src/render/overlays.ts`, `src/render/chunks.ts` (pen preview layer), `src/render/entities.ts` (flags, tee markers, stake dots)
- Test: `tests/ui/penTool.test.ts`

**Interfaces:**
- Consumes: every M1 command
- Produces:
  - Pen tool: click the tee, click 0–2 waypoints, double-click the green. The preview shows the corridor, live yardage per leg and the suggested par; Enter commits and Esc cancels. Sliders for fairway, rough and green width.
  - Paint, terrain and hazard tools: brush radius `[`/`]`, a live cost tooltip (`EditPlan.cost`), and drag-paint that collects a plan for the whole stroke and commits it on pointer-up (one transaction per stroke).
  - Green tool: terrain ops limited to the selected hole's green, with the pinnable overlay shown live and a pin placement mode.
  - Hole panel (inspector): number, name, par (with override), yardage per tee, tee box add/move, pins, validation list, grow-in buttons (seed/sod with cost and days), close/reopen.
  - Overlays added: `'slope'` (gradient colour ramp), `'pinnable'` (selected green), `'stakes'`
  - Contour lines: drawn in `chunks.ts` when elevation overlay or the "contours" toggle is on, every 1 m.

- [ ] **Step 1: Write failing test**: pen tool state machine. Simulated clicks (tee, waypoint, double-click green) produce exactly one `penHole` dispatch with a 3-point route; Esc mid-draw dispatches nothing.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Browser check.** In a new game, buy land; draw a par 4 with a dogleg; add a bunker, a pond and trees; shape the green; place 4 pins; add 4 tee boxes; seed it. Then speed up to 8× until it opens, and confirm editing it is refused with a message. Check the cost tooltips against cash changes.
- [ ] **Step 6:** Commit `feat: building tools UI and design overlays`. **M1 complete.**

---

# Phase M2 — Golfers play

### Task 16: Golfer generation

**Files:**
- Create: `src/sim/golfers/golfer.ts`, `src/sim/golfers/names.ts`, `src/sim/golfers/generate.ts`
- Test: `tests/sim/golfers/generate.test.ts`

**Interfaces:**
- Produces:
  - `type Segment = 'budget' | 'mid' | 'premium'`, `type GolferType = 'casual' | 'regular' | 'competitive' | 'tourist' | 'junior' | 'senior' | 'corporate'`
  - `interface Traits { pace: number; challenge: number; aesthetics: number; loyalty: number; social: number; gear: number; food: number }` (each 0..1)
  - `interface Golfer { id: number; name: string; age: number; home: string; handicap: number /* -4..36 */; segment: Segment; type: GolferType; traits: Traits; opinion: Record<number /*courseId*/, number /* -100..100 */>; visits: number; totalSpend: number; lastVisitDay: number; memberOf: number | null }`
  - `names.ts`: `FIRST_NAMES` (≥ 150), `LAST_NAMES` (≥ 200), `TOWNS` (≥ 30), all original/common, no real celebrities
  - `generateGolfer(rng: Rng, id: number, bias?: Partial<{ type: GolferType; segment: Segment }>): Golfer`. Handicap ~ normal(16, 8) clamped to [-4, 36] for adults; juniors normal(22, 9); competitive normal(8, 5); age by type.
  - `class GolferPool { all: Map<number, Golfer>; nextId: number; spawn(rng, bias?): Golfer }` (on `Game` as `g.golfers`)

- [ ] **Step 1: Write failing tests**: generation is deterministic for the same rng seed; 10,000 golfers have a handicap mean within 16 ± 1, all in [-4, 36], and every type and segment appears; competitive golfers average a lower handicap than casual ones; names are non-empty and from the lists.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: golfer generation`.

### Task 17: Clubs, lies, ball physics

**Files:**
- Create: `src/sim/golfers/clubs.ts`, `src/sim/golfers/lie.ts`, `src/sim/golfers/ballPhysics.ts`
- Test: `tests/sim/golfers/clubs.test.ts`, `tests/sim/golfers/ballPhysics.test.ts`

**Interfaces:**
- Produces:
  - `type ClubId = 'D' | '3W' | '5W' | '4H' | '5I' | '6I' | '7I' | '8I' | '9I' | 'PW' | 'GW' | 'SW' | 'LW' | 'P'`
  - `interface ClubSpec { id: ClubId; carryM: number; sdDistPct: number; sdAngleDeg: number; launch: 'low' | 'mid' | 'high' }`
  - `clubSet(handicap: number, age: number): ClubSpec[]`. Scratch driver carry 230 m, falling about 2.2 m per handicap stroke; seniors (60+) −12%; juniors −20%. Dispersion `sdAngleDeg = 2 + 0.22 × max(0, handicap)`, `sdDistPct = 0.04 + 0.006 × max(0, handicap)` (proposal; tuned in Task 45).
  - `type Lie = 'tee' | 'fairway' | 'fringe' | 'firstCut' | 'rough' | 'deepRough' | 'native' | 'bunker' | 'waste' | 'green' | 'trees' | 'path'`
  - `lieAt(w: World, p: Vec2): Lie`, `LIE_EFFECT: Record<Lie, { distMult: number; angleMult: number; maxClub?: ClubId }>` (e.g. rough 0.85 / 1.3; deepRough 0.6 / 1.8, max 7I; bunker 0.7 / 1.5, max PW for fairway bunkers, sand wedge only near the green; trees 0.5 / 2.0)
  - `interface BallOutcome { final: Vec2; path: Vec2[]; result: 'ok' | 'water' | 'ob' | 'lost' | 'unplayable'; hazardEntry?: Vec2 }`
  - `rollBall(g: Game, landing: Vec2, dir: Vec2, carryM: number, launch: ClubSpec['launch']): BallOutcome`. Roll distance = carry × base roll by launch (low 0.18, mid 0.10, high 0.04) × surface factor (green scales with stimp/10, fairway with firmness, rough 0.3, bunker 0) plus the downhill slope component. The ball steps tile by tile and stops in water (`water`, with entry point recorded), out of bounds (stake OB or unowned → `ob`), or on rock (`unplayable`). Landing in trees: 50% chance to drop near the landing spot, otherwise `lost` if in dense trees (≥ 3 neighbouring tree tiles), proposal.

- [ ] **Step 1: Write failing tests**: driver carry is greater for handicap 0 than 20; dispersion is greater for 20 than 0; the club list is ordered by carry descending; ball physics on a flat fairway rolls along `dir` and stops; on a downhill green it rolls further than on an uphill one; a ball crossing a water tile ends `water` with `hazardEntry`; a ball rolling onto an unowned tile → `ob`; landing on a rock tile → `unplayable`.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: clubs, lies and ball roll physics`.

### Task 18: Shot simulation and putting

**Files:**
- Create: `src/sim/golfers/shot.ts`, `src/sim/golfers/putting.ts`
- Test: `tests/sim/golfers/shot.test.ts`, `tests/sim/golfers/putting.test.ts`

**Interfaces:**
- Consumes: `clubSet`, `LIE_EFFECT`, `rollBall`
- Produces:
  - `interface ShotInput { from: Vec2; target: Vec2; club: ClubSpec; lie: Lie; golfer: Golfer; wind: Vec2 /* m/s */ }`
  - `simulateShot(g: Game, s: ShotInput, rng: Rng): BallOutcome & { landing: Vec2; mishit: boolean }`. Distance and angle errors are drawn from the club spec × lie effect. Mishit chance = 0.01 + 0.006 × handicap (a mishit gives 40–70% distance and doubled angle error). Wind pushes the landing by `wind × carryM × 0.012` (proposal).
  - `greenStimp(g, hole): number` (until Task 25 returns 10)
  - `putt(g: Game, from: Vec2, hole: Vec2, golfer: Golfer, stimp: number, rng: Rng): { final: Vec2; holed: boolean }`. Make probability from distance d (m): `p = clamp(1.05 × exp(-0.17 × d × (1 + 0.025 × handicap) × (stimp / 10)^0.5 × (1 + 8 × gradientAtCup)), 0, 0.99)` (proposal). A miss leaves the ball at a distance sampled from N(0.06 d + 0.3, 0.15 d) past or short of the hole, along the line plus a break offset.

- [ ] **Step 1: Write failing tests** (statistical, seeded, 2,000 samples): a 0-handicap player lands closer to the target than a 25-handicap on average; mishit rate rises with handicap; one-putt rate from 1 m > 85%, from 10 m < 20%; three-putt rate from 15 m is higher at stimp 13 than at stimp 8; a sloped cup lowers the make rate.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: handicap-driven shot and putting simulation`.

### Task 19: Shot AI, tee choice, pickup rule, whole-hole simulation

**Files:**
- Create: `src/sim/golfers/ai.ts`, `src/sim/golfers/hole.ts`
- Test: `tests/sim/golfers/ai.test.ts`, `tests/sim/golfers/hole.test.ts`

**Interfaces:**
- Produces:
  - `chooseTee(golfer: Golfer, hole: Hole): TeeBox`. By handicap: ≤ 5 → championship, ≤ 12 → back, ≤ 22 → middle, else forward; falls back to the nearest existing kind. Traits shift this: `challenge > 0.8` moves one tee back ("ego"), seniors with `challenge < 0.3` move one forward.
  - `planShot(g, golfer, ball: Vec2, lie: Lie, hole: Hole, pin: Vec2, rng): { club: ClubSpec; target: Vec2 }`. Evaluates a handful of candidate targets along the route and toward the pin with each allowed club, scoring each by expected remaining distance + hazard risk (probability the dispersion ellipse hits water/OB/bunker/trees × penalty strokes) × risk aversion (1 − `challenge` × 0.5). Lays up when the risk is too high.
  - `MAX_STROKES = (par: number) => par * 2` (double par pickup)
  - `interface ShotRecord { from: Vec2; landing: Vec2; final: Vec2; club: ClubId; result: BallOutcome['result']; penalty: number }`
  - `interface HoleResult { holeId: number; tee: TeeKind; strokes: number; putts: number; shots: ShotRecord[]; pickedUp: boolean; penalties: number; gir: boolean; fairwayHit: boolean | null }`
  - `simulateHole(g, golfer, hole, rng): HoleResult`. Runs the whole hole headless (used by stats, rating and tests; Task 21 animates the same shot sequence). Penalties: water → +1, drop at entry point back on line; OB/lost → stroke and distance (+1, replay from the previous spot); unplayable → +1, drop within 2 club lengths not nearer the hole on a playable tile, falling back to the previous spot.

- [ ] **Step 1: Write failing tests**: `chooseTee` table; on a 400-yard open par 4 a 0-handicap averages < 4.4 and a 24-handicap averages > 5.2 over 500 holes; a pond in front of the green increases the 24-handicap's average more than the 0's; **`picks up at double par on impossible hole`** (green completely surrounded by rock: strokes ≤ 8, `pickedUp` true, finishes in < 50 ms); a lay-up happens for a 30-handicap facing a 200 m carry over water at least 50% of the time.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: shot AI, tee choice and hole simulation`.

### Task 20: Pathfinding and group movement on course

**Files:**
- Create: `src/sim/world/pathfind.ts`, `src/sim/golfers/groups.ts`
- Modify: `src/sim/course/validate.ts` (use `findPath`), `src/sim/game.ts` (`groupsOnHole`, register `groupSystem`)
- Test: `tests/sim/world/pathfind.test.ts`, `tests/sim/golfers/groups.test.ts`

**Interfaces:**
- Produces:
  - `findPath(g: Game, from: Vec2, to: Vec2, mode: 'walk' | 'cart'): Vec2[] | null`. A* on a 2×-coarsened grid (4 m cells) with a per-tile cost: path 0.6, playable turf 1, green 3 (avoid, carts forbidden on greens/tees), bunker 4, water/rock/wetland/unowned impassable unless bridged. Results are cached by `(from cell, to cell, mode)` and the cache is cleared on any `commitPlan`.
  - `type GroupPhase = 'toTee' | 'teeing' | 'walkingToBall' | 'addressing' | 'putting' | 'holedOut' | 'toNextTee' | 'toClubhouse' | 'done'`
  - `interface Group { id: number; courseId: number; golferIds: number[]; teeTime: number /*day-minute*/; holeOrder: number[] /*hole ids*/; holeIdx: number; phase: GroupPhase; pos: Vec2; balls: Map<number, BallState>; scores: Map<number, HoleResult[]>; usesCart: boolean; waitingMin: number }`, `interface BallState { pos: Vec2; lie: Lie; strokes: number; holed: boolean; pickedUp: boolean }`
  - `groupSystem: System`. Per tick: move the group along its path (walk 1.3 m/s, cart 4 m/s in game seconds = ×6 per tick); when it reaches the furthest ball, the player farthest from the hole hits (time per shot 45 s); putting 30 s per putt. **A group may not hit while the group ahead is within its target distance + 30 m on the same hole** (it waits, and `waitingMin` grows). Shots come from `simulateShot`/`putt` with `g.rng.fork('group' + id)`.
  - `Game.groupsOnHole(holeId): number`
  - Events: `g.events.emit('holeComplete', { groupId, holeId, results })`, `g.events.emit('roundComplete', { groupId })` (add to `GameEvents`)

- [ ] **Step 1: Write failing tests**: a path goes around a pond and uses a bridge when one exists; carts never step on green or tee; `findPath` returns null into a rock enclosure; a single group finishes a 3-hole test course and emits 3 `holeComplete` events and 1 `roundComplete`; a second group teeing 2 minutes later accumulates `waitingMin > 0`; `groupsOnHole` reflects position.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: pathfinding and on-course group movement`.

### Task 21: Clubhouse, tee sheet, demand, green fees

**Files:**
- Create: `src/sim/golfers/teeSheet.ts`, `src/sim/golfers/demand.ts`, `src/sim/business/buildings.ts` (clubhouse only for now)
- Modify: `src/sim/commands.ts`, `src/sim/game.ts`
- Test: `tests/sim/golfers/demand.test.ts`, `tests/sim/golfers/teeSheet.test.ts`, `tests/sim/business/buildings.test.ts`

**Interfaces:**
- Produces:
  - `type BuildingKind = 'clubhouse'` (Task 34 extends this), `interface Building { id; kind: BuildingKind; courseId; tier: number; origin: Vec2; w: number; h: number }`. `BUILDING_DEFS.clubhouse = { w: 15, h: 10, cost: [250_000, 900_000, 2_500_000] /*per tier*/, roadAdjacent: true }`. `placeBuilding(g, kind, courseId, origin): Result` paints `Surface.Building` and must be on owned land next to the road (§4).
  - `roundOptions(course): number[]`. The number of open holes N gives `[N]` when N < 9; `[9]` when 9 ≤ N < 18; `[9, 18]` when N ≥ 18 (§17). Holes are played in number order, skipping closed ones; with N < 9, the round covers the open holes in order.
  - `interface Pricing { greenFee: Record<number /*round length*/, number> }` (Task 37 extends this with bands). Default $8 per hole.
  - `class TeeSheet { intervalMin = 10; firstTee = 360 /*6:00*/; lastTee(roundHoles): number /* sunset − 13 min per hole */; slots(day): TeeSlot[]; book(day, minute, group): boolean }`, `interface TeeSlot { minute: number; groupId: number | null }`
  - `demand.ts`: `dailyDemand(g, course): number`. Expected golfers = base 30 × reputation factor (Task 40; 1.0 until then) × price factor `clamp((40 / avgFeePer18) ^ 0.8, 0.2, 2.5)` × weather factor (Task 26; 1.0 until then) × capacity. `demandSystem: System` `onDay` generates arrivals for the next day: pick or spawn golfers (returning golfers weighted by opinion), form groups of 1–4 (`social` trait), book slots, and charge the green fee into the ledger `greenFees` on round start.
  - The course must have an open hole and a clubhouse before any demand appears; otherwise a notification is sent once a day.

- [ ] **Step 1: Write failing tests**: `roundOptions` for 3, 9, 12, 18 holes; the tee sheet refuses double-booking and has no slots after `lastTee`; no golfers arrive without a clubhouse; with a clubhouse and 3 open holes, 5 game days produce >0 rounds and green-fee income; doubling the fee reduces rounds (seeded, compared over 10 days).
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: clubhouse, tee sheet, demand and green fees`.

### Task 22: Thoughts, scorecards, statistics

**Files:**
- Create: `src/sim/golfers/thoughts.ts`, `src/sim/golfers/stats.ts`
- Test: `tests/sim/golfers/thoughts.test.ts`, `tests/sim/golfers/stats.test.ts`

**Interfaces:**
- Produces:
  - `type ThoughtKey = 'greenFast' | 'greenSlow' | 'waited' | 'lostBall' | 'water' | 'beautifulView' | 'tooHard' | 'tooEasy' | 'goodValue' | 'overpriced' | 'longWalk' | 'greatShot' | 'poorCondition' | 'bunkerUnraked'` (condition-related keys fire from Task 25 on)
  - `THOUGHT_TEXT: Record<ThoughtKey, (ctx: { hole: number }) => string>` (e.g. `greenFast: ({hole}) => \`Green was way too fast on ${hole}\``)
  - `interface Thought { golferId; day; minute; key: ThoughtKey; holeNumber?: number; mood: number /* -3..3 */ }`
  - `evaluateHoleThoughts(g, golfer, hole, result: HoleResult, waitedMin: number): Thought[]` (rules: waited ≥ 10 → `waited`; a water penalty → `water`; strokes ≥ par + 3 and challenge < 0.5 → `tooHard`; a par-or-better birdie → `greatShot`; ≥ 3 putts and stimp > 11 → `greenFast`; ...)
  - `class CourseStats` (per course, rolling 28 days): `record(holeResult, golfer)`, `holeAverage(holeId): number`, `holeAvgVsPar`, `hardestHoles(n)`, `avgRoundMinutes()`, `threePuttRate(holeId)`, `lostBallHotspots(): Vec2[]` (grid-bucketed), `landingHeat: Uint16Array` (per 4 m cell; feeds the traffic overlay)
  - Mood: `roundSatisfaction(thoughts, golfer, valueRatio): number` adjusts `golfer.opinion[courseId]`.

- [ ] **Step 1: Write failing tests**: waiting 12 min produces a `waited` thought; a water penalty produces `water`; `holeAverage` over recorded results is correct; rolling the window drops results older than 28 days; satisfaction is lower with more negative thoughts.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: golfer thoughts, scorecards and course stats`.

### Task 23: Golfer rendering, follow mode, golfer and stats panels

**Files:**
- Create: `src/render/entities.ts` (extend), `src/render/follow.ts`, `src/ui/panels/golferPanel.ts`, `src/ui/panels/statsPanel.ts`
- Modify: `src/render/overlays.ts` (`'traffic'`, `'landing'`, `'pace'`)
- Test: `tests/render/follow.test.ts`

**Interfaces:**
- Produces:
  - Entities layer: draws group members (walk animation from atlas `golfer_walk_0..3`, `golfer_swing`), carts, balls in flight (a parabola interpolated over 1.5 s of game time) and shot tracers for the followed golfer; only entities in visible chunks are drawn.
  - `class FollowCam { target: { kind: 'golfer'; id: number } | null; update(camera, g): void }`, which keeps the camera centred, smoothed with lerp 0.15.
  - Clicking a golfer selects them; the golfer panel shows name, age, home, handicap, type, segment, traits as bars, a running scorecard, thoughts (latest first), visit count and total spend, and a **Follow** button.
  - Stats panel: per-hole average vs par, hardest/easiest list, average round time, 3-putt rate.
  - Thought bubbles: a short pixel bubble over the golfer for 4 real seconds when a thought fires.

- [ ] **Step 1: Write failing test**: `FollowCam.update` moves the camera toward the target and converges within 30 updates.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Browser check.** Build 3 holes + clubhouse, seed with sod, wait until open, and watch groups play. Follow a golfer through a hole: the scorecard updates and a thought appears. Cash goes up from green fees, and the stats panel fills.
- [ ] **Step 6:** Commit `feat: golfer rendering, follow mode and stats panels`.

### Task 24: Save and load

**Files:**
- Create: `src/sim/save.ts`, `src/ui/panels/savePanel.ts`
- Test: `tests/sim/save.test.ts`

**Interfaces:**
- Produces:
  - `SAVE_VERSION = 1`
  - `serialize(g: Game): Uint8Array`. JSON header (version, seed, options, clock, ledger, courses, golfers, groups, stats, rng states, and any later system state through a `Saveable` registry) + raw typed-array buffers, gzip-compressed with `CompressionStream` (proposal; Node test uses `zlib` fallback via an injected compressor).
  - `interface Saveable { key: string; save(g: Game): unknown; load(g: Game, data: unknown, version: number): void }`, `registerSaveable(s: Saveable)`. **Every later task that adds state must register a Saveable.**
  - `deserialize(bytes: Uint8Array): Result<Game>`. Unknown/newer version → `fail('Save is from a newer version')`; older versions go through `MIGRATIONS: Record<number, (json) => json>`.
  - `SaveStore` (IndexedDB, db `gct`, store `saves`): `list(): Promise<SaveMeta[]>`, `put(name, bytes)`, `get(name)`, `delete(name)`. Autosave every 7 game days to slot `autosave`.
  - Export/import `.gctsave` file through the UI (Blob download / file input).

- [ ] **Step 1: Write failing tests**

```ts
test('round-trip is deterministic', () => {
  const g = buildPlayingGame(); /* 3 holes open, groups mid-round */ for (let i = 0; i < 3000; i++) g.tick();
  const h = deserialize(serialize(g)); expect(h.ok).toBe(true); const g2 = (h as any).value as Game;
  for (let i = 0; i < 3000; i++) { g.tick(); g2.tick(); }
  expect(g2.ledger.cash).toBe(g.ledger.cash); expect(g2.world.wear).toEqual(g.world.wear); expect(g2.rng.getState()).toBe(g.rng.getState());
});
test('rejects unknown version', () => { /* patch header version 999 → ok false, reason mentions newer */ });
test('SaveStore put/get/list with fake-indexeddb', async () => {});
test('full-size save under 8 MB compressed', () => {});
```

- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Browser check:** save, reload the page, load, and confirm the game continues identically, including the golfers on course.
- [ ] **Step 6:** Commit `feat: save/load with IndexedDB and file export`. **Vertical slice (M0 + M1 + M2) complete — stop and demo to the owner before continuing.**

---

# Phase M3 — Course conditions & staff

### Task 25: Grass types, turf simulation, mow height → speed

**Files:**
- Create: `src/sim/turf/grasses.ts`, `src/sim/turf/turf.ts`
- Modify: `src/sim/golfers/shot.ts` (`greenStimp` real), `src/sim/golfers/ballPhysics.ts` (firmness/moisture), `src/sim/golfers/thoughts.ts` (condition thoughts)
- Test: `tests/sim/turf/turf.test.ts`

**Interfaces:**
- Produces:
  - `enum Grass { None, Bent, PoaAnnua, Bermuda, Zoysia, Ryegrass, Bluegrass, FineFescue, Paspalum }`
  - `interface GrassSpec { name; climateFit: Record<ClimateId, number /*0..1*/>; minMowMm: number; wearTolerance; waterNeed; diseaseRisk; seedCostPerTile; sodCostPerTile; baseStimpAt3mm: number }` (proposal values in the file, e.g. Bent minMow 2.5, baseStimp 11; Bermuda minMow 3.0, baseStimp 10; FineFescue minMow 5, baseStimp 9)
  - `setGrass(g, tiles, grass, method: 'seed' | 'sod'): EditPlan` (closes nothing by itself; on an open hole it is refused like any edit)
  - Per-surface defaults: `courseTurfSettings: { [courseId]: { greenMowMm: number; fairwayMowMm: number; roughMowMm: number; greenStimpTarget: number /*8..13*/; fairwayFirmnessTarget: number } }`, and `holeOverrides`
  - `stimpFor(grass, mowMm, health, moisture, rolledToday: boolean): number` (lower mow → faster; rolled +0.5; wet −1; unhealthy −)
  - `turfSystem: System`. Processes 1/60 of the turf tiles each tick in a rotating stripe, so the whole map updates about once every 6 game minutes. Grass grows mow height by `growthMmPerDay(grass, season, health)`. Wear recovers. Moisture moves toward weather-driven evaporation and rain (Task 26). Health moves toward a target from climate fit, moisture band, wear, mow stress (mowing below `minMowMm` → stress) and disease.
  - Golfer traffic adds wear (each shot landing/divot on a tee or fairway, each step on a green); carts add wear off-path.
  - `greenStimp(g, hole)` = average `stimpFor` over the green tiles.

- [ ] **Step 1: Write failing tests**: a lower mow height gives a higher stimp; mowing below `minMowMm` lowers health over 10 days; grass with poor climate fit loses health; wear from 200 simulated rounds on a tee reduces health and recovers over 14 idle days; turf updates are deterministic; one full turf pass on a 1000² map takes < 50 ms total spread across ticks (benchmark per tick < 1 ms).
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: grass types and turf simulation`.

### Task 26: Weather, seasons, climate

**Files:**
- Create: `src/sim/turf/weather.ts`
- Modify: `src/sim/golfers/demand.ts` (weather factor), `src/sim/golfers/groups.ts` (rain delays, frost delay, wind for shots)
- Test: `tests/sim/turf/weather.test.ts`

**Interfaces:**
- Produces:
  - `type WeatherKind = 'sunny' | 'cloudy' | 'rain' | 'storm' | 'heatwave' | 'frost' | 'windy'`
  - `interface WeatherState { kind: WeatherKind; tempC: number; rainMm: number; wind: Vec2; forecast: WeatherKind[] /*next 3 days*/ }`
  - `CLIMATES: Record<ClimateId, { seasonTempC: Record<Season, [number, number]>; rainChance: Record<Season, number>; windMean: number; closedSeasons?: Season[] }>` (alpine: winter closed; arid: rain chance ≤ 0.05)
  - `weatherSystem: System`. Rolls the next day with a Markov transition; `onMinute` varies temp across the day. Storms suspend play (groups wait at shelters or go in). Frost delays the first tee until 09:00. A closed season sends a notification and `demand = 0`.
  - `weatherDemandFactor(w): number` (sunny 1.1, rain 0.4, storm 0.05, heatwave 0.7, frost 0.6)

- [ ] **Step 1: Write failing tests**: the same seed produces the same weather sequence; arid sees fewer rain days than temperate over a year; a storm stops play (groups don't advance); an alpine winter has zero rounds.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: weather, seasons and climates`.

### Task 27: Irrigation

**Files:**
- Create: `src/sim/turf/irrigation.ts`
- Modify: `src/sim/commands.ts`, `src/render/overlays.ts` (`'moisture'`, `'irrigation'`)
- Test: `tests/sim/turf/irrigation.test.ts`

**Interfaces:**
- Produces:
  - `interface Sprinkler { id; pos: Vec2; radiusTiles: 9 /*18 m*/; zone: number; broken: boolean }`, `interface PumpHouse { pos: Vec2; capacityM3PerNight: number; tier: 1 | 2 | 3 }` (tiers: 400 / 900 / 2000 m³, cost 60k / 140k / 300k), `interface IrrigationSystem { pump: PumpHouse | null; sprinklers: Sprinkler[]; pipes: Vec2[][]; schedule: { zone: number; minutes: number }[] }`
  - `placePump`, `placeSprinkler` ($900 each), `placePipe` ($15/tile), connectivity: a sprinkler only works if a pipe connects it to the pump (BFS over pipe tiles)
  - Nightly watering (on `newDay`): each scheduled zone adds moisture inside sprinkler radii, limited by pump capacity; water cost $1.20/m³ (proposal) charged to `water`. Drought restriction events (arid/temperate summer, 10%/week) cap capacity at 50%.
  - Sprinklers can break (0.2%/night), shown as a dry patch and a notification; fixed by the irrigation tech (Task 31) or hand-watering.
  - `coverage(g, courseId): number` (0..1 share of turf tiles within a working sprinkler's radius)

- [ ] **Step 1: Write failing tests**: an unconnected sprinkler waters nothing; scheduled zones raise moisture inside the radius only; capacity limits volume; water cost is charged; coverage is calculated correctly on a test layout.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: irrigation system`.

### Task 28: Turf practices — grow-in rules, aeration, disease, spraying

**Files:**
- Create: `src/sim/turf/practices.ts`
- Modify: `src/sim/course/lifecycle.ts` (grow-in now requires moisture ≥ 40 on the hole's turf to count down; too dry → stall with a notification), `src/sim/turf/turf.ts`
- Test: `tests/sim/turf/practices.test.ts`

**Interfaces:**
- Produces:
  - Per-tile `thatch` (new `Uint8Array` on `World`; register in save)
  - `type Practice = 'mow' | 'roll' | 'aerate' | 'topdress' | 'spray' | 'fertilize' | 'handWater' | 'rakeBunker' | 'changeCup' | 'fixDivots' | 'moveTeeMarkers'`
  - `applyPractice(g, practice, tiles: number[], opts?): void`. The tile-level effect of each practice: mow → mowHeight = target, stripe phase set (`stripe` bit in a new `Uint8Array flags`); roll → `rolledDay = today`; aerate → thatch −30, health −10 for 7 days (playability), firmness −; spray → disease cleared; fertilize → health target +; topdress → firmness +, thatch −; handWater → moisture +; rakeBunker → bunker quality = 100 (bunker quality uses `health` on Bunker tiles); changeCup → `hole.activePin` rotates; fixDivots → wear −.
  - Disease: `diseaseSystem` daily rolls by humidity × grass risk × low health, creating patches (`flags` disease bit) that spread to neighbours until sprayed.
  - Bunker quality decays with each golfer entry and daily (−15); unraked < 50 triggers the `bunkerUnraked` thought.

- [ ] **Step 1: Write failing tests**: each practice's effect; disease spreads if untreated and clears when sprayed; grow-in stalls when dry; aeration temporarily lowers playability/health then improves health after 21 days relative to no aeration (thatch effect).
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: turf practices, disease and grow-in moisture rule`.

### Task 29: Staff model, roles, hiring market, wages, morale

**Files:**
- Create: `src/sim/staff/roles.ts`, `src/sim/staff/staff.ts`, `src/sim/staff/market.ts`, `src/sim/staff/morale.ts`
- Test: `tests/sim/staff/staff.test.ts`, `tests/sim/staff/morale.test.ts`

**Interfaces:**
- Produces:
  - `type RoleId = 'superintendent' | 'assistantSuper' | 'greenkeeper' | 'irrigationTech' | 'sprayTech' | 'arborist' | 'mechanic' | 'generalManager' | 'starter' | 'marshal' | 'cartAttendant' | 'proShopStaff' | 'headPro' | 'fnbStaff' | 'chef'` (all §7 roles)
  - `ROLES: Record<RoleId, { dept: 'maintenance' | 'operations' | 'proShop' | 'hospitality'; baseWagePerDay: number; skills: SkillId[]; practices?: Practice[]; requires?: BuildingKind }>`
  - `type SkillId = 'mowing' | 'greens' | 'bunkers' | 'irrigation' | 'spraying' | 'trees' | 'mechanics' | 'management' | 'sales' | 'teaching' | 'service' | 'cooking' | 'pace'`
  - `type StaffTrait = 'earlyRiser' | 'perfectionist' | 'careless' | 'fast' | 'grumpy' | 'mentor' | 'loyal'`
  - `interface Staff { id; name; role: RoleId; courseId; skills: Partial<Record<SkillId, number /*0..100*/>>; speed: number; reliability: number; morale: number; fatigue: number; wagePerDay: number; traits: StaffTrait[]; hiredDay: number; xp: Partial<Record<SkillId, number>>; shift: { startMin: number; endMin: number }; zone: number | null; pos: Vec2; task: WorkOrderId | null }`
  - `class StaffRoster { all: Staff[]; hire(candidate, g): Result; fire(id, g): Result /* severance 7 days wage */; byRole(role) }`
  - `market.ts`: `generateCandidates(g, role, count = 5): Candidate[]`, refreshed weekly; better candidates ask higher wages, and the pool quality scales with reputation (Task 40; 1.0 until then)
  - `moraleSystem`: daily morale change = wage vs market (+/−), hours over 9/day (−), workload above capacity (−), equipment condition (−), staff room (+, Task 30), `mentor` nearby (+). Morale < 25 → 5%/day quit chance; < 50 → error rate up. Wages are paid daily into `wages`.
  - Training: `train(g, staffId, skill): Result` ($1,500 and 3 days away; +8–15 skill)
  - Starter crew: up to **3 greenkeepers** can be hired without a maintenance building (§7)

- [ ] **Step 1: Write failing tests**: hiring charges nothing up front but adds a wage line daily; a 4th greenkeeper without a maintenance building is refused; low wage and long hours lower morale over a week; morale < 25 leads to resignation within 30 days in ≥ 90% of 200 seeded trials; training raises the skill.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: staff roster, hiring market and morale`.

### Task 30: Equipment fleet and maintenance building

**Files:**
- Create: `src/sim/staff/equipment.ts`
- Modify: `src/sim/business/buildings.ts` (add `maintenance` with upgrades)
- Test: `tests/sim/staff/equipment.test.ts`

**Interfaces:**
- Produces:
  - `type EquipmentKind = 'greensMower' | 'teeMower' | 'fairwayMower' | 'roughMower' | 'roller' | 'aerator' | 'sprayer' | 'bunkerRake' | 'utilityVehicle' | 'topdresser'`
  - `EQUIPMENT: Record<EquipmentKind, { practice: Practice; tiers: { cost: number; tilesPerHour: number; breakdownPerDay: number; fuelPerHour: number }[] /*3 tiers*/ }>`. Hand tools (push mower, hand rake) are always available at 25% productivity.
  - `interface Equipment { id; kind; tier; condition: number /*0..100*/; broken: boolean; assignedTo: number | null }`
  - Breakdowns scale with `(100 − condition)`; a mechanic restores condition each day by skill; without a mechanic, condition −1/day of use.
  - Maintenance building: `BUILDING_DEFS.maintenance = { w: 12, h: 8, cost: 180_000, upgrades: { storage: [20, 40] /*equipment slots*/, workshop: 120_000, staffRoom: 60_000, chemicalStore: 45_000 } }`. Spraying requires `chemicalStore`; the staff room adds +10 morale/day target.
  - Commands: `buyEquipment`, `sellEquipment` (50% × condition), `upgradeBuilding`

- [ ] **Step 1: Write failing tests**: buying beyond storage is refused; spraying without a chemical store is refused; condition decays without a mechanic and stays ≥ 80 with a skilled mechanic; broken equipment can't be assigned.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: equipment fleet and maintenance building`.

### Task 31: Maintenance program, work orders, scheduler, shortfall report

**Files:**
- Create: `src/sim/staff/program.ts`, `src/sim/staff/workOrders.ts`
- Test: `tests/sim/staff/program.test.ts`, `tests/sim/staff/workOrders.test.ts`

**Interfaces:**
- Produces:
  - `interface ProgramRule { practice: Practice; surface: Surface; frequency: { perWeek: number } ; params?: { mowMm?: number }; priority: 1 | 2 | 3 }`. Default program (proposal): greens mow 7/wk at 3.0 mm, roll 3/wk; tees mow 3/wk; fairways mow 3/wk at 12 mm; rough mow 1/wk; bunkers rake 7/wk; cups change 7/wk; divots 2/wk; aerate greens 2/yr.
  - `interface MaintenanceProgram { courseId; rules: ProgramRule[]; zones: Zone[] }`, `interface Zone { id; name; holeIds: number[] }`
  - `type WorkOrderId = number`, `interface WorkOrder { id; courseId; practice: Practice; tiles: number[] /*chunked ≤ 400 tiles each*/; zone: number | null; priority: number; due: number /*day*/; laborHours: number; status: 'open' | 'assigned' | 'done' | 'skipped'; urgent: boolean; skipReason?: string }`
  - `generateDailyOrders(g, courseId): WorkOrder[]` (called at the day rollover). Labour hours = tiles ÷ (equipment tilesPerHour or hand-tool rate). Before an order is created, the superintendent's `management` skill reduces total labour by up to 20%; with no superintendent, only rules marked priority 1 are generated (proposal: the crew does the basics).
  - `assignOrders(g, courseId): void`. Greedy by priority, then due date; matches skill and practice to role; respects zones, shift hours, and equipment availability.
  - `shortfallReport(g, courseId, day): { skipped: WorkOrder[]; hoursShort: number; text: string[] }`, e.g. `"Bunkers on 10–18 not raked: 6 labour-hours short"` (§7)
  - Commands: `setProgramRule`, `removeProgramRule`, `createZone`, `assignZone`, `createUrgentOrder(practice, tiles)`, `pauseOrder`

- [ ] **Step 1: Write failing tests**: the default program on a 3-hole course creates the expected order set; with 1 greenkeeper and 18 holes, the shortfall report names skipped bunker raking and the hours short; with no superintendent only priority-1 orders exist; urgent orders are assigned first; zone assignment restricts who takes an order.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: maintenance program, work orders and shortfall report`.

### Task 32: Staff agents on the map

**Files:**
- Create: `src/sim/staff/agents.ts`
- Modify: `src/render/entities.ts` (mower sprites, stripe painting is shown through the `flags` stripe bit in chunk bake)
- Test: `tests/sim/staff/agents.test.ts`

**Interfaces:**
- Produces:
  - `staffAgentSystem: System`. Each staff member during their shift walks or drives (by equipment) from the maintenance building to the order's tiles via `findPath`, then works through tiles at their rate (skill × speed × equipment × fatigue), calling `applyPractice` per batch. Quality: `careless` / low skill → some tiles left un-striped or scalped (health −). Working on a tile with a group within 40 m pauses the staff member (they wait) and gives golfers a −1 mood "maintenance in the way" thought (add `ThoughtKey 'crewInWay'`).
  - The mechanic repairs broken equipment; the arborist works tree orders; the starter sets tee intervals (pace +); the marshal reduces waits on holes where `waitingMin` builds up (pushes slow groups: −10% shot time).
  - Clicking a staff member shows their current task, and they can be followed (reuse `FollowCam` with `kind: 'staff'`).

- [ ] **Step 1: Write failing tests**: a greenkeeper with a green-mowing order reaches the green and mows it (mowHeight = target) before the first tee time when the shift starts at 05:00; the crew pauses when a group is close; a marshal reduces the average waiting minutes in a congested scenario versus none.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: staff agents working on the map`.

### Task 33: Staff, program and turf UI + overlays

**Files:**
- Create: `src/ui/panels/staffPanel.ts`, `src/ui/panels/programPanel.ts`
- Modify: `src/render/overlays.ts` (`'health'`, `'moisture'`, `'wear'`, `'mowHeight'`, `'staffCoverage'`, `'workOrders'`), `src/ui/hud.ts` (weather + forecast), `src/ui/panels/holePanel.ts` (grass type, stimp target, per-hole overrides, pin sheet auto/manual), `src/ui/notifications.ts` (jump-to-location)
- Test: `tests/ui/programPanel.test.ts`

**Interfaces:**
- Produces:
  - Staff panel: roster table (role, skills, morale, wage, fatigue, traits), hiring tab with candidates, fire, train, shift editor, zone assignment, equipment tab (buy/sell/assign/condition).
  - Program panel: rules list editable inline (frequency, mow mm, priority), zone editor, today's orders with status, yesterday's shortfall report.
  - The irrigation tool from Task 27 is added to the toolbar (pump, sprinkler, pipe; schedule editor).

- [ ] **Step 1: Write failing test**: editing a rule frequency in the program panel dispatches `setProgramRule` with the new value.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Browser check.** Hire a superintendent and 3 greenkeepers and buy mowers; watch dawn mowing stripes appear; cut wages and see morale fall; run with too few staff and read the shortfall report; turn on the health and moisture overlays and see a dry spot get fixed after a sprinkler is added.
- [ ] **Step 6:** Commit `feat: staff, program and turf UI`. **M3 complete.**

---

# Phase M4 — Business depth

### Task 34: Amenity buildings

**Files:**
- Modify: `src/sim/business/buildings.ts`, `src/sim/commands.ts`, `src/ui/panels/buildPanel.ts`
- Test: `tests/sim/business/buildings.test.ts` (extend)

**Interfaces:**
- Produces: `BuildingKind` adds `'proShop' | 'range' | 'practiceGreen' | 'halfwayHouse' | 'restaurant' | 'cartBarn' | 'maintenance' | 'parking' | 'lodging'`; each def has `{ w, h, cost, upkeepPerDay, requires?: BuildingKind, capacity? }`. The pro shop must touch the clubhouse (it's an addition). Parking capacity in cars (1 per golfer group); demand above capacity is turned away with a `'noParking'` notification. Clubhouse tier raises prestige (used in Task 40). Lodging requires reputation ≥ 4 stars (enforced in Task 42; until then always locked).
- [ ] **Step 1:** Tests: the pro shop must be adjacent to the clubhouse; upkeep is charged daily; parking caps daily arrivals.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: amenity buildings`.

### Task 35: Pro shop — inventory, clubs, fitting, simulator bays, lessons

**Files:**
- Create: `src/sim/business/proShop.ts`, `src/ui/panels/proShopPanel.ts`
- Test: `tests/sim/business/proShop.test.ts`

**Interfaces:**
- Produces:
  - `type ItemCategory = 'balls' | 'gloves' | 'apparel' | 'hats' | 'clubsBudget' | 'clubsPremium' | 'bags' | 'accessories'`, `interface StockLine { cat; wholesale: number; retail: number; qty: number; reorderAt: number; reorderQty: number }`
  - Purchase model: after a round (and before, for balls), each golfer buys with probability = f(gear trait, segment, round satisfaction, price ratio retail/wholesale, staff `sales` skill). A stockout loses the sale and produces an `'emptyShelves'` thought. Auto-reorder charges wholesale into `proShop` out; sales go to `proShop` in.
  - Add-ons (`proShopAddons: Set<'fitting' | 'simulator' | 'apparelLine'>`): fitting requires a head pro, gives club sales +60% and $120 per fitting; simulator bays (1–6 bays, $45k each) earn hourly rentals, demand is higher in bad weather and in closed seasons, and they run year-round; the apparel line gives an apparel margin +.
  - Lessons: the head pro sells lessons ($80/hr), which lower the handicap of repeat students slowly (−0.1 per lesson, min floor).
- [ ] **Step 1:** Tests: sales reduce stock and add revenue; a stockout yields lost sales + thought; simulator revenue on rainy days > sunny; lessons lower the student's handicap.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: pro shop inventory, fitting, simulators and lessons`.

### Task 36: Food & beverage, carts, range

**Files:**
- Create: `src/sim/business/fnb.ts`, `src/sim/business/carts.ts`
- Test: `tests/sim/business/fnb.test.ts`, `tests/sim/business/carts.test.ts`

**Interfaces:**
- Produces:
  - F&B: the halfway house (served at the turn, between holes 9 and 10, or at a drink station), restaurant/bar after the round; spending = f(food trait, segment, price, chef `cooking` skill, staff count vs covers); cost of goods 32%. Long queues (> covers/hour) → `'slowService'` thought.
  - Carts: `cartFleet { count; condition; feePerRider }`. Golfers choose a cart by age, segment and walking distances (sum of green→tee distances). A cart barn is required for > 10 carts; carts are restricted when moisture > 80 (cart-path-only: carts slower, with an `'cartPathOnly'` thought). Cart attendants keep the fleet's condition up.
  - Range: bucket price; warm-up gives the round a −0.5-stroke handicap effect and +mood (§9).
- [ ] **Step 1:** Tests: halfway-house revenue only arrives when ≥ 10 holes are open or a drink station exists; cart-path-only triggers on wet days; the warm-up effect lowers the average score.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: food and beverage, carts and range`.

### Task 37: Pricing bands and memberships

**Files:**
- Create: `src/sim/business/pricing.ts`, `src/sim/business/memberships.ts`
- Modify: `src/sim/golfers/demand.ts`, `src/sim/golfers/teeSheet.ts`
- Test: `tests/sim/business/pricing.test.ts`, `tests/sim/business/memberships.test.ts`

**Interfaces:**
- Produces:
  - `interface Pricing { bands: { peak: number; offPeak: number; twilight: number }; weekendMult: number; seasonMult: Record<Season, number>; perRoundLength: Record<number, number /*multiplier of 18-hole fee*/>; cartFee; rangeBucket; dynamic: boolean }`. Peak 07:00–11:00, twilight from sunset − 4 h. `priceFor(g, course, day, minute, holes): number`.
  - Dynamic pricing (requires a general manager): adjusts the bands ±25% toward a 85% tee-sheet fill target weekly.
  - Memberships: tiers `{ name; annualFee; reservedSlotsPerDay; includedRounds: 'unlimited' | number }`. Golfers whose opinion > 50 and visits > 5 may join (loyalty, segment). Reserved member slots reduce public slots. Fees are booked yearly on the join day.
- [ ] **Step 1:** Tests: twilight is cheaper than peak; dynamic pricing raises prices when the tee sheet is full; members take reserved slots; renewal happens yearly only if opinion stays > 20.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: pricing bands, dynamic pricing and memberships`.

### Task 38: Loans, recurring costs, financial reports UI

**Files:**
- Create: `src/sim/economy/loans.ts`, `src/sim/economy/reports.ts`, `src/ui/panels/financePanel.ts`
- Test: `tests/sim/economy/loans.test.ts`, `tests/sim/economy/reports.test.ts`

**Interfaces:**
- Produces:
  - `interface Loan { id; principal; ratePerYear; termDays; remaining; dailyPayment }`. Limit = 50% × (land value + building value) − outstanding. Rates by difficulty (easy 4%, normal 6%, hard 9%). Missed payment (cash < 0 at day end) → a warning; 3 missed → game over in career mode (sandbox exempt).
  - Recurring costs (`recurringSystem`): property tax 1%/yr of land value (daily), insurance $40/day per open hole, utilities $15/day per building.
  - `incomeStatement(g, courseId | null, period: 'day' | 'month' | 'year', offset = 0)`, `cashFlowSeries(days: number): number[]`, `revenueBySource`, `costByDepartment` (wages split by role dept), `perHoleEconomics(courseId): { holeId; roundsPlayed; revenueShare; maintenanceCost }[]` (green-fee revenue split equally by holes played; maintenance cost = labour hours × wage + supplies attributed by the tiles each order covered).
  - Finance panel: income statement tabs, a cash line chart (simple canvas), loan take/repay, per-hole table.
- [ ] **Step 1:** Tests: loan limit; daily repayment amortises to 0 at term; missed-payment counter; per-hole maintenance cost is attributed to the hole whose tiles were worked; income statement sums match ledger totals.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5: Browser check:** run 60 game days, then read the reports and confirm they match the cash change. **Step 6:** Commit `feat: loans, recurring costs and financial reports`. **M4 complete.**

---

# Phase M5 — Reputation & competition

### Task 39: Course rating, slope, stroke index

**Files:**
- Create: `src/sim/rating/courseRating.ts`
- Test: `tests/sim/rating/courseRating.test.ts`

**Interfaces:**
- Produces:
  - `rateCourse(g, courseId, tee: TeeKind, samples = 200): { courseRating: number; slope: number /*55..155*/ }`. A simplified USGA-style method: simulate (headless `simulateHole`, forked rng) a scratch golfer (handicap 0) and a bogey golfer (handicap 20) over all open holes; CR = mean scratch score (scaled to 18 holes); slope = round(113 × (bogeyScore − CR) / 17.5) clamped to 55–155. Recomputed weekly and after any reopen.
  - `computeStrokeIndex(g, courseId): Map<holeId, number>`. Rank holes by (bogey avg − par) using `CourseStats` data when ≥ 100 rounds exist, otherwise by simulation; odd indexes to the front nine, even to the back (standard allocation). Respects a manual override.
- [ ] **Step 1:** Tests: a longer, more hazardous course rates higher in both CR and slope; slope stays within bounds; stroke index is a permutation of 1..N and holes with water rank harder.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: course rating, slope and stroke index`.

### Task 40: Scores, reviews and reputation by segment

**Files:**
- Create: `src/sim/rating/scores.ts`, `src/sim/rating/reviews.ts`, `src/sim/rating/reputation.ts`
- Modify: `src/sim/golfers/demand.ts` (reputation factor), `src/sim/staff/market.ts` (candidate quality)
- Test: `tests/sim/rating/reputation.test.ts`

**Interfaces:**
- Produces:
  - `conditionScore(g, courseId): number /*0..100*/` (turf health on playable tiles, wear, bunker quality, green speed consistency vs target)
  - `aestheticsScore(g, courseId)` (variety of hole lengths and pars, water/trees near holes, elevation change, the share of natural features kept, mowing stripes, clubhouse tier; specimen-tree removals subtract)
  - `paceScore` (average round minutes vs 4h15 for 18), `valueScore` (satisfaction ÷ price)
  - `interface Review { golferId; courseId; day; stars: 1..5; segment: Segment; type: GolferType; text: string /* built from the top 2 thoughts */ }`. ~25% of golfers leave one.
  - `reputation(g, courseId): { overall: number /*0..5 stars*/; bySegment: Record<Segment, number>; byType: Record<GolferType, number> }`, exponentially weighted (half-life 60 days) over reviews, plus the scores above, plus `pendingReputationEvents`.
  - The demand factor uses reputation for that golfer's segment and type.
  - Land-value feedback (§4): each month, unowned parcel prices are multiplied by `1 + 0.04 × (overall − 2.5)` for parcels within 3 parcels of owned land (clamped to the §12 range × 1.5 at most).
- [ ] **Step 1:** Tests: unowned parcels near your course rise in price when reputation > 2.5; poor condition lowers the condition score and, over 30 days, the reputation; competitive players rate a hard course higher than casual players do; removing a specimen tree drops aesthetics; higher reputation increases demand.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: scores, reviews and segmented reputation`.

### Task 41: Rival courses and regional ranking

**Files:**
- Create: `src/sim/rating/rivals.ts`, `src/ui/panels/rivalsPanel.ts`
- Modify: `src/sim/golfers/demand.ts`
- Test: `tests/sim/rating/rivals.test.ts`

**Interfaces:**
- Produces:
  - `interface Rival { id; name; holes: 9 | 18 | 27; reputation: number; condition: number; fee: number; style: 'municipal' | 'resort' | 'private' | 'links'; trend: number }` (3–6 per game, generated from the seed; abstract, no map presence)
  - Each month rivals drift (renovations, fee changes; a rival may "renovate", dropping capacity for a season).
  - Demand split: a golfer chooses among the player's courses and rivals by utility = reputation fit for their segment/type − price sensitivity × fee + loyalty bonus.
  - `regionalRanking(g): { name; score; isPlayer }[]`
- [ ] **Step 1:** Tests: a cheaper rival with equal reputation pulls budget golfers away; ranking order follows score; rivals are deterministic per seed.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: rival courses and regional ranking`.

### Task 42: Events, milestones, career mode, unlocks, multi-course

**Files:**
- Create: `src/sim/rating/events.ts`, `src/sim/rating/milestones.ts`, `src/sim/rating/unlocks.ts`
- Modify: `src/ui/newGame.ts` (career/sandbox), `src/ui/hud.ts` (course switcher), `src/sim/commands.ts`
- Test: `tests/sim/rating/events.test.ts`, `tests/sim/rating/milestones.test.ts`, `tests/sim/rating/unlocks.test.ts`

**Interfaces:**
- Produces:
  - Events: `type EventKind = 'corporateOuting' | 'clubChampionship' | 'charityScramble' | 'regionalAmateur' | 'proTour'`. Each has requirements (holes, rating, reputation, condition), blocks the tee sheet for its day(s), brings revenue (entry fees, sponsorship, F&B surge), a prestige gain scaled by condition on the day, and spectators (parking). Requests arrive as offers to accept or decline; a tournament day sets green speed and rough height targets automatically (proposal).
  - Milestones (§12): `open9`, `open18`, `reputation4`, `clubChampionship`, `profitableYear2`, `allFourTees`, `firstMember`, `regionalTop3`. Each has a reward (cash grant or unlock) and a notification.
  - Unlocks by reputation milestones (§12, not a research tree): equipment tier 3, premium sand, lodging, Paspalum/Zoysia grasses on non-native climates, pro-tour events. `isUnlocked(g, key): boolean`; sandbox → all unlocked.
  - Multi-course: `createCourse` becomes available after `open18`. The HUD course switcher filters panels by `courseId`; buildings and staff belong to a course; land is shared.
  - Career game over: bankruptcy (3 missed loan payments, or cash < −$250k with no loan headroom) → a summary screen.
- [ ] **Step 1:** Tests: a club championship requires 18 holes + condition ≥ 70 and blocks that day's public tee times; the `open9` milestone fires once; unlock gating; game over on bankruptcy (not in sandbox); a second course's holes have their own numbering starting at 1.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Browser check:** play a career game to 9 holes and confirm the milestone fires, an event offer arrives, and the rivals panel ranks you.
- [ ] **Step 6:** Commit `feat: events, milestones, unlocks and multi-course`. **M5 complete.**

---

# Phase M6 — Play your own course

### Task 43: Arcade swing and putting mode

**Files:**
- Create: `src/play/swing.ts`, `src/play/playMode.ts`, `src/ui/panels/playPanel.ts`
- Test: `tests/play/swing.test.ts`

**Interfaces:**
- Consumes: `simulateShot`, `rollBall`, `putt` math, `ClubSpec`, `lieAt`, wind from `WeatherState`
- Produces:
  - `type MeterPhase = 'idle' | 'power' | 'accuracy' | 'done'`. `class SwingMeter { phase; t: number; power: number /*0..1.1*/; accuracy: number /*-1..1, 0 = perfect*/; press(): void; update(dtMs): void }`. The meter sweeps 0→1.1 in 1,000 ms then back; the first press locks power, the second locks accuracy as it returns through the zone (speed scales with club difficulty).
  - `playerShot(g, state: PlayState, aim: Vec2, club: ClubSpec, meter: SwingMeter): BallOutcome`. Uses a fixed "player skill" handicap chosen at the start (0–30) for dispersion, scaled by meter accuracy: a perfect meter gives 30% of normal dispersion; the error maps to hook/slice angle; power > 1 adds distance and doubles the error.
  - Putting: aim line + power meter; slope arrows overlay on the green (reuse `slopeAt`); roll uses `rollBall` with green stimp.
  - `PlayMode`: pick a course, tee and hole(s); the sim time keeps running at 1× or pauses (option); the player's group occupies a tee time; scorecard saved to `g.playerRounds`.
- [ ] **Step 1:** Tests: a meter locked at perfect accuracy produces a smaller miss distance than one locked at 0.8 (seeded average); over-power adds distance; a putt on a sloped green breaks downhill.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5: Browser check:** play a hole you built with the meter; the ball rolls down the slopes you shaped; the scorecard is saved.
- [ ] **Step 6:** Commit `feat: arcade play-your-own-course mode`. **M6 complete.**

---

# Phase M7 — Content & polish

### Task 44: Scenarios, sandbox, difficulty options

**Files:**
- Create: `src/sim/modes/scenarios.ts`
- Modify: `src/ui/newGame.ts`, `src/sim/difficulty.ts`
- Test: `tests/sim/modes/scenarios.test.ts`

**Interfaces:**
- Produces:
  - `interface Scenario { id; name; description; seed: number; terrain: TerrainType; difficulty: Difficulty; setup(g: Game): void; goals: { id; text; check(g): boolean }[]; failIf?: (g) => string | null; timeLimitDays?: number }`
  - Built-in (§12): `restoreNeglected` (an 18-hole course pre-built with poor turf, $400k, reach a 3-star reputation in 2 years), `desertWaterCrisis` (desert, a permanent 60% drought cap, stay profitable for 1 year), `championshipOnBudget` (hard, host a regional amateur within 4 years).
  - Difficulty options (§12): starting cash, land price multiplier (0.7 / 1 / 1.4), golfer pickiness (satisfaction thresholds), weather severity (storm/heatwave frequency ×), loan rates.
- [ ] **Step 1:** Tests: each scenario's `setup` produces a valid game; goal checks fire correctly on crafted states; the time limit fails the scenario.
- [ ] **Step 2–4:** fail → implement → pass. **Step 5:** Commit `feat: scenarios, sandbox and difficulty options`.

### Task 45: Headless balance runner, tutorial, audio, polish

**Files:**
- Create: `tools/headless.ts`, `src/ui/tutorial.ts`, `src/ui/audio.ts`
- Modify: balance constants across `src/sim/**` as found
- Test: `tests/tools/headless.test.ts`

**Interfaces:**
- Produces:
  - `tools/headless.ts` (`npx tsx tools/headless.ts --seed 1 --days 365 --script basic18`): runs a scripted AI player (buys land, pens 18 holes along a generated routing, hires the default crew, sets default prices) at maximum speed and prints a yearly summary: cash, rounds, average score by handicap band, reputation, staff shortfall hours, turf health. Target checks (proposal): the default scripted 18-hole course is profitable by the end of year 2 on normal; average scores for handicap bands land within ±1.5 of `par + handicap × 0.9`; a full year sims in < 60 s.
  - Tutorial: a guided first-hole flow (buy parcels → pen a par 3 → place pins → seed → hire greenkeeper → build clubhouse → open), as step cards that wait for the corresponding command.
  - Audio: small synthesized sound effects (WebAudio, no files): ball strike, cash, notification, mower ambience at dawn. Mute toggle.
  - Polish checklist: keyboard shortcut overlay (`?`), tooltips on every tool, notification jump-to-location, undo for the last construction stroke (refund 100% if done within 10 real seconds and on the same game day, proposal).
- [ ] **Step 1:** Test: the headless runner completes 30 days on a 200-size map and returns a summary object with the expected keys.
- [ ] **Step 2–4:** fail → implement → pass.
- [ ] **Step 5:** Run the headless runner for 365 days on 3 seeds × 4 terrains; adjust constants until the target checks pass; record the results in `docs/balance-notes.md`.
- [ ] **Step 6: Browser check:** complete the tutorial from a fresh game.
- [ ] **Step 7:** Commit `feat: balance runner, tutorial, audio and polish`. **M7 complete.**
