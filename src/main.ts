import { Atlas } from './render/atlas';
import { Camera } from './render/camera';
import { ChunkRenderer } from './render/chunks';
import { FEATURE_COLORS, PALETTES, TREE_COLORS } from './render/palette';
import { createPixiApp } from './render/pixiApp';
import { Game } from './sim/game';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const app = await createPixiApp(canvas);
  const game = Game.create({ seed: Date.now() >>> 0, terrain: 'parkland', difficulty: 'normal' });
  const atlas = new Atlas(PALETTES[game.terrain], TREE_COLORS, FEATURE_COLORS);
  const chunks = new ChunkRenderer(app, atlas, game.world);
  const camera = new Camera();
  camera.x = game.world.size / 2;
  camera.y = game.world.size / 2;

  const keys = new Set<string>();
  window.addEventListener('keydown', e => keys.add(e.key.toLowerCase()));
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    camera.zoomAt(e.deltaY < 0 ? 1 : -1, e.offsetX, e.offsetY, canvas.clientWidth, canvas.clientHeight);
  }, { passive: false });
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', e => { if (e.button === 1 || e.button === 2) drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointerup', () => { drag = null; });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    camera.x -= (e.clientX - drag.x) / camera.pxPerTile;
    camera.y -= (e.clientY - drag.y) / camera.pxPerTile;
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  app.ticker.add(t => {
    const speed = (600 / camera.pxPerTile) * (t.deltaMS / 1000);
    if (keys.has('w') || keys.has('arrowup')) camera.y -= speed;
    if (keys.has('s') || keys.has('arrowdown')) camera.y += speed;
    if (keys.has('a') || keys.has('arrowleft')) camera.x -= speed;
    if (keys.has('d') || keys.has('arrowright')) camera.x += speed;
    camera.clampTo(game.world.size);
    chunks.update(camera);
  });
  (window as unknown as { gct: unknown }).gct = { game, camera, app };
}

void boot();
