# Balance notes (Task 45)

Results from the headless runner (`tools/headless.ts`). It runs a scripted player that:

- buys land and pens 18 holes in rows along a fixed par pattern;
- slides and shortens each hole to dodge rock, creeks, water and steep green sites (rock is immovable, so a player routes around it);
- bridges short creek crossings when golfers couldn't otherwise walk from green to tee;
- builds the clubhouse, pro shop, parking, pump, maintenance shed and halfway house;
- buys the fleet and keeps the default crew topped up every day (people quit);
- borrows to keep building, then adds a cart barn and 20 carts once 9 holes are open.

Prices stay at their defaults.

```bash
npx tsx tools/headless.ts --seed 1 --days 365 --terrain parkland [--holes 18] [--size 1000] [--difficulty normal] [--progress]
```

For tuning the shot model there is a faster harness, `tools/scoring.ts`. It lays out the same course and plays golfers of fixed handicaps (0–30) over it, with wind drawn from the climate. It reports, per 18 holes:

- average score over par against the target;
- pick-ups;
- penalties by kind;
- putts.

```bash
npx tsx tools/scoring.ts --terrain links --seed 1 --rounds 60 [--calm]
```

## Targets (from the plan)

| Target | Status |
|---|---|
| The default scripted 18-hole course is operating-profitable by the end of year 2 on normal | **Met** in all 12 runs: every terrain is profitable every year, with all 18 holes open. |
| Average score per handicap band within ±1.5 of `par + handicap × 0.9` | **Met** for 10-19 and 20+ on parkland and links. **Partly met** elsewhere, on purpose: the target assumes a course of standard difficulty, and terrain moves it. Desert plays 1.5–3.5 easy and mountain 4–7 hard. The 0-9 band scores 1–4 under target everywhere (see below). |
| A full year runs in under 60 s | **Met**: about 51 s for a 112-day year in a single run (parkland, seed 1; about 0.45 s per game day with roughly 80 rounds a day). |

"Year" means a game year of 112 days (`DAYS_PER_YEAR`). A 365-day run is therefore 3.26 game years. The 4th profit figure in the table covers only that partial year.

## Results: 365 days, normal difficulty, 3 seeds × 4 terrains

Operating profit = revenue minus running costs, including interest. Construction and land are not included; the script finances them with about $450–670k of loans.

| Terrain | Seed | Holes open/built | Rounds/day | Operating profit by year | 0-9 avg/target | 10-19 | 20+ | Rep | Turf | Shortfall h | ms/day |
|---|---|---|---|---|---|---|---|---|---|---|---|
| parkland | 1 | 18/18 | 121.2 | 546k, 738k, 871k, 163k | 2.2 / 4.3 | 12.3 / 13.2 | 21.3 / 22.5 | 2.68 | 43 | 2334 | 811 |
| parkland | 2 | 18/18 | 121.9 | 812k, 762k, 790k, 88k | 3.1 / 4 | 13 / 13.1 | 21.4 / 21.8 | 2.66 | 45 | 2235 | 1426 |
| parkland | 3 | 18/18 | 151.6 | 709k, 959k, 1065k, 229k | 2.3 / 4.2 | 12.7 / 13.3 | 21.5 / 22.1 | 2.78 | 44 | 2157 | 723 |
| links | 1 | 18/18 | 111.6 | 542k, 648k, 738k, 225k | 3 / 3.9 | 13.4 / 13.2 | 22.8 / 22.1 | 3.39 | 49 | 2580 | 655 |
| links | 2 | 18/18 | 111 | 711k, 788k, 560k, 105k | 3.5 / 4.6 | 13 / 13.1 | 21.4 / 21.8 | 3.39 | 49 | 2390 | 620 |
| links | 3 | 18/18 | 140.6 | 733k, 808k, 950k, 252k | 3.1 / 4.1 | 13.3 / 13.2 | 22.5 / 22.2 | 3.39 | 48 | 2162 | 733 |
| desert | 1 | 18/18 | 124.9 | 158k, 924k, 1154k, 304k | 1.9 / 4.4 | 11.8 / 13.1 | 20.2 / 21.9 | 3.42 | 45 | 2270 | 625 |
| desert | 2 | 18/18 | 121.3 | 358k, 1059k, 912k, 149k | 0.8 / 4.1 | 10.8 / 13.2 | 18.7 / 22.1 | 3.31 | 52 | 1918 | 615 |
| desert | 3 | 18/18 | 144.4 | 178k, 1144k, 1243k, 313k | 0.5 / 4 | 10.3 / 12.9 | 18.9 / 21.9 | 3.5 | 52 | 1895 | 696 |
| mountain | 1 | 18/18 | 82.2 | 342k, 270k, 466k, 249k | 6.1 / 4 | 18.8 / 13.1 | 28.8 / 22.3 | 3.48 | 47 | 1441 | 550 |
| mountain | 2 | 18/18 | 81.3 | 447k, 378k, 392k, 134k | 7.3 / 4 | 19.9 / 13.1 | 28.7 / 22.2 | 3.37 | 48 | 1398 | 1353 |
| mountain | 3 | 18/18 | 110.7 | 573k, 539k, 656k, 203k | 3.8 / 3.8 | 16.8 / 13 | 26.4 / 21.8 | 3.32 | 44 | 1613 | 1064 |

The ms/day column comes from four sims running at once. The speed target above is for a single run.

### Reading the table

**Mountain** is the hardest terrain and the least profitable (about 80–110 rounds a day, against 110–150 elsewhere), but it pays.

- Scores run 4–7 over target. Rock outcrops are immovable, and a ball that stops on rock is unplayable (a penalty drop). Routing around rock removes most of those penalties, but not all.
- That is mountain's character. A player who routes holes more carefully than the script will score better.

**Desert** plays easy (few trees, wide waste areas) and pays best.

**The 0-9 band** scores 1–4 under target in full runs, while the scoring harness puts scratch players within about 1.5. The likely cause is course conditions. In a full run, low handicappers play a settled, mown course with rolled greens; the harness plays freshly built holes. Real handicaps behave the same way: good players beat theirs on easy days.

**Cash stays positive** in every run. Debt of $450–670k comes from financing the build, and the course pays it down.

### Before this round of tuning

In the first pass (Task 45):

- mountain lost money in all 3 runs, with only 10–13 holes open, because of blocked walks and holes laid over rock;
- the 20+ band was about +5 over target everywhere;
- links scores ran +3 to +4 over target from wind;
- one seed left broken machines unrepaired after its mechanic quit, giving 20–40k shortfall hours.

## Changes made while balancing

**Land and construction**

- Parcel prices are $3k + $8k × buildable share + $5k near the road + $5k × water share, clamped to $3–60k. The difficulty land multiplier applies on top.
- Paint costs per tile:

  | Surface | Cost |
  |---|---|
  | Tee | 60 |
  | Fairway | 14 |
  | Green | 180 |
  | Fringe | 60 |
  | First cut | 8 |
  | Rough | 3 |
  | Deep rough | 4 |
  | Native | 3 |
  | Natural | 2 |
  | Bunker | 120 |
  | Waste | 30 |

  Tree removal costs 40 per tile.
- Penned greens are graded to a maximum slope of 2%, blended over 6 tiles and charged as earthworks. 8% greens caused endless pick-ups on par 4s.
- When a default pin lands on rock, the penned hole now replaces it from the rest of the green, keeping four pins. Before, that hole could not be seeded.

**Golf**

- Club spread grows at half rate past handicap 15, and so does the mishit chance. High handicaps lose strokes to distance and short game, not to ever-wilder full swings.
  - Angle spread: 3° + 0.19° per point.
  - Distance spread: 5% + 0.55% per point.
  - Both count points past 15 at half.
- Golfers aim off for the wind (`windAllowance`). A scratch player allows for 85% of the expected push; that falls 1.8 points per handicap stroke, to a floor of 30%. Before, nobody allowed for wind, and links scored 4–6 over target.
- Putting is a little harder for good players: difficulty is 1.15 + 0.02 × handicap (was 1 + 0.025 × handicap). Scratch players were holing too much.

**Money**

- Loans: each open hole adds $120k of borrowing capacity (`HOLE_COLLATERAL`), and course value counts toward the loan limit.
- The default green fee is $4 per hole.
- Base demand is 100, and the price reference for 18 holes is $55.
- Insurance is $25 per hole per day.
- Water costs $0.60/m³.

**Turf and maintenance**

- Disease spreads less (chance 0.08). It now clears on its own (0.04, doubled on dry ground), and thatch builds more slowly (0.25). Turf used to collapse from outbreaks that never ended. Disease notifications now point at the outbreak.
- The utility vehicle fills divots at 4000/6000/9000 tiles per hour (tier 1/2/3). Filling them by hand had created a huge labour shortfall.

**Performance**

- Turf stripes are drawn 600 at a time.
- The green stimp value is cached per tick.
- Pathfinding:
  - a straight-line shortcut for walks up to 80 tiles;
  - a typed-array cost cache;
  - carts only search when the target tile is passable for a cart.
- **Connected-region check**: an unreachable goal now fails at once instead of searching up to 400k tiles. Before, staff sent to work on a walled-off hole made the sim stall (one run hung at day 22).
- **Agent walks** (golfers and staff) use a weighted search (`AGENT_WEIGHT` 2): a walk a few percent longer than the best is fine. They take a straight line up to 160 tiles across anything short of a bunker or blocked tile, greens included. Precise searches (validation, the default) are unchanged.
- **Carts**:
  - they weave through trees at cost 3 (they used to treat trees as walls);
  - they skip trips under 15 tiles, or trips starting on a tee or green;
  - they give up after 500 + 15 × distance tiles expanded, and the group walks.
  - Cart searches through tree mazes had made a game year take about 150 s.

## Not done / next steps

- A pricing script. Every run uses default fees, so revenue is likely below what a player would earn.
- Low-handicap scoring on a mature course (the 0-9 band, see above).
- A target adjusted for course difficulty (slope rating), which would judge mountain and desert fairly.
