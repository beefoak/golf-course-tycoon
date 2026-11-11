import { Game } from '../../sim/game';
import { holePar } from '../../sim/course/yardage';
import { teeSheetFor } from '../../sim/golfers/demand';
import { greenFee, roundOptions } from '../../sim/golfers/teeSheet';
import { statsFor } from '../../sim/golfers/roundEffects';
import { clubhouseOf } from '../../sim/business/buildings';
import { DEFAULT_BANDS, DEFAULT_WEEKEND, bandAt, hasManager, priceFor } from '../../sim/business/pricing';
import { MembershipTier, membershipsOf } from '../../sim/business/memberships';
import { ratingOf } from '../../sim/rating/courseRating';
import { Command } from '../../sim/commands';
import { h, money } from '../dom';
import { INPUT_STYLE } from '../tools/panelTool';

/** Course overview: green fees, today's tee sheet, per-hole scoring and pace. */
export function statsPanel(g: Game, courseId: number, refresh: () => void): HTMLElement {
  const course = g.courses.get(courseId);
  if (!course) return h('div', { class: 'muted' }, 'No course yet — draw a hole with the Fairway Pen.');
  const st = statsFor(g, courseId);
  const opts = roundOptions(course);
  const pricing = g.pricing.get(courseId);
  const sheet = teeSheetFor(g, courseId);
  const golfersToday = sheet.golfers.get(g.day) ?? 0;
  const onCourse = g.groups.filter(x => x.courseId === courseId && x.started && x.phase !== 'done').length;
  const fees = g.ledger.totals(Math.max(0, g.day - 6), g.day, courseId).greenFees.in;

  const feeRows = opts.map(len => {
    const input = h('input', { type: 'number', min: 0, max: 1000, step: 1, value: greenFee(pricing, len), style: 'width:70px;background:var(--panel-2);color:var(--text);border:2px solid var(--line);font:inherit;padding:2px',
      onchange: (e: Event) => {
        const r = g.dispatch({ t: 'setGreenFee', courseId, holes: len, fee: Number((e.target as HTMLInputElement).value) });
        if (!r.ok) g.notify('warn', r.reason);
        refresh();
      } });
    return h('div', { class: 'row' }, h('span', { class: 'muted' }, `${len}-hole green fee $`), input);
  });

  const rating = ratingOf(g, courseId);
  const holeRows = course.holes.slice().sort((a, b) => a.number - b.number).map(hole => {
    const n = st.playedCount(hole.id);
    const vs = st.holeAvgVsPar(hole.id);
    return h('tr', null,
      h('td', null, `#${hole.number}`),
      h('td', null, String(holePar(hole))),
      h('td', null, String(rating?.strokeIndex[hole.id] ?? '—')),
      h('td', null, n ? st.holeAverage(hole.id).toFixed(2) : '—'),
      h('td', { style: n ? (vs > 0.8 ? 'color:var(--bad)' : vs < 0.2 ? 'color:var(--accent)' : '') : '' }, n ? `${vs >= 0 ? '+' : ''}${vs.toFixed(2)}` : ''),
      h('td', null, n ? `${Math.round(st.threePuttRate(hole.id) * 100)}%` : ''),
      h('td', null, st.holeMinutes(hole.id) ? `${Math.round(st.holeMinutes(hole.id))}m` : ''));
  });
  const run = (c: Command) => { const r = g.dispatch(c); if (!r.ok) g.notify('warn', r.reason); refresh(); };
  const pct = (v: number, on: (n: number) => void) => h('input', { type: 'number', min: 30, max: 200, step: 5, value: Math.round(v * 100), style: `width:56px;${INPUT_STYLE}`,
    onchange: (e: Event) => on(Number((e.target as HTMLInputElement).value) / 100) });
  const bands = pricing?.bands ?? DEFAULT_BANDS;
  const setBand = (k: keyof typeof bands) => (n: number) => run({ t: 'setPricing', courseId, patch: { bands: { ...bands, [k]: n } } });
  const nowLen = opts[opts.length - 1];
  const pricingRows = opts.length ? [
    h('label', null, 'Price bands (% of base fee)'),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Peak 07–11'), pct(bands.peak, setBand('peak'))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Off-peak'), pct(bands.offPeak, setBand('offPeak'))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Twilight from 17:00'), pct(bands.twilight, setBand('twilight'))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Weekends'), pct(pricing?.weekendMult ?? DEFAULT_WEEKEND, n => run({ t: 'setPricing', courseId, patch: { weekendMult: n } }))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Dynamic pricing'),
      h('span', null,
        h('input', { type: 'checkbox', checked: !!pricing?.dynamic, disabled: !hasManager(g, courseId) && !pricing?.dynamic, onchange: (e: Event) => run({ t: 'setPricing', courseId, patch: { dynamic: (e.target as HTMLInputElement).checked } }) }),
        pricing?.dynamic ? ` ${Math.round(((pricing.dynamicMult ?? 1) - 1) * 100)}%` : '')),
    !hasManager(g, courseId) ? h('div', { class: 'muted' }, 'Hire a general manager to steer prices toward a full tee sheet each week.') : null,
    nowLen ? h('div', { class: 'row' }, h('span', { class: 'muted' }, `Now (${bandAt(g.clock.minuteOfDay)})`), h('span', null, `${money(priceFor(g, course, g.day, g.clock.minuteOfDay, nowLen))} for ${nowLen} holes`)) : null,
  ] : [];

  const ms = membershipsOf(g, courseId);
  const memberIncome = g.ledger.totals(Math.max(0, g.day - 111), g.day, courseId).memberships.in;
  const tierRow = (t: MembershipTier, i: number) => {
    const set = (patch: Partial<MembershipTier>) => run({ t: 'setMembershipTier', courseId, index: i, tier: { ...t, ...patch } });
    const n = ms.members.filter(x => x.tier === i).length;
    return h('div', { style: 'border-top:1px solid var(--line);padding:3px 0' },
      h('div', { class: 'row' },
        h('input', { value: t.name, style: `width:110px;${INPUT_STYLE}`, onchange: (e: Event) => set({ name: (e.target as HTMLInputElement).value }) }),
        h('span', null, `${n} member${n === 1 ? '' : 's'} `,
          h('button', { class: 'btn', title: 'Remove tier', onclick: () => run({ t: 'setMembershipTier', courseId, index: i, tier: null }) }, '✕'))),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Annual fee $'),
        h('input', { type: 'number', min: 0, step: 50, value: t.annualFee, style: `width:70px;${INPUT_STYLE}`, onchange: (e: Event) => set({ annualFee: Number((e.target as HTMLInputElement).value) }) })),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Tee times held a day'),
        h('input', { type: 'number', min: 0, max: 30, step: 1, value: t.reservedSlotsPerDay, style: `width:50px;${INPUT_STYLE}`, onchange: (e: Event) => set({ reservedSlotsPerDay: Number((e.target as HTMLInputElement).value) }) })),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Free rounds a year'),
        h('input', { placeholder: 'unlimited', value: t.includedRounds === 'unlimited' ? '' : t.includedRounds, style: `width:70px;${INPUT_STYLE}`,
          onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value.trim(); set({ includedRounds: v === '' ? 'unlimited' : Number(v) }); } })));
  };
  const memberRows = [
    h('label', null, 'Memberships'),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Members'), h('span', null, `${ms.members.length} · ${money(memberIncome)} this year`)),
    ...ms.tiers.map(tierRow),
    ms.tiers.length < 4 ? h('button', { class: 'btn', onclick: () => run({ t: 'setMembershipTier', courseId, index: ms.tiers.length, tier: { name: ms.tiers.length ? `Tier ${ms.tiers.length + 1}` : 'Full', annualFee: 1500, reservedSlotsPerDay: 3, includedRounds: 'unlimited' } }) }, '+ Add tier') : null,
    h('div', { class: 'muted' }, 'Regulars who rate the course highly may join. Members play the held tee times; renewals come yearly if they still like it.'),
  ];
  const hardest = st.hardestHoles(3).map(id => g.courses.hole(id)).filter(Boolean);
  const avgRound = st.avgRoundMinutes();

  return h('div', null,
    h('h3', null, course.name),
    !clubhouseOf(g, courseId) ? h('div', { class: 'warnline' }, 'No clubhouse yet — golfers won\'t come. Build one next to the road.') : null,
    !opts.length ? h('div', { class: 'warnline' }, 'No open holes yet.') : null,
    ...feeRows,
    ...pricingRows,
    ...memberRows,
    h('label', null, 'Today'),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Booked today'), h('span', null, `${golfersToday} golfers`)),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Groups on course'), h('span', null, String(onCourse))),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Green fees (7 days)'), h('span', null, money(fees))),
    rating ? h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Course rating / slope'), h('span', null, `${rating.courseRating.toFixed(1)} / ${rating.slope}`)) : null,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Avg round'), h('span', null, avgRound ? `${Math.floor(avgRound / 60)}h ${Math.round(avgRound % 60)}m` : '—')),
    h('label', null, 'Scoring (last 28 days)'),
    h('table', { class: 'grid' }, h('tr', null, h('th', null, 'Hole'), h('th', null, 'Par'), h('th', { title: 'Stroke index (1 = hardest)' }, 'SI'), h('th', null, 'Avg'), h('th', null, '±'), h('th', null, '3-putt'), h('th', null, 'Time')), ...holeRows),
    hardest.length ? h('div', { class: 'muted', style: 'margin-top:6px' }, `Hardest: ${hardest.map(x => `#${x!.number}`).join(', ')}`) : null,
  );
}
