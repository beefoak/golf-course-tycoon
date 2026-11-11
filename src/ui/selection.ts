/** The hole the player is working on (shared by the hole panel, green tool and entity layer). */
export class HoleSelection {
  id: number | null = null;
  private listeners: ((id: number | null) => void)[] = [];
  set(id: number | null): void {
    if (this.id === id) return;
    this.id = id;
    for (const l of this.listeners) l(id);
  }
  onChange(fn: (id: number | null) => void): void {
    this.listeners.push(fn);
  }
}
