import { Game } from '../../sim/game';
import { readHeader, serialize } from '../../sim/save';
import { AUTOSAVE, SaveMeta, SaveStore } from '../../sim/saveStore';
import { h, money } from '../dom';

export const SAVE_EXT = '.gctsave';

/** Reload the page into a stored save (a clean restart avoids leaking renderer state between games). */
export function loadSlot(name: string): void {
  const u = new URL(location.href);
  u.searchParams.set('load', name);
  location.href = u.toString();
}

export function downloadSave(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: `${name.replace(/[^\w\- ]+/g, '_')}${SAVE_EXT}` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Pick a .gctsave file, validate it, store it under its file name; resolves to the slot name. */
export function importSaveFile(store: SaveStore): Promise<{ ok: true; name: string } | { ok: false; reason: string } | null> {
  return new Promise(resolve => {
    const input = h('input', { type: 'file', accept: SAVE_EXT }) as HTMLInputElement;
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const bytes = new Uint8Array(await f.arrayBuffer());
      const hr = readHeader(bytes);
      if (!hr.ok) return resolve({ ok: false, reason: hr.reason });
      const name = f.name.replace(/\.gctsave$/i, '') || 'imported';
      if ((await store.list()).some(m => m.name === name) && !confirm(`A save named "${name}" exists. Overwrite it?`)) return resolve(null);
      await store.put(name, bytes);
      resolve({ ok: true, name });
    };
    input.click();
  });
}

function when(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Slot list rows shared by the in-game panel and the new-game screen. */
export function saveRows(store: SaveStore, list: SaveMeta[], onChange: () => void, inGame = false): HTMLElement[] {
  return list.map(m => h('div', { class: 'row', style: 'gap:6px;align-items:center' },
    h('span', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' },
      h('b', null, m.name === AUTOSAVE ? '⟳ autosave' : m.name),
      h('div', { class: 'muted', style: 'font-size:11px' }, `Day ${m.day} · ${money(m.cash)} · ${when(m.savedAt)}`)),
    h('button', { class: 'btn', title: 'Load', onclick: () => { if (!inGame || confirm(`Load "${m.name}"? Unsaved progress in this game will be lost.`)) loadSlot(m.name); } }, 'Load'),
    h('button', { class: 'btn', title: 'Export to file', onclick: async () => { const b = await store.get(m.name); if (b) downloadSave(m.name, b); } }, '⇩'),
    h('button', { class: 'btn', title: 'Delete', onclick: async () => { if (confirm(`Delete save "${m.name}"?`)) { await store.delete(m.name); onChange(); } } }, '✕')));
}

/** Save / load panel: save by name, list slots, load, delete, export and import files. */
export function savePanel(g: Game, store: SaveStore): HTMLElement {
  const el = h('div', null);
  const name = h('input', { value: `Day ${g.day}`, style: 'flex:1;background:var(--panel-2);color:var(--text);border:2px solid var(--line);font:inherit;padding:2px' }) as HTMLInputElement;
  const listEl = h('div', null, h('div', { class: 'muted' }, 'Loading…'));
  const refresh = async () => {
    const list = await store.list();
    listEl.replaceChildren(...(list.length ? saveRows(store, list, () => void refresh(), true) : [h('div', { class: 'muted' }, 'No saves yet.')]));
  };
  const save = async () => {
    const n = name.value.trim();
    if (!n) return;
    const existing = (await store.list()).some(m => m.name === n);
    if (existing && !confirm(`Overwrite "${n}"?`)) return;
    await store.put(n, serialize(g));
    g.notify('info', `Saved "${n}"`);
    await refresh();
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') void save(); });
  el.append(
    h('h3', null, 'Save & load'),
    h('div', { class: 'row', style: 'gap:6px' }, name, h('button', { class: 'btn on', onclick: () => void save() }, 'Save')),
    h('div', { class: 'row', style: 'gap:6px' },
      h('button', { class: 'btn', onclick: () => downloadSave(name.value.trim() || 'golf-course', serialize(g)) }, 'Export file'),
      h('button', { class: 'btn', onclick: async () => {
        const r = await importSaveFile(store);
        if (!r) return;
        if (!r.ok) { g.notify('warn', r.reason); return; }
        g.notify('info', `Imported "${r.name}"`);
        await refresh();
      } }, 'Import file')),
    h('label', null, 'Saved games'),
    listEl,
    h('div', { class: 'muted', style: 'margin-top:6px;font-size:11px' }, 'Autosaves every 7 game days. Loading restarts the page.'));
  void refresh();
  return el;
}
