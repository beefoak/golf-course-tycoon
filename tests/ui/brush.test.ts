import { paintTool } from '../../src/ui/tools/paintTool';
import { Command } from '../../src/sim/commands';
import { Surface } from '../../src/sim/world/tiles';
import { newOwnedGame, countSurface } from '../helpers';

const ev = () => ({ button: 0, detail: 1, shiftKey: false }) as unknown as PointerEvent;

test('a drag stroke dispatches exactly one paint command and charges what the status quoted', () => {
  const g = newOwnedGame();
  const sent: Command[] = []; const orig = g.dispatch.bind(g);
  g.dispatch = (c: Command) => { sent.push(c); return orig(c); };
  const tool = paintTool(g);
  tool.radius = 1;
  tool.onPointerDown!({ x: 10, y: 10 }, ev());
  for (let x = 11; x <= 20; x++) tool.onPointerMove!({ x, y: 10 }, ev());
  const quoted = Number(/cost \$([\d,]+)/.exec(tool.status!())![1]!.replace(/,/g, ''));
  const before = g.ledger.cash;
  tool.onPointerUp!({ x: 20, y: 10 }, ev());
  expect(sent.length).toBe(1);
  expect(before - g.ledger.cash).toBe(quoted);
  expect(countSurface(g, Surface.Fairway)).toBeGreaterThan(20);
});

test('[ and ] change the radius within bounds', () => {
  const g = newOwnedGame();
  const tool = paintTool(g);
  const k = (key: string) => tool.onKey!({ key } as KeyboardEvent);
  tool.radius = 0; k('['); expect(tool.radius).toBe(0);
  k(']'); k(']'); expect(tool.radius).toBe(2);
});
