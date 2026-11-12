import { UiContext } from './context';
import { h } from './dom';
import { Tool } from './tools/tool';

/** hint: one line on what the tool is for (the button's tooltip) */
export interface ToolEntry { make: () => Tool; hotkey?: string; hint?: string }

/** Left toolbar: one button per tool; clicking the active tool again deselects it. */
export function createToolbar(ctx: UiContext, entries: ToolEntry[]): HTMLElement {
  const el = h('div', { class: 'panel toolbar' });
  const items = entries.map(e => ({ tool: e.make(), hotkey: e.hotkey, hint: e.hint }));
  const toggle = (t: Tool) => ctx.tools.setTool(ctx.tools.active === t ? null : t);
  const buttons = items.map(({ tool, hotkey, hint }) => {
    const title = `${tool.label}${hotkey ? ` (${hotkey.toUpperCase()})` : ''}${hint ? ` — ${hint}` : ''}`;
    const b = h('button', { class: 'btn', title, onclick: () => toggle(tool) }, tool.label);
    el.appendChild(b);
    return b;
  });
  window.addEventListener('keydown', ev => {
    if ((ev.target as HTMLElement)?.tagName === 'INPUT' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const it = items.find(x => x.hotkey && x.hotkey.toLowerCase() === ev.key.toLowerCase());
    if (it) toggle(it.tool);
  });
  ctx.tools.onChange(active => {
    items.forEach((it, i) => buttons[i]!.classList.toggle('on', it.tool === active));
    const panel = active?.panel?.() ?? null;
    if (panel) ctx.inspector.show(active, panel);
    else ctx.inspector.hide();
  });
  return el;
}
