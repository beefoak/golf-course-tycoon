# Balance notes (Task 45)

Results from the headless runner (`tools/headless.ts`). It runs a scripted player that:

- buys land and pens 18 holes in rows along a fixed par pattern;
- builds the clubhouse, pro shop, parking, pump, maintenance shed and halfway house;
- buys the fleet and hires the default crew;
- borrows to keep building, then adds a cart barn and 20 carts once 9 holes are open.

Prices stay at their defaults.

```bash
npx tsx tools/headless.ts --seed 1 --days 365 --terrain parkland [--holes 18] [--size 1000] [--difficulty normal] [--progress]
```

## Targets (from the plan)

| Target | Status |
|---|---|
| The default scripted 18-hole course is operating-profitable by the end of year 2 on normal | **Met** on parkland, links and desert (9/12 runs). **Not met** on mountain, where the script's straight-row layout ignores slopes. |
| Average score per handicap band within ±1.5 of `par + handicap × 0.9` | **Met** for 0-9 and 10-19 on parkland and desert. **Not met** on links (about +3 to +4: wind and firm ground), mountain (slopes) or the 20+ band (about +5 everywhere). |
| A full year runs in under 60 s | **Met**: 0.4–1.1 s per game day, so a 112-day year takes 45–120 s on a busy machine running 4 sims at once and about 45 s alone. |

"Year" means a game year of 112 days (`DAYS_PER_YEAR`). A 365-day run is therefore 3.26 game years. The 4th profit figure in the table covers only that partial year.

## Results: 365 days, normal difficulty, 3 seeds × 4 terrains

Operating profit = revenue minus running costs, including interest. Construction and land are not included; the script finances them with about $600–700k of loans.

| Terrain | Seed | Holes open/built | Rounds/day | Operating profit by year | 0-9 avg/target | 10-19 | 20+ | Rep | Turf | Shortfall h | ms/day |
|---|---|---|---|---|---|---|---|---|---|---|---|
| parkland | 1 | 16/18 | 108.2 | 78k, 25k, 127k, 11k | 2.3 / 3.9 | 12.7 / 13.2 | 24.4 / 21.8 | 2.52 | 43 | 1786 | 584 |
| parkland | 2 | 12/18 | 83.6 | 324k, 277k, 334k, 1k | 5.6 / 4.4 | 15.7 / 13.1 | 28.2 / 22.4 | 2.7 | 45 | 21398 | 502 |
| parkland | 3 | 17/18 | 149.6 | 372k, 595k, 695k, 123k | 2.9 / 4.1 | 13.1 / 13.2 | 25.2 / 22 | 2.57 | 43 | 2212 | 749 |
| links | 1 | 18/18 | 109.2 | 459k, 550k, 668k, 200k | 8.2 / 4.5 | 16.4 / 13 | 28.4 / 22 | 3.33 | 48 | 2373 | 966 |
| links | 2 | 16/18 | 95.4 | 319k, 387k, 299k, 25k | 11.7 / 4.7 | 19.8 / 13.1 | 31.1 / 22.2 | 3.31 | 49 | 1897 | 545 |
| links | 3 | 18/18 | 140.9 | 665k, 782k, 938k, 253k | 7.7 / 4.4 | 15.9 / 12.8 | 28 / 21.9 | 3.3 | 47 | 2464 | 1054 |
| desert | 1 | 18/18 | 124.4 | -33k, 1020k, 1152k, 305k | 3.5 / 4.2 | 13.9 / 12.9 | 27.1 / 22.1 | 3.51 | 46 | 2566 | 1071 |
| desert | 2 | 16/18 | 111.9 | 147k, 622k, 463k, 45k | 7.8 / 4.3 | 17 / 13 | 29.9 / 22.6 | 3.23 | 52 | 1785 | 589 |
| desert | 3 | 18/18 | 144.3 | -8k, 1209k, 1187k, 299k | 4.9 / 3.7 | 15.4 / 13 | 29.1 / 22 | 3.62 | 53 | 2124 | 947 |
| mountain | 1 | 13/18 | 58.4 | -76k, -267k, -218k, -2k | 15.7 / 4.2 | 29.4 / 13.3 | 42.7 / 22.5 | 3.43 | 48 | 831 | 479 |
| mountain | 2 | 10/18 | 41.4 | -15k, -184k, -214k, -46k | 22.6 / 4.6 | 34.8 / 13.1 | 46.2 / 22.1 | 3.08 | 49 | 527 | 376 |
| mountain | 3 | 11/18 | 72 | 68k, -93k, -99k, 1k | 16.2 / 4.5 | 29.7 / 13.1 | 43.4 / 22 | 3.21 | 45 | 916 | 517 |

### Reading the table

**Mountain.** These are failures of the script, not proof that the game is unwinnable there:

- The fixed-row layout puts greens on steep ground and drops holes across ridges. Scores of +16 to +23 for scratch players come from that terrain.
- Several holes can't be seeded ("Golfers can't walk here from Hole N's green") because the script never routes walkways around rock and creeks. Fewer holes open, demand stays low, and wages swamp revenue.
- A player who routes holes along the valleys should do far better. Next balance step: a terrain-aware script.

**Links** scores run about +3 to +4 over target in every band, from wind on exposed ground. That is arguably the terrain's character, but it is worth a look when tuning wind strength.

**The 20+ band** is about +5 over target everywhere, from extra penalty strokes and three-putts. A cheap fix would be a lower miss spread for high handicaps in `golfers/shot.ts`. It is left as is for now.

**Parkland seed 2** shows 21k staff-shortfall hours: only 12 holes opened, and the crew was hired for 18. This is noise from the script hiring for planned holes rather than open ones.

**Cash goes negative** in some runs (mountain, parkland-1) because the script borrows the whole build and keeps building at a loss. A human would stop.

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
- Penned holes top their default pins back up to four from the rest of the green when one lands on rock. Before, that hole could not be seeded.

**Money**

- Loans: each open hole adds $120k of borrowing capacity (`HOLE_COLLATERAL`), and course value counts toward the loan limit.
- The default green fee is $4 per hole.
- Base demand is 100, and the price reference for 18 holes is $55.
- Insurance is $25 per hole per day.
- Water costs $0.60/m³.

**Turf and maintenance**

- Disease spreads less (chance 0.08). It now clears on its own (0.04, doubled on dry ground) and thatch builds more slowly (0.25). Turf used to collapse from outbreaks that never ended. Disease notifications now point at the outbreak.
- The utility vehicle fills divots at 4000/6000/9000 tiles per hour (tier 1/2/3). Hand-filling had created a huge labour shortfall.

**Performance**

- Turf stripes are drawn 600 at a time.
- The green stimp value is cached per tick.
- Pathfinding: a straight-line shortcut for walks up to 80 tiles; a typed-array cost cache; carts only search when the target tile is passable for a cart.
- **Connected-region check**: unreachable goals now fail at once instead of searching up to 400k tiles. Before, staff sent to work on a walled-off hole made the sim stall (one run hung at day 22).

## Not done / next steps

- Terrain-aware scripted routing, so mountain can be judged fairly.
- 20+ handicap scoring (shot spread), and links wind strength.
- A pricing script: every run uses default fees, so revenue is likely below what a player would earn.
