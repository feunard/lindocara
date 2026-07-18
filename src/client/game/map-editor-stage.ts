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
import { type Application, Assets, Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { MonsterSpecies } from "../../shared/game.js";
import { bakeCollision } from "../../shared/map-data.js";
import { kindAt, TILE_SIZE, type TileMap } from "../../shared/tilemap.js";
import type { EditorAssetId } from "../../shared/tiny-swords-catalog.js";
import { landTile, needsFoam, tileVisual } from "./autotile.js";
import { catalogElementFrameAt, createCatalogElementView } from "./catalog-element-render.js";
import {
  type EditorAssetArt,
  loadEditorAssetArt,
  loadEditorAssetArts,
} from "./editor-asset-art.js";
import type { EditorMap, EditorSelection, EditorTool } from "./editor-state.js";
import {
  applyTool,
  commitEditorHistory,
  createEditorHistory,
  deleteSelection,
  isEditorHistoryDirty,
  markEditorHistorySaved,
  moveSelection,
  redoEditorHistory,
  selectionAt,
  setMarkerLabel,
  undoEditorHistory,
  updateSelectedElementAsset,
  updateSelectedMonster,
} from "./editor-state.js";
import { acquireStageApp } from "./stage-application.js";
import { foamFrameAt } from "./terrain-visuals.js";
import {
  sliceAutotileSheet,
  sliceStrip,
  TINY_SWORDS_FOAM_FRAME,
  TINY_SWORDS_FOAM_FRAMES,
  TINY_SWORDS_TERRAIN,
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
  undo(): void;
  redo(): void;
  markSaved(): void;
  selected(): EditorSelection | null;
  setSelectedMarkerLabel(label: string): boolean;
  moveSelected(col: number, row: number): boolean;
  setSelectedElementAsset(assetId: EditorAssetId): boolean;
  setSelectedMonster(species: MonsterSpecies, patrolRadius: number): boolean;
  deleteSelected(): boolean;
  dispose(): void;
}

export interface MapEditorStageState {
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  selection: EditorSelection | null;
}

/** Camera zoom is clamped to this range, both to keep pixels legible and to stop the map sailing
 *  off into empty space. Matches the brief's 0.5x–2x. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

const SPAWN_MARKER_COLOR = 0xffd54a;
const SPAWN_MARKER_OUTLINE = 0x2a1a05;
const ENTRY_MARKER_COLOR = 0x6fd44c;
const EXIT_MARKER_COLOR = 0x9a6cf0;
const MONSTER_MARKER_COLOR = 0xd9484a;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** A stored `variant` folded into `[0, length)`, sign-safe — the same fold `renderer.ts` applies to
 *  a wire element, so the editor previews the sprite the world will draw. */
interface StageTextures {
  /** `land[row][col]` of the flat sheet's first 4x4 group — indexed straight by `landTile()`. */
  land: Texture[][];
  water: Texture;
  foam: Texture[];
  editorAssets: Map<EditorAssetId, EditorAssetArt>;
}

async function loadStageTextures(assetIds: Iterable<EditorAssetId>): Promise<StageTextures> {
  const [flatSheet, waterTexture, foamSheet] = await Promise.all([
    Assets.load<Texture>(TINY_SWORDS_TERRAIN.flat),
    Assets.load<Texture>(TINY_SWORDS_TERRAIN.water),
    Assets.load<Texture>(TINY_SWORDS_TERRAIN.foam),
  ]);
  // Pixel art, every one: nearest keeps the tiles square exactly as the world renderer does.
  flatSheet.source.style.scaleMode = "nearest";
  waterTexture.source.style.scaleMode = "nearest";
  foamSheet.source.style.scaleMode = "nearest";

  return {
    land: sliceAutotileSheet(flatSheet),
    water: waterTexture,
    foam: sliceStrip(foamSheet, TINY_SWORDS_FOAM_FRAME, TINY_SWORDS_FOAM_FRAMES),
    editorAssets: await loadEditorAssetArts(assetIds),
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
    undo() {},
    redo() {},
    markSaved() {},
    selected: () => null,
    setSelectedMarkerLabel: () => false,
    moveSelected: () => false,
    setSelectedElementAsset: () => false,
    setSelectedMonster: () => false,
    deleteSelected: () => false,
    dispose() {},
  };
}

// The single Pixi Application bound to #stage now lives in stage-application.ts, created once and
// shared with the world renderer: playing the game after visiting the editor (no reload) reuses that
// one app instead of racing a second one onto the canvas. This stays a thin delegate so the build
// and dispose serialization below reads exactly as before.
function ensureStageApp(canvas: HTMLCanvasElement): Promise<Application> {
  return acquireStageApp(canvas);
}

/**
 * Opens the painting stage on `#stage` and returns the handle React drives it with. Opens are
 * serialized so only one map is ever mounted on the shared Application at a time, and StrictMode's
 * throwaway first mount builds nothing. `dispose()` tears down the painted world but leaves the
 * shared Application on the canvas for the next consumer, because Pixi 8 cannot re-init a destroyed
 * canvas.
 *
 * The Application is the page-wide singleton owned by stage-application.ts, so leaving the editor and
 * playing the game (no reload) hands that same app to the world renderer rather than putting a second
 * renderer on the canvas. This stage owns only its own root container, listeners and ticker callback
 * and removes exactly those in `destroy()`, which is what makes that handoff clean.
 */
export function openMapEditorStage(
  initial: EditorMap,
  onChange: (map: EditorMap, state: MapEditorStageState) => void,
): Promise<MapEditorStageHandle> {
  const generation = ++openGeneration;
  return enqueue(() => buildSession(initial, onChange, generation));
}

async function buildSession(
  initial: EditorMap,
  onChange: (map: EditorMap, state: MapEditorStageState) => void,
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
  canvas.dataset.cursor = "paint";

  // Tear down the previous session's world before building this one — this runs inside the
  // serialized chain, so only ever one map is mounted on the shared app's stage at a time.
  if (activeSession) {
    activeSession.destroy();
    activeSession = null;
  }

  const app = await ensureStageApp(canvas);
  app.ticker.start();

  const textures = await loadStageTextures(initial.elements.map((element) => element.assetId));

  let map = initial;
  let history = createEditorHistory(initial);
  let selected: EditorSelection | null = null;
  let tool: EditorTool = { kind: "block", block: "grass" };

  const notify = (): void => {
    onChange(map, {
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      dirty: isEditorHistoryDirty(history, map),
      selection: selected,
    });
  };

  // Back-to-front: flat water, then foam bleeding out from the shore, then the opaque land tiles
  // that hide the water and the middle of each foam blob, then props, then the spawn marker on top.
  const world = new Container();
  const waterLayer = new Container();
  const foamLayer = new Container();
  const landLayer = new Container();
  const groundElementLayer = new Container();
  const objectElementLayer = new Container();
  const canopyElementLayer = new Container();
  const markerLayer = new Container();
  world.addChild(
    waterLayer,
    foamLayer,
    landLayer,
    groundElementLayer,
    objectElementLayer,
    canopyElementLayer,
    markerLayer,
  );
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
    for (const layer of [
      waterLayer,
      foamLayer,
      landLayer,
      groundElementLayer,
      objectElementLayer,
      canopyElementLayer,
      markerLayer,
    ]) {
      for (const child of layer.removeChildren()) child.destroy({ children: true });
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
    drawMarkers();
  }

  /** Props, painted the way `renderer.ts`'s `#buildMapElements` does: y-sorted so a lower tree
   *  overlaps a higher one, anchored bottom-centre and pushed down by each sheet's empty footer so
   *  the object stands on its cell rather than floating over it. */
  function drawElements(): void {
    const ordered = [...map.elements].sort((a, b) => a.row - b.row || a.col - b.col);
    for (const element of ordered) {
      const art = textures.editorAssets.get(element.assetId);
      if (!art) continue;
      const view = createCatalogElementView(element, art);
      if (!view) continue;
      const layer =
        view.layer === "ground"
          ? groundElementLayer
          : view.layer === "canopy"
            ? canopyElementLayer
            : objectElementLayer;
      layer.addChild(view.container);
      if (view.frames.length > 1)
        swaySprites.push({ sprite: view.sprite, frames: [...view.frames] });
    }
  }

  /** A colored diamond centred on a cell — the one shape every editor marker (spawn, entry, exit,
   *  monster spawn) renders as, distinguished only by fill color. */
  function drawDiamond(col: number, row: number, color: number): void {
    const cx = col * TILE_SIZE + TILE_SIZE / 2;
    const cy = row * TILE_SIZE + TILE_SIZE / 2;
    const marker = new Graphics();
    marker
      .moveTo(cx, cy - 22)
      .lineTo(cx + 17, cy)
      .lineTo(cx, cy + 22)
      .lineTo(cx - 17, cy)
      .closePath()
      .fill({ color, alpha: 0.85 })
      .stroke({ width: 3, color: SPAWN_MARKER_OUTLINE, alpha: 0.9 });
    markerLayer.addChild(marker);
  }

  /** A gold diamond on the spawn cell — a marker the brief leaves to taste, chosen to read clearly
   *  over both grass and water without hiding what is under it. */
  function drawSpawnMarker(): void {
    drawDiamond(map.spawn.col, map.spawn.row, SPAWN_MARKER_COLOR);
  }

  /** Editor-only overlays: adventure graphs bind these cells, so they must be visible while editing. */
  function drawMarkers(): void {
    for (const entry of map.markers.entries) drawDiamond(entry.col, entry.row, ENTRY_MARKER_COLOR);
    for (const exit of map.markers.exits) drawDiamond(exit.col, exit.row, EXIT_MARKER_COLOR);
    for (const spawn of map.markers.monsterSpawns) {
      drawDiamond(spawn.col, spawn.row, MONSTER_MARKER_COLOR);
      const ring = new Graphics();
      ring
        .circle(
          spawn.col * TILE_SIZE + TILE_SIZE / 2,
          spawn.row * TILE_SIZE + TILE_SIZE / 2,
          spawn.patrolRadius,
        )
        .stroke({ width: 2, color: MONSTER_MARKER_COLOR, alpha: 0.35 });
      markerLayer.addChild(ring);
    }
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
  let strokeStart: EditorMap | null = null;

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
    if (tool.kind === "select") {
      selected = selectionAt(map, col, row);
      notify();
      return;
    }
    const next = applyTool(map, tool, col, row);
    // null → refused (does nothing visible); same reference → a no-op edit (eraser on empty).
    if (!next || next === map) return;
    map = next;
    redraw();
    notify();
  }

  function isPanTrigger(event: PointerEvent): boolean {
    return event.button === 2 || (event.button === 0 && (spaceHeld || tool.kind === "pan"));
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (isPanTrigger(event)) {
      panning = true;
      canvas.dataset.cursor = "move";
      panLastX = event.clientX;
      panLastY = event.clientY;
      return;
    }
    if (event.button !== 0) return;
    painting = true;
    strokeStart = map;
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
    if (strokeStart && strokeStart !== map) {
      history = commitEditorHistory({ ...history, present: strokeStart }, map);
      notify();
    }
    strokeStart = null;
    painting = false;
    panning = false;
    canvas.dataset.cursor =
      tool.kind === "pan" ? "move" : tool.kind === "select" ? "select" : "paint";
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
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
      event.preventDefault();
      stopStroke();
      if (event.shiftKey) {
        history = redoEditorHistory(history);
      } else {
        history = undoEditorHistory(history);
      }
      map = { ...history.present, name: map.name };
      history = { ...history, present: map };
      selected = null;
      redraw();
      notify();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyY") {
      event.preventDefault();
      stopStroke();
      history = redoEditorHistory(history);
      map = { ...history.present, name: map.name };
      history = { ...history, present: map };
      selected = null;
      redraw();
      notify();
      return;
    }
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
      const frame = catalogElementFrameAt(now, frames);
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
    delete canvas.dataset.cursor;
    // Only this map's display tree goes; the Application, its canvas and the Assets-cached textures
    // (shared with the world renderer) stay, so the next open reuses them instead of re-initializing.
    app.stage.removeChild(world);
    world.destroy({ children: true });
    if (activeSession === session) activeSession = null;
  };
  const session: StageSession = { destroy };
  activeSession = session;

  const commitInspectorChange = (
    next: EditorMap | null,
    nextSelection: EditorSelection | null = selected,
  ): boolean => {
    if (!next || next === map) return false;
    history = commitEditorHistory({ ...history, present: map }, next);
    map = next;
    selected = nextSelection;
    redraw();
    notify();
    return true;
  };

  const ensureAsset = (assetId: EditorAssetId): void => {
    if (textures.editorAssets.has(assetId)) return;
    void loadEditorAssetArt(assetId).then((art) => {
      if (destroyed) return;
      textures.editorAssets.set(assetId, art);
      redraw();
    });
  };

  return {
    setTool(next) {
      tool = next;
      if (next.kind === "element") ensureAsset(next.assetId);
      canvas.dataset.cursor =
        tool.kind === "pan" ? "move" : tool.kind === "select" ? "select" : "paint";
    },
    current() {
      return map;
    },
    setName(name) {
      if (name === map.name) return;
      map = { ...map, name };
      notify();
    },
    undo() {
      stopStroke();
      const next = undoEditorHistory(history);
      if (next === history) return;
      history = next;
      map = { ...history.present, name: map.name };
      history = { ...history, present: map };
      selected = null;
      redraw();
      notify();
    },
    redo() {
      stopStroke();
      const next = redoEditorHistory(history);
      if (next === history) return;
      history = next;
      map = { ...history.present, name: map.name };
      history = { ...history, present: map };
      selected = null;
      redraw();
      notify();
    },
    markSaved() {
      history = markEditorHistorySaved(history, map);
      notify();
    },
    selected() {
      return selected;
    },
    setSelectedMarkerLabel(label) {
      if (!selected || (selected.kind !== "entry" && selected.kind !== "exit")) return false;
      return commitInspectorChange(setMarkerLabel(map, selected, label));
    },
    moveSelected(col, row) {
      if (!selected) return false;
      const previous = selected;
      const nextSelection: EditorSelection =
        previous.kind === "element" || previous.kind === "monster"
          ? { ...previous, col, row }
          : previous;
      return commitInspectorChange(moveSelection(map, previous, col, row), nextSelection);
    },
    setSelectedElementAsset(assetId) {
      if (selected?.kind !== "element") return false;
      ensureAsset(assetId);
      return commitInspectorChange(updateSelectedElementAsset(map, selected, assetId));
    },
    setSelectedMonster(species, patrolRadius) {
      if (selected?.kind !== "monster") return false;
      return commitInspectorChange(updateSelectedMonster(map, selected, species, patrolRadius));
    },
    deleteSelected() {
      if (!selected || selected.kind === "spawn") return false;
      const next = deleteSelection(map, selected);
      return commitInspectorChange(next, null);
    },
    dispose() {
      // Serialized like open: a dispose must not race a queued open onto the shared canvas. Idempotent
      // via `destroyed`, so a superseded session already torn down by the next open is a no-op here.
      enqueue(destroy);
    },
  };
}
