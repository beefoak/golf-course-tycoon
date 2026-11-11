import { Camera, TILE_PX } from '../../src/render/camera';

test('tile size', () => { expect(TILE_PX).toBe(16); });
test('screenToTile inverts tileToScreen', () => {
  const c = new Camera(); c.x = 500; c.y = 500; c.zoom = 2;
  const s = c.tileToScreen(510, 490, 800, 600); const t = c.screenToTile(s.x, s.y, 800, 600);
  expect(t.x).toBeCloseTo(510); expect(t.y).toBeCloseTo(490);
});
test('screen centre is camera position', () => {
  const c = new Camera(); c.x = 123; c.y = 456; c.zoom = 1;
  expect(c.screenToTile(400, 300, 800, 600)).toEqual({ x: 123, y: 456 });
});
test('visibleChunks only includes on-screen chunks', () => {
  const c = new Camera(); c.x = 25; c.y = 25; c.zoom = 4;
  const v = c.visibleChunks(800, 600, 20); expect(v).toContain(0); expect(v).not.toContain(399); expect(v.length).toBeLessThanOrEqual(4);
});
test('visibleChunks clamps to the map', () => {
  const c = new Camera(); c.x = 500; c.y = 500; c.zoom = 0.25;
  const v = c.visibleChunks(4000, 4000, 20); expect(Math.max(...v)).toBeLessThanOrEqual(399); expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
});
test('zoomAt keeps the tile under the cursor fixed', () => {
  const c = new Camera(); c.x = 100; c.y = 100; c.zoom = 1;
  const before = c.screenToTile(600, 200, 800, 600); c.zoomAt(1, 600, 200, 800, 600);
  expect(c.zoom).toBe(2); const after = c.screenToTile(600, 200, 800, 600);
  expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y);
});
test('zoom is clamped to the allowed steps', () => {
  const c = new Camera(); c.zoom = 4; c.zoomAt(1, 0, 0, 800, 600); expect(c.zoom).toBe(4);
  c.zoom = 0.25; c.zoomAt(-1, 0, 0, 800, 600); expect(c.zoom).toBe(0.25);
});
