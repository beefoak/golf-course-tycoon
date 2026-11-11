export class EventBus<E extends Record<string, unknown>> {
  private listeners = new Map<keyof E, Set<(p: never) => void>>();
  on<K extends keyof E>(k: K, fn: (p: E[K]) => void): () => void {
    let set = this.listeners.get(k);
    if (!set) { set = new Set(); this.listeners.set(k, set); }
    set.add(fn as (p: never) => void);
    return () => { set!.delete(fn as (p: never) => void); };
  }
  emit<K extends keyof E>(k: K, p: E[K]): void {
    const set = this.listeners.get(k);
    if (!set) return;
    for (const fn of [...set]) (fn as (p: E[K]) => void)(p);
  }
}
