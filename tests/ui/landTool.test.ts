import { Game } from '../../src/sim/game';
import { landTool } from '../../src/ui/tools/landTool';

const ev = (shiftKey = false) => ({ shiftKey, button: 0 }) as unknown as PointerEvent;

test('land tool click buys parcel under cursor', () => {
  const g = Game.create({ seed: 1, terrain: 'parkland', difficulty: 'normal', size: 100 });
  const tool = landTool(g); tool.onPointerDown!({ x: 75, y: 10 }, ev());
  expect(g.parcels.isOwned(1, 0)).toBe(true); expect(g.parcels.isOwned(0, 0)).toBe(false);
});
test('shift-click sells', () => {
  const g = Game.create({ seed: 1, terrain: 'parkland', difficulty: 'normal', size: 100 });
  const tool = landTool(g); tool.onPointerDown!({ x: 75, y: 10 }, ev()); tool.onPointerDown!({ x: 75, y: 10 }, ev(true));
  expect(g.parcels.isOwned(1, 0)).toBe(false);
});
test('failed purchase notifies with the reason', () => {
  const g = Game.create({ seed: 1, terrain: 'parkland', difficulty: 'normal', size: 100 }); g.ledger.cash = 0;
  const msgs: string[] = []; g.events.on('notify', n => msgs.push(n.text));
  landTool(g).onPointerDown!({ x: 10, y: 10 }, ev()); expect(msgs[0]).toMatch(/Not enough money/);
});
test('hover describes parcel price', () => {
  const g = Game.create({ seed: 1, terrain: 'parkland', difficulty: 'normal', size: 100 });
  const tool = landTool(g); tool.onPointerMove!({ x: 10, y: 10 }, ev());
  expect(tool.status!()).toContain('$');
});
