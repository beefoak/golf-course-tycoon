# Golf Course Tycoon — Game Design Document

*Version 0.2 · 2026-11-11 · Status: reviewed, awaiting owner approval*

Items marked **(proposal)** are design calls made during drafting, not yet confirmed by the owner. Everything else was decided in the design conversation.

---

## 1. Vision

A deep, replayable business-simulation game about buying land, designing a golf course hole by hole, and running it as a business. It runs in the browser with lightweight 8-bit / pixel-art visuals.

The model is *Cities: Skylines*-style depth: the player gets a lot of controls, and every one of them changes how the course operates. The game is about systems that interact, not decoration. Faster greens raise prestige, but they also slow pace of play, need more staff hours, and stress the turf. Every choice should ripple outward like that.

### Design pillars

1. **Land is a puzzle.** Parcels cost money, and generated terrain (rocks, ponds, creeks, slopes) forces real routing decisions.
2. **Design matters to play.** AI golfers play shot by shot, using their handicaps, on the holes you actually shaped. Their scores, complaints and pace come from your design.
3. **Staff are the engine.** The course's condition comes from the people you hire, how you schedule them, and the equipment you give them. This system is paramount.
4. **Golfers are people.** Every visitor has a name, a handicap and a personality. You can follow any of them around the course.
5. **Every game is different.** Generated maps, terrain types and scenarios make each run play out differently.

### Goals
- Long-form management depth that rewards learning how the systems interact.
- Clear feedback loops: data overlays, statistics and golfer thoughts that tell the player *why* something is happening.
- Replayability through per-game generated maps.
- Runs smoothly in a desktop browser with no install.

### Non-goals (for now)
- Realistic 3D graphics or a 3D camera.
- Multiplayer or online leaderboards.
- Mobile/touch-first controls (desktop mouse + keyboard first).
- A full golf game. Playing your own course is an arcade extra that comes later (§13).

### Anti-goals (failures even if it technically works)
- **Shallow decoration:** settings that look important but change nothing in the simulation.
- **Spreadsheet fatigue:** depth that can only be reached through menus. Depth should be visible on the map through overlays, walking staff and golfers.
- **Opaque failure:** money draining or reputation falling without the game being able to explain why.
- **Micromanagement as the only way to play:** players can manage by policy (the superintendent runs the crew) or step in directly.

---

## 2. Platform & technical constraints

| Decision | Choice |
|---|---|
| Platform | Desktop web browser (Chrome, Firefox, Edge, Safari: current versions) |
| Camera | **Top-down 2D**, like a yardage book. Elevation is shown with hill shading, optional contour lines and an elevation overlay |
| Art | 8-bit / pixel art |
| Language | TypeScript |
| Renderer | **PixiJS** (proposal: chosen over Phaser for direct control of large chunked tile maps; Phaser's scene/physics framework isn't needed) |
| Build | Vite (proposal) |
| Saves | Browser IndexedDB, plus export/import of a save file (proposal) |

### Approaches considered

| Option | Summary | Trade-off | Outcome |
|---|---|---|---|
| **A. Top-down 2D, TypeScript + PixiJS** | Grid-based pixel art seen from above, with data overlays | Slopes are less obvious at a glance (solved with shading and overlays) | **Chosen.** Painting and shaping tools map exactly onto the grid, overlays are easy to read, and it is the lightest option for a large map in a browser |
| B. Isometric 2D pixel art | Classic theme-park tycoon look | Shaping tools on a sloped diamond grid are hard to build and use, objects hide each other, and it needs about 4× the art | Rejected. It undermines course shaping, which is the core activity |
| C. Game engine (e.g. Godot) exported to web | Engine editors and physics | Heavy download and slow web loading, most of the engine unused | Rejected. Too heavy for a light browser game |

### Architecture principles (proposal; details left to the builder)
- **The simulation is separate from rendering.** The sim runs on a fixed tick, is deterministic given a seed, and has no rendering code. This allows a Web Worker later, faster-than-real-time simulation, and testable logic.
- **Tile data is stored in typed arrays** (struct of arrays), split into chunks for rendering. A 1,000 × 1,000 tile map at ~16 bytes per tile is about 16 MB, which is acceptable.
- **The renderer only draws visible chunks** and caches static chunk textures, re-drawing a chunk only when its tiles change.

---

## 3. Core loop

```
Buy land → Design/shape holes → Hire & schedule staff → Open for play
     ↑                                                        ↓
Expand / reinvest ← Earn revenue & reputation ← Golfers play, spend, review
                            ↑
         Watch data (overlays, stats, golfer thoughts) → Adjust design, settings, staff, prices
```

**Session arc (typical career game):**
1. Pick a map seed, terrain type and difficulty. Receive starting cash.
2. Buy a handful of parcels and build a short starter loop (e.g. 3–6 holes, often par-3 heavy).
3. Hire a small crew, open the course, and collect early revenue.
4. Expand to 9 and then 18 holes, add a pro shop and amenities, and raise prices as reputation grows.
5. Late game: a championship-standard course, tournaments, a second course or resort, and prestige rankings.

---

## 4. World & map

### Scale
- **Tile = 2 m × 2 m.**
- **Parcel = 1 hectare (100 m × 100 m) = 50 × 50 tiles.** This is the unit of purchase.
- **Map = 2 km × 2 km = 400 parcels = 1,000 × 1,000 tiles** (proposal). A real 18-hole course needs about 60–80 ha, so the map fits several courses' worth of land and leaves real choice about *which* land to buy.
- For reference, a par 3 needs about 1–3 ha, a par 4 about 3–5 ha and a par 5 about 4–6 ha, including corridors and safety buffers.

### Procedural generation
- Every new game generates a map from a **shareable seed**.
- **Terrain type** (chosen at game start) shapes both the generation and the simulation:

| Terrain | Terrain character | Grass suitability | Maintenance pressure |
|---|---|---|---|
| Parkland | Rolling hills, deciduous trees, creeks | Cool-season (bent, rye, poa) | Moderate rain, disease |
| Links / Coastal | Dunes, sandy soil, wind, few trees | Fescue | Wind, salt, low water needs |
| Desert | Flat to rocky, arroyos, no natural rough | Warm-season (bermuda, zoysia) | Very high irrigation cost |
| Mountain | Steep elevation, rock outcrops, pine forest | Cool-season | Steep earthworks cost, short season |

### Natural map features (fixed constraints that force routing)
| Feature | Can the player change it? |
|---|---|
| **Rock outcrops** | No. Immovable. |
| **Existing ponds & lakes** | Can be enlarged or incorporated as hazards; filling them in is very expensive (proposal) |
| **Creeks / streams** | No. Cannot be moved or blocked; bridges can cross them |
| **Protected wetlands** (proposal) | No building allowed; carry over only |
| **Specimen / old-growth trees** (proposal) | Removable at high cost, with a reputation hit for removal |
| **Steep slopes** | Can be reshaped, but earthworks cost scales sharply with gradient |
| **Roads & neighbouring properties** (proposal) | No. Define the map's edges and the main entrance; out-of-bounds safety buffers apply next to them |

### Land purchasing
- Every parcel has a price based on terrain, features, distance to the road entrance and proximity to water views (proposal).
- Prices rise as your reputation grows and you buy more land nearby (proposal: a land-value feedback effect).
- Parcels can be sold back at a loss.
- **Clubhouse placement:** the clubhouse must sit on owned land next to a road. Hole 1 and hole 10 tees should be near it, and walking distance between green and next tee affects pace of play.

---

## 5. Course building tools

All construction costs money. Costs scale with area, materials and **earthworks volume**.

### 5.1 Fairway Pen (primary tool, available from the start)
- The player clicks a tee point, optionally places one or two doglegs/waypoints, then a green point.
- The game generates a draft hole: a tee area, a fairway corridor along the route, rough on either side, and a basic green.
- It shows the hole's yardage live and suggests a par (≤ 250 yd → par 3, 251–470 → par 4, 471+ → par 5; the player can override).
- Corridor width and green size are adjustable while drawing.
- Validation warnings (non-blocking): crossing an immovable feature, overlapping another hole's safety corridor, landing zones next to out-of-bounds, tee-to-green line crossing a rock face.

### 5.2 Fine-shaping brushes
- **Surface paint:** tee, fairway, green, fringe/collar, first cut, primary rough, deep rough, native/fescue areas, waste area. Adjustable brush size, with soft edges available.
- **Terrain:** raise, lower, smooth, flatten-to-height, and slope along a line (for terraced tees and tiered greens). Each edit computes cut/fill volume.
  - **Cut/fill balance (proposal):** soil cut is stored in a stockpile, and filling draws from it first. Importing soil costs more. This rewards balanced earthworks.
- **Green shaper:** a dedicated tool for green contours, tiers, false fronts and slopes. It shows a slope overlay while you sculpt, warns about unpinnable areas (too steep for a pin at the current green speed), and shows how many pinnable spots remain.

### 5.3 Hazards & features
- **Bunkers:** greenside, fairway and waste bunkers; sand type (proposal: affects cost, playability and raking needs).
- **Water:** dig ponds or lakes, and extend existing water. Needs liners or a high water table, depending on terrain (proposal).
- **Trees:** plant individual trees or forest brushes. Species vary by terrain type. Trees grow over seasons (saplings → mature) and affect shade (turf health), aesthetics and play.
- **Out-of-bounds stakes** and **hazard stakes** (red/yellow), applied automatically near boundaries and water, with manual overrides.
- **Cart paths** (gravel → asphalt → concrete), **bridges**, **rain shelters**, **restrooms**, **ball washers**, **benches**, **on-course drink stations**.

### 5.4 Tee boxes
- Each hole has **3–4 tee boxes**: Championship/Black, Back/Blue, Middle/White, Forward/Red.
- Each tee box is placed and shaped on its own; yardage is computed per tee.
- Golfers choose a tee based on handicap and personality (sandbaggers and ego players included).
- A hole needs at least one tee box and one green to open.

### 5.5 Hole settings
- **Par** (auto-suggested, can be overridden).
- **Stroke index / handicap ranking** (auto-computed from AI scoring data once enough rounds exist; can be overridden).
- **Pin locations:** the player places a set of candidate pin positions on each green (proposal: 4–6). The daily pin sheet is either rotated automatically by staff or set by the player. Pin difficulty depends on slope at that spot and distance from the edge.
- **Tee marker positions:** moved within each tee box to spread wear.

---

## 6. Turf & course conditions

Each playable tile tracks turf state. This is the system the staff maintain.

### Per-tile state (proposal)
| Property | Effect |
|---|---|
| Grass species | Set per surface; suitability to climate drives health |
| Mow height (mm) | Combined with grass species, determines **speed** (greens: Stimpmeter-style rating) and playability |
| Health (0–100) | Colour, playability, disease risk |
| Moisture | Too dry → stress and brown turf; too wet → disease, slow play, carts restricted |
| Wear | Foot and cart traffic, divots, ball marks; recovers over time |
| Firmness | Affects ball roll and bounce in the shot simulation |
| Thatch / compaction | Builds slowly; fixed by aeration (which temporarily hurts playability) |

### Grass types (initial set, proposal)
Bentgrass, Poa annua, Bermudagrass, Zoysia, Perennial ryegrass, Kentucky bluegrass, Fine fescue, Paspalum. Each has climate suitability, the lowest mow height it tolerates, wear tolerance, water need, disease susceptibility and a cost. Grass can be changed by re-sodding or re-seeding, which costs money and closes the area for a while.

### Speed settings
- **Green speed** target (e.g. Stimp 8–13) and **fairway speed / firmness** target, set per course with per-hole overrides (proposal).
- Faster means more prestige and harder play, but slower rounds, more three-putts, and more stress on the turf (it needs lower mowing, more rolling and more water management).

### Environment
- **Day/night clock**, **seasons**, and **weather** (sun, rain, storms, heatwaves, frost, wind) produced by the terrain type's climate model.
- **Irrigation:** place sprinkler heads and pipes connected to a pump house and water source. Water has a cost, and drought restrictions can happen (proposal). An irrigation coverage overlay shows gaps.
- **Disease & pests:** risk depends on humidity, health and grass species, and is handled by spray programs.
- **Seasonal closures** for frost or flooding (proposal).

---

## 7. Staff (paramount system)

Staff are what turn money into course quality. Hiring, scheduling, training and equipping them is the main management layer.

### Roles
| Department | Role | Responsibilities |
|---|---|---|
| Maintenance | **Superintendent** | Runs the maintenance program; turns player policy into daily work orders. Their skill sets how efficiently the crew is used |
| | Assistant Superintendent | Extra capacity for the program; covers when the super is off |
| | Greenkeeper / Groundskeeper | Mowing, raking bunkers, changing cups, fixing divots |
| | Irrigation Technician | Irrigation repairs, hand-watering, fixing dry spots |
| | Spray Technician | Fertiliser, disease and pest treatment |
| | Arborist | Tree care, pruning, removal, planting |
| | Mechanic | Equipment maintenance; without one, equipment breaks down |
| Operations | General Manager | Unlocks automation of pricing and booking policies (proposal) |
| | Starter | Manages the tee sheet and spacing between groups |
| | Course Marshal / Ranger | Keeps pace of play, deals with slow groups |
| | Cart Attendant | Cart fleet cleaning, charging, distribution |
| Pro Shop & Golf | Pro Shop Staff | Sales; their skill affects conversion and upsell |
| | Head Pro / Teaching Pro | Lessons, club fitting, events; raises reputation |
| Hospitality | Food & beverage staff, Chef | Halfway house, restaurant |

### Staff attributes
- **Skill** (per task area), **speed**, **reliability**, **morale**, **fatigue**, **wage**, and **traits** (e.g. "early riser", "perfectionist", "careless with carts") (proposal).
- Staff improve through experience and paid **training courses**.
- Morale depends on wages, hours, workload, equipment quality and break facilities (a maintenance building with a staff room). Low morale leads to mistakes, lateness and people quitting.

### Scheduling & work
- **Shifts:** most maintenance happens early in the morning, before the first tee time. Work during play disrupts golfers and slows the crew.
- **Maintenance program (policy layer):** the player sets standards such as "Greens: mow daily at 3.0 mm, roll 3×/week", "Bunkers: rake daily", "Fairways: mow 3×/week". The superintendent turns these into daily **work orders** and assigns staff.
- **Direct control (override layer):** the player can create urgent work orders ("fix dry spot on 7 green"), assign people to zones, or pause tasks.
- **Zones:** split the course into maintenance zones and assign crews to them.
- **Shortfall feedback:** if the crew can't finish the program, the game says what was skipped and why (e.g. "Bunkers on 10–18 not raked: 6 labour-hours short").
- Staff are **visible on the map**: you can watch mowers stripe fairways at dawn and click any staff member to follow them.

### Equipment & facilities
- **Equipment fleet:** greens mowers, tee/approach mowers, fairway mowers, rough mowers, rollers, aerators, sprayers, bunker rakes, utility vehicles, top-dressers. Each has a quality tier, condition, fuel/electric cost and a breakdown chance.
- **Maintenance building** (required to hire maintenance staff beyond a starter crew), with upgrades: equipment storage capacity, workshop (repair speed), staff room (morale), chemical store (unlocks spray programs).

---

## 8. Golfers

### Generation
Every golfer is an individual with:
- **Generated name**, age and home area.
- **Handicap index**, which drives the shot simulation.
- **Wealth segment** (budget / mid / premium): price sensitivity and spending.
- **Personality traits** (proposal): pace sensitivity, difficulty preference (likes a challenge vs. wants an easy day), aesthetics appreciation, loyalty, social (plays in groups, brings friends), gear enthusiast (pro shop spender), food lover.
- **Golfer types:** casual, regular/local, competitive/club player, tourist, junior, senior, corporate outing.

### Visit lifecycle
1. **Decides to play** based on reputation, price, course rating fit, weather, marketing and competitors.
2. **Books a tee time** (or walks on) at a time slot with a group size.
3. **Arrives**, may use the pro shop or range, and rents or brings a cart.
4. **Plays the round** with the shot simulation (below).
5. **Spends** at the halfway house, restaurant and pro shop after the round.
6. **Leaves a review** and updates their opinion of the course, which feeds reputation and return visits.

### Shot simulation (handicap-driven)
- Each golfer has a club set with distance and **dispersion** derived from their handicap.
- For each shot the AI picks a target (aim point and club) based on its skill and risk tolerance, then the result is rolled: distance error, direction error, and mishit chance.
- The ball's landing and **roll** depend on tile surface, firmness, slope and green speed.
- **Lie penalties:** rough depth, bunkers, trees and hazards change the next shot's options and accuracy.
- **Putting:** make probability depends on distance, green speed, slope at the hole and putting skill.
- Penalties for water and OB follow the standard golf rules.
- **Result:** scores emerge from your design. A scratch player handles a long par 4 easily; a 24-handicap loses balls in the pond.

### Observation & feedback
- **Follow mode:** click any golfer to follow them with the camera; see shot tracers, their running scorecard and current mood.
- **Thoughts:** short, readable reactions ("Green was lightning fast on 12", "Waited 15 minutes on the 6th tee", "Beautiful view from 15").
- **Golfer profile:** visit history, favourite holes, total spending, opinion of the course.
- **Course statistics:** per-hole scoring average versus par, hardest/easiest holes, average round time, bottlenecks, lost-ball hot spots, three-putt rate per green.

### Pace of play
- Golfer groups move on the course. Slow groups create **backups**, which hurt satisfaction and reduce how many tee times you can sell.
- Pace is driven by hole difficulty, green speed, walking distances between green and next tee, cart usage, marshals and the tee-time interval.

---

## 9. Business & economy

### Revenue
- **Green fees:** set per time band (peak / off-peak / twilight), weekday versus weekend, and by season; can be dynamic once a GM is hired (proposal).
- **Memberships:** tiers with annual fees, which trade guaranteed revenue for tee times reserved for members.
- **Cart rental, range balls, lessons, club fitting.**
- **Pro shop:** merchandise, balls, apparel, **golf clubs**. Inventory is bought wholesale and sold at retail markup, and the player sets stock levels.
- **Simulator bays:** year-round and bad-weather revenue.
- **Food & beverage:** halfway house, bar, restaurant.
- **Events:** corporate outings, club championships, and later tournaments that bring prestige and crowds.

### Costs
- Land, construction and earthworks (one-off).
- Wages, equipment purchase and maintenance, fuel, water, fertiliser and chemicals, seed and sod, utilities, insurance, property tax (proposal).
- Pro shop inventory, F&B cost of goods.
- **Loans** with interest, available from a bank with limits based on assets.

### Amenities (buildings)
| Building | Unlocks / effect |
|---|---|
| Clubhouse (required, upgradable) | Check-in, base capacity, restrooms. Higher tiers raise prestige |
| Pro shop (clubhouse addition) | Merchandise; add-ons: **club fitting / club sales**, **simulator bays**, apparel line |
| Driving range / practice green | Range revenue, warm-up (golfers who warm up play slightly better and are happier) |
| Halfway house | Food and drink at the turn |
| Restaurant / bar | Post-round spending, events |
| Cart barn | Cart fleet capacity and charging |
| Maintenance building | Staff and equipment (see §7) |
| Parking lot | Capacity limits on daily visitors (proposal) |
| Lodging (late game, proposal) | Resort play, tourists, multi-day stays |

### Ratings & reputation
- **Course Rating & Slope** (simplified USGA-style), computed automatically from the design and actual scoring.
- **Condition score:** from turf health, wear, bunker quality and green consistency.
- **Aesthetics score:** variety, water and tree features, views, how natural the design looks.
- **Pace score** and **Value score** (price versus experience).
- **Reputation:** a rolling score from reviews, split by golfer segment (a course can be loved by competitive players and disliked by beginners).
- **Rival courses (proposal):** simulated competitor courses in the region compete for the same golfers. You can see their prices and ratings, and you climb a regional ranking.

### Finances UI
Income statement (daily / monthly / yearly), cash-flow graph, revenue by source, cost by department, per-hole economics (proposal: revenue attributed per round, maintenance cost per hole).

---

## 10. Data overlays (Cities: Skylines-style views)
- Elevation / contours
- Slope (with an unpinnable-green warning)
- Turf health
- Moisture & irrigation coverage
- Wear & traffic
- Mow height / green speed
- Golfer traffic heatmap & ball landing zones
- Pace of play / backups
- Land value & parcel ownership
- Staff coverage / work order completion
- Hazard & OB stakes

---

## 11. Time & controls
- Speeds: **Pause, 1×, 2×, 4×**, plus an optional **8× "skip night"** (proposal).
- A day runs from dawn maintenance through the first tee time to dusk. Night is mostly skipped.
- Notifications with "jump to location" (e.g. irrigation leak on 4, a staff member quit, a golfer complaint).
- Keyboard shortcuts for tools, overlays and speed.

---

## 12. Game modes & progression
- **Career (primary):** pick a generated map, terrain type and difficulty. Open-ended play with **milestone goals** (open 9 holes, reach a 4-star reputation, host a club championship, become profitable within year 2).
- **Scenarios (proposal):** hand-made or seeded challenges with fixed constraints, e.g. "Restore a neglected course", "Desert water crisis", "Build a championship course on a tight budget".
- **Sandbox:** unlimited money, all tools unlocked.
- **Progression / unlocks (proposal):** better equipment, grass varieties and buildings unlock through reputation milestones rather than a full research tree, so depth comes from systems rather than gating.
- **Difficulty settings:** starting cash, land prices, golfer pickiness, weather severity, loan rates.

### Starting economics (proposal, to be tuned during balance)
- Normal difficulty: **$3,000,000** starting cash.
- Parcel prices about **$20k–$150k per hectare**, depending on terrain and features.
- Enough to buy roughly 20–30 ha and build a 3–6 hole starter loop with a small crew. Growing to 18 holes requires revenue and/or loans.

---

## 13. Play your own course (later phase)
- An **arcade swing** mode: pick a club, aim, then a **power + accuracy meter**.
- Uses the same ball-flight, roll and lie systems as the AI golfers, including wind, firmness and green speed. Slopes you shaped affect roll.
- Putting with an aim line and power meter; green slope shown with an overlay or arrows.
- Play a full round or a single hole; your scorecard is saved.
- **Priority:** comes after the core management game is solid. It isn't required for the first release.

---

## 14. Art direction & UI

### Visuals
- **8-bit / pixel art** with a limited palette per terrain type (proposal).
- Base sprite tile 16 × 16 px representing 2 m × 2 m, rendered with integer zoom levels (proposal).
- Elevation shown with directional hill shading; contour lines on demand.
- Mowing stripe patterns on fairways and greens (they show maintenance quality visually).
- Small animated people: golfers swinging and walking, carts, mowers.

### Screen layout (sketch)
```
┌──────────────────────────────────────────────────────────────────┐
│ $2,341,200 ▲  │ Day 34 · Spring · 7:42 AM ☀ 18°C │ ⏸ ▶ ▶▶ ▶▶▶ │ ★★★☆☆ │
├──────────┬───────────────────────────────────────────┬───────────┤
│ TOOLS    │                                           │ INSPECTOR │
│ ✎ Pen    │                                           │ Hole 4    │
│ ▦ Paint  │            MAP VIEW (top-down)            │ Par 4     │
│ ⛰ Terrain│                                           │ 412/388/  │
│ ◎ Green  │                                           │ 356/301yd │
│ ∴ Bunker │                                           │ Avg 4.62  │
│ ≈ Water  │                                           │ Speed 10.5│
│ ♣ Trees  │                                           │ [Pins...] │
│ ⌂ Build  │                                           │           │
│ ▤ Land   │                                           │           │
├──────────┴───────────────────────────────────────────┴───────────┤
│ Overlays: [Elev][Slope][Health][Moist][Wear][Traffic][Pace][Land]│
│ Staff · Golfers · Finances · Course Stats · Tee Sheet · Pro Shop │
└──────────────────────────────────────────────────────────────────┘
```

---

## 15. Phased roadmap (proposal)

Each phase ends with something playable.

| Phase | Name | Contents |
|---|---|---|
| **M0** | Tech foundation | TypeScript + PixiJS + Vite; chunked tile map renderer; camera pan/zoom; procedural map generation (terrain, rocks, ponds, creeks, trees) with seed; parcel grid & ownership |
| **M1** | Build a hole | Land purchasing with money; fairway pen; surface paint; terrain raise/lower with cut/fill costs; bunkers, water, trees; tee boxes; greens; pins; hole validation |
| **M2** | Golfers play | Golfer generation; shot simulation by handicap; groups walking the course; scorecards; follow mode; thoughts; green fees; basic finances; clubhouse |
| **M3** | Course conditions & staff | Per-tile turf sim; grass types; mow height and speed; weather/seasons; irrigation; staff hiring, roles, attributes, morale; maintenance program and work orders; equipment; maintenance building |
| **M4** | Business depth | Pro shop with inventory, club fitting, simulator bays; F&B; memberships; tee sheet and pricing bands; cart fleet; loans; financial reports |
| **M5** | Reputation & competition | Course rating/slope, condition/aesthetic/pace scores, reviews, reputation by segment, rival courses, events and tournaments, milestones, career mode |
| **M6** | Play your own course | Arcade swing, putting |
| **M7** | Content & polish | Additional terrain types, scenarios, sandbox, save export/import, tutorial, balancing, audio |

**First playable vertical slice = M0 + M1 + a basic M2:** buy land, build three holes, watch golfers play them and pay green fees.

---

## 16. Left to the builder
- Internal architecture beyond the principles in §2 (e.g. ECS or plain modules, Web Worker timing).
- Exact simulation formulas and balance numbers (all values in this document are starting points).
- Procedural generation algorithms (noise functions, feature placement).
- Pathfinding approach for golfers, staff and carts.
- Save format and versioning.
- Test strategy.

---

## 17. Calls made during review (proposal)

- **Multiple courses per save:** the data model groups holes, tee sheet, ratings, reputation, staff zones and finances by course from M1 onward. The UI for building a second course arrives in M5 or later, but the structure exists from the start so it doesn't need rewriting.
- **Round composition:** holes are played in number order. The player can renumber holes and reorder the routing. A course with N holes sells N-hole rounds (a 3-hole course sells a 3-hole round, priced by the player); once 9+ holes exist, 9-hole and 18-hole rounds are offered. "Holes 1 and 10 near the clubhouse" is advice (worse pace and satisfaction if ignored), not a requirement. A hole is playable when it has ≥ 1 tee box, a green with ≥ 1 pin position, and a walkable route from the previous green.
- **Game time:** at 1× speed, one game day (dawn to dusk) takes about **12 real minutes**, so an 18-hole round takes about 3 minutes to watch at 1×. The sim tick is fixed (e.g. 10 ticks per game minute). Per-tile turf updates run in batches spread across ticks, not every tile every frame. Golfers, staff and shots update every tick.

## 18. Owner decisions from review

- **Art source: programmer art first.** The builder makes simple pixel sprites and tiles (procedural where practical) from one central sprite sheet / atlas definition, so any asset can be replaced by real art later without code changes. Visual scope stays modest until the systems are proven.
- **Construction: instant build + grow-in.** Shaping, hazards and buildings finish as soon as they're paid for. Newly seeded or sodded surfaces need a **grow-in period** (seed takes longer and costs less; sod is faster and costs more) before the hole can open. A hole has a state: *Under construction → Growing in → Open → Closed*. **An open hole must be closed before it can be edited,** so golfers never play on terrain that changes mid-round. Grow-in uses the M1 surfaces and gets its full rules in M3 (turf health, watering); in M1–M2 it is a simple timer.
- **Planning scope: the whole roadmap (M0–M7).** The implementation plan covers every phase. Each phase still ends with something playable, and the vertical slice (M0 + M1 + basic M2) is the first checkpoint.
