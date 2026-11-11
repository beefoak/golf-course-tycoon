import { Notification } from '../sim/game';
import { UiContext } from './context';
import { h } from './dom';

const LIFETIME_MS = 5000;
const MAX_TOASTS = 5;

export function createNotifications(ctx: UiContext): HTMLElement {
  const el = h('div', { class: 'toasts' });
  ctx.game.events.on('notify', (n: Notification) => {
    const toast = h('div', {
      class: `panel toast ${n.kind}`,
      title: n.at ? 'Click to jump there' : '',
      onclick: () => {
        if (n.at) { ctx.camera.x = n.at.x; ctx.camera.y = n.at.y; }
        toast.remove();
      },
    }, n.text);
    el.prepend(toast);
    while (el.children.length > MAX_TOASTS) el.lastElementChild?.remove();
    setTimeout(() => toast.remove(), LIFETIME_MS);
  });
  return el;
}
