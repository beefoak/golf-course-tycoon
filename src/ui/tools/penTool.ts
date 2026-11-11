import type { Graphics } from 'pixi.js';
import { Vec2, dist } from '../../core/geom';
import { tilesToYards, yardsToTiles } from '../../core/units';
import { PEN_DEFAULTS, planPenHole } from '../../sim/course/pen';
import { routeLengthTiles, suggestPar } from '../../sim/course/yardage';
import { Course } from '../../sim/course/course';
import { Game } from '../../sim/game';
import { TILE_PX } from '../../render/camera';
import { h, money } from '../dom';
import { Tool } from './tool';

const MAX_POINTS = 4;

export function penTool(g: Game, onCreated?: (holeId: number) => void): Tool {
  let points: Vec2[] = [];
  let hover: Vec2 | null = null;
  let confirming = false;
  const widths = { ...PEN_DEFAULTS };
  let preview: { cost: number; warnings: string[] } | null = null;

  const snap = (t: Vec2): Vec2 => ({ x: Math.round(t.x), y: Math.round(t.y) });
  const reset = () => { points = []; confirming = false; preview = null; };
  const route = (): Vec2[] => (confirming || !hover ? points : [...points, snap(hover)]);
  const course = (): Course => {
    if (g.courses.list.length === 0) g.dispatch({ t: 'createCourse', name: 'Course 1' });
    return g.courses.list[0]!;
  };
  const finish = () => {
    if (points.length < 2) return;
    confirming = true;
    const d = planPenHole(g, { courseId: g.courses.list[0]?.id ?? 0, route: points, ...widths });
    preview = { cost: d.plan.cost, warnings: d.warnings };
  };
  const commit = () => {
    if (!confirming) return;
    const c = course();
    const r = g.dispatch({ t: 'penHole', input: { courseId: c.id, route: points, ...widths } });
    if (r.ok) { g.notify('info', `Hole drafted — add tee boxes and pins, shape it, then seed it`); onCreated?.((r.value as { id: number }).id); }
    else g.notify('warn', r.reason);
    reset();
  };

  return {
    id: 'pen',
    label: 'Fairway Pen',
    cursor: 'crosshair',
    onPointerMove(t) { hover = t; },
    // the controller forwards dblclick as pointerup with detail 2 (pointerdown.detail is 0 in some browsers)
    onPointerUp(_t, e) { if (e.detail >= 2 && !confirming) finish(); },
    onPointerDown(t, e) {
      if (confirming) return;
      const p = snap(t);
      if (e.detail >= 2) { finish(); return; }
      if (points.length && dist(points[points.length - 1]!, p) < 1) return;
      points.push(p);
      if (points.length >= MAX_POINTS) finish();
    },
    onKey(e) {
      if (e.key === 'Escape') reset();
      else if (e.key === 'Enter') { if (!confirming) finish(); commit(); }
      else if (e.key === 'Backspace' && !confirming) points.pop();
    },
    onDeactivate: reset,
    status() {
      const r = route();
      if (r.length === 0) return 'Fairway Pen: Click to place the tee, click up to two dogleg points, double-click the green';
      const yd = tilesToYards(routeLengthTiles(r));
      const legs = r.slice(1).map((p, i) => `${Math.round(tilesToYards(dist(r[i]!, p)))}`).join(' + ');
      const base = `${Math.round(yd)} yd (${legs}) · par ${suggestPar(yd)}`;
      if (confirming && preview) {
        const warn = preview.warnings.length ? ` · ⚠ ${preview.warnings.join('; ')}` : '';
        return `${base} · cost ${money(preview.cost)} · Enter to build, Esc to cancel${warn}`;
      }
      return `${base} · ${points.length < 2 ? 'click the next point' : 'double-click to place the green'} · Backspace undoes · Esc cancels`;
    },
    drawPreview(gfx: Graphics) {
      const r = route().map(p => ({ x: (p.x + 0.5) * TILE_PX, y: (p.y + 0.5) * TILE_PX }));
      if (r.length === 0) return;
      const fw = yardsToTiles(widths.fairwayWidthYd) * TILE_PX;
      const rough = fw + 2 * yardsToTiles(widths.roughWidthYd + 4) * TILE_PX;
      if (r.length >= 2) {
        gfx.moveTo(r[0]!.x, r[0]!.y);
        for (const p of r.slice(1)) gfx.lineTo(p.x, p.y);
        gfx.stroke({ width: rough, color: 0x4a7f33, alpha: 0.35, cap: 'round', join: 'round' });
        gfx.moveTo(r[0]!.x, r[0]!.y);
        for (const p of r.slice(1)) gfx.lineTo(p.x, p.y);
        gfx.stroke({ width: fw, color: 0x9be070, alpha: 0.45, cap: 'round', join: 'round' });
        const green = r[r.length - 1]!;
        gfx.circle(green.x, green.y, yardsToTiles(widths.greenRadiusYd) * TILE_PX).fill({ color: 0xb8f088, alpha: 0.6 });
      }
      for (const p of r) gfx.circle(p.x, p.y, 10).fill({ color: 0xffffff, alpha: 0.9 });
      gfx.rect(r[0]!.x - 32, r[0]!.y - 16, 64, 32).stroke({ width: 3, color: 0xffffff });
    },
    panel() {
      const slider = (label: string, key: keyof typeof widths, min: number, max: number) => {
        const val = h('span', null, `${widths[key]} yd`);
        const input = h('input', { type: 'range', min, max, value: widths[key], oninput: (e: Event) => { widths[key] = Number((e.target as HTMLInputElement).value); val.textContent = `${widths[key]} yd`; if (confirming) finish(); } });
        return h('div', null, h('label', null, label, ' ', val), input);
      };
      return h('div', null,
        h('h3', null, 'Fairway Pen'),
        h('div', { class: 'muted' }, 'Click the tee, up to two dogleg points, then double-click the green. Enter builds the draft; you can then shape it, add bunkers, tee boxes and pins.'),
        slider('Fairway width', 'fairwayWidthYd', 20, 60),
        slider('Rough width (each side)', 'roughWidthYd', 0, 40),
        slider('Green radius', 'greenRadiusYd', 8, 22));
    },
  };
}
