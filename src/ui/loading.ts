import { h } from './dom';

/** What the crew is up to while the course is generated and the renderer warms up. */
export const LOADING_LINES = [
  'Laying sod',
  'Placing boulders',
  'Filling ponds',
  'Carving creeks',
  'Shaping the hills',
  'Planting oaks',
  'Raking bunkers',
  'Mowing stripes',
  'Cutting the cups',
  'Chasing off geese',
  'Polishing ball washers',
  'Untangling hoses',
  'Bribing the weather',
  'Counting tees',
];

/** Shortest time a line is on screen before a loading phase may replace it. */
export const MIN_LINE_MS = 350;

export interface Loading {
  el: HTMLElement;
  /** the line on show now */
  line(): string;
  /** move on to the next line (called between loading phases); a line stays up at least MIN_LINE_MS so it can be read */
  step(): void;
  /** fade out and remove */
  done(): void;
}

/**
 * A full-screen loading card with a bouncing ball and a rotating line of flavour text. The ball
 * is a CSS transform animation, so it keeps moving while the main thread is busy generating.
 */
export function showLoading(parent: HTMLElement, lines: string[] = LOADING_LINES, everyMs = 900, start = Math.floor(Math.random() * lines.length)): Loading {
  let i = ((start % lines.length) + lines.length) % lines.length;
  const text = h('div', { class: 'loading-line' }, `${lines[i]}…`);
  const el = h('div', { class: 'loading', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'loading-card' },
      h('div', { class: 'loading-title' }, '⛳ Golf Course Tycoon'),
      h('div', { class: 'loading-ball' }),
      text));
  parent.appendChild(el);
  let shownAt = Date.now();
  let timer: ReturnType<typeof setTimeout>;
  // each line gets its full turn: the timer restarts whenever the line changes
  const next = () => {
    i = (i + 1) % lines.length;
    text.textContent = `${lines[i]}…`;
    shownAt = Date.now();
    clearTimeout(timer);
    timer = setTimeout(next, everyMs);
  };
  const step = () => { if (Date.now() - shownAt >= MIN_LINE_MS) next(); };
  timer = setTimeout(next, everyMs);
  let finished = false;
  return {
    el,
    line: () => lines[i]!,
    step,
    done: () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    },
  };
}

/**
 * Resolve after the browser has painted, so a loading line shows before the next blocking step.
 * A background tab gets no animation frames, so a short timer stands in and loading carries on.
 */
export function afterPaint(): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    setTimeout(go, 100);
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => setTimeout(go, 0));
  });
}
