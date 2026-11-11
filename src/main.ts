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
import { penTool } from './ui/tools/penTool';
import { paintTool } from './ui/tools/paintTool';
import { terrainTool } from './ui/tools/terrainTool';
import { hazardTool } from './ui/tools/hazardTool';
import { pathTool, structureTool } from './ui/tools/pathTool';
import { greenTool } from './ui/tools/greenTool';
import { holeTool } from './ui/tools/holeTool';
import { HoleSelection } from './ui/selection';
import { EntityLayer } from './render/entities';
import { GolferLayer } from './render/golfers';
import { FollowCam } from './render/follow';
import { StaffLayer } from './render/staff';
import { crewMemberPanel } from './ui/panels/crewMemberPanel';
import { staffTool } from './ui/panels/staffPanel';
import { programTool } from './ui/panels/programPanel';
import { amenityTool } from './ui/panels/buildPanel';
import { proShopTool } from './ui/panels/proShopPanel';
import { servicesTool } from './ui/panels/servicesPanel';
import { LIVE_OVERLAYS } from './render/overlays';
import { ThoughtBubbles } from './ui/bubbles';
import { golferPanel } from './ui/panels/golferPanel';
import { statsPanel } from './ui/panels/statsPanel';
import { financeTool } from './ui/panels/financePanel';
import { clubhouseTool } from './ui/tools/clubhouseTool';
import { irrigationTool } from './ui/tools/irrigationTool';
import { Tool } from './ui/tools/tool';
import { ToolController } from './ui/tools/toolController';
import { deserialize, serialize } from './sim/save';
import { AUTOSAVE, AUTOSAVE_DAYS, SaveStore } from './sim/saveStore';
import { savePanel } from './ui/panels/savePanel';

const store = new SaveStore();

async function startGame(game: Game): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const root = document.getElementById('ui') as HTMLElement;
  const app = await createPixiApp(canvas);
  const atlas = new Atlas(PALETTES[game.terrain], TREE_COLORS, FEATURE_COLORS);
  const chunks = new ChunkRenderer(app, atlas, game.world);
  const worldLayer = new Container();
  chunks.container.addChild(worldLayer);
  const camera = new Camera();
  // start near the road entrance
  camera.x = game.world.size / 2;
  camera.y = game.world.size - 60;
  const loop = new GameLoop(game);
  // dev builds only: poke the sim from the console
  if (import.meta.env.DEV) Object.assign(window, { __game: game, __camera: camera });
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
  const sel = new HoleSelection();
  const entities = new EntityLayer(game, () => sel.id);
  worldLayer.addChildAt(entities.container, 0);
  const golfers = new GolferLayer(game, atlas);
  worldLayer.addChildAt(golfers.container, 1);
  const follow = new FollowCam();
  const followedGolfer = () => (follow.target?.kind === 'golfer' ? follow.target.id : null);
  golfers.followed = followedGolfer;
  const crew = new StaffLayer(game, atlas);
  worldLayer.addChildAt(crew.container, 2);
  crew.followed = () => (follow.target?.kind === 'staff' ? follow.target.id : null);
  golfers.speed = () => loop.speed;
  const bubbles = new ThoughtBubbles(game, followedGolfer);
  root.appendChild(bubbles.el);

  // golfer selection: click a golfer with no tool active
  const golferOwner = { id: 0 };
  const showGolfer = () => {
    if (!ctx.inspector.isOwner(golferOwner)) return;
    ctx.inspector.update(golferOwner, golferPanel(game, golferOwner.id, () => {
      follow.target = followedGolfer() === golferOwner.id ? null : { kind: 'golfer', id: golferOwner.id };
      showGolfer();
    }, followedGolfer() === golferOwner.id));
  };
  // crew selection
  const crewOwner = { id: 0 };
  const followedCrew = () => (follow.target?.kind === 'staff' ? follow.target.id : null);
  const showCrew = () => {
    if (!ctx.inspector.isOwner(crewOwner)) return;
    ctx.inspector.update(crewOwner, crewMemberPanel(game, crewOwner.id, () => {
      follow.target = followedCrew() === crewOwner.id ? null : { kind: 'staff', id: crewOwner.id };
      showCrew();
    }, followedCrew() === crewOwner.id));
  };
  ctx.tools.fallback = t => {
    const id = golfers.pick(t, camera.zoom);
    if (id === null) {
      const sid = crew.pick(t, camera.zoom);
      if (sid === null) return;
      crewOwner.id = sid;
      ctx.inspector.show(crewOwner, document.createElement('div'));
      showCrew();
      return;
    }
    golferOwner.id = id;
    ctx.inspector.show(golferOwner, document.createElement('div'));
    showGolfer();
  };
  // course overview tool (panel only)
  const courseOwner: Tool = {
    id: 'course', label: 'Course', cursor: 'default',
    panel: () => { const el = document.createElement('div'); queueMicrotask(showCourse); return el; },
  };
  const showCourse = () => {
    if (!ctx.inspector.isOwner(courseOwner)) return;
    ctx.inspector.update(courseOwner, statsPanel(game, game.courses.list[0]?.id ?? 0, showCourse));
  };
  setInterval(() => {
    // live panels refresh twice a second, but never while the player is typing in them
    if ((document.activeElement as HTMLElement | null)?.tagName === 'INPUT') return;
    showGolfer();
    showCrew();
    showCourse();
  }, 500);
  // turf and crew overlays follow the sim
  setInterval(() => { const o = overlayBar.current(); if (o && LIVE_OVERLAYS.has(o) && loop.speed > 0) overlayBar.refresh(); }, 3000);
  game.events.on('day', () => overlayBar.refresh());

  // save / load (panel only) and autosave every AUTOSAVE_DAYS game days
  const saveTool: Tool = { id: 'save', label: 'Save', cursor: 'default', panel: () => savePanel(game, store) };
  let lastAutosave = game.day;
  game.events.on('day', () => {
    if (game.day - lastAutosave < AUTOSAVE_DAYS) return;
    lastAutosave = game.day;
    store.put(AUTOSAVE, serialize(game)).catch(e => game.notify('warn', `Autosave failed: ${(e as Error).message}`));
  });

  const green = greenTool(game, sel, chunks, () => overlayBar.refresh());
  const holes = holeTool(game, sel, ctx.inspector, () => ctx.tools.setTool(green));
  const toolbar = createToolbar(ctx, [
    { make: () => landTool(game), hotkey: 'l' },
    { make: () => penTool(game, id => { sel.set(id); ctx.tools.setTool(holes); }), hotkey: 'f' },
    { make: () => holes, hotkey: 'h' },
    { make: () => green, hotkey: 'g' },
    { make: () => paintTool(game), hotkey: 'p' },
    { make: () => terrainTool(game), hotkey: 't' },
    { make: () => hazardTool(game), hotkey: 'b' },
    { make: () => pathTool(game), hotkey: 'k' },
    { make: () => structureTool(game), hotkey: 'u' },
    { make: () => clubhouseTool(game), hotkey: 'c' },
    { make: () => clubhouseTool(game, 'maintenance'), hotkey: 'm' },
    { make: () => amenityTool(game), hotkey: 'n' },
    { make: () => proShopTool(game), hotkey: 'y' },
    { make: () => servicesTool(game), hotkey: 'x' },
    { make: () => financeTool(game), hotkey: 'r' },
    { make: () => irrigationTool(game), hotkey: 'i' },
    { make: () => staffTool(game), hotkey: 'e' },
    { make: () => programTool(game), hotkey: 'j' },
    { make: () => courseOwner, hotkey: 'o' },
    { make: () => saveTool, hotkey: 'v' },
  ]);
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
    follow.target = null;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  let hudTimer = 0;
  app.ticker.add(t => {
    try {
      loop.advance(Math.min(t.deltaMS, 250));
    } catch (e) {
      // a sim bug must not kill the ticker: pause and tell the player instead
      loop.speed = 0;
      console.error(e);
      game.notify('bad', `Simulation error — game paused (${(e as Error).message}). Save your game and report this.`);
    }
    const speed = (700 / camera.pxPerTile) * (t.deltaMS / 1000);
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].some(k => keys.has(k))) follow.target = null;
    follow.update(camera, game);
    if (keys.has('w') || keys.has('arrowup')) camera.y -= speed;
    if (keys.has('s') || keys.has('arrowdown')) camera.y += speed;
    if (keys.has('a') || keys.has('arrowleft')) camera.x -= speed;
    if (keys.has('d') || keys.has('arrowright')) camera.x += speed;
    camera.clampTo(game.world.size);
    chunks.update(camera);
    entities.update(camera.pxPerTile);
    golfers.update(camera, canvas.clientWidth, canvas.clientHeight, performance.now());
    crew.update(camera, canvas.clientWidth, canvas.clientHeight, performance.now());
    bubbles.update(camera, canvas.clientWidth, canvas.clientHeight);
    ctx.tools.drawPreview();
    ctx.setStatus(ctx.tools.active?.status?.() ?? 'Right-drag or WASD to pan · wheel to zoom · L land · F fairway pen · H holes · G green · P paint · T terrain · B hazards · K paths · C clubhouse · M maintenance · N amenities · Y pro shop · X services · I irrigation · E staff · J program · O course · V save · click a golfer or crew member · Space pause');
    hudTimer += t.deltaMS;
    if (hudTimer > 200) { hudTimer = 0; hud.refresh(); }
  });
  (window as unknown as { gct: UiContext }).gct = ctx;
}

async function boot(): Promise<void> {
  const root = document.getElementById('ui') as HTMLElement;
  const params = new URL(location.href).searchParams;
  const slot = params.get('load');
  let error: string | undefined;
  if (slot !== null) {
    // drop ?load so a manual refresh doesn't reload the old save over newer play
    history.replaceState(null, '', location.pathname);
    const bytes = await store.get(slot).catch(() => null);
    const r = bytes ? deserialize(bytes) : { ok: false as const, reason: `No save named "${slot}"` };
    if (r.ok) return startGame(r.value);
    error = r.reason;
  }
  showNewGame(root, (o: NewGameOptions) => void startGame(Game.create(o)), store, error);
}
void boot();
