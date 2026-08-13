/**
 * The editor's virtual canvas: a session always edits a MAP_MAX_COLS × MAP_MAX_ROWS ocean document
 * (`padMapToCanvas`), and a save stores only the bounding rect of authored content plus
 * MAP_OCEAN_MARGIN cells of ocean (`derivedMapRect` + `cropMapToRect`). Pure and platform-free —
 * the stored map format does not change, so the server never sees any of this.
 *
 * Markers count toward content bounds even though they are quarantined: `parseMapMarkers` bounds-
 * checks them at parse time, so a legacy marker left outside the crop would fail the save.
 */
import type { MapElement, MapMarkers } from "./map-data.js";
import { EMPTY_MARKERS, MAP_LAYERS } from "./map-data.js";
import type { MapEvent } from "./map-events.js";
import {
  MAP_MAX_COLS,
  MAP_MAX_ROWS,
  MAP_MIN_COLS,
  MAP_MIN_ROWS,
  MAP_OCEAN_MARGIN,
} from "./map-limits.js";
import type { TileLayer } from "./tile-layer-codec.js";
import { EMPTY_TILE } from "./tileset.js";

export interface MapRect {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** The slice of a map document these functions read. Every field is accepted readonly so both
 *  `MapInput` and the editor's `EditorMap` satisfy it structurally. */
export interface MapCanvasContent {
  readonly layers: readonly TileLayer[];
  readonly elements: readonly MapElement[];
  readonly spawn: { readonly col: number; readonly row: number };
  readonly markers?: MapMarkers | undefined;
  readonly events?: readonly MapEvent[] | undefined;
}

/** What pad/crop return: exactly the shifted fields, to be spread over the caller's own map type. */
export interface CanvasMapPatch {
  layers: TileLayer[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers: MapMarkers;
  events: MapEvent[];
}

function layerDims(map: MapCanvasContent): { cols: number; rows: number } {
  const ground = map.layers[0];
  return { cols: ground?.cols ?? 0, rows: ground?.rows ?? 0 };
}

function shiftLayer(
  source: TileLayer | undefined,
  dCol: number,
  dRow: number,
  cols: number,
  rows: number,
): TileLayer {
  const ids = new Array<number>(cols * rows).fill(EMPTY_TILE);
  if (source) {
    for (let row = 0; row < source.rows; row += 1) {
      for (let col = 0; col < source.cols; col += 1) {
        const id = source.ids[row * source.cols + col] ?? EMPTY_TILE;
        if (id === EMPTY_TILE) continue;
        const targetCol = col + dCol;
        const targetRow = row + dRow;
        if (targetCol < 0 || targetRow < 0 || targetCol >= cols || targetRow >= rows) continue;
        ids[targetRow * cols + targetCol] = id;
      }
    }
  }
  return { cols, rows, ids };
}

function shiftMapContent(
  map: MapCanvasContent,
  dCol: number,
  dRow: number,
  cols: number,
  rows: number,
): CanvasMapPatch {
  const inside = (item: { col: number; row: number }): boolean => {
    const col = item.col + dCol;
    const row = item.row + dRow;
    return col >= 0 && row >= 0 && col < cols && row < rows;
  };
  const shift = <P extends { col: number; row: number }>(item: P): P => ({
    ...item,
    col: item.col + dCol,
    row: item.row + dRow,
  });
  const markers = map.markers ?? EMPTY_MARKERS;
  return {
    layers: Array.from({ length: MAP_LAYERS }, (_unused, index) =>
      shiftLayer(map.layers[index], dCol, dRow, cols, rows),
    ),
    elements: map.elements.filter(inside).map(shift),
    spawn: shift({ col: map.spawn.col, row: map.spawn.row }),
    markers: {
      entries: markers.entries.filter(inside).map(shift),
      exits: markers.exits.filter(inside).map(shift),
      monsterSpawns: markers.monsterSpawns.filter(inside).map(shift),
    },
    events: (map.events ?? []).filter(inside).map(shift),
  };
}

/** The stored map, centered in the maximum authorable rect. Every cell of the canvas is paintable;
 *  everything outside the stored rect starts as ocean. */
export function padMapToCanvas(map: MapCanvasContent): CanvasMapPatch {
  const { cols, rows } = layerDims(map);
  const dCol = Math.max(0, Math.floor((MAP_MAX_COLS - cols) / 2));
  const dRow = Math.max(0, Math.floor((MAP_MAX_ROWS - rows) / 2));
  return shiftMapContent(map, dCol, dRow, MAP_MAX_COLS, MAP_MAX_ROWS);
}

/** Bounding rect of everything authored: non-empty tiles on any layer, elements, events, markers
 *  and the spawn cell. The spawn always exists, so there is always at least one content cell. */
export function contentBounds(map: MapCanvasContent): MapRect {
  let minCol = map.spawn.col;
  let maxCol = map.spawn.col;
  let minRow = map.spawn.row;
  let maxRow = map.spawn.row;
  const include = (col: number, row: number): void => {
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  };
  for (const layer of map.layers) {
    for (let row = 0; row < layer.rows; row += 1) {
      for (let col = 0; col < layer.cols; col += 1) {
        if ((layer.ids[row * layer.cols + col] ?? EMPTY_TILE) !== EMPTY_TILE) include(col, row);
      }
    }
  }
  for (const element of map.elements) include(element.col, element.row);
  for (const event of map.events ?? []) include(event.col, event.row);
  const markers = map.markers ?? EMPTY_MARKERS;
  for (const marker of markers.entries) include(marker.col, marker.row);
  for (const marker of markers.exits) include(marker.col, marker.row);
  for (const marker of markers.monsterSpawns) include(marker.col, marker.row);
  return { col: minCol, row: minRow, cols: maxCol - minCol + 1, rows: maxRow - minRow + 1 };
}

/** Grow `[lo, hi)` to at least `min` cells, distributing the growth evenly, inside `[0, limit)`. */
function widenSpan(lo: number, hi: number, min: number, limit: number): { lo: number; hi: number } {
  if (hi - lo >= min) return { lo, hi };
  const grownLo = Math.max(0, lo - Math.floor((min - (hi - lo)) / 2));
  const grownHi = Math.min(limit, grownLo + min);
  return { lo: Math.max(0, grownHi - min), hi: grownHi };
}

/** The rect a save stores: content bounds + the ocean margin, floored to the map size minimum and
 *  clamped to the document. This IS "the size calculated from my tile addition". */
export function derivedMapRect(map: MapCanvasContent): MapRect {
  const { cols: docCols, rows: docRows } = layerDims(map);
  const bounds = contentBounds(map);
  const horizontal = widenSpan(
    Math.max(0, bounds.col - MAP_OCEAN_MARGIN),
    Math.min(docCols, bounds.col + bounds.cols + MAP_OCEAN_MARGIN),
    Math.min(MAP_MIN_COLS, docCols),
    docCols,
  );
  const vertical = widenSpan(
    Math.max(0, bounds.row - MAP_OCEAN_MARGIN),
    Math.min(docRows, bounds.row + bounds.rows + MAP_OCEAN_MARGIN),
    Math.min(MAP_MIN_ROWS, docRows),
    docRows,
  );
  return {
    col: horizontal.lo,
    row: vertical.lo,
    cols: horizontal.hi - horizontal.lo,
    rows: vertical.hi - vertical.lo,
  };
}

/** Slice the document down to `rect`, shifting every coordinate to the rect's origin. */
export function cropMapToRect(map: MapCanvasContent, rect: MapRect): CanvasMapPatch {
  return shiftMapContent(map, -rect.col, -rect.row, rect.cols, rect.rows);
}
