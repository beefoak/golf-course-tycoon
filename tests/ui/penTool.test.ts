import { penTool } from '../../src/ui/tools/penTool';
import { Command } from '../../src/sim/commands';
import { newOwnedGame } from '../helpers';

const click = (detail = 1) => ({ button: 0, detail, shiftKey: false }) as unknown as PointerEvent;
const key = (k: string) => ({ key: k, preventDefault() {} }) as unknown as KeyboardEvent;

function setup() {
  const g = newOwnedGame({ size: 200, parcels: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]] });
  const sent: Command[] = []; const orig = g.dispatch.bind(g);
  g.dispatch = (c: Command) => { sent.push(c); return orig(c); };
  return { g, sent, tool: penTool(g) };
}

test('tee, waypoint, double-click green, Enter → one penHole with 3 points', () => {
  const { tool, sent } = setup();
  tool.onPointerDown!({ x: 50, y: 10 }, click());
  tool.onPointerDown!({ x: 50, y: 100 }, click());
  tool.onPointerDown!({ x: 80, y: 170 }, click(1));
  tool.onPointerDown!({ x: 80, y: 170 }, click(2));
  expect(sent.filter(c => c.t === 'penHole').length).toBe(0);
  tool.onKey!(key('Enter'));
  const pens = sent.filter(c => c.t === 'penHole');
  expect(pens.length).toBe(1);
  const p = pens[0] as Extract<Command, { t: 'penHole' }>;
  expect(p.input.route).toEqual([{ x: 50, y: 10 }, { x: 50, y: 100 }, { x: 80, y: 170 }]);
});
test('creates a course automatically when none exists', () => {
  const { g, tool, sent } = setup();
  tool.onPointerDown!({ x: 50, y: 10 }, click()); tool.onPointerDown!({ x: 50, y: 150 }, click()); tool.onPointerDown!({ x: 50, y: 150 }, click(2));
  tool.onKey!(key('Enter'));
  expect(sent[0]!.t).toBe('createCourse'); expect(g.courses.list.length).toBe(1); expect(g.courses.list[0]!.holes.length).toBe(1);
});
test('Esc mid-draw dispatches nothing and resets', () => {
  const { tool, sent } = setup();
  tool.onPointerDown!({ x: 50, y: 10 }, click()); tool.onPointerDown!({ x: 50, y: 100 }, click());
  tool.onKey!(key('Escape')); tool.onKey!(key('Enter'));
  expect(sent.length).toBe(0); expect(tool.status!()).toMatch(/Click to place the tee/);
});
test('fourth point finishes the drawing automatically', () => {
  const { tool, sent } = setup();
  for (const [x, y] of [[50, 10], [50, 60], [60, 110], [70, 170]] as const) tool.onPointerDown!({ x, y }, click());
  tool.onKey!(key('Enter')); expect(sent.filter(c => c.t === 'penHole').length).toBe(1);
});
test('status shows yardage and suggested par while drawing', () => {
  const { tool } = setup();
  tool.onPointerDown!({ x: 50, y: 10 }, click()); tool.onPointerMove!({ x: 50, y: 190 }, click());
  expect(tool.status!()).toMatch(/394 yd/); expect(tool.status!()).toMatch(/par 4/);
});
