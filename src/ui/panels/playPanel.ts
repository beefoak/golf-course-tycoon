import type { Graphics } from 'pixi.js';
import { Vec2 } from '../../core/geom';
import { TILE_PX } from '../../render/camera';
import { PlayMode } from '../../play/playMode';
import { ACCURACY_ZONE, METER_MAX, SwingMeter } from '../../play/swing';
import { TeeKind } from '../../sim/course/course';
import { activeCourseId } from '../../sim/course/active';
import type { Game } from '../../sim/game';
import type { Speed } from '../../sim/loop';
import { slopeAt } from '../../sim/world/slope';
import { Surface } from '../../sim/world/tiles';
import { h } from '../dom';
import { INPUT_STYLE } from '../tools/panelTool';
import { Tool } from '../tools/tool';

/** Play your own course: click to aim, Space three times to swing (start, power, accuracy). */
export function playTool(g: Game, loop: { speed: Speed }, onShot?: (putt: boolean) => void): Tool {
  let play: PlayMode | null = null;
  let handicap = 15;
  let tee: TeeKind = 'middle';
  let pause = true;
  let savedSpeed: Speed = 1;
  const box = h('div');
  const bar = h('div', { style: 'position:relative;height:16px;background:var(--panel-2);border:2px solid var(--line);margin:4px 0' });
  const marker = h('div', { style: 'position:absolute;top:-2px;width:3px;height:18px;background:#fff' });
  const powerMark = h('div', { style: 'position:absolute;top:0;width:2px;height:12px;background:var(--accent)' });
  const zone = h('div', { style: `position:absolute;top:0;height:12px;background:#ffffff33;left:${(ACCURACY_ZONE / (METER_MAX + ACCURACY_ZONE)) * 0}%` });
  bar.append(zone, powerMark, marker);
  const pct = (v: number) => `${((v + ACCURACY_ZONE) / (METER_MAX + ACCURACY_ZONE)) * 100}%`;
  zone.style.left = pct(-ACCURACY_ZONE); zone.style.width = `${(2 * ACCURACY_ZONE / (METER_MAX + ACCURACY_ZONE)) * 100}%`;

  let raf = 0, last = 0;
  /** Move the meter on by the real time since it was last moved (frames can be throttled or paused). */
  const catchUp = (now: number) => {
    const dt = last ? Math.min(3000, now - last) : 0;
    last = now;
    if (!play) return;
    const before = play.meter.phase;
    // small steps so the turn at the top of the sweep is exact
    for (let left = dt; left > 0; left -= 20) play.meter.update(Math.min(20, left));
    // the marker ran off the end: the swing plays itself out as a full miss
    if (before === 'accuracy' && play.meter.phase === 'done') { onShot?.(play.club.id === 'P'); play.swing(play.meter); play.meter = new SwingMeter(play.meter.speed); render(); }
  };
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    catchUp(now);
    if (!play) return;
    marker.style.left = pct(play.meter.t);
    powerMark.style.display = play.meter.phase === 'accuracy' || play.meter.phase === 'done' ? '' : 'none';
    powerMark.style.left = pct(play.meter.power);
  };

  const start = () => {
    const courseId = activeCourseId(g);
    play = new PlayMode(g, courseId, { handicap, tee });
    if (play.done) { g.notify('warn', 'Open some holes first — there is nothing to play'); play = null; return render(); }
    if (pause) { savedSpeed = loop.speed || 1; loop.speed = 0; }
    g.notify('info', play.teeTime !== null ? `You're on the tee — booked at ${Math.floor(play.teeTime / 60)}:${String(play.teeTime % 60).padStart(2, '0')}` : 'Teeing off');
    render();
  };
  const quit = () => {
    if (play) {
      const r = play.finish();
      if (r) g.notify('info', `Round saved: ${r.total} (${r.toPar >= 0 ? '+' : ''}${r.toPar}) over ${r.scores.length} holes`);
    }
    play = null;
    if (pause && loop.speed === 0) loop.speed = savedSpeed;
    render();
  };

  function render(): void {
    if (!play) {
      const rounds = g.playerRounds.filter(r => r.courseId === activeCourseId(g)).slice(-5).reverse();
      box.replaceChildren(h('div', null,
        h('h3', null, 'Play your course'),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Your handicap'),
          h('input', { type: 'number', min: 0, max: 30, value: handicap, style: `width:50px;${INPUT_STYLE}`, onchange: (e: Event) => { handicap = Math.max(0, Math.min(30, Number((e.target as HTMLInputElement).value) || 0)); } })),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Tees'),
          h('select', { style: INPUT_STYLE, onchange: (e: Event) => { tee = (e.target as HTMLSelectElement).value as TeeKind; } },
            ...(['championship', 'back', 'middle', 'forward'] as TeeKind[]).map(k => h('option', { value: k, selected: k === tee }, k)))),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Pause the sim while I play'),
          h('input', { type: 'checkbox', checked: pause, onchange: (e: Event) => { pause = (e.target as HTMLInputElement).checked; } })),
        h('button', { class: 'btn on', onclick: start }, 'Tee off'),
        rounds.length ? h('label', null, 'Your rounds here') : null,
        ...rounds.map(r => h('div', { class: 'row' }, h('span', null, `Day ${r.day} · ${r.scores.length} holes`), h('span', null, `${r.total} (${r.toPar >= 0 ? '+' : ''}${r.toPar})`)))));
      return;
    }
    const p = play;
    const hole = p.hole();
    const card = p.scores.map(s => h('td', { style: s.strokes < s.par ? 'color:var(--accent)' : s.strokes > s.par ? 'color:var(--bad)' : '' }, String(s.strokes)));
    box.replaceChildren(h('div', null,
      h('h3', null, hole ? `Hole ${hole.number} · par ${p.par()}` : 'Round over'),
      hole ? h('div', { class: 'row' }, h('span', { class: 'muted' }, `Stroke ${p.strokes + 1} · ${p.isPutting() ? 'on the green' : p.lie}`), h('span', null, `${Math.round(p.distanceM())} m to the pin`)) : null,
      hole ? h('div', { style: 'display:flex;gap:2px;flex-wrap:wrap;margin:3px 0' },
        ...p.clubs.map(c => h('button', { class: `btn${c.id === p.club.id ? ' on' : ''}`, title: c.id === 'P' ? 'Putter' : `${Math.round(c.carryM)} m carry`, onclick: () => { p.setClub(c.id); render(); } }, c.id))) : null,
      bar,
      h('div', { class: 'muted' }, p.club.id === 'P' ? 'Click to aim the putt · Space: start, then set the pace' : 'Click to aim · Space three times: start, power, accuracy (stop in the white zone)'),
      p.lastText ? h('div', null, p.lastText) : null,
      p.scores.length ? h('table', { class: 'grid', style: 'margin-top:4px' }, h('tr', null, ...p.scores.map(s => h('th', null, String(s.number)))), h('tr', null, ...card)) : null,
      h('button', { class: 'btn', style: 'margin-top:4px', onclick: quit }, p.done ? 'Card in' : 'Quit and card in')));
    if (p.done) quit();
  }

  return {
    id: 'play', label: 'Play', cursor: 'crosshair',
    panel: () => { render(); if (!raf) raf = requestAnimationFrame(tick); return box; },
    onPointerDown(t: Vec2) { if (play && !play.done && play.meter.phase === 'idle') { play.setAim(t); render(); } },
    onKey(e: KeyboardEvent) {
      if (!play || e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      catchUp(performance.now());
      if (play.meter.phase === 'idle') last = performance.now();
      const putt = play.club.id === 'P';
      if (play.press()) { onShot?.(putt); render(); }
    },
    status: () => play && !play.done ? `Hole ${play.hole()?.number} · ${play.club.id} · ${Math.round(play.distanceM())} m · wind ${Math.round(Math.hypot(g.weather.wind.x, g.weather.wind.y))} m/s` : 'Play mode: tee off from the panel',
    drawPreview(gfx: Graphics) {
      if (!play || play.done) return;
      const px = (v: Vec2) => ({ x: v.x * TILE_PX, y: v.y * TILE_PX });
      const w = g.world;
      // slope arrows on the green around the ball
      if (play.isPutting()) {
        for (let dy = -12; dy <= 12; dy += 3) for (let dx = -12; dx <= 12; dx += 3) {
          const x = Math.round(play.pos.x + dx), y = Math.round(play.pos.y + dy);
          if (!w.inBounds(x, y) || w.surface[w.idx(x, y)] !== Surface.Green) continue;
          const s = slopeAt(w, x, y);
          if (s.gradient < 0.004) continue;
          const len = Math.min(1.4, s.gradient * 60) * TILE_PX;
          const a = px({ x: x + 0.5, y: y + 0.5 });
          gfx.moveTo(a.x, a.y).lineTo(a.x + s.dir.x * len, a.y + s.dir.y * len).stroke({ color: 0x1a3a10, width: 1.5, alpha: 0.8 });
        }
      }
      if (play.lastPath.length > 1) {
        const pts = play.lastPath.map(px);
        gfx.moveTo(pts[0]!.x, pts[0]!.y);
        for (const q of pts.slice(1)) gfx.lineTo(q.x, q.y);
        gfx.stroke({ color: 0xffffff, width: 1.5, alpha: 0.5 });
      }
      const b = px(play.pos);
      if (play.aim) { const a = px(play.aim); gfx.moveTo(b.x, b.y).lineTo(a.x, a.y).stroke({ color: 0xffe066, width: 1.5, alpha: 0.9 }); gfx.circle(a.x, a.y, 3).stroke({ color: 0xffe066, width: 1.5 }); }
      const pin = px(play.pin());
      gfx.moveTo(pin.x, pin.y).lineTo(pin.x, pin.y - 14).stroke({ color: 0xffffff, width: 1.5 });
      gfx.rect(pin.x, pin.y - 14, 7, 5).fill(0xe03030);
      gfx.circle(b.x, b.y, 2.5).fill(0xffffff).stroke({ color: 0x000000, width: 1 });
    },
    onDeactivate() { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; },
  };
}
