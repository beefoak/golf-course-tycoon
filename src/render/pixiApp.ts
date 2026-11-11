import { Application } from 'pixi.js';

export async function createPixiApp(canvas: HTMLCanvasElement): Promise<Application> {
  const app = new Application();
  await app.init({ canvas, resizeTo: window, background: 0x1b2a1b, antialias: false, roundPixels: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
  return app;
}
