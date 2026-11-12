/**
 * Scoring harness: lays out the scripted course, then plays golfers of fixed handicaps over every
 * built hole (no tee sheet, no turf wear) and compares their 18-hole average with the target
 * `par + handicap × 0.9`. Much faster than a full headless run for tuning the shot model.
 *
 *   npx tsx tools/scoring.ts --terrain links --seed 1 --rounds 20 [--calm]
 */
import { Rng } from '../src/core/rng';
import { holePar } from '../src/sim/course/yardage';
import { Game } from '../src/sim/game';
import { generateGolfer } from '../src/sim/golfers/generate';
import { simulateHole } from '../src/sim/golfers/hole';
import { CLIMATES } from '../src/sim/turf/weather';
import { TERRAINS, TerrainType } from '../src/sim/world/terrainTypes';
import { ScriptedPlayer } from './headless';

export interface ScoringRow { handicap: number; avgOverPar18: number; target: number; pickUpRate: number; penaltiesPer18: number; puttsPer18: number; why: string }

export function runScoring(o: { seed: number; terrain: TerrainType; rounds: number; calm?: boolean; handicaps?: number[]; size?: number; holes?: number }): { holes: number; rows: ScoringRow[] } {
  const g = Game.create({ seed: o.seed, terrain: o.terrain, difficulty: 'normal', size: o.size ?? 1000 });
  const p = new ScriptedPlayer(g, o.holes ?? 18);
  p.setup();
  p.daily();
  const holes = p.built.map(id => g.courses.hole(id)!).filter(h => h.pins.length > 0);
  const climate = CLIMATES[TERRAINS[o.terrain].climate];
  const rng = new Rng(o.seed * 7919 + 1);
  const rows: ScoringRow[] = [];
  for (const hcp of o.handicaps ?? [0, 5, 10, 15, 20, 25, 30]) {
    let over = 0, n = 0, picks = 0, pens = 0, putts = 0;
    const kinds = new Map<string, number>();
    for (let r = 0; r < o.rounds; r++) {
      const golfer = { ...generateGolfer(rng, r + 1), handicap: hcp, age: 40 };
      // one wind per round, drawn like the weather does (speed around the climate mean, windy days ×2.2)
      const speed = o.calm ? 0 : Math.max(0, climate.windMean * (rng.chance(climate.windyChance) ? 2.2 : 1) + rng.normal(0, 1.5));
      const ang = rng.range(0, Math.PI * 2);
      const wind = { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed };
      for (const h of holes) {
        h.activePin = r % h.pins.length;
        const res = simulateHole(g, golfer, h, rng, wind);
        over += res.strokes - holePar(h); n++;
        if (res.pickedUp) picks++;
        pens += res.penalties; putts += res.putts;
        for (const s of res.shots) if (s.penalty) kinds.set(s.result, (kinds.get(s.result) ?? 0) + s.penalty);
      }
    }
    const k = 18 / n;
    rows.push({ handicap: hcp, avgOverPar18: +(over * k).toFixed(1), target: +(hcp * 0.9).toFixed(1), pickUpRate: +(picks / n).toFixed(3), penaltiesPer18: +(pens * k).toFixed(1), puttsPer18: +(putts * k).toFixed(1), why: [...kinds].map(([w, c]) => `${w} ${(c * k).toFixed(1)}`).join(' ') });
  }
  return { holes: holes.length, rows };
}

const isMain = typeof process !== 'undefined' && process.argv[1] && /scoring\.ts$/.test(process.argv[1]);
if (isMain) {
  const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
  const r = runScoring({ seed: Number(arg('seed', '1')), terrain: arg('terrain', 'parkland') as TerrainType, rounds: Number(arg('rounds', '20')), calm: process.argv.includes('--calm') });
  console.log(`${r.holes} holes`);
  console.table(r.rows);
}
