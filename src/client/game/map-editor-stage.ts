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
import type { MonsterSpecies } from "../../shared/game.js";
import { bakeCollision, MAP_LAYERS } from "../../shared/map-data.js";
import type { MapEvent } from "../../shared/map-events.js";
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
  editorMapSize,
  isEditorHistoryDirty,
  markEditorHistorySaved,
  moveSelection,
  redoEditorHistory,
  selectionAt,
  setActiveLayer,
  setMarkerLabel,
  toMapData,
  undoEditorHistory,
  updateSelectedElementAsset,
  updateSelectedMonster,
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
  /** Which layer the paint-adjacent tools (eraser; rect/fill when their selection is layer-free)
   *  write to. Lives on `EditorHistory`, survives undo/redo, and is threaded into every `applyTool`
   *  call from `paintAt`. React owns the displayed value and pushes it down here. */
  setActiveLayer(layer: 0 | 1 | 2): void;
  /** Editor-only "dim other layers": with it on, every logical tile layer but the active one drops
   *  to `DIM_ALPHA`, so the author can see which layer a stroke lands on. Never touches the game
   *  renderer. React owns the toggle and pushes it down here. */
  setDim(dim: boolean): void;
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

/** How far a non-active tile layer fades when "dim other layers" is on. Editor-only; the game
 *  renderer never applies it. */
const DIM_ALPHA = 0.35;

/**
 * Apply "dim other layers" to one container per logical tile layer: with `dim` on, every container
 * but `activeLayer` fades to `DIM_ALPHA`, and the active one — and every layer when `dim` is off —
 * stays fully opaque. Pure and Pixi-object-only (a `Container`'s `alpha` needs no renderer), so it
 * pins the dim rule without the rest of the stage, exactly like `paintLandCell`.
 */
export function applyLayerDim(
  containers: readonly Container[],
  activeLayer: number,
  dim: boolean,
): void {
  containers.forEach((container, index) => {
    container.alpha = dim && index !== activeLayer ? DIM_ALPHA : 1;
  });
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

const EVENT_BOX_COLOR = 0x27272a;
const EVENT_PLACEHOLDER_COLOR = 0x7c3aed;
const EVENT_CHIP_BG_COLOR = 0x18181b;
const EVENT_CHIP_TEXT_COLOR = 0xfafafa;
const EVENT_SELECTION_COLOR = 0xffffff;

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
    const sprite = new Sprite(frame);
    const fit = Math.min((TILE_SIZE * 1.6) / frame.width, (TILE_SIZE * 1.6) / frame.height);
    sprite.width = frame.width * fit;
    sprite.height = frame.height * fit;
    sprite.anchor.set(0.5, 1);
    sprite.position.set(x + TILE_SIZE / 2, y + TILE_SIZE);
    container.addChild(sprite);
  } else {
    const placeholder = new Graphics();
    placeholder
      .roundRect(x + TILE_SIZE * 0.2, y + TILE_SIZE * 0.2, TILE_SIZE * 0.6, TILE_SIZE * 0.6, 4)
      .fill({ color: EVENT_PLACEHOLDER_COLOR, alpha: 0.85 });
    container.addChild(placeholder);
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
const ENTRY_MARKER_COLOR = 0x6fd44c;
const EXIT_MARKER_COLOR = 0x9a6cf0;
const MONSTER_MARKER_COLOR = 0xd9484a;

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
    setActiveLayer() {},
    setDim() {},
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
  const aboveLandLayer = new Container();
  const markerLayer = new Container();
  // Events are the topmost plane, above markers and props, and only shown in "EV mode" (the event
  // tool). Its visibility is driven by `shouldShowEventOverlay(tool)`, never by content.
  const eventLayer = new Container();
  eventLayer.visible = shouldShowEventOverlay(tool);
  world.addChild(
    waterLayer,
    foamLayer,
    ...tileLayers,
    groundElementLayer,
    objectElementLayer,
    canopyElementLayer,
    aboveLandLayer,
    markerLayer,
    eventLayer,
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
    drawMarkers();
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

  function cellAt(clientX: number, clientY: number): { col: number; row: number } {
    const rect = canvas.getBoundingClientRect();
    const worldX = (clientX - rect.left - world.x) / world.scale.x;
    const worldY = (clientY - rect.top - world.y) / world.scale.y;
    return { col: Math.floor(worldX / TILE_SIZE), row: Math.floor(worldY / TILE_SIZE) };
  }

  function paintAt(clientX: number, clientY: number, isStrokeStart: boolean): void {
    const { col, row } = cellAt(clientX, clientY);
    if (col === lastPaintedCol && row === lastPaintedRow) return;
    lastPaintedCol = col;
    lastPaintedRow = row;
    if (tool.kind === "select") {
      selected = selectionAt(map, col, row);
      redraw();
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
    const next = applyTool(map, tool, col, row, isStrokeStart, history.activeLayer);
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
    paintAt(event.clientX, event.clientY, true);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const hovered = cellAt(event.clientX, event.clientY);
    reportCursor(hovered.col, hovered.row);
    if (panning) {
      world.x += event.clientX - panLastX;
      world.y += event.clientY - panLastY;
      panLastX = event.clientX;
      panLastY = event.clientY;
      clampCamera();
      return;
    }
    if (painting) paintAt(event.clientX, event.clientY, false);
  };

  const onPointerLeave = (): void => reportCursor(null, null);

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
      tool = next;
      if (next.kind === "element") ensureAsset(next.assetId);
      // A pending event graphic is what a freshly placed event will draw with, so its art must be
      // loaded before the first placement, not only after the overlay's next spontaneous redraw.
      if (next.kind === "event" && next.graphic != null) ensureAsset(next.graphic);
      // Entering or leaving EV mode flips the overlay; redraw so a just-shown overlay paints its
      // events (and their selection) immediately, not only after the next edit.
      eventLayer.visible = shouldShowEventOverlay(next);
      redraw();
      canvas.dataset.cursor =
        tool.kind === "pan" ? "move" : tool.kind === "select" ? "select" : "paint";
    },
    setActiveLayer(layer) {
      history = setActiveLayer(history, layer);
      applyLayerDim(tileLayers, layer, dim);
    },
    setDim(next) {
      dim = next;
      applyLayerDim(tileLayers, history.activeLayer, dim);
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
