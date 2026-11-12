export type Difficulty = 'easy' | 'normal' | 'hard' | 'sandbox';
export const STARTING_CASH: Record<Difficulty, number> = { easy: 5_000_000, normal: 3_000_000, hard: 1_500_000, sandbox: Infinity };

/** The knobs behind a difficulty, each one overridable on the new-game screen or by a scenario. */
export interface DifficultyOptions {
  startingCash: number;
  /** multiplier on parcel prices */
  landPriceMult: number;
  /** 0.5 (forgiving) .. 1.5 (fussy): how hard golfers are to please */
  pickiness: number;
  /** 0.5 .. 2: multiplier on storms, heatwaves and frost */
  weatherSeverity: number;
  /** yearly interest on new loans */
  loanRate: number;
  /** 0..1: irrigation can never use more than this share of the pump (1: no cap) */
  droughtCap: number;
}

export const DIFFICULTY_PRESETS: Record<Difficulty, DifficultyOptions> = {
  easy: { startingCash: STARTING_CASH.easy, landPriceMult: 0.7, pickiness: 0.8, weatherSeverity: 0.8, loanRate: 0.04, droughtCap: 1 },
  normal: { startingCash: STARTING_CASH.normal, landPriceMult: 1, pickiness: 1, weatherSeverity: 1, loanRate: 0.06, droughtCap: 1 },
  hard: { startingCash: STARTING_CASH.hard, landPriceMult: 1.4, pickiness: 1.2, weatherSeverity: 1.3, loanRate: 0.09, droughtCap: 1 },
  sandbox: { startingCash: STARTING_CASH.sandbox, landPriceMult: 1, pickiness: 1, weatherSeverity: 1, loanRate: 0.06, droughtCap: 1 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A difficulty's preset with any overrides applied (and kept in range). */
export function resolveDifficulty(d: Difficulty, o: Partial<DifficultyOptions> = {}): DifficultyOptions {
  const p = { ...DIFFICULTY_PRESETS[d], ...Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number' && !Number.isNaN(v))) } as DifficultyOptions;
  return {
    startingCash: d === 'sandbox' ? Infinity : Math.max(0, p.startingCash),
    landPriceMult: clamp(p.landPriceMult, 0.25, 4),
    pickiness: clamp(p.pickiness, 0.5, 1.5),
    weatherSeverity: clamp(p.weatherSeverity, 0, 2),
    loanRate: clamp(p.loanRate, 0, 0.3),
    droughtCap: clamp(p.droughtCap, 0.1, 1),
  };
}
