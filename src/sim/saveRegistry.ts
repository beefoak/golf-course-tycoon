import type { Game } from './game';

/** Later systems register their own state here (every task that adds state must). Kept import-free to avoid cycles. */
export interface Saveable {
  key: string;
  save(g: Game): unknown;
  load(g: Game, data: unknown, version: number): void;
}
export const saveRegistry = new Map<string, Saveable>();
export function registerSaveable(s: Saveable): void {
  saveRegistry.set(s.key, s);
}
