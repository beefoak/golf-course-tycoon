import { hashString } from '../core/rng';
import { DIFFICULTY_PRESETS, Difficulty, DifficultyOptions } from '../sim/difficulty';
import { SCENARIOS, SCENARIO_IDS, scenarioOptions } from '../sim/modes/scenarios';
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
    h('option', { value: 'easy' }, 'Career, easy — $5,000,000, loans at 4%'),
    h('option', { value: 'normal', selected: true }, 'Career, normal — $3,000,000, loans at 6%'),
    h('option', { value: 'hard' }, 'Career, hard — $1,500,000, loans at 9%'),
    h('option', { value: 'sandbox' }, 'Sandbox — unlimited money, everything unlocked')) as HTMLSelectElement;
  diff.value = 'normal';
  // advanced knobs, refilled from the preset whenever the mode changes
  const num = (step: string) => h('input', { type: 'number', step, style: 'width:90px' }) as HTMLInputElement;
  const knobs = { startingCash: num('100000'), landPriceMult: num('0.1'), pickiness: num('0.1'), weatherSeverity: num('0.1'), loanRate: num('0.5') };
  const fill = () => {
    const p = DIFFICULTY_PRESETS[diff.value as Difficulty];
    knobs.startingCash.value = Number.isFinite(p.startingCash) ? String(p.startingCash) : '';
    knobs.startingCash.disabled = diff.value === 'sandbox';
    knobs.landPriceMult.value = String(p.landPriceMult);
    knobs.pickiness.value = String(p.pickiness);
    knobs.weatherSeverity.value = String(p.weatherSeverity);
    knobs.loanRate.value = String(Math.round(p.loanRate * 1000) / 10);
  };
  fill();
  diff.addEventListener('change', fill);
  const knobRow = (label: string, el: HTMLElement, hint: string) => h('div', { class: 'row', title: hint }, h('span', { class: 'muted' }, label), el);
  const advanced = h('details', null, h('summary', null, 'Difficulty options'),
    knobRow('Starting cash ($)', knobs.startingCash, 'Money in the bank on day one'),
    knobRow('Land price ×', knobs.landPriceMult, '0.7 cheap · 1 normal · 1.4 dear'),
    knobRow('Golfer pickiness', knobs.pickiness, '0.5 forgiving … 1.5 fussy'),
    knobRow('Weather severity', knobs.weatherSeverity, 'Multiplier on storms, heatwaves and frost (0–2)'),
    knobRow('Loan rate (%/yr)', knobs.loanRate, 'Interest on new bank loans'));
  const options = (): Partial<DifficultyOptions> => {
    const v = (el: HTMLInputElement) => (el.value.trim() === '' ? undefined : Number(el.value));
    const rate = v(knobs.loanRate);
    return { startingCash: v(knobs.startingCash), landPriceMult: v(knobs.landPriceMult), pickiness: v(knobs.pickiness), weatherSeverity: v(knobs.weatherSeverity), loanRate: rate === undefined ? undefined : rate / 100 };
  };
  // free play or a scenario
  const scen = h('select', null, h('option', { value: '' }, 'Free play'), ...SCENARIO_IDS.map(id => h('option', { value: id }, `Scenario: ${SCENARIOS[id]!.name}`))) as HTMLSelectElement;
  const scenDesc = h('div', { class: 'muted', style: 'display:none' });
  const freeBits = h('div', null);
  scen.addEventListener('change', () => {
    const s = SCENARIOS[scen.value];
    scenDesc.style.display = s ? '' : 'none';
    scenDesc.textContent = s ? `${s.description} (${s.terrain}, ${s.difficulty})` : '';
    freeBits.style.display = s ? 'none' : '';
  });
  const back = h('div', { class: 'modal-back' });
  const start = () => {
    back.remove();
    if (scen.value) return onStart(scenarioOptions(scen.value));
    onStart({ seed: parseSeed(seed.value), terrain: terrain.value as TerrainType, difficulty: diff.value as Difficulty, options: options() });
  };
  back.appendChild(h('div', { class: 'panel modal' },
    h('h1', null, 'Golf Course Tycoon'),
    h('label', null, 'Game'), scen, scenDesc,
    freeBits,
    h('div', { class: 'actions' }, h('button', { class: 'btn on', onclick: start }, 'Start new game')),
    store ? savesSection(store, error) : null));
  freeBits.append(
    h('label', null, 'Map seed (share it to replay a map)'),
    h('div', { style: 'display:flex;gap:6px' }, seed, h('button', { class: 'btn', onclick: () => { seed.value = pick(); } }, '🎲')),
    h('label', null, 'Terrain'), terrain,
    h('label', null, 'Mode'), diff,
    h('div', { class: 'muted' }, 'Career: earn milestones and unlocks, keep the bank happy — go bankrupt and it\'s over.'),
    advanced);
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
