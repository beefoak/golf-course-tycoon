import { activeCourseId } from '../../sim/course/active';
import { Command } from '../../sim/commands';
import { Game } from '../../sim/game';
import { LOAN_TERMS, MISSED_LIMIT, loanLimit, outstanding } from '../../sim/economy/loans';
import { TxCategory } from '../../sim/economy/ledger';
import { DEPT_LABEL, Period, cashFlowSeries, costByDepartment, incomeStatement, perHoleEconomics } from '../../sim/economy/reports';
import { DAYS_PER_YEAR } from '../../sim/clock';
import { h, money } from '../dom';
import { INPUT_STYLE, PanelTool, panelTool, tabs } from '../tools/panelTool';

type Tab = 'statement' | 'cash' | 'loans' | 'holes';

export const CAT_LABEL: Partial<Record<TxCategory, string>> = {
  greenFees: 'Green fees', proShop: 'Pro shop', fnb: 'Food & drink', carts: 'Carts', range: 'Driving range', lessons: 'Lessons',
  simulator: 'Simulators', memberships: 'Memberships', events: 'Events',
};
const PERIOD_LABEL: Record<Period, string> = { day: 'Day', month: 'Season', year: 'Year' };

/** Cash over time: a simple line on a canvas, zero marked when the line dips below it. */
export function cashChart(series: number[], w = 300, ht = 120): HTMLElement {
  const c = h('canvas', { width: w, height: ht, style: `width:${w}px;height:${ht}px;background:var(--panel-2);border:2px solid var(--line)` }) as HTMLCanvasElement;
  const ctx = c.getContext?.('2d');
  if (!ctx || series.length < 2) return series.length < 2 ? h('div', { class: 'muted' }, 'The chart fills in as the days go by.') : c;
  const css = getComputedStyle(document.documentElement);
  const lo = Math.min(0, ...series), hi = Math.max(...series, 1);
  const y = (v: number) => ht - 6 - (v - lo) / (hi - lo || 1) * (ht - 12);
  const x = (k: number) => 4 + k * (w - 8) / (series.length - 1);
  if (lo < 0) {
    ctx.strokeStyle = css.getPropertyValue('--bad') || '#ef6b5b';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(w, y(0)); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = css.getPropertyValue('--accent') || '#8fd16a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  series.forEach((v, k) => (k ? ctx.lineTo(x(k), y(v)) : ctx.moveTo(x(k), y(v))));
  ctx.stroke();
  return c;
}

/** Income statement, cash chart, loans and per-hole economics. */
export function financeTool(g: Game): PanelTool {
  let tab: Tab = 'statement';
  let period: Period = 'month';
  let offset = 0;
  let loanAmount = 100_000;
  let loanTerm = LOAN_TERMS[1]!;
  return panelTool(g, 'finance', 'Finance', refresh => {
    const run = (c: Command, okText?: string) => {
      const r = g.dispatch(c);
      if (!r.ok) g.notify('warn', r.reason); else if (okText) g.notify('info', okText);
      refresh();
    };
    const row = (k: string, v: string, style = '') => h('div', { class: 'row' }, h('span', { class: 'muted' }, k), h('span', { style }, v));
    const courseId = activeCourseId(g);
    const f = g.finance;
    const head = h('div', null,
      h('h3', null, 'Finance'),
      row('Cash', g.ledger.unlimited ? 'Unlimited' : money(g.ledger.cash), g.ledger.cash < 0 ? 'color:var(--bad)' : ''),
      f.loans.length ? row('Loans owed', money(outstanding(g))) : null,
      f.gameOver ? h('div', { class: 'warnline' }, f.gameOver) : f.missedPayments ? h('div', { class: 'warnline' }, `Missed loan payments: ${f.missedPayments}/${MISSED_LIMIT}`) : null,
      tabs<Tab>([{ value: 'statement', text: 'Statement' }, { value: 'cash', text: 'Cash' }, { value: 'loans', text: 'Loans' }, { value: 'holes', text: 'Holes' }], () => tab, v => { tab = v; refresh(); }));

    let body: HTMLElement;
    if (tab === 'statement') {
      const s = incomeStatement(g, null, period, offset);
      const depts = costByDepartment(g, s.from, s.to);
      const span = s.from === s.to ? `Day ${s.from}` : `Days ${s.from}–${s.to}`;
      body = h('div', null,
        h('div', { style: 'display:flex;gap:3px;align-items:center;flex-wrap:wrap' },
          ...(['day', 'month', 'year'] as Period[]).map(p => h('button', { class: `btn${p === period ? ' on' : ''}`, onclick: () => { period = p; offset = 0; refresh(); } }, PERIOD_LABEL[p])),
          h('button', { class: 'btn', title: 'Earlier', disabled: s.from <= 1, onclick: () => { offset++; refresh(); } }, '◀'),
          h('button', { class: 'btn', title: 'Later', disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - 1); refresh(); } }, '▶'),
          h('span', { class: 'muted' }, span)),
        h('label', null, 'Revenue'),
        ...Object.entries(s.revenue).map(([k, v]) => row(CAT_LABEL[k as TxCategory] ?? k, money(v!))),
        row('Total revenue', money(s.totalRevenue), 'font-weight:bold'),
        h('label', null, 'Running costs'),
        ...Object.entries(depts).sort((a, b) => b[1] - a[1]).map(([k, v]) => row(DEPT_LABEL[k] ?? k, money(v))),
        row('Total running costs', money(s.totalOperating), 'font-weight:bold'),
        row('Operating profit', money(s.operatingProfit), `font-weight:bold;color:var(${s.operatingProfit < 0 ? '--bad' : '--accent'})`),
        h('label', null, 'Below the line'),
        row('Land, building & equipment', money(-s.capital)),
        row('Loans in/out', money(s.financing)),
        row('Change in cash', money(s.cashChange), 'font-weight:bold'));
    } else if (tab === 'cash') {
      const series = cashFlowSeries(g, DAYS_PER_YEAR);
      body = h('div', null,
        h('label', null, `Closing cash, last ${series.length} days`),
        cashChart(series),
        series.length ? row('Lowest', money(Math.min(...series))) : null,
        series.length ? row('Highest', money(Math.max(...series))) : null);
    } else if (tab === 'loans') {
      const limit = loanLimit(g);
      body = h('div', null,
        row('Bank will lend up to', money(limit)),
        h('div', { class: 'muted' }, 'Half the value of your land, buildings and open holes ($120k each), less what you already owe. Paid back daily; three days in the red while owing money and the bank calls it in.'),
        h('div', { style: 'display:flex;gap:3px;align-items:center;margin:4px 0;flex-wrap:wrap' },
          '$', h('input', { type: 'number', min: 1000, step: 10000, value: loanAmount, style: `width:90px;${INPUT_STYLE}`, onchange: (e: Event) => { loanAmount = Number((e.target as HTMLInputElement).value); } }),
          h('select', { style: INPUT_STYLE, onchange: (e: Event) => { loanTerm = Number((e.target as HTMLSelectElement).value); } },
            ...LOAN_TERMS.map(t => h('option', { value: t, selected: t === loanTerm }, `${t / DAYS_PER_YEAR} year${t > DAYS_PER_YEAR ? 's' : ''}`))),
          h('button', { class: 'btn', disabled: limit < 1000, onclick: () => run({ t: 'takeLoan', amount: loanAmount, termDays: loanTerm }, `Borrowed ${money(loanAmount)}`) }, 'Borrow')),
        ...f.loans.map(l => h('div', { style: 'border-top:1px solid var(--line);padding:3px 0' },
          row(`Loan #${l.id} · ${(l.ratePerYear * 100).toFixed(0)}%`, `${money(l.remaining)} of ${money(l.principal)}`),
          row('Daily payment', `${money(l.dailyPayment)} · ends day ${l.takenDay + l.termDays}`),
          h('button', { class: 'btn', onclick: () => run({ t: 'repayLoan', id: l.id }, 'Loan repaid') }, `Repay ${money(l.remaining)}`))),
        !f.loans.length ? h('div', { class: 'muted' }, 'No loans.') : null);
    } else {
      const eco = perHoleEconomics(g, courseId);
      body = eco.length
        ? h('div', null,
          h('label', null, 'Last 28 days'),
          h('table', { class: 'grid' },
            h('tr', null, h('th', null, 'Hole'), h('th', null, 'Golfers'), h('th', null, 'Fees'), h('th', null, 'Upkeep'), h('th', null, 'Net')),
            ...eco.map(e => {
              const net = e.revenueShare - e.maintenanceCost;
              return h('tr', null, h('td', null, `#${e.number}`), h('td', null, String(e.roundsPlayed)), h('td', null, money(e.revenueShare)), h('td', null, money(e.maintenanceCost)),
                h('td', { style: net < 0 ? 'color:var(--bad)' : '' }, money(net)));
            })),
          h('div', { class: 'muted' }, 'Green fees are split evenly over the holes each round plays; upkeep is crew time and supplies spent on the hole.'))
        : h('div', { class: 'muted' }, 'No holes yet.');
    }
    return h('div', null, head, body);
  }, 2000);
}
