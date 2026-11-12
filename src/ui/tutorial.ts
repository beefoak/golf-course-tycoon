import type { Command } from '../sim/commands';
import type { Game } from '../sim/game';
import { h } from './dom';

export interface TutorialStep {
  id: string;
  title: string;
  text: string;
  /** done when the game reaches this state, or once a matching command has worked */
  done: (g: Game, seen: (t: Command['t'], pred?: (c: Command) => boolean) => boolean) => boolean;
}

const owned = (g: Game) => { let n = 0; for (const o of g.parcels.owner) if (o) n++; return n; };
const holes = (g: Game) => g.courses.allHoles();

/** The guided first hole: buy land, pen a par 3, place pins, seed, hire, build the clubhouse, open. */
export const TUTORIAL_STEPS: TutorialStep[] = [
  { id: 'land', title: 'Buy some land', text: 'Press L for the Land tool and click two parcels next to the road at the bottom of the map. The price shows as you hover.',
    done: g => owned(g) >= 2 },
  { id: 'pen', title: 'Pen a par 3', text: 'Press F for the Pen tool. Click a tee spot, then click a green spot 120–180 yards away (the readout shows the yardage), and confirm. Keep it on your land.',
    done: g => holes(g).length > 0 },
  { id: 'pins', title: 'Place the pins', text: 'Press G for the Green tool in Pins mode and click 4–6 spots on the green (shift-click removes one). Varied pins spread the wear.',
    done: (_g, seen) => seen('setPins') },
  { id: 'seed', title: 'Seed the hole', text: 'Press H for the Holes tool, select your hole and choose Seed (cheap, 21 days) or Sod (dear, 3 days). New turf needs moist soil to knit in.',
    done: g => holes(g).some(h => h.state === 'growingIn' || h.state === 'open') },
  { id: 'hire', title: 'Hire a greenkeeper', text: 'Press E for Staff and hire a greenkeeper from the candidates. They mow, change cups and rake bunkers every morning.',
    done: g => g.staff.all.some(s => s.role === 'greenkeeper') },
  { id: 'clubhouse', title: 'Build a clubhouse', text: 'Press C for the Clubhouse tool and place it beside the road. Golfers check in there, and without one nobody comes.',
    done: g => g.buildings.some(b => b.kind === 'clubhouse') },
  { id: 'open', title: 'Open for play', text: 'Speed up time with keys 1–4 until the grow-in finishes. The hole opens by itself and the first golfers book tee times.',
    done: g => holes(g).some(h => h.state === 'open') },
];

export interface Tutorial {
  el: HTMLElement;
  /** index of the current step (TUTORIAL_STEPS.length when finished) */
  step(): number;
  /** re-check the current step (called on commands and every game minute) */
  check(): void;
  close(): void;
}

/** Step cards in the corner; each waits for its command or state, then moves on. */
export function startTutorial(root: HTMLElement, g: Game, onClose?: () => void): Tutorial {
  const seenCmds: { cmd: Command; ok: boolean }[] = [];
  const seen = (t: Command['t'], pred?: (c: Command) => boolean) => seenCmds.some(x => x.ok && x.cmd.t === t && (!pred || pred(x.cmd)));
  let idx = 0;
  let closed = false;
  const el = h('div', { class: 'panel tutorial' });
  const render = () => {
    if (idx >= TUTORIAL_STEPS.length) {
      el.replaceChildren(
        h('div', { class: 'row' }, h('b', null, 'Tutorial complete'), h('span', { class: 'muted' }, `${TUTORIAL_STEPS.length}/${TUTORIAL_STEPS.length}`)),
        h('div', null, 'Your first hole is open. Watch the golfers (click one to follow), check the Course panel (O) and keep building. Press ? for every shortcut.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn on', onclick: close }, 'Close')));
      return;
    }
    const s = TUTORIAL_STEPS[idx]!;
    el.replaceChildren(
      h('div', { class: 'row' }, h('b', null, s.title), h('span', { class: 'muted' }, `${idx + 1}/${TUTORIAL_STEPS.length}`)),
      h('div', null, s.text),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: close }, 'Skip tutorial')));
  };
  const check = () => {
    if (closed) return;
    let moved = false;
    while (idx < TUTORIAL_STEPS.length && TUTORIAL_STEPS[idx]!.done(g, seen)) { idx++; moved = true; }
    if (moved) { render(); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }
  };
  const offs = [
    g.events.on('command', e => { seenCmds.push(e); check(); }),
    g.events.on('minute', check),
  ];
  function close(): void {
    closed = true;
    for (const off of offs) off();
    el.remove();
    onClose?.();
  }
  render();
  check();
  root.appendChild(el);
  return { el, step: () => idx, check, close };
}
