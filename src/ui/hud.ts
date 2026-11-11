import { Speed } from '../sim/loop';
import { UiContext } from './context';
import { h, money } from './dom';
import { WeatherKind } from '../sim/turf/weather';

const ICON: Record<WeatherKind, string> = { sunny: '☀', cloudy: '☁', rain: '🌧', storm: '⛈', heatwave: '🔥', frost: '❄', windy: '🌬' };

const SPEEDS: { s: Speed; label: string; key: string }[] = [
  { s: 0, label: '⏸', key: ' ' },
  { s: 1, label: '▶', key: '1' },
  { s: 2, label: '▶▶', key: '2' },
  { s: 4, label: '▶▶▶', key: '3' },
  { s: 8, label: '8×', key: '4' },
];

export function createHud(ctx: UiContext): { el: HTMLElement; refresh(): void } {
  const cash = h('span', { class: 'cash px' });
  const date = h('span', { class: 'px' });
  const weather = h('span', { class: 'px' });
  const buttons = SPEEDS.map(sp => h('button', { class: 'btn', title: `Speed ${sp.s}× (${sp.key === ' ' ? 'Space' : sp.key})`, onclick: () => setSpeed(sp.s) }, sp.label));
  let lastSpeed: Speed = 1;
  const setSpeed = (s: Speed) => {
    if (s !== 0) lastSpeed = s;
    ctx.loop.speed = s;
    refresh();
  };
  window.addEventListener('keydown', e => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); setSpeed(ctx.loop.speed === 0 ? lastSpeed : 0); return; }
    const sp = SPEEDS.find(x => x.key === e.key && x.s !== 0);
    if (sp) setSpeed(sp.s);
  });
  const el = h('div', { class: 'panel hud' },
    h('span', { class: 'px', style: 'color:#cfe8b0' }, '⛳ Golf Course Tycoon'),
    cash, date, weather, h('span', { class: 'spacer' }), ...buttons);
  const refresh = () => {
    const g = ctx.game;
    cash.textContent = g.ledger.unlimited ? '$∞' : money(g.ledger.cash);
    cash.classList.toggle('neg', !g.ledger.unlimited && g.ledger.cash < 0);
    const season = g.clock.season[0]!.toUpperCase() + g.clock.season.slice(1);
    date.textContent = `Day ${g.clock.day} · ${season} · Y${g.clock.year} · ${g.clock.timeString()}`;
    const w = g.weather;
    const wind = Math.round(Math.hypot(w.wind.x, w.wind.y));
    weather.textContent = `${ICON[w.kind]} ${Math.round(w.tempC)}°C · wind ${wind} m/s`;
    weather.title = `Today: ${w.kind}, ${Math.round(w.lowC)}–${Math.round(w.highC)}°C${w.rainMm ? `, ${w.rainMm} mm rain` : ''}
Forecast: ${w.forecast.map(d => `${ICON[d.kind]} ${Math.round(d.highC)}°`).join('  ')}`;
    buttons.forEach((b, i) => b.classList.toggle('on', SPEEDS[i]!.s === ctx.loop.speed));
  };
  refresh();
  return { el, refresh };
}
