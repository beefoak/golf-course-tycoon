import { Command } from '../../sim/commands';
import { Game } from '../../sim/game';
import { ADDON_COST, BAY_RATE_PER_HOUR, FITTING_FEE, ITEM_LABEL, LESSON_FEE, MAX_BAYS, effectiveWholesale, proShopOf, simulatorHours } from '../../sim/business/proShop';
import { h, money } from '../dom';
import { INPUT_STYLE, PanelTool, panelTool } from '../tools/panelTool';

/** Pro shop: stock and prices, auto-reorder, add-ons (fitting, simulators, own apparel) and the day's takings. */
export function proShopTool(g: Game): PanelTool {
  return panelTool(g, 'proShop', 'Pro shop', refresh => {
    const courseId = g.courses.list[0]?.id ?? 0;
    const shop = proShopOf(g, courseId);
    if (!shop) return h('div', null, h('h3', null, 'Pro shop'), h('div', { class: 'muted' }, 'Build a pro shop onto the clubhouse first (Amenities, N).'));
    const run = (c: Command, okText?: string) => {
      const r = g.dispatch(c);
      if (!r.ok) g.notify('warn', r.reason);
      else if (okText) g.notify('info', okText);
      refresh();
    };
    const num = (v: number, w: number, on: (n: number) => void, title: string) =>
      h('input', { type: 'number', value: v, title, style: `width:${w}px;${INPUT_STYLE}`, onchange: (e: Event) => on(Number((e.target as HTMLInputElement).value)) });
    const t = shop.today, y = shop.yesterday;
    const rows = shop.stock.map(l => h('tr', null,
      h('td', null, ITEM_LABEL[l.cat]),
      h('td', { style: l.qty === 0 ? 'color:var(--warn)' : '' }, String(l.qty)),
      h('td', { class: 'muted' }, money(effectiveWholesale(shop, l))),
      h('td', null, num(l.retail, 56, n => run({ t: 'setStockLine', courseId, cat: l.cat, patch: { retail: n } }), 'Retail price')),
      h('td', null, num(l.reorderAt, 40, n => run({ t: 'setStockLine', courseId, cat: l.cat, patch: { reorderAt: n } }), 'Reorder when stock falls to'),
        num(l.reorderQty, 44, n => run({ t: 'setStockLine', courseId, cat: l.cat, patch: { reorderQty: n } }), 'Reorder this many')),
      h('td', null, h('button', { class: 'btn', title: `Order ${l.reorderQty || 10} now`, onclick: () => run({ t: 'orderStock', courseId, cat: l.cat, qty: l.reorderQty || 10 }) }, '+'))));
    const has = (a: string) => shop.addons.includes(a as never);
    return h('div', null,
      h('h3', null, 'Pro shop'),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Today'), h('span', null, `${t.sales} sales · ${money(t.revenue)}${t.lost ? ` · ${t.lost} lost (sold out)` : ''}`)),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Yesterday'), h('span', null, `${y.sales} sales · ${money(y.revenue)}`)),
      h('label', null, 'Stock'),
      h('table', { class: 'grid' }, h('tr', null, h('th', null, 'Item'), h('th', null, 'Qty'), h('th', null, 'Cost'), h('th', null, 'Price'), h('th', null, 'Reorder at / qty'), h('th', null, '')), ...rows),
      h('div', { class: 'muted' }, 'Stock reorders overnight at cost. A 2× markup is the norm; more makes each sale pay but fewer people buy.'),
      h('label', null, 'Add-ons'),
      h('div', { class: 'row' }, h('span', null, `Club fitting (${money(FITTING_FEE)} each, club sales +60%)`),
        has('fitting') ? h('span', { class: 'muted' }, '✓') : h('button', { class: 'btn', onclick: () => run({ t: 'buyProShopAddon', courseId, addon: 'fitting' }, 'Fitting bay open') }, money(ADDON_COST.fitting))),
      h('div', { class: 'row' }, h('span', null, 'Own apparel line (−25% cost on apparel & hats)'),
        has('apparelLine') ? h('span', { class: 'muted' }, '✓') : h('button', { class: 'btn', onclick: () => run({ t: 'buyProShopAddon', courseId, addon: 'apparelLine' }, 'Apparel line launched') }, money(ADDON_COST.apparelLine))),
      h('div', { class: 'row' }, h('span', null, `Simulator bays: ${shop.bays}/${MAX_BAYS} (${money(BAY_RATE_PER_HOUR)}/h)`),
        shop.bays < MAX_BAYS ? h('button', { class: 'btn', onclick: () => run({ t: 'setSimulatorBays', courseId, bays: shop.bays + 1 }, 'Simulator bay added') }, `+1 ${money(ADDON_COST.simulator)}`) : h('span', { class: 'muted' }, 'full')),
      shop.bays ? h('div', { class: 'muted' }, `Today's weather: about ${Math.round(simulatorHours(g, shop))} bay-hours (busier when it's wet, cold or the course is shut)`) : null,
      h('label', null, 'Lessons'),
      h('div', { class: 'muted' }, `A head pro teaches up to 6 lessons a day at ${money(LESSON_FEE)}; regular students' handicaps come down. Today: ${t.lessons}${t.fittings ? ` · fittings ${t.fittings}` : ''}.`));
  }, 2000);
}
