import { Container, Graphics } from 'pixi.js';
import { Vec2 } from '../../core/geom';
import { Camera } from '../../render/camera';
import { Tool } from './tool';

/** Routes canvas pointer/keyboard input (left button) to the active tool and draws its preview. */
export class ToolController {
  active: Tool | null = null;
  /** Left click with no tool active (selects golfers). */
  fallback: ((t: Vec2, e: PointerEvent) => void) | null = null;
  private gfx = new Graphics();
  private listeners: ((t: Tool | null) => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private camera: Camera, worldLayer: Container) {
    worldLayer.addChild(this.gfx);
    const tile = (e: PointerEvent) => this.camera.screenToTile(e.offsetX, e.offsetY, canvas.clientWidth, canvas.clientHeight);
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (!this.active) { this.fallback?.(tile(e), e); return; }
      canvas.setPointerCapture(e.pointerId);
      this.active.onPointerDown?.(tile(e), e);
    });
    canvas.addEventListener('pointermove', e => this.active?.onPointerMove?.(tile(e), e));
    canvas.addEventListener('pointerup', e => {
      if (e.button !== 0) return;
      this.active?.onPointerUp?.(tile(e), e);
    });
    // MouseEvent.detail is a read-only getter, so pass a plain object that reports detail 2
    canvas.addEventListener('dblclick', e => {
      const fake = { button: 0, detail: 2, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, offsetX: e.offsetX, offsetY: e.offsetY } as unknown as PointerEvent;
      this.active?.onPointerUp?.(tile(e as PointerEvent), fake);
    });
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape' && this.active && !this.active.onKey) { this.setTool(null); return; }
      this.active?.onKey?.(e);
    });
  }

  setTool(t: Tool | null): void {
    if (this.active === t) return;
    this.active?.onDeactivate?.();
    this.active = t;
    this.canvas.style.cursor = t?.cursor ?? 'default';
    for (const l of this.listeners) l(t);
  }
  onChange(fn: (t: Tool | null) => void): void {
    this.listeners.push(fn);
  }
  drawPreview(): void {
    this.gfx.clear();
    this.active?.drawPreview?.(this.gfx);
  }
}
