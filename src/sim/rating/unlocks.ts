import type { Game } from '../game';

/** What reputation milestones open up (GDD §12): not a research tree, just doors that open as the club grows. */
export type UnlockKey = 'equipmentTier3' | 'premiumSand' | 'lodging' | 'exoticGrass' | 'proTour' | 'multiCourse';

export const UNLOCK_LABEL: Record<UnlockKey, string> = {
  equipmentTier3: 'Top-tier equipment',
  premiumSand: 'Premium bunker sand',
  lodging: 'Lodge',
  exoticGrass: 'Paspalum and Zoysia in any climate',
  proTour: 'Pro tour events',
  multiCourse: 'A second course',
};

/** Sandbox has everything; career games earn them. */
export function isUnlocked(g: Game, key: UnlockKey): boolean {
  return g.difficulty === 'sandbox' || g.unlocks.includes(key);
}

export function unlock(g: Game, key: UnlockKey): boolean {
  if (g.unlocks.includes(key)) return false;
  g.unlocks.push(key);
  if (g.difficulty !== 'sandbox') g.notify('info', `Unlocked: ${UNLOCK_LABEL[key]}`);
  return true;
}

/** Why something is locked, for the UI and command errors. */
export function lockedReason(key: UnlockKey): string {
  switch (key) {
    case 'equipmentTier3': return 'Top-tier equipment unlocks at a 4-star reputation';
    case 'premiumSand': return 'Premium sand unlocks when you open 18 holes';
    case 'lodging': return 'A lodge needs a 4-star reputation';
    case 'exoticGrass': return 'That grass won\'t take in this climate until you reach the regional top 3';
    case 'proTour': return 'Pro tour events need a 4-star, top-3 course';
    case 'multiCourse': return 'A second course unlocks when you open 18 holes';
  }
}
