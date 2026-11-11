import { OVERLAYS, OVERLAY_LABELS, OverlayId } from '../render/overlays';
import { UiContext } from './context';
import { h } from './dom';

export function createOverlayBar(ctx: UiContext): { el: HTMLElement; current(): OverlayId | null; set(id: OverlayId | null): void; refresh(): void } {
  let current: OverlayId | null = null;
  const buttons = new Map<OverlayId, HTMLButtonElement>();
  const contours = h('button', { class: 'btn', title: 'Contour lines every 1 m', onclick: () => { ctx.chunks.setContours(!ctx.chunks.contours); contours.classList.toggle('on', ctx.chunks.contours); } }, 'Contours');
  const set = (id: OverlayId | null) => {
    current = id;
    ctx.chunks.setOverlay(id ? OVERLAYS[id](ctx.game) : null);
    for (const [k, b] of buttons) b.classList.toggle('on', k === id);
  };
  const row = h('div', { class: 'overlays' }, h('span', { class: 'muted', style: 'align-self:center;margin-right:6px' }, 'Overlays:'));
  for (const id of Object.keys(OVERLAYS) as OverlayId[]) {
    const b = h('button', { class: 'btn', onclick: () => set(current === id ? null : id) }, OVERLAY_LABELS[id]);
    buttons.set(id, b);
    row.appendChild(b);
  }
  row.appendChild(contours);
  return { el: row, current: () => current, set, refresh: () => { if (current) set(current); } };
}
