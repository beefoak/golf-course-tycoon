import { h } from './dom';

export interface Shortcut { keys: string; what: string }

/** Keys that aren't tool hotkeys (those are read off the toolbar). */
export const GENERAL_SHORTCUTS: Shortcut[] = [
  { keys: 'W A S D / arrows', what: 'Pan the camera' },
  { keys: 'Right- or middle-drag', what: 'Pan the camera' },
  { keys: 'Mouse wheel', what: 'Zoom' },
  { keys: 'Space', what: 'Pause / resume (swing in Play mode)' },
  { keys: '1 2 3 4', what: 'Speed 1× 2× 4× 8×' },
  { keys: 'Ctrl+Z', what: 'Undo the last construction stroke (within 10 s, same game day, full refund)' },
  { keys: 'Esc', what: 'Cancel the current drawing' },
  { keys: 'Backspace', what: 'Remove the last pen point' },
  { keys: 'Enter', what: 'Build the pen draft' },
  { keys: '?', what: 'This list' },
];

/** Tool hotkeys from the toolbar's buttons ("Label (K) — hint"). */
export function toolShortcuts(toolbar: HTMLElement): Shortcut[] {
  return [...toolbar.querySelectorAll('button')].flatMap(b => {
    const m = /^(.*) \((.+?)\)(?: — (.*))?$/.exec(b.title);
    return m ? [{ keys: m[2]!, what: m[3] ? `${m[1]} — ${m[3]}` : m[1]! }] : [];
  });
}

/** The keyboard shortcut overlay (toggled with ?). */
export function toggleShortcuts(root: HTMLElement, toolbar: HTMLElement): void {
  const open = root.querySelector('.shortcuts-back');
  if (open) { open.remove(); return; }
  const row = (s: Shortcut) => h('tr', null, h('td', { class: 'keys' }, s.keys), h('td', null, s.what));
  const back = h('div', { class: 'modal-back shortcuts-back', onclick: (e: Event) => { if (e.target === back) back.remove(); } });
  back.appendChild(h('div', { class: 'panel modal shortcuts' },
    h('h1', null, 'Keyboard shortcuts'),
    h('div', { class: 'cols' },
      h('table', null, h('tr', null, h('th', { colspan: 2 }, 'Tools')), ...toolShortcuts(toolbar).map(row)),
      h('table', null, h('tr', null, h('th', { colspan: 2 }, 'General')), ...GENERAL_SHORTCUTS.map(row))),
    h('div', { class: 'actions' }, h('button', { class: 'btn on', onclick: () => back.remove() }, 'Close'))));
  root.appendChild(back);
}
