import type { Application, Container } from 'pixi.js';
import type { Atlas } from '../render/atlas';
import type { Camera } from '../render/camera';
import type { ChunkRenderer } from '../render/chunks';
import type { Game } from '../sim/game';
import type { GameLoop } from '../sim/loop';
import type { Inspector } from './inspector';
import type { ToolController } from './tools/toolController';

/** Everything the UI pieces share. Built once in main.ts. */
export interface UiContext {
  game: Game;
  loop: GameLoop;
  app: Application;
  atlas: Atlas;
  camera: Camera;
  chunks: ChunkRenderer;
  world: Container; // pixi container in world-pixel space (for entities and previews)
  tools: ToolController;
  inspector: Inspector;
  root: HTMLElement;
  setStatus(text: string): void;
  /** Re-bake the active data overlay (call after changes it depends on). */
  refreshOverlay(): void;
}
