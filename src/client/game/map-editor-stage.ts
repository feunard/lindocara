/**
 * The map editor's painting surface — Pixi on the `#stage` canvas, driven only through a handle.
 *
 * This is the WYSIWYG twin of the world renderer: it draws a map the exact way `renderer.ts` draws
 * a wire zone (the same `bakeCollision` tilemap, the same `landTile`/`needsFoam` autotiling, the
 * same native-scale Tiny Swords props), so what a builder paints here is what a player will stand
 * on. It never decides a *rule*: every placement is answered by `applyTool` (editor-state.ts),
 * which calls the same `canPlaceElement`/`bakeCollision` the server validates with. A pointer here
 * computes a cell, asks `applyTool`, and only adopts a non-null, changed result.
 *
 * React never touches anything in this module but the returned `MapEditorStageHandle`: the toolbar
 * is React, the canvas is Pixi, and the two only meet at `setTool`/`current`/`setName`/`dispose`.
 */
import { Application, Assets, Container, Graphics, Sprite, type Texture } from "pixi.js";
import { bakeCollision } from "../../shared/map-data.js";
import { kindAt, TILE_SIZE, type TileMap } from "../../shared/tilemap.js";
import { landTile, needsFoam, tileVisual } from "./autotile.js";
import type { EditorMap, EditorTool } from "./editor-state.js";
import { applyTool } from "./editor-state.js";
import { foamFrameAt } from "./terrain-visuals.js";
import {
  sliceAutotileSheet,
  sliceStrip,
  TINY_SWORDS_BUSHES,
  TINY_SWORDS_FOAM_FRAME,
  TINY_SWORDS_FOAM_FRAMES,
  TINY_SWORDS_ROCKS,
  TINY_SWORDS_TERRAIN,
  TINY_SWORDS_TREES,
} from "./tiny-swords-art.js";

/**
 * The one seam between React's toolbar and the Pixi stage. `current()` is a live snapshot the Save
 * button hands straight to the map API (an `EditorMap` is a `MapSaveInput` minus the server-minted
 * id); `setTool`/`setName` push toolbar state down; `dispose()` returns the `#stage` canvas.
 */
export interface MapEditorStageHandle {
  setTool(tool: EditorTool): void;
  current(): EditorMap;
  setName(name: string): void;
  dispose(): void;
}

/** Camera zoom is clamped to this range, both to keep pixels legible and to stop the map sailing
 *  off into empty space. Matches the brief's 0.5x–2x. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

/** One full cycle of a tree/bush sway strip. Slower than the foam so the two do not beat against
 *  each other; the exact number only sets the tempo of the idle animation. */
const SWAY_CYCLE_MS = 1_400;

const SPAWN_MARKER_COLOR = 0xffd54a;
const SPAWN_MARKER_OUTLINE = 0x2a1a05;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** A stored `variant` folded into `[0, length)`, sign-safe — the same fold `renderer.ts` applies to
 *  a wire element, so the editor previews the sprite the world will draw. */
function wrapVariant(variant: number, length: number): number {
  if (length <= 0) return 0;
  return ((Math.trunc(variant) % length) + length) % length;
}

/** Which frame of an idle sway strip the whole scene is on, global like the foam so every tree of a
 *  kind breathes together instead of shimmering out of phase. */
function swayFrameAt(elapsedMs: number, frames: number): number {
  if (frames <= 0) return 0;
  return Math.floor((Math.max(0, elapsedMs) / SWAY_CYCLE_MS) * frames) % frames;
}

interface StageTextures {
  /** `land[row][col]` of the flat sheet's first 4x4 group — indexed straight by `landTile()`. */
  land: Texture[][];
  water: Texture;
  foam: Texture[];
  /** One sway strip per tree/bush sheet; `[sheetIndex][frame]`. */
  trees: Texture[][];
  bushes: Texture[][];
  /** Still stones, one per rock sheet. */
  stones: Texture[];
}

async function loadStageTextures(): Promise<StageTextures> {
  const [flatSheet, waterTexture, foamSheet] = await Promise.all([
    Assets.load<Texture>(TINY_SWORDS_TERRAIN.flat),
    Assets.load<Texture>(TINY_SWORDS_TERRAIN.water),
    Assets.load<Texture>(TINY_SWORDS_TERRAIN.foam),
  ]);
  // Pixel art, every one: nearest keeps the tiles square exactly as the world renderer does.
  flatSheet.source.style.scaleMode = "nearest";
  waterTexture.source.style.scaleMode = "nearest";
  foamSheet.source.style.scaleMode = "nearest";

  const treeSheets = await Promise.all(
    TINY_SWORDS_TREES.map((sheet) => Assets.load<Texture>(sheet.source)),
  );
  const bushSheets = await Promise.all(
    TINY_SWORDS_BUSHES.map((sheet) => Assets.load<Texture>(sheet.source)),
  );
  const stones = await Promise.all(TINY_SWORDS_ROCKS.map((source) => Assets.load<Texture>(source)));
  for (const texture of [...treeSheets, ...bushSheets, ...stones]) {
    texture.source.style.scaleMode = "nearest";
  }

  return {
    land: sliceAutotileSheet(flatSheet),
    water: waterTexture,
    foam: sliceStrip(foamSheet, TINY_SWORDS_FOAM_FRAME, TINY_SWORDS_FOAM_FRAMES),
    trees: TINY_SWORDS_TREES.map((sheet, index) =>
      sliceStrip(treeSheets[index] ?? flatSheet, sheet.frame, sheet.frames),
    ),
    bushes: TINY_SWORDS_BUSHES.map((sheet, index) =>
      sliceStrip(bushSheets[index] ?? flatSheet, sheet.frame, sheet.frames),
    ),
    stones,
  };
}

/** One editor session's teardown, tracked at module scope so at most one Pixi Application is ever
 *  bound to the single shared `#stage` canvas. */
interface StageSession {
  destroy(): void;
}

// Every open and dispose is serialized onto one lifecycle chain so a session's teardown can never
// race the next session's build for the shared app's stage (React StrictMode fires the open/dispose
// effect twice on mount; a reopen races the previous teardown). Combined with `openGeneration`
// below, this guarantees exactly one map is mounted at a time on the one persistent Application.
let stageLifecycle: Promise<unknown> = Promise.resolve();
let activeSession: StageSession | null = null;
// Bumped by every open. A queued build whose generation is stale was superseded before it ran (the
// classic StrictMode mount→cleanup→mount, where the first open is abandoned instantly), so it skips
// building entirely: only the latest open ever creates an Application, and never on a canvas a
// throwaway app just churned. This is what keeps a single, cleanly-initialized renderer on #stage.
let openGeneration = 0;

function enqueue<T>(job: () => Promise<T> | T): Promise<T> {
  const run = stageLifecycle.then(job);
  // Keep the chain alive whether the job resolves or rejects, so one failed open cannot wedge every
  // later open and dispose behind a rejected promise.
  stageLifecycle = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** A superseded open resolves to this: the effect that requested it has already been cleaned up, so
 *  its methods must be harmless no-ops. It never touched the canvas, so there is nothing to undo. */
function inertHandle(map: EditorMap): MapEditorStageHandle {
  return {
    setTool() {},
    current: () => map,
    setName() {},
    dispose() {},
  };
}

// The single Pixi Application bound to #stage for the page's life. Pixi 8 cannot re-init a WebGL
// context on a canvas a prior Application already destroyed — the second `app.init` hangs — so the
// editor creates its Application exactly once and reuses it across every open, the same way the
// world renderer keeps one Application for a whole game session. `dispose()` tears down the painted
// world but leaves this app attached to the canvas, ready to build the next map into.
let sharedApp: Application | null = null;
let sharedAppPromise: Promise<Application> | null = null;

function ensureStageApp(canvas: HTMLCanvasElement): Promise<Application> {
  if (sharedApp) return Promise.resolve(sharedApp);
  if (!sharedAppPromise) {
    sharedAppPromise = (async () => {
      const app = new Application();
      await app.init({
        canvas,
        background: 0x0a1f1a,
        resizeTo: window,
        antialias: false,
        autoDensity: true,
        resolution: Math.min(2, window.devicePixelRatio || 1),
      });
      // Native DOM pointer/keyboard events carry screen coordinates directly; Pixi's own event
      // system would add nothing here and cost a hit test per move.
      app.stage.eventMode = "none";
      sharedApp = app;
      return app;
    })();
  }
  return sharedAppPromise;
}

/**
 * Opens the painting stage on `#stage` and returns the handle React drives it with. Opens are
 * serialized so only one map is ever mounted on the shared Application at a time, and StrictMode's
 * throwaway first mount builds nothing. `dispose()` tears down the painted world but leaves the
 * Application on the canvas for the next open, because Pixi 8 cannot re-init a destroyed canvas.
 *
 * Known limitation: this Application lingers on `#stage` for the page's life, so playing the game
 * after visiting the editor without a reload would put a second renderer on the same canvas. The
 * editor's own open/reopen cycle is unaffected; sharing one renderer between game and editor is a
 * follow-up (see docs/plans/2026-07-16-map-editor-remaining.md).
 */
export function openMapEditorStage(
  initial: EditorMap,
  onChange: (map: EditorMap) => void,
): Promise<MapEditorStageHandle> {
  const generation = ++openGeneration;
  return enqueue(() => buildSession(initial, onChange, generation));
}

async function buildSession(
  initial: EditorMap,
  onChange: (map: EditorMap) => void,
  generation: number,
): Promise<MapEditorStageHandle> {
  // A newer open already superseded this one before the chain reached it: build nothing, bind no
  // Application. This is the throwaway half of a StrictMode double-mount.
  if (generation !== openGeneration) return inertHandle(initial);

  const found = document.querySelector<HTMLCanvasElement>("#stage");
  if (!found) throw new Error("index.html is missing #stage");
  // Explicitly typed so the non-null narrowing survives into the deferred handles (dispose et al.)
  // that capture it, which control-flow narrowing alone does not carry across a closure boundary.
  const canvas: HTMLCanvasElement = found;

  // Tear down the previous session's world before building this one — this runs inside the
  // serialized chain, so only ever one map is mounted on the shared app's stage at a time.
  if (activeSession) {
    activeSession.destroy();
    activeSession = null;
  }

  const app = await ensureStageApp(canvas);
  app.ticker.start();

  const textures = await loadStageTextures();

  let map = initial;
  let tool: EditorTool = { kind: "block", block: "grass" };

  // Back-to-front: flat water, then foam bleeding out from the shore, then the opaque land tiles
  // that hide the water and the middle of each foam blob, then props, then the spawn marker on top.
  const world = new Container();
  const waterLayer = new Container();
  const foamLayer = new Container();
  const landLayer = new Container();
  const elementLayer = new Container();
  const markerLayer = new Container();
  world.addChild(waterLayer, foamLayer, landLayer, elementLayer, markerLayer);
  app.stage.addChild(world);

  // Rebuilt every redraw; the ticker retextures these in place so the coastline and the trees are
  // alive while you paint, not only after.
  let foamSprites: Sprite[] = [];
  let swaySprites: { sprite: Sprite; frames: Texture[] }[] = [];

  const mapCols = (): number => map.blocks[0]?.length ?? 0;
  const mapRows = (): number => map.blocks.length;

  function clampCamera(): void {
    const scale = world.scale.x;
    const mapW = mapCols() * TILE_SIZE * scale;
    const mapH = mapRows() * TILE_SIZE * scale;
    const viewW = app.screen.width;
    const viewH = app.screen.height;
    // Smaller than the viewport on an axis: centre it. Larger: pin so neither edge pulls inside
    // the view, which is what keeps the map from drifting into the void.
    world.x = mapW <= viewW ? (viewW - mapW) / 2 : clamp(world.x, viewW - mapW, 0);
    world.y = mapH <= viewH ? (viewH - mapH) / 2 : clamp(world.y, viewH - mapH, 0);
  }

  function fitCamera(): void {
    const mapW = mapCols() * TILE_SIZE;
    const mapH = mapRows() * TILE_SIZE;
    const fit = Math.min(app.screen.width / mapW, app.screen.height / mapH) * 0.92;
    world.scale.set(clamp(fit, MIN_ZOOM, MAX_ZOOM));
    clampCamera();
  }

  function redraw(): void {
    for (const layer of [waterLayer, foamLayer, landLayer, elementLayer, markerLayer]) {
      for (const child of layer.removeChildren()) child.destroy();
    }
    foamSprites = [];
    swaySprites = [];

    const tiles: TileMap = bakeCollision({
      blocks: map.blocks,
      elements: map.elements,
      spawn: map.spawn,
    });
    const cols = tiles.cols;
    const rows = tiles.rows;

    // The sea is one flat teal sheet (see TINY_SWORDS_TERRAIN.water): a single stretched sprite is
    // indistinguishable from tiling it and far cheaper. Land tiles paint over it.
    const water = new Sprite(textures.water);
    water.width = cols * TILE_SIZE;
    water.height = rows * TILE_SIZE;
    waterLayer.addChild(water);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (tileVisual(kindAt(tiles, col, row)) !== "land") continue;
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        const cell = landTile(tiles, col, row);
        const texture = textures.land[cell.row]?.[cell.col];
        if (!texture) continue;
        const tile = new Sprite(texture);
        tile.position.set(x, y);
        tile.width = TILE_SIZE;
        tile.height = TILE_SIZE;
        landLayer.addChild(tile);

        if (needsFoam(tiles, col, row)) {
          // Native 192px frame centred on the 64px cell: the ~82px blob bleeds ~9px past the tile,
          // and that bleed IS the shoreline. Scaling it to the tile would erase the shore.
          const blob = new Sprite(textures.foam[0] ?? texture);
          blob.anchor.set(0.5);
          blob.position.set(x + TILE_SIZE / 2, y + TILE_SIZE / 2);
          foamLayer.addChild(blob);
          foamSprites.push(blob);
        }
      }
    }

    drawElements();
    drawSpawnMarker();
  }

  /** Props, painted the way `renderer.ts`'s `#buildMapElements` does: y-sorted so a lower tree
   *  overlaps a higher one, anchored bottom-centre and pushed down by each sheet's empty footer so
   *  the object stands on its cell rather than floating over it. */
  function drawElements(): void {
    const ordered = [...map.elements].sort((a, b) => a.row - b.row || a.col - b.col);
    for (const element of ordered) {
      const x = element.col * TILE_SIZE + TILE_SIZE / 2;
      const base = (element.row + 1) * TILE_SIZE;
      if (element.kind === "stone") {
        const texture = textures.stones[wrapVariant(element.variant, textures.stones.length)];
        if (!texture) continue;
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5, 1);
        sprite.position.set(x, base);
        elementLayer.addChild(sprite);
        continue;
      }
      const strips = element.kind === "tree" ? textures.trees : textures.bushes;
      const sheets = element.kind === "tree" ? TINY_SWORDS_TREES : TINY_SWORDS_BUSHES;
      const index = wrapVariant(element.variant, strips.length);
      const frames = strips[index];
      const sheet = sheets[index];
      const first = frames?.[0];
      if (!frames || !sheet || !first) continue;
      const sprite = new Sprite(first);
      sprite.anchor.set(0.5, 1);
      sprite.position.set(x, base + sheet.foot);
      elementLayer.addChild(sprite);
      swaySprites.push({ sprite, frames });
    }
  }

  /** A gold diamond on the spawn cell — a marker the brief leaves to taste, chosen to read clearly
   *  over both grass and water without hiding what is under it. */
  function drawSpawnMarker(): void {
    const cx = map.spawn.col * TILE_SIZE + TILE_SIZE / 2;
    const cy = map.spawn.row * TILE_SIZE + TILE_SIZE / 2;
    const marker = new Graphics();
    marker
      .moveTo(cx, cy - 22)
      .lineTo(cx + 17, cy)
      .lineTo(cx, cy + 22)
      .lineTo(cx - 17, cy)
      .closePath()
      .fill({ color: SPAWN_MARKER_COLOR, alpha: 0.85 })
      .stroke({ width: 3, color: SPAWN_MARKER_OUTLINE, alpha: 0.9 });
    markerLayer.addChild(marker);
  }

  // ── Pointer: paint, or pan the camera ─────────────────────────────────────────────────────────
  let painting = false;
  let panning = false;
  let spaceHeld = false;
  let panLastX = 0;
  let panLastY = 0;
  // The last cell this stroke painted, so dragging across one cell rebuilds the scene once, not on
  // every pointermove event.
  let lastPaintedCol = Number.NaN;
  let lastPaintedRow = Number.NaN;

  function cellAt(clientX: number, clientY: number): { col: number; row: number } {
    const rect = canvas.getBoundingClientRect();
    const worldX = (clientX - rect.left - world.x) / world.scale.x;
    const worldY = (clientY - rect.top - world.y) / world.scale.y;
    return { col: Math.floor(worldX / TILE_SIZE), row: Math.floor(worldY / TILE_SIZE) };
  }

  function paintAt(clientX: number, clientY: number): void {
    const { col, row } = cellAt(clientX, clientY);
    if (col === lastPaintedCol && row === lastPaintedRow) return;
    lastPaintedCol = col;
    lastPaintedRow = row;
    const next = applyTool(map, tool, col, row);
    // null → refused (does nothing visible); same reference → a no-op edit (eraser on empty).
    if (!next || next === map) return;
    map = next;
    redraw();
    onChange(map);
  }

  function isPanTrigger(event: PointerEvent): boolean {
    return event.button === 2 || (event.button === 0 && spaceHeld);
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (isPanTrigger(event)) {
      panning = true;
      panLastX = event.clientX;
      panLastY = event.clientY;
      return;
    }
    if (event.button !== 0) return;
    painting = true;
    lastPaintedCol = Number.NaN;
    lastPaintedRow = Number.NaN;
    paintAt(event.clientX, event.clientY);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (panning) {
      world.x += event.clientX - panLastX;
      world.y += event.clientY - panLastY;
      panLastX = event.clientX;
      panLastY = event.clientY;
      clampCamera();
      return;
    }
    if (painting) paintAt(event.clientX, event.clientY);
  };

  const stopStroke = (): void => {
    painting = false;
    panning = false;
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    // Keep the cell under the cursor fixed while zooming, the way every map tool does.
    const worldX = (screenX - world.x) / world.scale.x;
    const worldY = (screenY - world.y) / world.scale.y;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const scale = clamp(world.scale.x * factor, MIN_ZOOM, MAX_ZOOM);
    world.scale.set(scale);
    world.x = screenX - worldX * scale;
    world.y = screenY - worldY * scale;
    clampCamera();
  };

  const onContextMenu = (event: Event): void => event.preventDefault();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Space") spaceHeld = true;
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") spaceHeld = false;
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  // On window, so releasing or moving off the canvas mid-stroke still ends the stroke cleanly.
  window.addEventListener("pointerup", stopStroke);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const animate = (): void => {
    const now = performance.now();
    const foamFrame = textures.foam[foamFrameAt(now, textures.foam.length)];
    if (foamFrame) for (const blob of foamSprites) blob.texture = foamFrame;
    for (const { sprite, frames } of swaySprites) {
      const frame = frames[swayFrameAt(now, frames.length)];
      if (frame) sprite.texture = frame;
    }
  };
  app.ticker.add(animate);

  fitCamera();
  redraw();

  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    app.ticker.remove(animate);
    // The shared app is not destroyed (Pixi 8 cannot re-init the canvas afterwards); its ticker is
    // paused so an idle editor costs nothing, and it restarts on the next open.
    app.ticker.stop();
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("pointerup", stopStroke);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    // Only this map's display tree goes; the Application, its canvas and the Assets-cached textures
    // (shared with the world renderer) stay, so the next open reuses them instead of re-initializing.
    app.stage.removeChild(world);
    world.destroy({ children: true });
    if (activeSession === session) activeSession = null;
  };
  const session: StageSession = { destroy };
  activeSession = session;

  return {
    setTool(next) {
      tool = next;
    },
    current() {
      return map;
    },
    setName(name) {
      if (name === map.name) return;
      map = { ...map, name };
      onChange(map);
    },
    dispose() {
      // Serialized like open: a dispose must not race a queued open onto the shared canvas. Idempotent
      // via `destroyed`, so a superseded session already torn down by the next open is a no-op here.
      enqueue(destroy);
    },
  };
}
