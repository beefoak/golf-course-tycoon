export type Difficulty = 'easy' | 'normal' | 'hard' | 'sandbox';
export const STARTING_CASH: Record<Difficulty, number> = { easy: 5_000_000, normal: 3_000_000, hard: 1_500_000, sandbox: Infinity };
