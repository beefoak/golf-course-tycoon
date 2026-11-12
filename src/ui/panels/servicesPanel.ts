import { activeCourseId } from '../../sim/course/active';
import { Command } from '../../sim/commands';
import { Game } from '../../sim/game';
import { CART_PRICE, RANGE_BUCKET, cartCapacity, cartPathOnly, fleetOf } from '../../sim/business/carts';
import { coversPerHour, fnbOf } from '../../sim/business/fnb';
import { h, money } from '../dom';
import { INPUT_STYLE, PanelTool, panelTool } from '../tools/panelTool';

/** Food & drink prices, the cart fleet and fee, and the range bucket price. */
export function servicesTool(g: Game): PanelTool {
  return panelTool(g, 'services', 'Services', refresh => {
    const courseId = activeCourseId(g);
    const has = (k: string) => g.buildings.some(b => (b.kind as string) === k && b.courseId === courseId);
    const run = (c: Command, okText?: string) => {
      const r = g.dispatch(c);
      if (!r.ok) g.notify('warn', r.reason);
      else if (okText) g.notify('info', okText);
      refresh();
    };
    const num = (v: number, w: number, step: number, on: (n: number) => void) =>
      h('input', { type: 'number', value: v, step, style: `width:${w}px;${INPUT_STYLE}`, onchange: (e: Event) => on(Number((e.target as HTMLInputElement).value)) });
    const row = (k: string, ...v: (Node | string)[]) => h('div', { class: 'row' }, h('span', { class: 'muted' }, k), h('span', null, ...v));
    const f = fnbOf(g, courseId);
    const fleet = fleetOf(g, courseId);
    return h('div', null,
      h('h3', null, 'Services'),
      h('label', null, 'Food & drink'),
      has('halfwayHouse') || has('restaurant')
        ? h('div', null,
          row('Menu prices %', num(Math.round(f.priceMult * 100), 60, 5, n => run({ t: 'setMenuPrices', courseId, mult: n / 100 }))),
          row('Today', `${f.today.covers} covers · ${f.today.drinks} snacks · ${money(f.today.revenue)}`),
          row('Yesterday', `${f.yesterday.covers} covers · ${money(f.yesterday.revenue)}${f.yesterday.slow ? ` · ${f.yesterday.slow} slow` : ''}`),
          has('restaurant') ? row('Kitchen', `${coversPerHour(g, courseId)} covers/hour (hire F&B staff for more)`) : null,
          has('halfwayHouse') ? h('div', { class: 'muted' }, 'The halfway house serves at the turn of 10+ hole rounds, and stocks drink stations near greens.') : null)
        : h('div', { class: 'muted' }, 'Build a halfway house or restaurant (Amenities, N).'),
      h('label', null, 'Carts'),
      row('Fleet', `${fleet.count}/${cartCapacity(g, courseId)} · ${Math.round(fleet.condition)}% condition`),
      row('Fee per rider $', num(fleet.feePerRider, 60, 1, n => run({ t: 'setCartFee', courseId, fee: n }))),
      row('Today', `${fleet.today.riders} riders · ${money(fleet.today.revenue)}`),
      cartPathOnly(g, courseId) ? h('div', { class: 'warnline' }, 'Cart path only — the turf is too wet') : null,
      h('div', { style: 'display:flex;gap:3px;margin-top:3px' },
        h('button', { class: 'btn', onclick: () => run({ t: 'buyCarts', courseId, n: 1 }, 'Cart bought') }, `+1 ${money(CART_PRICE)}`),
        h('button', { class: 'btn', onclick: () => run({ t: 'buyCarts', courseId, n: 5 }, '5 carts bought') }, `+5 ${money(CART_PRICE * 5)}`)),
      h('label', null, 'Driving range'),
      has('range')
        ? row('Bucket price $', num(g.rangeBucket.get(courseId) ?? RANGE_BUCKET, 60, 1, n => run({ t: 'setRangeBucket', courseId, price: n })))
        : h('div', { class: 'muted' }, 'Build a driving range (Amenities, N). A warm-up bucket helps golfers play a little better and enjoy it more.'));
  }, 2000);
}
