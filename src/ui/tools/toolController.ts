import { Container, Graphics } from 'pixi.js';
import { Camera } from '../../render/camera';
import { Tool } from './tool';

/** Routes canvas pointer/keyboard input (left button) to the active tool and draws its preview. */
export class ToolController {
  active: Tool | null = null;
  private gfx = new Graphics();
  private listeners: ((t: Tool | null) => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private camera: Camera, worldLayer: Container) {
    worldLayer.addChild(this.gfx);
    const tile = (e: PointerEvent) => this.camera.screenToTile(e.offsetX, e.offsetY, canvas.clientWidth, canvas.clientHeight);
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !this.active) return;
      canvas.setPointerCapture(e.pointerId);
      this.active.onPointerDown?.(tile(e), e);
    });
    canvas.addEventListener('pointermove', e => this.active?.onPointerMove?.(tile(e), e));
    canvas.addEventListener('pointerup', e => {
      if (e.button !== 0) return;
      this.active?.onPointerUp?.(tile(e), e);
    });
    canvas.addEventListener('dblclick', e => this.active?.onPointerUp?.(tile(e as PointerEvent), Object.assign(e, { detail: 2 }) as unknown as PointerEvent));
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
