/**
 * What a map IS, as pure rules.
 *
 * This is the only place a map payload becomes collision, and that is the whole point of the file.
 * Terrain now arrives over the wire instead of being imported, so the old guarantee — client and
 * server read the same compile-time constant — has to be replaced by a deliberate one: both sides
 * call `bakeCollision` on the same payload. Two decoders that "should" agree is exactly how
 * prediction becomes unfixable; `step()` carries the same argument about movement, for the same
 * reason.
 */

import {
  type BridgeDimensions,
  bridgeBaseRotationDegrees,
  bridgeOrientation,
  bridgePlacementLayout,
  parseBridgeDimensions,
} from "./bridges.js";
import {
  type BuildingDimensions,
  type BuildingSettings,
  defaultBuildingSettings,
  isStandingBuildingAsset,
  parseBuildingSettings,
} from "./buildings.js";
import { colliderIndexFrom } from "./collider.js";
import {
  type ElementOrientation,
  type ElementRotation,
  elementRotationDegrees,
  parseElementOrientation,
  parseElementRotation,
} from "./element-orientation.js";
import type { Rect, TerrainGeometry } from "./game.js";
import { isMonsterSpecies, type MonsterSpecies } from "./game.js";
import { isUuid } from "./identifiers.js";
import {
  DEFAULT_MAP_ENVIRONMENT,
  type InteriorShell,
  type MapEnvironment,
  parseInteriorShell,
  parseMapEnvironment,
} from "./map-environment.js";
import type { MapWeather } from "./map-weather.js";
import { isNativeSceneryAsset, nativeSceneryDimensionsOrDefault } from "./native-scenery.js";
import { parseTileLayer, type TileLayer } from "./tile-layer-codec.js";
import { TILE_SIZE, type TileKind, type TileMap } from "./tilemap.js";
import { decodeTileId, EMPTY_TILE, type Tileset, tileIdInTileset } from "./tileset.js";
import { isRampFixedIndex, tilesetById } from "./tilesets/tiny-swords.js";
import { type EditorAssetId, editorAsset, isEditorAssetId } from "./tiny-swords-catalog.js";

export const ELEMENT_KINDS = ["tree", "bush", "stone"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** A quarter tile. The offset space covers exactly one cell — no overlap, no gap between
 *  neighbours — so every sub-cell position has exactly one `(col, offset)` encoding. */
export const ELEMENT_OFFSET_STEPS = 4;
export const ELEMENT_OFFSET_PX = TILE_SIZE / ELEMENT_OFFSET_STEPS;

export interface MapElement {
  /** Durable row identity; optional only while opening payloads written by older clients. */
  id?: string;
  col: number;
  row: number;
  /** Integer in `0..ELEMENT_OFFSET_STEPS - 1`, quarter tiles right of the cell origin. */
  offsetX: number;
  /** Integer in `0..ELEMENT_OFFSET_STEPS - 1`, quarter tiles below the cell origin. */
  offsetY: number;
  assetId: EditorAssetId;
  /** Optional quarter-turn: front (0/default), right side (1), rear (2), left side (3). */
  orientation?: ElementOrientation;
  /** Optional whole-degree rotation for native 3D scenery. Supersedes `orientation`. */
  rotation?: ElementRotation;
  /** Present only on a resizable bridge. Absent preserves the historical 3x1 dimensions. */
  bridge?: BridgeDimensions;
  /** Present only on standing building assets; legacy payloads receive catalogue-derived defaults. */
  building?: BuildingSettings;
  /** Optional footprint for native 3D scenery that is not a building. */
  dimensions?: BuildingDimensions;
}

export interface LegacyMapElement {
  col: number;
  row: number;
  kind: ElementKind;
  variant: number;
}

export interface EntryMarker {
  id: string;
  label?: string;
  col: number;
  row: number;
}

export interface ExitMarker {
  id: string;
  label?: string;
  col: number;
  row: number;
}

export interface MonsterSpawnMarker {
  col: number;
  row: number;
  species: MonsterSpecies;
  patrolRadius: number;
}

/**
 * QUARANTINED (UX wave #12 / Task 5): markers are dead. Entries, exits and monster spawns are now
 * typed EVENTS (`kind` on `MapEvent`), read by the runtime and bound by the adventure graph. These
 * types and their parser survive only so the `map.markers` column keeps decoding without a throw and
 * the one-shot migration can read old rows; nothing functional reads a marker any more. Do not add a
 * new marker — add an event kind. See `docs/superpowers/plans/2026-07-19-ux-wave.md` Task 5.
 */
export interface MapMarkers {
  entries: readonly EntryMarker[];
  exits: readonly ExitMarker[];
  monsterSpawns: readonly MonsterSpawnMarker[];
}

export const EMPTY_MARKERS: MapMarkers = { entries: [], exits: [], monsterSpawns: [] };

export const MAX_MAP_ENTRIES = 8;
export const MAX_MAP_EXITS = 8;
export const MAX_MAP_MONSTER_SPAWNS = 32;
/** Zero is a valid authored leash and keeps a character at its spawn point. */
export const MIN_PATROL_RADIUS = 0;
export const MAX_PATROL_RADIUS = 768;
export const MARKER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const MARKER_LABEL_MAX = 48;

export const MAP_LAYERS = 3;

/** Native world geometry that may be freely rotated without turning a billboard sideways. */
export function isRotatable3dElementAsset(assetId: string): boolean {
  return (
    isStandingBuildingAsset(assetId) ||
    bridgeOrientation(assetId) !== null ||
    isNativeSceneryAsset(assetId)
  );
}

export function element3dRotationDegrees(
  element: Pick<MapElement, "assetId" | "orientation" | "rotation">,
): number {
  if (element.rotation !== undefined) return element.rotation;
  const bridgeBase = bridgeBaseRotationDegrees(element.assetId);
  return bridgeBase ?? elementRotationDegrees(element);
}

export interface MapData {
  /** Exterior maps end in water; interior maps end in an unlit void. */
  environment?: MapEnvironment;
  /** Optional world-space cutaway generated around the authored floor boundary. */
  interiorShell?: InteriorShell;
  /** The authored weather. Absent on every map written before it existed, which reads as `none`.
   *  Appearance only, like `environment`: nothing here may reach collision. */
  weather?: MapWeather;
  tilesetId: string;
  cols: number;
  rows: number;
  /** Exactly `MAP_LAYERS`. Index 0 is the ground; an empty ground cell is the void. */
  layers: readonly TileLayer[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  /** Absent on legacy payloads; parseMapData always fills it (EMPTY_MARKERS when omitted). */
  markers?: MapMarkers;
}

/**
 * The most elements one map may carry. Independent of the layer/body byte cap
 * (`MAX_MAP_JSON_BYTES` in `server/api/bodySizeCap.ts`, sized against the tile layers, not this): a run-length
 * layer already dominates that cap on its own, but leaving the element count unbounded would still
 * let many thousands of elements push a legitimate body past it with no useful message. Enforced on
 * the server (`validateMapInput`) and refused up front by the editor (`applyTool`) so a builder
 * never paints past what will save. Lives beside the shared catalogue lookup because both server
 * and browser read it and neither may import the other.
 */
/** Stable replacements for maps written before catalogue ids existed. */
export const LEGACY_ELEMENT_ASSETS = {
  tree: [
    "resource.terrain-resources-wood-trees.tree3",
    "resource.terrain-resources-wood-trees.tree4",
  ],
  bush: [
    "decoration.terrain-decorations-bushes.bushe1",
    "decoration.terrain-decorations-bushes.bushe2",
    "decoration.terrain-decorations-bushes.bushe3",
    "decoration.terrain-decorations-bushes.bushe4",
  ],
  stone: [
    "decoration.terrain-decorations-rocks.rock1",
    "decoration.terrain-decorations-rocks.rock2",
    "decoration.terrain-decorations-rocks.rock3",
    "decoration.terrain-decorations-rocks.rock4",
  ],
} as const satisfies Readonly<Record<ElementKind, readonly EditorAssetId[]>>;

export const MAX_MAP_ELEMENTS = 2_000;

export function isElementKind(value: unknown): value is ElementKind {
  return typeof value === "string" && (ELEMENT_KINDS as readonly string[]).includes(value);
}

function parseAnchoredMarkers(
  value: unknown,
  max: number,
  cols: number,
  rows: number,
): { id: string; label?: string; col: number; row: number }[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const seen = new Set<string>();
  const parsed: { id: string; label?: string; col: number; row: number }[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const { id, label, col, row } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !MARKER_ID_PATTERN.test(id) || seen.has(id)) return null;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    const c = col as number;
    const r = row as number;
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    if (label !== undefined && typeof label !== "string") return null;
    const normalizedLabel = typeof label === "string" ? label.trim() : "";
    if (normalizedLabel.length > MARKER_LABEL_MAX) return null;
    seen.add(id);
    parsed.push(
      normalizedLabel.length > 0
        ? { id, label: normalizedLabel, col: c, row: r }
        : { id, col: c, row: r },
    );
  }
  return parsed;
}

export function parseMapMarkers(value: unknown, cols: number, rows: number): MapMarkers | null {
  if (value === undefined) return EMPTY_MARKERS;
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const entries = parseAnchoredMarkers(record.entries, MAX_MAP_ENTRIES, cols, rows);
  const exits = parseAnchoredMarkers(record.exits, MAX_MAP_EXITS, cols, rows);
  if (!entries || !exits) return null;
  const spawnsRaw = record.monsterSpawns;
  if (!Array.isArray(spawnsRaw) || spawnsRaw.length > MAX_MAP_MONSTER_SPAWNS) return null;
  const monsterSpawns: MonsterSpawnMarker[] = [];
  for (const raw of spawnsRaw) {
    if (typeof raw !== "object" || raw === null) return null;
    const { col, row, species, patrolRadius } = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    const c = col as number;
    const r = row as number;
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    if (!isMonsterSpecies(species)) return null;
    if (!Number.isSafeInteger(patrolRadius)) return null;
    const radius = patrolRadius as number;
    if (radius < MIN_PATROL_RADIUS || radius > MAX_PATROL_RADIUS) return null;
    monsterSpawns.push({ col: c, row: r, species, patrolRadius: radius });
  }
  return { entries, exits, monsterSpawns };
}

export function legacyElementAssetId(kind: ElementKind, variant: number): EditorAssetId {
  const choices = LEGACY_ELEMENT_ASSETS[kind];
  const index = ((Math.trunc(variant) % choices.length) + choices.length) % choices.length;
  return choices[index] ?? choices[0];
}

/** Where a hero appears: the centre of the map's one spawn cell. */
export function mapSpawnPoint(data: MapData): { x: number; y: number } {
  return {
    x: data.spawn.col * TILE_SIZE + TILE_SIZE / 2,
    y: data.spawn.row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/**
 * A map as the world geometry both sides run on. Shared because the server builds rooms from it
 * and the preview sandbox walks it — one builder, so they cannot disagree.
 */
export function terrainFromMap(data: MapData): TerrainGeometry {
  const tiles = bakeCollision(data);
  const width = tiles.cols * TILE_SIZE;
  const height = tiles.rows * TILE_SIZE;
  // No safe zone: an authored map has no way to declare one, and `monster-system` reads that rect
  // as "monsters may not touch a player here". Declaring the whole map safe — as this used to —
  // made every placed monster permanently harmless on the only maps a hero can play. Spawn
  // protection on an authored map is the author's job: place spawns away from the entry.
  return {
    width,
    height,
    obstacles: [],
    spawnPoints: [mapSpawnPoint(data)],
    safeZone: null,
    tiles,
    colliders: colliderIndexFrom(elementColliders(data.elements), tiles.cols, tiles.rows),
  };
}

/**
 * Scenery is an appearance layer, so every known editor asset may be authored over every terrain.
 *
 * `on` stays in the signature for compatibility with catalogue tooling and older callers, but it no
 * longer gates placement: water, cliffs and elevation decide world collision, not whether an author
 * may put a visual prop there. Unknown assets remain invalid.
 */
export function canPlaceElement(assetId: EditorAssetId, _on: TileKind): boolean {
  return editorAsset(assetId) !== undefined;
}

/** A world pixel to the cell and quarter-step it lands in. `Math.floor` on both, so a negative
 *  pixel yields a negative col with a non-negative offset rather than a negative offset. */
export function quarterCellAt(
  x: number,
  y: number,
): { col: number; row: number; offsetX: number; offsetY: number } {
  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);
  return {
    col,
    row,
    offsetX: Math.floor((x - col * TILE_SIZE) / ELEMENT_OFFSET_PX),
    offsetY: Math.floor((y - row * TILE_SIZE) / ELEMENT_OFFSET_PX),
  };
}

/**
 * The world PIXEL an element stands on: FOOT SPACE, which is the coordinate system the asset
 * catalogue itself is authored in.
 *
 * THE one definition. `elementWorldColliderGeometry` below and `authoredElementGroundPoint`
 * (`hd2d/authored-map.ts`, in tile units) both read it, so the art and the collision cannot drift
 * into describing two different places. It used to be written out twice, once per package.
 *
 * **Do not "centre" this on the cell.** The horizontal centre and the far Z edge are not an
 * arbitrary anchor: every `editor.collider` rect in the catalogue is expressed relative to this
 * point, with negative `y` reaching back up into the cell, which is why `subcell-collision.test.ts`
 * pins a tree's collider to end exactly on `(row + 1) * TILE_SIZE`. Moving the foot silently
 * re-reads every authored rect and marches every collider in every stored map a cell north. Tried:
 * it walls off 8 events in the Liin bundle.
 *
 * The pointer mismatch quest #26 reports is real but lives on the WRITE side, not here. See
 * `quarterCellAt`, which answers a different question from the one placement needs.
 */
export function elementFootPixel(
  element: Pick<MapElement, "col" | "row" | "offsetX" | "offsetY">,
): { x: number; y: number } {
  return {
    x: element.col * TILE_SIZE + TILE_SIZE / 2 + element.offsetX * ELEMENT_OFFSET_PX,
    y: (element.row + 1) * TILE_SIZE + element.offsetY * ELEMENT_OFFSET_PX,
  };
}

/**
 * The storage that puts an element's FOOT nearest a world pixel: the inverse of `elementFootPixel`.
 *
 * This is quest #26's second mechanism, and the fix is here rather than in the foot. `quarterCellAt`
 * answers "which quarter of which cell is this pixel in", and placement used to store that answer
 * directly. But the stored triple does not mean that: `col`/`row` locate a foot ORIGIN and the
 * quarter counts up from it, so reading the pointer's own bucket back moved the element a constant
 * 0.375 cells east and 0.875 cells south, and since the quarter only ever ADDS, the left half of
 * every cell could not be expressed at all.
 *
 * Solving for the foot instead costs nothing in range. Over all `col` and `offsetX` in `0..3`, the
 * reachable feet are every quarter position on the lattice, so the same set of places is
 * expressible; only the decomposition differs. Nothing stored moves, foot space is untouched, and
 * the ghost lands within an eighth of a cell of the pointer, which is all `ELEMENT_OFFSET_STEPS`
 * can hold.
 *
 * `col`/`row` may therefore differ by one from the cell the pointer is in. That is inherent to a
 * foot origin sitting on a cell's far edge, not a rounding bug.
 */
export function elementFootStorage(
  x: number,
  y: number,
): { col: number; row: number; offsetX: number; offsetY: number } {
  const quarters = (value: number, origin: number): { cell: number; offset: number } => {
    const step = Math.round((value / TILE_SIZE - origin) * ELEMENT_OFFSET_STEPS);
    const cell = Math.floor(step / ELEMENT_OFFSET_STEPS);
    return { cell, offset: step - cell * ELEMENT_OFFSET_STEPS };
  };
  const horizontal = quarters(x, 0.5);
  const vertical = quarters(y, 1);
  return {
    col: horizontal.cell,
    row: vertical.cell,
    offsetX: horizontal.offset,
    offsetY: vertical.offset,
  };
}

export function elementCells(element: MapElement): { col: number; row: number }[] {
  const bridge = bridgePlacementLayout(element);
  if (bridge) {
    if (element.rotation !== undefined) {
      const collider = elementWorldCollider(element);
      return collider ? rectCells(collider) : [];
    }
    return Array.from({ length: bridge.rows }, (_, row) =>
      Array.from({ length: bridge.cols }, (_unused, col) => ({
        col: bridge.startCol + col,
        row: bridge.startRow + row,
      })),
    ).flat();
  }
  if (
    element.building?.dimensions ||
    element.dimensions ||
    isNativeSceneryAsset(element.assetId) ||
    element.rotation !== undefined
  ) {
    const collider = elementWorldCollider(element);
    return collider ? rectCells(collider) : [];
  }
  const asset = editorAsset(element.assetId);
  if (!asset) return [];
  const orientation = element.orientation ?? 0;
  return asset.editor.visualFootprint.map((offset) => {
    let col = offset.col;
    let row = offset.row;
    for (let turn = 0; turn < orientation; turn += 1) [col, row] = [-row, col];
    return { col: element.col + col, row: element.row + row };
  });
}

export interface ElementWorldColliderGeometry extends Rect {
  /** Clockwise rotation around this rectangle's centre, in radians. */
  rotation: number;
}

/** Exact local rectangle used by the heightfield compiler before taking an editor-facing AABB. */
export function elementWorldColliderGeometry(
  element: MapElement,
): ElementWorldColliderGeometry | null {
  const bridge = bridgePlacementLayout(element);
  if (bridge) {
    const baseRotation = bridgeBaseRotationDegrees(element.assetId) ?? 0;
    const rotation = element.rotation === undefined ? 0 : element.rotation - baseRotation;
    return {
      x: bridge.startCol * TILE_SIZE + element.offsetX * ELEMENT_OFFSET_PX,
      y: bridge.startRow * TILE_SIZE + element.offsetY * ELEMENT_OFFSET_PX,
      width: bridge.cols * TILE_SIZE,
      height: bridge.rows * TILE_SIZE,
      rotation: (rotation * Math.PI) / 180,
    };
  }
  // Documents authored before resizable native geometry have no explicit dimensions. Keep their
  // catalogue collider byte-for-byte compatible: switching those rows to the larger render volume
  // can close an authored passage. Fresh placements and generated Runner props persist dimensions,
  // so only those opt into the new resize-aware collider.
  const authoredDimensions = element.building?.dimensions ?? element.dimensions;
  const dimensions = authoredDimensions
    ? nativeSceneryDimensionsOrDefault(element.assetId, authoredDimensions)
    : null;
  const collider = dimensions
    ? {
        x: (-dimensions.width * TILE_SIZE) / 2,
        y: -dimensions.depth * TILE_SIZE,
        width: dimensions.width * TILE_SIZE,
        height: dimensions.depth * TILE_SIZE,
      }
    : editorAsset(element.assetId)?.editor.collider;
  if (!collider) return null;
  const { x: footX, y: footY } = elementFootPixel(element);
  const rotation = (elementRotationDegrees(element) * Math.PI) / 180;
  const localCentreX = collider.x + collider.width / 2;
  const localCentreY = collider.y + collider.height / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const centreX = footX + localCentreX * cos - localCentreY * sin;
  const centreY = footY + localCentreX * sin + localCentreY * cos;
  return {
    x: centreX - collider.width / 2,
    y: centreY - collider.height / 2,
    width: collider.width,
    height: collider.height,
    rotation,
  };
}

/**
 * An element's collider in world pixels, or null when the asset does not collide.
 *
 * The catalogue authors the rect in foot space, so this translation needs no `footOffset`: the
 * art's visible foot always lands on the cell's bottom edge, because the renderer's `footOffset`
 * cancels against the frame's own bottom padding. Do NOT reintroduce `footOffset` here to "match"
 * `createCatalogElementView` — that would push every collider a padding's worth south of its sprite.
 */
export function elementWorldCollider(element: MapElement): Rect | null {
  const collider = elementWorldColliderGeometry(element);
  if (!collider) return null;
  if (collider.rotation === 0) {
    return { x: collider.x, y: collider.y, width: collider.width, height: collider.height };
  }
  const centreX = collider.x + collider.width / 2;
  const centreY = collider.y + collider.height / 2;
  const cos = Math.cos(collider.rotation);
  const sin = Math.sin(collider.rotation);
  const corners = [
    [-collider.width / 2, -collider.height / 2],
    [collider.width / 2, -collider.height / 2],
    [-collider.width / 2, collider.height / 2],
    [collider.width / 2, collider.height / 2],
  ].map(([sourceX, sourceY]) => {
    const x = sourceX ?? 0;
    const y = sourceY ?? 0;
    return { x: centreX + x * cos - y * sin, y: centreY + x * sin + y * cos };
  });
  const minX = Math.min(...corners.map((point) => point.x));
  const maxX = Math.max(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxY = Math.max(...corners.map((point) => point.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function elementColliders(elements: readonly MapElement[]): Rect[] {
  const rects: Rect[] = [];
  for (const element of elements) {
    const rect = elementWorldCollider(element);
    if (rect) rects.push(rect);
  }
  return rects;
}

export function elementCoversCell(element: MapElement, col: number, row: number): boolean {
  return elementCells(element).some((cell) => cell.col === col && cell.row === row);
}

/** The cells a world-pixel rect overlaps, far edge exclusive — the same box→cell convention
 *  `isWalkableBox` uses, so a rect flush against a cell boundary does not claim the next cell. */
function rectCells(rect: Rect): { col: number; row: number }[] {
  const c0 = Math.floor(rect.x / TILE_SIZE);
  const c1 = Math.floor((rect.x + rect.width - 1) / TILE_SIZE);
  const r0 = Math.floor(rect.y / TILE_SIZE);
  const r1 = Math.floor((rect.y + rect.height - 1) / TILE_SIZE);
  const cells: { col: number; row: number }[] = [];
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) cells.push({ col, row });
  }
  return cells;
}

/**
 * Cells occupied by an element's functional base.
 *
 * Kept as shared geometry for catalogue diagnostics and tools that need to locate a base; these
 * cells no longer restrict which terrain may sit underneath scenery.
 */
export function elementPlacementCells(element: MapElement): { col: number; row: number }[] {
  const asset = editorAsset(element.assetId);
  if (!asset) return [];
  if (asset.editor.terrainOverride) return elementCells(element);
  // A solid base — a tree's trunk, a rock — is what must stand on allowed terrain; the canopy above it
  // is free to overhang water. So when the asset carries a collider, the cells that collider actually
  // covers ARE its functional base. A quarter-cell offset can push a trunk beyond its anchor, so
  // callers that inspect base geometry must use these collider cells instead of guessing from the
  // anchor. A collider-less decoration (a bush, a sign) uses its plain anchor cell.
  const collider = elementWorldCollider(element);
  if (!collider) return [{ col: element.col, row: element.row }];
  return rectCells(collider);
}

export function elementFitsMap(element: MapElement, cols: number, rows: number): boolean {
  const bridge = bridgePlacementLayout(element);
  // Historical rows only guaranteed that their anchor was in bounds. Keep accepting them; once an
  // author explicitly resizes or rotates a bridge, its complete footprint must fit inside the map.
  if (bridge && (element.bridge || element.rotation !== undefined)) {
    if (element.rotation !== undefined) {
      const collider = elementWorldCollider(element);
      return Boolean(
        collider &&
        collider.x >= 0 &&
        collider.y >= 0 &&
        collider.x + collider.width <= cols * TILE_SIZE &&
        collider.y + collider.height <= rows * TILE_SIZE,
      );
    }
    return (
      bridge.startCol >= 0 &&
      bridge.startRow >= 0 &&
      bridge.startCol + bridge.cols <= cols &&
      bridge.startRow + bridge.rows <= rows
    );
  }
  if (element.building?.dimensions || element.dimensions || element.rotation !== undefined) {
    const collider = elementWorldCollider(element);
    return Boolean(
      collider &&
      collider.x >= 0 &&
      collider.y >= 0 &&
      collider.x + collider.width <= cols * TILE_SIZE &&
      collider.y + collider.height <= rows * TILE_SIZE,
    );
  }
  // The authored foot is the placement. Art may overhang any map edge: clouds, crowns and large
  // buildings must remain placeable on the first/last row without pretending their transparent
  // canvas is gameplay terrain.
  return element.col >= 0 && element.row >= 0 && element.col < cols && element.row < rows;
}

export function elementsOverlap(left: MapElement, right: MapElement): boolean {
  const occupied = new Set(elementCells(left).map((cell) => `${cell.col}:${cell.row}`));
  return elementCells(right).some((cell) => occupied.has(`${cell.col}:${cell.row}`));
}

/**
 * Full sub-position identity: two elements share a slot only when their cell AND their quarter-tile
 * offset both match — exactly the D1 primary key `(mapId, col, row, offsetX, offsetY)`.
 *
 * This is the identity element placement, selection and the eraser key on now that a cell can hold a
 * stack of decorations at distinct offsets. `(col, row)` alone can no longer tell two stacked
 * decorations apart, and visual-footprint overlap (`elementsOverlap`) deliberately no longer rejects
 * placement — decorations are meant to overlap. The parameter is the minimal slot shape so a
 * selection descriptor (which carries no `assetId`) can be compared against a `MapElement`.
 */
export function sameElementSlot(
  a: { col: number; row: number; offsetX: number; offsetY: number },
  b: { col: number; row: number; offsetX: number; offsetY: number },
): boolean {
  return a.col === b.col && a.row === b.row && a.offsetX === b.offsetX && a.offsetY === b.offsetY;
}

/** Whether a tile blocks movement, resolved through the tileset. An empty cell blocks nothing —
 *  on the ground layer it is the void, which the ground pass has already called water. */
function tileBlocks(tileset: Tileset, id: number): boolean {
  const ref = decodeTileId(id);
  if (ref.kind === "empty") return false;
  const entry = ref.kind === "autotile" ? tileset.autotiles[ref.slot] : tileset.fixed[ref.index];
  // An id no tileset entry answers for is treated as solid: an unknown obstacle you cannot walk
  // into is recoverable, an invisible hole you fall through is not.
  return entry ? !entry.passable : true;
}

/**
 * The ground, plus everything standing on it that you bump into.
 *
 * Tiles are still baked, and `step` still knows nothing. What changed is that an element is no
 * longer expressible as a cell: its collider is a sub-cell rect, carried on `TerrainGeometry`
 * beside these tiles and queried through the same `isWalkable`. Two structures, still one bake and
 * still one query — `prediction.ts` and the server read the identical geometry.
 */
export function bakeCollision(map: MapData): TileMap {
  const tileset = tilesetById(map.tilesetId);
  const cells = map.cols * map.rows;
  const kinds: TileKind[] = new Array<TileKind>(cells).fill("water");
  const ground = map.layers[0];
  for (let index = 0; index < cells; index += 1) {
    const id = ground?.ids[index] ?? EMPTY_TILE;
    kinds[index] = id === EMPTY_TILE ? "water" : "grass";
  }
  for (const layer of map.layers) {
    for (let index = 0; index < cells; index += 1) {
      const id = layer.ids[index] ?? EMPTY_TILE;
      if (id === EMPTY_TILE) continue;
      const ref = decodeTileId(id);
      if (ref.kind === "fixed" && isRampFixedIndex(ref.index)) {
        // Keep staircase semantics in the server-baked grid so authoritative movement and client
        // prediction apply the same climbing pace without independently re-reading visual layers.
        kinds[index] = "ramp";
        continue;
      }
      // No tileset means no entry can answer for any id, so every drawn tile is solid — the same
      // fail-closed posture `tileBlocks` takes one level down. Skipping the sweep instead would
      // make an unknown-tileset map entirely walkable, which is the invisible-hole failure.
      if (!tileset || tileBlocks(tileset, id)) kinds[index] = "forest";
    }
  }
  const tiles: TileMap = { cols: map.cols, rows: map.rows, kinds };
  return bakeElements(tiles, map.elements);
}

/** The element pass. Walkable overrides still reclaim water in the grid, because that is a grid
 *  operation. Collision footprints are gone: an element's solidity is a sub-cell collider now
 *  (`elementWorldCollider`), carried on the geometry beside the tiles rather than burned into them. */
function bakeElements(tiles: TileMap, elements: readonly MapElement[]): TileMap {
  const kinds = [...tiles.kinds];
  for (const element of elements) {
    const asset = editorAsset(element.assetId);
    if (asset?.editor.terrainOverride !== "walkable") continue;
    // Deliberate: a walkable override reclaims only "water", never a tile-authored solid. A bridge
    // over water still works, because water is an empty ground cell. A bridge laid across a cliff
    // face stays impassable. Accepted for this tranche rather than an oversight: letting scenery
    // punch through authored terrain would make a cliff wall — the whole point of the layered
    // model — cancellable by dropping one element on it. Revisit only with an explicit
    // "overrides terrain" asset flag, not by widening this condition.
    for (const cell of elementCells(element)) {
      const index = cell.row * tiles.cols + cell.col;
      if (kinds[index] === "water") kinds[index] = "grass";
    }
  }
  return { ...tiles, kinds };
}

/**
 * Elements off the wire, checked like the untrusted data they are.
 *
 * Bounds ARE checked here now, and the caller must supply them. They deliberately were not before:
 * collision was fully baked into the tiles by the time elements arrived, so a silly cell drew
 * nowhere and collided with nothing. Elements now carry colliders, so an out-of-range element is a
 * collider somewhere no author put one.
 */
export function parseMapElements(value: unknown, cols: number, rows: number): MapElement[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: MapElement[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const { id, col, row } = item;
    if (id !== undefined && !isUuid(id)) return null;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    if ((col as number) < 0 || (col as number) >= cols) return null;
    if ((row as number) < 0 || (row as number) >= rows) return null;
    const offsetX = parseOffsetStep(item.offsetX);
    const offsetY = parseOffsetStep(item.offsetY);
    if (offsetX === null || offsetY === null) return null;
    let assetId: EditorAssetId;
    if (isEditorAssetId(item.assetId)) assetId = item.assetId;
    else if (isElementKind(item.kind) && Number.isSafeInteger(item.variant)) {
      assetId = legacyElementAssetId(item.kind, item.variant as number);
    } else return null;
    let building: BuildingSettings | undefined;
    let dimensions: BuildingDimensions | undefined;
    if (isStandingBuildingAsset(assetId)) {
      const settings =
        item.building === undefined
          ? defaultBuildingSettings(assetId)
          : parseBuildingSettings(item.building);
      if (!settings) return null;
      building = settings;
    } else if (item.building !== undefined) {
      return null;
    }
    if (isNativeSceneryAsset(assetId)) {
      const parsedDimensions =
        item.dimensions === undefined
          ? undefined
          : nativeSceneryDimensionsOrDefault(assetId, item.dimensions as BuildingDimensions);
      if (item.dimensions !== undefined && !parsedDimensions) return null;
      dimensions = parsedDimensions ?? undefined;
    } else if (item.dimensions !== undefined) {
      return null;
    }
    const bridgeAsset = bridgeOrientation(assetId);
    const nativeScenery = isNativeSceneryAsset(assetId);
    const orientation = parseElementOrientation(item.orientation);
    const rotation = parseElementRotation(item.rotation);
    const hasRotation = item.rotation !== undefined && item.rotation !== null;
    if (
      orientation === null ||
      rotation === null ||
      (orientation !== 0 && !building && !nativeScenery) ||
      (rotation !== 0 && !building && !bridgeAsset && !nativeScenery) ||
      (orientation !== 0 && hasRotation)
    )
      return null;
    const bridge = item.bridge === undefined ? undefined : parseBridgeDimensions(item.bridge);
    if (bridge === null || (!bridgeAsset && bridge !== undefined)) return null;
    parsed.push({
      ...(typeof id === "string" ? { id } : {}),
      col: col as number,
      row: row as number,
      offsetX,
      offsetY,
      assetId,
      ...(orientation === 0 ? {} : { orientation }),
      ...(hasRotation ? { rotation } : {}),
      ...(bridge ? { bridge } : {}),
      ...(building ? { building } : {}),
      ...(dimensions ? { dimensions } : {}),
    });
  }
  return parsed;
}

/** Absent is 0: maps authored before offsets existed are aligned to their cell. */
function parseOffsetStep(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  if (!Number.isSafeInteger(value)) return null;
  const step = value as number;
  if (step < 0 || step >= ELEMENT_OFFSET_STEPS) return null;
  return step;
}

/**
 * Defensive, exactly like client intent already is.
 *
 * A malformed map that reaches the renderer throws on the first paint — a short layer, an unknown
 * tileset, a spawn off the edge. This returns null instead and the frame is dropped.
 */
export function parseMapData(value: unknown): MapData | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { tilesetId, cols, rows, layers, elements, spawn } = record;
  const environment = parseMapEnvironment(record.environment ?? DEFAULT_MAP_ENVIRONMENT);
  if (!environment) return null;
  const interiorShell =
    record.interiorShell === undefined ? undefined : parseInteriorShell(record.interiorShell);
  if (record.interiorShell !== undefined && !interiorShell) return null;
  if (interiorShell && environment !== "interior") return null;

  if (typeof tilesetId !== "string") return null;
  const tileset = tilesetById(tilesetId);
  if (!tileset) return null;
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return null;
  const width = cols as number;
  const height = rows as number;
  if (width <= 0 || height <= 0) return null;
  if (interiorShell?.innerWalls?.some((run) => run.row >= height || run.col + run.length > width))
    return null;

  if (!Array.isArray(layers) || layers.length !== MAP_LAYERS) return null;
  const parsedLayers: TileLayer[] = [];
  for (const raw of layers) {
    const layer = parseTileLayer(raw, width, height);
    if (!layer) return null;
    // `parseTileLayer` only knows the id SHAPE (a safe integer); it has no tileset to check the id
    // against. An id no autotile slot or fixed-tile index in THIS tileset can answer for is refused
    // here rather than silently baked as solid terrain later by `tileBlocks`.
    if (layer.ids.some((id) => !tileIdInTileset(tileset, id))) return null;
    parsedLayers.push(layer);
  }

  const parsed = parseMapElements(elements, width, height);
  if (!parsed) return null;

  if (typeof spawn !== "object" || spawn === null) return null;
  const spawnRecord = spawn as Record<string, unknown>;
  const { col: spawnCol, row: spawnRow } = spawnRecord;
  if (!Number.isSafeInteger(spawnCol) || !Number.isSafeInteger(spawnRow)) return null;
  if ((spawnCol as number) < 0 || (spawnCol as number) >= width) return null;
  if ((spawnRow as number) < 0 || (spawnRow as number) >= height) return null;

  const markers = parseMapMarkers(record.markers, width, height);
  if (!markers) return null;

  return {
    environment,
    ...(interiorShell ? { interiorShell } : {}),
    tilesetId,
    cols: width,
    rows: height,
    layers: parsedLayers,
    elements: parsed,
    spawn: { col: spawnCol as number, row: spawnRow as number },
    markers,
  };
}
