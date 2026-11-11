import type { Graphics } from 'pixi.js';
import { Vec2 } from '../../core/geom';

/**
 * A map tool. Coordinates are fractional world tiles.
 * drawPreview draws into a Graphics whose units are world pixels (tile × TILE_PX).
 */
export interface Tool {
  id: string;
  label: string;
  cursor: string;
  onPointerDown?(t: Vec2, e: PointerEvent): void;
  onPointerMove?(t: Vec2, e: PointerEvent): void;
  onPointerUp?(t: Vec2, e: PointerEvent): void;
  onKey?(e: KeyboardEvent): void;
  /** One-line status text for the bottom bar (hover info, costs). */
  status?(): string;
  drawPreview?(gfx: Graphics): void;
  panel?(): HTMLElement | null;
  onDeactivate?(): void;
}
