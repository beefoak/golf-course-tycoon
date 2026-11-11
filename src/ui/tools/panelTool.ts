import { Game } from '../../sim/game';
import { h } from '../dom';
import { Tool } from './tool';

export interface PanelTool extends Tool { refreshPanel(): void }

/**
 * A toolbar entry that is only a panel (no map interaction). `render` builds the body; the panel
 * re-renders after the player's actions, and in the background at each new day, on staff changes and
 * every `liveMs` — but not while the pointer is over it or the player is typing in it.
 */
export function panelTool(g: Game, id: string, label: string, render: (refresh: () => void) => HTMLElement, liveMs = 1000): PanelTool {
  const box = h('div');
  const force = () => box.replaceChildren(render(refresh));
  // background refreshes wait while the player is pointing at or typing in the panel,
  // so a click never lands on a button that is being replaced
  const live = () => {
    if (!box.isConnected || box.matches(':hover')) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && box.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) return;
    force();
  };
  // after the player's own action: redraw now
  const refresh = () => { if (box.isConnected) force(); };
  g.events.on('day', live);
  g.events.on('staff', live);
  if (typeof setInterval !== 'undefined' && liveMs > 0) setInterval(live, liveMs);
  return {
    id, label, cursor: 'default',
    panel: () => { force(); return box; },
    refreshPanel: force,
  };
}

/** Tab strip: buttons that switch a piece of panel state. */
export function tabs<T extends string>(items: { value: T; text: string }[], get: () => T, set: (v: T) => void): HTMLElement {
  return h('div', { style: 'display:flex;gap:3px;margin-bottom:6px;flex-wrap:wrap' },
    ...items.map(it => h('button', { class: `btn${get() === it.value ? ' on' : ''}`, onclick: () => set(it.value) }, it.text)));
}

export const INPUT_STYLE = 'background:var(--panel-2);color:var(--text);border:2px solid var(--line);font:inherit;padding:2px';
