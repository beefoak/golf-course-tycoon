import { Container } from 'pixi.js';
import './ui/style.css';
import { Atlas } from './render/atlas';
import { Camera } from './render/camera';
import { ChunkRenderer } from './render/chunks';
import { FEATURE_COLORS, PALETTES, TREE_COLORS } from './render/palette';
import { createPixiApp } from './render/pixiApp';
import { Game, NewGameOptions } from './sim/game';
import { GameLoop } from './sim/loop';
import { UiContext } from './ui/context';
import { h } from './ui/dom';
import { createHud } from './ui/hud';
import { Inspector } from './ui/inspector';
import { showNewGame } from './ui/newGame';
import { createNotifications } from './ui/notifications';
import { createOverlayBar } from './ui/overlayBar';
import { createToolbar } from './ui/toolbar';
import { landTool } from './ui/tools/landTool';
import { ToolController } from './ui/tools/toolController';

async function startGame(opts: NewGameOptions): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const root = document.getElementById('ui') as HTMLElement;
  const app = await createPixiApp(canvas);
  const game = Game.create(opts);
  const atlas = new Atlas(PALETTES[game.terrain], TREE_COLORS, FEATURE_COLORS);
  const chunks = new ChunkRenderer(app, atlas, game.world);
  const worldLayer = new Container();
  chunks.container.addChild(worldLayer);
  const camera = new Camera();
  // start near the road entrance
  camera.x = game.world.size / 2;
  camera.y = game.world.size - 60;
  const loop = new GameLoop(game);
  const status = h('div', { class: 'status' });
  const ctx: UiContext = {
    game, loop, app, atlas, camera, chunks, world: worldLayer, root,
    tools: new ToolController(canvas, camera, worldLayer),
    inspector: new Inspector(),
    setStatus: t => { if (status.textContent !== t) status.textContent = t; },
    refreshOverlay: () => overlayBar.refresh(),
  };
  const hud = createHud(ctx);
  const overlayBar = createOverlayBar(ctx);
  const toolbar = createToolbar(ctx, [{ make: () => landTool(game), hotkey: 'l' }]);
  root.append(hud.el, toolbar, ctx.inspector.el, createNotifications(ctx), h('div', { class: 'panel bottombar' }, overlayBar.el, status));
  game.events.on('cash', () => { if (overlayBar.current() === 'land') overlayBar.refresh(); });

  // camera controls: WASD / arrows, wheel zoom, right- or middle-drag pan
  const keys = new Set<string>();
  window.addEventListener('keydown', e => { if ((e.target as HTMLElement)?.tagName !== 'INPUT') keys.add(e.key.toLowerCase()); });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
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

  let hudTimer = 0;
  app.ticker.add(t => {
    loop.advance(Math.min(t.deltaMS, 250));
    const speed = (700 / camera.pxPerTile) * (t.deltaMS / 1000);
    if (keys.has('w') || keys.has('arrowup')) camera.y -= speed;
    if (keys.has('s') || keys.has('arrowdown')) camera.y += speed;
    if (keys.has('a') || keys.has('arrowleft')) camera.x -= speed;
    if (keys.has('d') || keys.has('arrowright')) camera.x += speed;
    camera.clampTo(game.world.size);
    chunks.update(camera);
    ctx.tools.drawPreview();
    ctx.setStatus(ctx.tools.active?.status?.() ?? 'Right-drag or WASD to pan · wheel to zoom · L = land tool · Space = pause');
    hudTimer += t.deltaMS;
    if (hudTimer > 200) { hudTimer = 0; hud.refresh(); }
  });
  (window as unknown as { gct: UiContext }).gct = ctx;
}

showNewGame(document.getElementById('ui') as HTMLElement, o => void startGame(o));
