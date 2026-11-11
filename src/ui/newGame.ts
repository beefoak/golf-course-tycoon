import { hashString } from '../core/rng';
import { Difficulty } from '../sim/difficulty';
import { NewGameOptions } from '../sim/game';
import { TerrainType } from '../sim/world/terrainTypes';
import { SaveStore } from '../sim/saveStore';
import { h } from './dom';
import { importSaveFile, loadSlot, saveRows } from './panels/savePanel';

const WORDS = ['maple', 'heron', 'quarry', 'brook', 'willow', 'summit', 'dune', 'cedar', 'falcon', 'meadow', 'canyon', 'harbor'];

/** Turn a seed string into a number: digits are used directly, text is hashed. */
export function parseSeed(s: string): number {
  const t = s.trim();
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  return hashString(t.toLowerCase());
}

export function showNewGame(root: HTMLElement, onStart: (o: NewGameOptions) => void, store?: SaveStore, error?: string): void {
  const pick = () => `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${WORDS[Math.floor(Math.random() * WORDS.length)]}-${Math.floor(Math.random() * 100)}`;
  const seed = h('input', { value: pick() }) as HTMLInputElement;
  const terrain = h('select', null,
    h('option', { value: 'parkland' }, 'Parkland — rolling hills, creeks, hardwoods'),
    h('option', { value: 'links' }, 'Links / Coastal — dunes, wind, fescue'),
    h('option', { value: 'desert' }, 'Desert — rocky, arid, costly water'),
    h('option', { value: 'mountain' }, 'Mountain — steep, rocky, short season')) as HTMLSelectElement;
  const diff = h('select', null,
    h('option', { value: 'easy' }, 'Easy — $5,000,000'),
    h('option', { value: 'normal', selected: true }, 'Normal — $3,000,000'),
    h('option', { value: 'hard' }, 'Hard — $1,500,000'),
    h('option', { value: 'sandbox' }, 'Sandbox — unlimited money')) as HTMLSelectElement;
  diff.value = 'normal';
  const back = h('div', { class: 'modal-back' });
  const start = () => {
    back.remove();
    onStart({ seed: parseSeed(seed.value), terrain: terrain.value as TerrainType, difficulty: diff.value as Difficulty });
  };
  back.appendChild(h('div', { class: 'panel modal' },
    h('h1', null, 'Golf Course Tycoon'),
    h('label', null, 'Map seed (share it to replay a map)'),
    h('div', { style: 'display:flex;gap:6px' }, seed, h('button', { class: 'btn', onclick: () => { seed.value = pick(); } }, '🎲')),
    h('label', null, 'Terrain'), terrain,
    h('label', null, 'Difficulty'), diff,
    h('div', { class: 'actions' }, h('button', { class: 'btn on', onclick: start }, 'Start new game')),
    store ? savesSection(store, error) : null));
  seed.addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
  root.appendChild(back);
}

/** "Continue" block on the new-game screen: stored slots plus file import. */
function savesSection(store: SaveStore, error?: string): HTMLElement {
  const listEl = h('div', null);
  const msg = h('div', { class: 'warnline', style: error ? '' : 'display:none' }, error ?? '');
  const refresh = async () => {
    const list = await store.list().catch(() => []);
    listEl.replaceChildren(...(list.length ? saveRows(store, list, () => void refresh()) : [h('div', { class: 'muted' }, 'No saved games.')]));
  };
  void refresh();
  return h('div', { style: 'margin-top:12px;border-top:2px solid var(--line);padding-top:8px' },
    h('label', null, 'Continue a saved game'),
    msg,
    listEl,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: async () => {
      const r = await importSaveFile(store);
      if (!r) return;
      if (!r.ok) { msg.textContent = r.reason; msg.style.display = ''; return; }
      loadSlot(r.name);
    } }, 'Import .gctsave file')));
}
