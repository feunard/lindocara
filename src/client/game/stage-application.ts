/**
 * The single Pixi Application on the shared `#stage` canvas.
 *
 * `#stage` is one canvas, and Pixi 8 cannot re-init a WebGL context on a canvas a prior Application
 * already destroyed — a second `app.init` on it hangs, and two live Applications on one canvas race
 * the context to a blank frame ("WebGL context may be lost"). So the whole page gets exactly one
 * Application, created on the first acquire and handed to every consumer thereafter: the world
 * renderer for a game session, and the map editor's painting stage. Neither creates its own.
 *
 * Handoff is safe by construction. Each consumer owns only what it adds — its own root container on
 * `app.stage`, its own listeners, its own ticker callbacks — and removes exactly that on teardown,
 * so the app it hands back is a clean stage the next consumer builds onto. The Application itself is
 * never destroyed while the page lives, so a later consumer never re-inits the canvas. This is what
 * lets the game start after the editor without a reload, and (a follow-up) a map preview renderer be
 * created and destroyed repeatedly on the same canvas.
 *
 * The ticker is guaranteed running on every acquire, because a previous consumer (the editor's
 * dispose) may have paused it to keep an idle stage free.
 */
import { Application } from "pixi.js";

// The stage background — the game's void, kept byte-identical to `COLORS.void` in renderer.ts so the
// world's letterbox does not change. The editor's former teal (0x0a1f1a) only ever showed in the
// margin around a map that its own full-bleed water sprite covers, so it defers to the game's value.
const STAGE_BACKGROUND = 0x050b0d;

let sharedApp: Application | null = null;
let sharedAppPromise: Promise<Application> | null = null;

/**
 * Returns the one Application bound to `#stage`, creating it on the first call with the exact init
 * options the world renderer has always used. Concurrent or React-StrictMode double calls await the
 * same in-flight init rather than racing a second Application onto the canvas.
 */
export function acquireStageApp(canvas: HTMLCanvasElement): Promise<Application> {
  if (sharedApp) {
    // A previous consumer (the editor's dispose) may have paused the ticker; every acquire hands
    // back a running one so the new consumer's frame callbacks fire.
    sharedApp.ticker.start();
    return Promise.resolve(sharedApp);
  }
  if (!sharedAppPromise) {
    sharedAppPromise = createStageApp(canvas);
  }
  return sharedAppPromise;
}

async function createStageApp(canvas: HTMLCanvasElement): Promise<Application> {
  const app = new Application();
  await app.init({
    canvas,
    background: STAGE_BACKGROUND,
    resizeTo: window,
    antialias: false,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
  });
  // The stage is left at Pixi's default (interactive) event mode: the world renderer targets
  // players, monsters and guards through `pointertap` on `eventMode: "static"` containers, which a
  // "none" stage would silently swallow. The editor drives itself from native DOM pointer events, so
  // the default costs it nothing measurable — no editor display object is a hit-test target.
  sharedApp = app;
  return app;
}
