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
import { type Application, Assets, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import {
  bakeCollision,
  ELEMENT_OFFSET_PX,
  ELEMENT_OFFSET_STEPS,
  MAP_LAYERS,
  quarterCellAt,
} from "../../shared/map-data.js";
import type { EventKind, MapEvent } from "../../shared/map-events.js";
import type { TileLayer } from "../../shared/tile-layer-codec.js";
import { TILE_SIZE, type TileMap } from "../../shared/tilemap.js";
import type { Tileset } from "../../shared/tileset.js";
import {
  TINY_SWORDS_SHEET_COLS,
  TINY_SWORDS_SHEET_ROWS,
  TINY_SWORDS_TILESET,
} from "../../shared/tilesets/tiny-swords.js";
import type { EditorAssetId } from "../../shared/tiny-swords-catalog.js";
import { needsFoam } from "./autotile.js";
import {
  catalogElementFrameAt,
  createCatalogElementView,
  createEventGraphicSprite,
} from "./catalog-element-render.js";
import {
  type EditorAssetArt,
  loadEditorAssetArt,
  loadEditorAssetArts,
} from "./editor-asset-art.js";
import type { EditorMap, EditorMode, EditorSelection, EditorTool } from "./editor-state.js";
import {
  applyTool,
  beginEventDraft,
  commitEditorHistory,
  commitEventDraft,
  createEditorHistory,
  deleteSelection,
  editorMapSize,
  isEditorHistoryDirty,
  markEditorHistorySaved,
  moveSelection,
  placementLegalAt,
  redoEditorHistory,
  selectionAt,
  setActiveMode,
  toMapData,
  undoEditorHistory,
  updateSelectedElementAsset,
  updateSelectedElementOffset,
} from "./editor-state.js";
import { acquireStageApp } from "./stage-application.js";
import { foamFrameAt } from "./terrain-visuals.js";
import { tileDrawAt } from "./tile-draw.js";
import {
  sliceStrip,
  sliceTilesetSheet,
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
  /** Which of the three authored collections (terrain / elements / events) the editor is working in.
   *  Routes the eraser, gates every other tool, and drives the dim overlay. Lives on `EditorHistory`,
   *  survives undo/redo, and is threaded into every `applyTool` call from `paintAt`. React owns the
   *  displayed value and pushes it down here. */
  setActiveMode(mode: EditorMode): void;
  /** Editor-only "dim other modes": with it on, the two planes the active mode does NOT own drop to
   *  `DIM_ALPHA`, so the author can see which collection a stroke lands on. Never touches the game
   *  renderer. React owns the toggle and pushes it down here. */
  setDim(dim: boolean): void;
  /** UX wave #8: toggle the cell grid overlay. On by default so a fresh editor shows the grid; React
   *  owns the displayed value and pushes it down here. */
  setGrid(show: boolean): void;
  current(): EditorMap;
  setName(name: string): void;
  undo(): void;
  redo(): void;
  markSaved(): void;
  selected(): EditorSelection | null;
  moveSelected(col: number, row: number): boolean;
  setSelectedElementAsset(assetId: EditorAssetId): boolean;
  /** Re-place the selected element at a new quarter-cell offset (0..3 per axis) as one history entry;
   *  a no-op for any non-element selection. */
  setSelectedElementOffset(offsetX: number, offsetY: number): boolean;
  deleteSelected(): boolean;
  /** A detached draft copy of one event for the dialog to edit, or `null` if the id names no live
   *  event. Reads the live map; writes nothing. */
  beginEventDraft(id: string): MapEvent | null;
  /** Commit an edited event draft back onto the map as ONE history entry (the dialog's Save). */
  commitEventDraft(draft: MapEvent): void;
  /** Delete an event by id as its own history entry (the dialog's delete-event). */
  deleteEvent(id: string): void;
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

/** How far the two non-active planes fade when "dim other modes" is on. Editor-only; the game
 *  renderer never applies it. */
const DIM_ALPHA = 0.35;

/**
 * Apply "dim other modes" across the three authored planes: the tile layers (Field), the element
 * containers (Element) and the event overlay (Event). With `dim` on, the two planes the active mode
 * does NOT own drop to `DIM_ALPHA`; the active plane — and every plane when `dim` is off — stays fully
 * opaque. Pure and Pixi-object-only (a `Container`'s `alpha` needs no renderer), so it pins the dim
 * rule without the rest of the stage, exactly like `paintLandCell`.
 */
export function applyModeDim(
  tileLayers: readonly Container[],
  elementContainers: readonly Container[],
  eventOverlay: Container,
  mode: EditorMode,
  dim: boolean,
): void {
  const tileAlpha = dim && mode !== "field" ? DIM_ALPHA : 1;
  const elementAlpha = dim && mode !== "element" ? DIM_ALPHA : 1;
  const eventAlpha = dim && mode !== "event" ? DIM_ALPHA : 1;
  for (const container of tileLayers) container.alpha = tileAlpha;
  for (const container of elementContainers) container.alpha = elementAlpha;
  eventOverlay.alpha = eventAlpha;
}

/** The wireframe's `EV{ordinal}` chip text: the creation ordinal zero-padded to three digits, so the
 *  first event on a map reads `EV001`. Display only — the uuid is identity, never this. */
export function eventChipLabel(ordinal: number): string {
  return `EV${String(ordinal).padStart(3, "0")}`;
}

/** The event overlay is a mode, not always-on: events show only while the event tool is the active
 *  tool (the wireframe's EV layer), and are hidden under every other tool. Pure so the visibility
 *  gate can be pinned without the rest of the stage, exactly like `applyLayerDim`. */
export function shouldShowEventOverlay(tool: EditorTool): boolean {
  return tool.kind === "event";
}

/**
 * Whether switching from `prev` to `next` flips the EV overlay's visibility — the ONE thing `setTool`
 * must `redraw()` for. The overlay is the only stage content that reacts to the active tool; every
 * other tool swap (pencil↔rect↔fill↔eraser↔select) changes nothing drawn, so gating the redraw on
 * this predicate is what stops each P/R/F/E/S keypress from rebuilding the whole map for nothing.
 * Pure so the gate can be pinned without the stage, exactly like `shouldShowEventOverlay`.
 */
export function eventOverlayToggled(prev: EditorTool, next: EditorTool): boolean {
  return shouldShowEventOverlay(prev) !== shouldShowEventOverlay(next);
}

/** UX wave #9: the hover preview shows for placement tools, but never for select/pan — those tools
 *  point at existing content rather than propose a placement, so a "can I place here?" outline would
 *  be noise. Pure so the visibility gate pins without the stage, exactly like `shouldShowEventOverlay`. */
export function shouldShowHoverPreview(tool: EditorTool): boolean {
  return tool.kind !== "select" && tool.kind !== "pan";
}

const HOVER_OUTLINE_COLOR = 0xffffff;
/** The "wider cell border" the user asked for: a 3px preview outline, versus the map's 1px grid. */
const HOVER_OUTLINE_WIDTH = 3;
const HOVER_ILLEGAL_COLOR = 0xd41f1f;

/**
 * Draws the UX wave #9 hover feedback for ONE cell into `container`: always a thick preview outline,
 * plus an OPAQUE red cell fill UNDER that outline when `placementLegalAt` says the active tool cannot
 * place here. Returns whether it drew the illegal fill, which is the render decision the stage test
 * pins.
 *
 * Exported and kept Pixi-object-only like `paintEventCell`/`paintLandCell` — `Graphics` constructs
 * without a live renderer — so the red-vs-clear decision can be pinned without the WebGL context the
 * rest of the stage needs. Rendering only: it never mutates the map and nothing here runs in the game.
 */
export function paintHoverCell(
  tool: EditorTool,
  map: EditorMap,
  col: number,
  row: number,
  mode: EditorMode,
  container: Container,
  offsetX = 0,
  offsetY = 0,
): { illegal: boolean } {
  const x = col * TILE_SIZE + offsetX * ELEMENT_OFFSET_PX;
  const y = row * TILE_SIZE + offsetY * ELEMENT_OFFSET_PX;
  const illegal = !placementLegalAt(tool, map, col, row, mode);
  if (illegal) {
    const fill = new Graphics();
    fill.rect(x, y, TILE_SIZE, TILE_SIZE).fill({ color: HOVER_ILLEGAL_COLOR, alpha: 1 });
    container.addChild(fill);
  }
  const outline = new Graphics();
  const inset = HOVER_OUTLINE_WIDTH / 2;
  outline
    .rect(x + inset, y + inset, TILE_SIZE - HOVER_OUTLINE_WIDTH, TILE_SIZE - HOVER_OUTLINE_WIDTH)
    .stroke({
      width: HOVER_OUTLINE_WIDTH,
      color: illegal ? HOVER_ILLEGAL_COLOR : HOVER_OUTLINE_COLOR,
      alpha: 1,
    });
  container.addChild(outline);
  return { illegal };
}

/** The 1px cell grid overlay (UX wave #8), one Graphics of lines for the whole map. Pure and
 *  Pixi-object-only so it needs no live renderer; `gridLayer.visible` toggles it without a rebuild. */
const GRID_COLOR = 0x0e1a12;

const EVENT_BOX_COLOR = 0x27272a;
const EVENT_CHIP_BG_COLOR = 0x18181b;
const EVENT_CHIP_TEXT_COLOR = 0xfafafa;
const EVENT_SELECTION_COLOR = 0xffffff;

/**
 * The placeholder swatch colour per event kind, so the four kinds read apart at a glance on the EV
 * overlay: `normal` is the wireframe's violet, and entry/exit/monster inherit the old marker palette
 * they replace (green arrival, violet-blue departure, red spawn). A `normal` event with a page-1
 * graphic draws that sprite instead of the swatch; the functional kinds never carry a graphic, so
 * their swatch is always their identity on the overlay.
 */
const EVENT_KIND_PLACEHOLDER_COLOR: Record<EventKind, number> = {
  normal: 0x7c3aed,
  entry: 0x6fd44c,
  exit: 0x9a6cf0,
  monster: 0xd9484a,
};

/** What `paintEventCell` decided and drew for one event: the chip text, whether it drew the page-1
 *  graphic (vs the blank placeholder), and whether it drew the selection outline. */
export interface EventCellDraw {
  chipText: string;
  hasGraphic: boolean;
  selected: boolean;
}

/**
 * Draws one authored event into the overlay container: the wireframe's faint bounding box, then
 * either its page-1 catalogue graphic (when that art is loaded) or the blank placeholder square, an
 * `EV{ordinal}` chip, and a selection outline when it is selected.
 *
 * Exported and kept Pixi-object-only like `paintLandCell` — `Container`/`Sprite`/`Graphics`/`Text`
 * all construct without a live renderer — so the per-event draw decision (graphic vs placeholder,
 * chip text, selection) can be pinned without the WebGL context the rest of the stage needs.
 *
 * Rendering only: it never mutates the map and nothing here runs in the game.
 */
export function paintEventCell(
  event: MapEvent,
  art: EditorAssetArt | undefined,
  selected: boolean,
  container: Container,
): EventCellDraw {
  const x = event.col * TILE_SIZE;
  const y = event.row * TILE_SIZE;

  const box = new Graphics();
  box
    .rect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2)
    .fill({ color: EVENT_BOX_COLOR, alpha: 0.04 })
    .stroke({ width: 1, color: EVENT_BOX_COLOR, alpha: 0.55 });
  container.addChild(box);

  // The graphic branch needs both a page-1 graphic AND its art loaded; a graphic whose art has not
  // arrived yet falls back to the placeholder until the next redraw, exactly like an element's art.
  const graphicId = event.pages[0]?.graphicAssetId ?? null;
  const frame = graphicId === null ? undefined : art?.frames[0];
  const hasGraphic = frame !== undefined;
  if (frame) {
    // The shared event crop (`createEventGraphicSprite`), so the overlay and the game renderer draw a
    // page graphic identically — a fixed one-cell marker anchored bottom-centre and fit into ~1.6
    // tiles, deliberately NOT `createCatalogElementView`'s per-asset footprint. Same catalogue art,
    // one event placement contract for both trees.
    container.addChild(createEventGraphicSprite(event.col, event.row, frame));
  } else {
    // The blank placeholder, coloured by kind so entry/exit/monster events (which never carry a
    // graphic) read apart from each other and from a scripted `normal` event.
    const placeholder = new Graphics();
    placeholder
      .roundRect(x + TILE_SIZE * 0.2, y + TILE_SIZE * 0.2, TILE_SIZE * 0.6, TILE_SIZE * 0.6, 4)
      .fill({ color: EVENT_KIND_PLACEHOLDER_COLOR[event.kind], alpha: 0.85 });
    container.addChild(placeholder);
  }

  // A monster event carries its patrol radius, so the overlay draws the same reach ring the old
  // monster marker did — a faint circle centred on the cell — right on the EV plane.
  if (event.kind === "monster" && event.patrolRadius !== null) {
    const ring = new Graphics();
    ring
      .circle(x + TILE_SIZE / 2, y + TILE_SIZE / 2, event.patrolRadius)
      .stroke({ width: 2, color: EVENT_KIND_PLACEHOLDER_COLOR.monster, alpha: 0.35 });
    container.addChild(ring);
  }

  const chipText = eventChipLabel(event.ordinal);
  // Chip width derived from the text length rather than measured, so the backing plate is stable
  // without a canvas 2D context (jsdom has none, which is where this function is pinned).
  const chipBg = new Graphics();
  chipBg.rect(x, y, chipText.length * 6 + 4, 12).fill({ color: EVENT_CHIP_BG_COLOR, alpha: 0.9 });
  container.addChild(chipBg);
  const chip = new Text({
    text: chipText,
    style: { fontFamily: "monospace", fontSize: 9, fill: EVENT_CHIP_TEXT_COLOR },
  });
  chip.position.set(x + 2, y + 1);
  container.addChild(chip);

  if (selected) {
    const outline = new Graphics();
    outline
      .rect(x, y, TILE_SIZE, TILE_SIZE)
      .stroke({ width: 2, color: EVENT_SELECTION_COLOR, alpha: 0.95 });
    container.addChild(outline);
  }

  return { chipText, hasGraphic, selected };
}

/** The page-1 graphic ids across a set of events, deduplicated by the caller's loader. Only page 1
 *  renders on the overlay, so only its graphic needs preloading. */
function eventGraphicAssetIds(events: readonly MapEvent[]): EditorAssetId[] {
  const ids: EditorAssetId[] = [];
  for (const event of events) {
    const graphicId = event.pages[0]?.graphicAssetId ?? null;
    if (graphicId !== null) ids.push(graphicId);
  }
  return ids;
}

const SPAWN_MARKER_COLOR = 0xffd54a;
const SPAWN_MARKER_OUTLINE = 0x2a1a05;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Draws one cell's worth of layers, routing each resolved tile into the container its own tileset
 * entry's `priority` selects — `land` for "below", `above` for "above". Mirrors `renderer.ts`'s
 * `#tilesBelow`/`#tilesAbove` split so the editor never draws a priority-"above" tile (a treetop, an
 * upper cliff lip) on the wrong side of a prop from the game it is previewing.
 *
 * Exported and kept free of the Application/canvas the rest of this module needs, because
 * `Container`/`Sprite` construct and accept children without a live renderer — a fixture tileset can
 * pin the routing directly, which is not true of `openMapEditorStage` as a whole.
 *
 * Returns whether anything was drawn, which callers use to decide whether the cell needs foam.
 */
export function paintLandCell(
  tileset: Tileset,
  layers: readonly TileLayer[],
  sheet: Texture[][],
  col: number,
  row: number,
  land: Container,
  above: Container,
): boolean {
  let drewAnything = false;
  for (const layer of layers) {
    const draw = tileDrawAt(tileset, layer, col, row);
    if (!draw) continue;
    const texture = sheet[draw.cell.row]?.[draw.cell.col];
    if (!texture) continue;
    const tile = new Sprite(texture);
    tile.position.set(col * TILE_SIZE, row * TILE_SIZE);
    tile.width = TILE_SIZE;
    tile.height = TILE_SIZE;
    tile.tint = draw.tint;
    (draw.priority === "above" ? above : land).addChild(tile);
    drewAnything = true;
  }
  return drewAnything;
}

/** A stored `variant` folded into `[0, length)`, sign-safe — the same fold `renderer.ts` applies to
 *  a wire element, so the editor previews the sprite the world will draw. */
interface StageTextures {
  /** The whole `Tilemap_color1.png` grid, `[row][col]` — the same slice the world renderer
   *  indexes a frozen tile id into, so both draw an authored map from one sheet layout. */
  tileset: Texture[][];
  water: Texture;
  foam: Texture[];
  editorAssets: Map<EditorAssetId, EditorAssetArt>;
}

async function loadStageTextures(assetIds: Iterable<EditorAssetId>): Promise<StageTextures> {
  const [tilesetSheet, waterTexture, foamSheet] = await Promise.all([
    Assets.load<Texture>(TINY_SWORDS_TERRAIN.tileset),
    Assets.load<Texture>(TINY_SWORDS_TERRAIN.water),
    Assets.load<Texture>(TINY_SWORDS_TERRAIN.foam),
  ]);
  // Pixel art, every one: nearest keeps the tiles square exactly as the world renderer does.
  tilesetSheet.source.style.scaleMode = "nearest";
  waterTexture.source.style.scaleMode = "nearest";
  foamSheet.source.style.scaleMode = "nearest";

  return {
    tileset: sliceTilesetSheet(tilesetSheet, TINY_SWORDS_SHEET_COLS, TINY_SWORDS_SHEET_ROWS),
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
    setActiveMode() {},
    setDim() {},
    setGrid() {},
    current: () => map,
    setName() {},
    undo() {},
    redo() {},
    markSaved() {},
    selected: () => null,
    moveSelected: () => false,
    setSelectedElementAsset: () => false,
    setSelectedElementOffset: () => false,
    deleteSelected: () => false,
    beginEventDraft: () => null,
    commitEventDraft() {},
    deleteEvent() {},
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
  onCursorCell?: (col: number | null, row: number | null) => void,
  onOpenEvent?: (id: string) => void,
): Promise<MapEditorStageHandle> {
  const generation = ++openGeneration;
  return enqueue(() => buildSession(initial, onChange, generation, onCursorCell, onOpenEvent));
}

async function buildSession(
  initial: EditorMap,
  onChange: (map: EditorMap, state: MapEditorStageState) => void,
  generation: number,
  onCursorCell?: (col: number | null, row: number | null) => void,
  onOpenEvent?: (id: string) => void,
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

  const textures = await loadStageTextures([
    ...initial.elements.map((element) => element.assetId),
    ...eventGraphicAssetIds(initial.events),
  ]);

  let map = initial;
  let history = createEditorHistory(initial);
  let selected: EditorSelection | null = null;
  let tool: EditorTool = { kind: "block", block: "grass" };
  let dim = false;

  const notify = (): void => {
    onChange(map, {
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      dirty: isEditorHistoryDirty(history, map),
      selection: selected,
    });
  };

  // Back-to-front: flat water, then foam bleeding out from the shore, then the opaque land tiles
  // that hide the water and the middle of each foam blob, then props, then any tile whose priority
  // is "above" (mirrors renderer.ts's `#tilesAbove`, which paints after `#groundDecor`/`#structures`/
  // `#actors` — a treetop or an upper cliff lip a character walks *behind*), then the editor's own
  // spawn/marker icons on top of everything, same as the renderer keeps its labels/overlays above
  // `#tilesAbove`.
  const world = new Container();
  const waterLayer = new Container();
  const foamLayer = new Container();
  // One below-priority land container per logical tile layer, stacked in layer order in the same
  // z-slot the single `landLayer` used to occupy — so the composite is visually identical, but each
  // logical layer's tiles are now separable, which is what "dim other layers" fades independently.
  const tileLayers: Container[] = Array.from({ length: MAP_LAYERS }, () => new Container());
  const groundElementLayer = new Container();
  const objectElementLayer = new Container();
  const canopyElementLayer = new Container();
  // The three prop containers as one group, so `applyModeDim` can fade the whole Element plane at
  // once (Field/Event modes dim it together).
  const elementContainers = [groundElementLayer, objectElementLayer, canopyElementLayer];
  const aboveLandLayer = new Container();
  // The cell grid (UX wave #8), above the terrain/props so it reads over both land and sea, below the
  // markers so a spawn/entry diamond still sits clearly on top. Built once (map size is fixed for a
  // session) and toggled by `.visible`, not rebuilt per stroke.
  const gridLayer = new Container();
  let gridVisible = true;
  const markerLayer = new Container();
  // Events are the topmost plane, above markers and props, and only shown in "EV mode" (the event
  // tool). Its visibility is driven by `shouldShowEventOverlay(tool)`, never by content.
  const eventLayer = new Container();
  eventLayer.visible = shouldShowEventOverlay(tool);
  // The hover preview overlay (UX wave #9) sits above everything, so its outline and opaque-red
  // illegal fill read over any content. Managed on pointer move, never in `redraw()`.
  const hoverLayer = new Container();
  world.addChild(
    waterLayer,
    foamLayer,
    ...tileLayers,
    groundElementLayer,
    objectElementLayer,
    canopyElementLayer,
    aboveLandLayer,
    gridLayer,
    markerLayer,
    eventLayer,
    hoverLayer,
  );
  app.stage.addChild(world);

  // Rebuilt every redraw; the ticker retextures these in place so the coastline and the trees are
  // alive while you paint, not only after.
  let foamSprites: Sprite[] = [];
  let swaySprites: { sprite: Sprite; frames: Texture[] }[] = [];

  const mapCols = (): number => editorMapSize(map).cols;
  const mapRows = (): number => editorMapSize(map).rows;

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
      ...tileLayers,
      groundElementLayer,
      objectElementLayer,
      canopyElementLayer,
      aboveLandLayer,
      markerLayer,
      eventLayer,
    ]) {
      for (const child of layer.removeChildren()) child.destroy({ children: true });
    }
    foamSprites = [];
    swaySprites = [];

    const tiles: TileMap = bakeCollision(toMapData(map));
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
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        // Every layer that has something to say about this cell, in order, through the same
        // `tileDrawAt` the world renderer paints with — the editor cannot resolve a tile id
        // differently from the game it is previewing. Each logical layer draws its below-priority
        // tiles into its own container (so dim can fade them one layer at a time) and its rare
        // above-priority tiles into the shared `aboveLandLayer`, keeping the renderer's z-split.
        let drewAnything = false;
        for (let layerIndex = 0; layerIndex < map.layers.length; layerIndex++) {
          const layer = map.layers[layerIndex];
          const container = tileLayers[layerIndex];
          if (!layer || !container) continue;
          if (
            paintLandCell(
              TINY_SWORDS_TILESET,
              [layer],
              textures.tileset,
              col,
              row,
              container,
              aboveLandLayer,
            )
          ) {
            drewAnything = true;
          }
        }

        // Foam reads the baked tilemap, not the layers: a cliff face meeting the sea is not ground,
        // but it is still where the water meets something, and that is where the rim belongs.
        if (drewAnything && needsFoam(tiles, col, row)) {
          // Native 192px frame centred on the 64px cell: the ~82px blob bleeds ~9px past the tile,
          // and that bleed IS the shoreline. Scaling it to the tile would erase the shore.
          const blob = new Sprite(textures.foam[0] ?? textures.water);
          blob.anchor.set(0.5);
          blob.position.set(x + TILE_SIZE / 2, y + TILE_SIZE / 2);
          foamLayer.addChild(blob);
          foamSprites.push(blob);
        }
      }
    }

    drawElements();
    drawSpawnMarker();
    drawEvents();
  }

  /** Every authored event on the EV overlay: its page-1 graphic or the blank placeholder, its chip,
   *  and a selection outline on the selected one. Hidden unless the event tool is active. */
  function drawEvents(): void {
    eventLayer.visible = shouldShowEventOverlay(tool);
    for (const event of map.events) {
      const graphicId = event.pages[0]?.graphicAssetId ?? null;
      const art = graphicId === null ? undefined : textures.editorAssets.get(graphicId);
      const isSelected = selected?.kind === "event" && selected.id === event.id;
      paintEventCell(event, art, isSelected, eventLayer);
    }
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

  /** A gold diamond on the spawn cell — the hero spawn, the one always-on editor marker (entries,
   *  exits and monster spawns are events now, drawn on the EV overlay). Chosen to read clearly over
   *  both grass and water without hiding what is under it. */
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

  /** The 1px cell grid across the whole map, built once and toggled by `gridLayer.visible`. In
   *  Element mode it also draws the quarter-cell sub-divisions at a lower alpha, so the author sees
   *  where a decoration will snap; Field and Event modes stay whole-cell. */
  function drawGrid(): void {
    for (const child of gridLayer.removeChildren()) child.destroy();
    const { cols, rows } = editorMapSize(map);
    if (history.activeMode === "element") {
      const subGrid = new Graphics();
      const mapW = cols * TILE_SIZE;
      const mapH = rows * TILE_SIZE;
      for (let col = 0; col < cols; col++) {
        for (let step = 1; step < ELEMENT_OFFSET_STEPS; step++) {
          const x = col * TILE_SIZE + step * ELEMENT_OFFSET_PX;
          subGrid.moveTo(x, 0).lineTo(x, mapH);
        }
      }
      for (let row = 0; row < rows; row++) {
        for (let step = 1; step < ELEMENT_OFFSET_STEPS; step++) {
          const y = row * TILE_SIZE + step * ELEMENT_OFFSET_PX;
          subGrid.moveTo(0, y).lineTo(mapW, y);
        }
      }
      subGrid.stroke({ width: 1, color: GRID_COLOR, alpha: 0.14 });
      gridLayer.addChild(subGrid);
    }
    const grid = new Graphics();
    for (let col = 0; col <= cols; col++) {
      grid.moveTo(col * TILE_SIZE, 0).lineTo(col * TILE_SIZE, rows * TILE_SIZE);
    }
    for (let row = 0; row <= rows; row++) {
      grid.moveTo(0, row * TILE_SIZE).lineTo(cols * TILE_SIZE, row * TILE_SIZE);
    }
    grid.stroke({ width: 1, color: GRID_COLOR, alpha: 0.35 });
    gridLayer.addChild(grid);
    gridLayer.visible = gridVisible;
  }

  // The cell the pointer is currently over, so the hover overlay redraws only when it changes cell (or
  // when the tool/map under it changes), never per pixel. `NaN` is the off-canvas state. In Element
  // mode `hoverOffsetX`/`hoverOffsetY` carry the quarter-step within that cell so the preview snaps to
  // the same pixel a placement would.
  let hoverCol = Number.NaN;
  let hoverRow = Number.NaN;
  let hoverOffsetX = 0;
  let hoverOffsetY = 0;

  /** Repaint the hover preview for the current cell/tool/map: cleared when off-canvas, out of bounds,
   *  or the active tool has no placement to preview (select/pan). Element mode shifts the preview by
   *  the quarter-cell offset; Field and Event modes stay whole-cell. */
  function drawHover(): void {
    for (const child of hoverLayer.removeChildren()) child.destroy();
    if (!shouldShowHoverPreview(tool)) return;
    if (Number.isNaN(hoverCol) || Number.isNaN(hoverRow)) return;
    const { cols, rows } = editorMapSize(map);
    if (hoverCol < 0 || hoverRow < 0 || hoverCol >= cols || hoverRow >= rows) return;
    const inElementMode = history.activeMode === "element";
    paintHoverCell(
      tool,
      map,
      hoverCol,
      hoverRow,
      history.activeMode,
      hoverLayer,
      inElementMode ? hoverOffsetX : 0,
      inElementMode ? hoverOffsetY : 0,
    );
  }

  // ── Pointer: paint, or pan the camera ─────────────────────────────────────────────────────────
  let painting = false;
  let panning = false;
  let spaceHeld = false;
  let panLastX = 0;
  let panLastY = 0;
  // The last placement this stroke painted, so dragging within one cell (or one quarter-cell, in
  // Element mode) rebuilds the scene once, not on every pointermove event. `""` is the pre-stroke
  // state, distinct from any real placement key.
  let lastPaintedKey = "";
  let strokeStart: EditorMap | null = null;

  // The last cell handed to `onCursorCell`, so a pointer sliding within one cell reports once, not
  // per pixel. `"none"` is the off-canvas state, distinct from any real cell.
  let lastCursorKey = "";
  const reportCursor = (col: number | null, row: number | null): void => {
    if (!onCursorCell) return;
    const key = col === null || row === null ? "none" : `${col},${row}`;
    if (key === lastCursorKey) return;
    lastCursorKey = key;
    onCursorCell(col, row);
  };

  function worldAt(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - world.x) / world.scale.x,
      y: (clientY - rect.top - world.y) / world.scale.y,
    };
  }

  function cellAt(clientX: number, clientY: number): { col: number; row: number } {
    const point = worldAt(clientX, clientY);
    return { col: Math.floor(point.x / TILE_SIZE), row: Math.floor(point.y / TILE_SIZE) };
  }

  /** The placement the pointer resolves to under the active mode: whole-cell for Field/Event (offsets
   *  stay 0, those modes are grid-forced), quarter-cell for Element mode. */
  function placementAt(
    clientX: number,
    clientY: number,
  ): { col: number; row: number; offsetX: number; offsetY: number } {
    const point = worldAt(clientX, clientY);
    if (history.activeMode === "element") return quarterCellAt(point.x, point.y);
    return {
      col: Math.floor(point.x / TILE_SIZE),
      row: Math.floor(point.y / TILE_SIZE),
      offsetX: 0,
      offsetY: 0,
    };
  }

  function paintAt(clientX: number, clientY: number, isStrokeStart: boolean): void {
    const { col, row, offsetX, offsetY } = placementAt(clientX, clientY);
    const paintKey = `${col},${row},${offsetX},${offsetY}`;
    if (paintKey === lastPaintedKey) return;
    lastPaintedKey = paintKey;
    if (tool.kind === "select") {
      // No redraw: no non-event selection renders anything on the stage (the marker/element/spawn
      // inspector is React), and the EV overlay is hidden under the select tool — so a select-click
      // rebuilds nothing. Only the React-facing `notify()` needs to fire.
      selected = selectionAt(map, col, row);
      notify();
      return;
    }
    // Event tool on a cell that already holds an event: placement is refused, so the click reads as
    // "select that event instead" (its double-click then opens the dialog), keeping place and select
    // cleanly separate on one tool the way the wireframe does.
    if (tool.kind === "event") {
      const existing = map.events.find((event) => event.col === col && event.row === row);
      if (existing) {
        selected = { kind: "event", id: existing.id };
        redraw();
        notify();
        return;
      }
    }
    const next = applyTool(
      map,
      tool,
      col,
      row,
      isStrokeStart,
      history.activeMode,
      offsetX,
      offsetY,
    );
    // null → refused (does nothing visible); same reference → a no-op edit (eraser on empty).
    if (!next || next === map) return;
    map = next;
    // A freshly placed event is selected so it reads as active and its double-click has a target.
    if (tool.kind === "event") {
      const placed = next.events.find((event) => event.col === col && event.row === row);
      if (placed) selected = { kind: "event", id: placed.id };
    }
    redraw();
    notify();
    // The terrain under the cursor just changed, so the hover legality may have too (e.g. a decoration
    // that was legal on grass is now illegal over freshly-painted water).
    hoverCol = col;
    hoverRow = row;
    hoverOffsetX = offsetX;
    hoverOffsetY = offsetY;
    drawHover();
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
    lastPaintedKey = "";
    paintAt(event.clientX, event.clientY, true);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const hovered = placementAt(event.clientX, event.clientY);
    reportCursor(hovered.col, hovered.row);
    if (panning) {
      world.x += event.clientX - panLastX;
      world.y += event.clientY - panLastY;
      panLastX = event.clientX;
      panLastY = event.clientY;
      clampCamera();
      return;
    }
    if (
      hovered.col !== hoverCol ||
      hovered.row !== hoverRow ||
      hovered.offsetX !== hoverOffsetX ||
      hovered.offsetY !== hoverOffsetY
    ) {
      hoverCol = hovered.col;
      hoverRow = hovered.row;
      hoverOffsetX = hovered.offsetX;
      hoverOffsetY = hovered.offsetY;
      drawHover();
    }
    if (painting) paintAt(event.clientX, event.clientY, false);
  };

  const onPointerLeave = (): void => {
    reportCursor(null, null);
    hoverCol = Number.NaN;
    hoverRow = Number.NaN;
    hoverOffsetX = 0;
    hoverOffsetY = 0;
    drawHover();
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

  // Double-click in EV mode opens the event under the cursor, if any — the wireframe's route into the
  // event dialog. Threaded to React through `onOpenEvent`; the stage itself owns no dialog.
  const onDoubleClick = (event: MouseEvent): void => {
    if (tool.kind !== "event" || !onOpenEvent) return;
    const { col, row } = cellAt(event.clientX, event.clientY);
    const target = map.events.find((candidate) => candidate.col === col && candidate.row === row);
    if (target) onOpenEvent(target.id);
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
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("dblclick", onDoubleClick);
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
  drawGrid();

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
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("dblclick", onDoubleClick);
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
      const overlayFlipped = eventOverlayToggled(tool, next);
      tool = next;
      if (next.kind === "element") ensureAsset(next.assetId);
      // A pending event graphic is what a freshly placed event will draw with, so its art must be
      // loaded before the first placement, not only after the overlay's next spontaneous redraw.
      if (next.kind === "event" && next.graphic != null) ensureAsset(next.graphic);
      eventLayer.visible = shouldShowEventOverlay(next);
      // Only entering or leaving EV mode changes anything drawn, so only then repaint — a redraw on
      // every tool swap rebuilt the whole map on each P/R/F/E/S keypress for nothing. Entering paints
      // the just-shown overlay's events (and selection); leaving is covered by the visibility flip.
      if (overlayFlipped) redraw();
      // The hovered cell's legality/preview depends on the tool, so re-evaluate it for the new tool
      // (and hide it entirely when switching to select/pan).
      drawHover();
      canvas.dataset.cursor =
        tool.kind === "pan" ? "move" : tool.kind === "select" ? "select" : "paint";
    },
    setActiveMode(mode) {
      history = setActiveMode(history, mode);
      applyModeDim(tileLayers, elementContainers, eventLayer, mode, dim);
      // The quarter-cell sub-grid and the hover snap belong to Element mode only, so both are rebuilt
      // when the active mode changes.
      drawGrid();
      drawHover();
    },
    setDim(next) {
      dim = next;
      applyModeDim(tileLayers, elementContainers, eventLayer, history.activeMode, dim);
    },
    setGrid(next) {
      gridVisible = next;
      gridLayer.visible = next;
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
    moveSelected(col, row) {
      if (!selected) return false;
      const previous = selected;
      // Only an element selection is keyed by cell, so only it re-anchors on a move; an event is
      // keyed by uuid and a spawn is singular, so both keep their existing selection identity.
      const nextSelection: EditorSelection =
        previous.kind === "element" ? { ...previous, col, row } : previous;
      return commitInspectorChange(moveSelection(map, previous, col, row), nextSelection);
    },
    setSelectedElementAsset(assetId) {
      if (selected?.kind !== "element") return false;
      ensureAsset(assetId);
      return commitInspectorChange(updateSelectedElementAsset(map, selected, assetId));
    },
    setSelectedElementOffset(offsetX, offsetY) {
      if (selected?.kind !== "element") return false;
      return commitInspectorChange(updateSelectedElementOffset(map, selected, offsetX, offsetY));
    },
    deleteSelected() {
      if (!selected || selected.kind === "spawn") return false;
      const next = deleteSelection(map, selected);
      return commitInspectorChange(next, null);
    },
    beginEventDraft(id) {
      return beginEventDraft(map, id);
    },
    commitEventDraft(draft) {
      // Sync `present` to the live map first (so an uncommitted name edit is not lost), then let the
      // editor-state API fold the draft in as one entry. `commitEditorHistory` inside it collapses a
      // no-op save, so re-saving an unchanged event adds nothing to the undo stack.
      history = commitEventDraft({ ...history, present: map }, draft);
      map = history.present;
      selected = { kind: "event", id: draft.id };
      redraw();
      notify();
    },
    deleteEvent(id) {
      commitInspectorChange(deleteSelection(map, { kind: "event", id }), null);
    },
    dispose() {
      // Serialized like open: a dispose must not race a queued open onto the shared canvas. Idempotent
      // via `destroyed`, so a superseded session already torn down by the next open is a no-op here.
      enqueue(destroy);
    },
  };
}
