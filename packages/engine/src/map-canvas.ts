/**
 * The editor's virtual canvas: a session always edits a MAP_MAX_COLS × MAP_MAX_ROWS ocean document
 * (`padMapToCanvas`), and a save stores only the bounding rect of authored content plus
 * MAP_OCEAN_MARGIN cells of ocean (`derivedMapRect` + `cropMapToRect`). Pure and platform-free —
 * the stored map format does not change, so the server never sees any of this.
 *
 * Markers count toward content bounds even though they are quarantined: `parseMapMarkers` bounds-
 * checks them at parse time, so a legacy marker left outside the crop would fail the save.
 *
 * A same-map `teleport` command (`event-commands.ts`) carries an absolute cell, just like an
 * element or a marker, so every function here accepts an optional `selfMapId`: with it, a
 * `teleport` command whose `mapId` matches gets its `col`/`row` shifted in step with its owning
 * event (recursing into `if`/`loop`/`choices` bodies), and its target counts toward
 * `contentBounds` so a crop can never strand it outside the saved rect. A cross-map teleport (a
 * different `mapId`) is left untouched — the runtime ignores its cell and uses the destination
 * map's own entry instead, so shifting it would be both wrong and pointless.
 */
import type { EventCommand } from "./event-commands.js";
import type { MapElement, MapMarkers } from "./map-data.js";
import { EMPTY_MARKERS, MAP_LAYERS } from "./map-data.js";
import type { InteriorShell, InteriorShellCellRun } from "./map-environment.js";
import type { MapEvent, MapEventPage } from "./map-events.js";
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
  readonly interiorShell?: InteriorShell | undefined;
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
  interiorShell?: InteriorShell;
}

function layerDims(map: MapCanvasContent): { cols: number; rows: number } {
  const ground = map.layers[0];
  return { cols: ground?.cols ?? 0, rows: ground?.rows ?? 0 };
}

function compactInnerWallRuns(runs: readonly InteriorShellCellRun[]): InteriorShellCellRun[] {
  const ordered = [...runs].sort((left, right) => left.row - right.row || left.col - right.col);
  const compact: InteriorShellCellRun[] = [];
  for (const run of ordered) {
    const previous = compact.at(-1);
    if (previous && previous.row === run.row && run.col <= previous.col + previous.length) {
      previous.length = Math.max(previous.length, run.col + run.length - previous.col);
    } else {
      compact.push({ ...run });
    }
  }
  return compact;
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

/**
 * One command, shifted (or not). Only a `teleport` targeting `selfMapId` ever changes — every
 * other opcode either carries no cell or targets a different map, which the runtime resolves
 * through that map's own entry rather than the cell authored here. Recurses into `if`'s two
 * branches, `loop`'s body and every `choices` option body, because a same-map teleport can be
 * nested arbitrarily deep in the command tree (`event-commands.ts`'s `MAX_COMMAND_DEPTH`).
 */
function shiftCommand(
  command: EventCommand,
  selfMapId: string,
  dCol: number,
  dRow: number,
): EventCommand {
  switch (command.t) {
    case "teleport":
      return command.mapId === selfMapId
        ? { ...command, col: command.col + dCol, row: command.row + dRow }
        : command;
    case "if": {
      const then = shiftCommands(command.then, selfMapId, dCol, dRow);
      const elseBranch = shiftCommands(command.else, selfMapId, dCol, dRow);
      return then === command.then && elseBranch === command.else
        ? command
        : { ...command, then, else: elseBranch };
    }
    case "loop": {
      const body = shiftCommands(command.body, selfMapId, dCol, dRow);
      return body === command.body ? command : { ...command, body };
    }
    case "choices": {
      let changed = false;
      const options = command.options.map((option) => {
        const body = shiftCommands(option.body, selfMapId, dCol, dRow);
        if (body === option.body) return option;
        changed = true;
        return { ...option, body };
      });
      return changed ? { ...command, options } : command;
    }
    default:
      return command;
  }
}

/** A command array, shifted. Returns the SAME array identity when nothing inside it changed, like
 *  every other pure mutator here — a page whose commands hold no self-map teleport costs nothing. */
function shiftCommands(
  commands: readonly EventCommand[],
  selfMapId: string,
  dCol: number,
  dRow: number,
): readonly EventCommand[] {
  let changed = false;
  const next = commands.map((command) => {
    const shifted = shiftCommand(command, selfMapId, dCol, dRow);
    if (shifted !== command) changed = true;
    return shifted;
  });
  return changed ? next : commands;
}

/** An event's pages, with every page's `commands` shifted. `selfMapId` absent means the caller
 *  does not know which map is "self" (a legacy call site not yet threaded); in that case a
 *  same-map teleport cannot be identified at all, so pages pass through unshifted rather than
 *  guessing. */
function shiftEventPages(
  pages: readonly MapEventPage[],
  selfMapId: string | undefined,
  dCol: number,
  dRow: number,
): readonly MapEventPage[] {
  if (!selfMapId) return pages;
  let changed = false;
  const next = pages.map((page) => {
    const commands = shiftCommands(page.commands, selfMapId, dCol, dRow);
    if (commands === page.commands) return page;
    changed = true;
    return { ...page, commands };
  });
  return changed ? next : pages;
}

/**
 * Walk every `teleport` command in `pages` and report each one targeting `selfMapId` to `include`
 * — the same recursion `shiftEventPages` runs, but collecting rather than transforming. Used by
 * `contentBounds` so a same-map teleport target counts as authored content: without it, a crop
 * could shift the derived rect right past a target no visible tile, element or marker guards.
 */
function collectSelfTeleportTargets(
  pages: readonly MapEventPage[],
  selfMapId: string,
  include: (col: number, row: number) => void,
): void {
  const walk = (commands: readonly EventCommand[]): void => {
    for (const command of commands) {
      switch (command.t) {
        case "teleport":
          if (command.mapId === selfMapId) include(command.col, command.row);
          break;
        case "if":
          walk(command.then);
          walk(command.else);
          break;
        case "loop":
          walk(command.body);
          break;
        case "choices":
          for (const option of command.options) walk(option.body);
          break;
        default:
          break;
      }
    }
  };
  for (const page of pages) walk(page.commands);
}

function shiftMapContent(
  map: MapCanvasContent,
  dCol: number,
  dRow: number,
  cols: number,
  rows: number,
  selfMapId?: string,
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
  const shiftedInnerWalls = map.interiorShell?.innerWalls?.flatMap((run) => {
    const row = run.row + dRow;
    if (row < 0 || row >= rows) return [];
    const start = Math.max(0, run.col + dCol);
    const end = Math.min(cols, run.col + run.length + dCol);
    return end <= start ? [] : [{ col: start, row, length: end - start }];
  });
  const innerWalls = shiftedInnerWalls ? compactInnerWallRuns(shiftedInnerWalls) : undefined;
  const interiorShell = map.interiorShell
    ? {
        style: map.interiorShell.style,
        ...(innerWalls && innerWalls.length > 0 ? { innerWalls } : {}),
      }
    : undefined;
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
    events: (map.events ?? []).filter(inside).map((event) => ({
      ...shift(event),
      pages: shiftEventPages(event.pages, selfMapId, dCol, dRow),
    })),
    ...(interiorShell ? { interiorShell } : {}),
  };
}

/** The stored map, centered in the maximum authorable rect. Every cell of the canvas is paintable;
 *  everything outside the stored rect starts as ocean. `selfMapId`, when given, is the map's own
 *  id — the one a same-map `teleport` command carries — so its authored cell pads in step with the
 *  rest of the content instead of staying pinned to the pre-pad frame. */
export function padMapToCanvas(map: MapCanvasContent, selfMapId?: string): CanvasMapPatch {
  const { cols, rows } = layerDims(map);
  const dCol = Math.max(0, Math.floor((MAP_MAX_COLS - cols) / 2));
  const dRow = Math.max(0, Math.floor((MAP_MAX_ROWS - rows) / 2));
  return shiftMapContent(map, dCol, dRow, MAP_MAX_COLS, MAP_MAX_ROWS, selfMapId);
}

/** Bounding rect of everything authored: non-empty tiles on any layer, elements, events, markers,
 *  the spawn cell and — given `selfMapId` — every same-map `teleport` command's target. The spawn
 *  always exists, so there is always at least one content cell. Counting a same-map teleport
 *  target guarantees a crop can never shift it to a negative coordinate or strand it outside the
 *  saved rect, the same guarantee markers already have. */
export function contentBounds(map: MapCanvasContent, selfMapId?: string): MapRect {
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
  for (const run of map.interiorShell?.innerWalls ?? []) {
    include(run.col, run.row);
    include(run.col + run.length - 1, run.row);
  }
  for (const element of map.elements) include(element.col, element.row);
  const events = map.events ?? [];
  for (const event of events) include(event.col, event.row);
  if (selfMapId) {
    for (const event of events) collectSelfTeleportTargets(event.pages, selfMapId, include);
  }
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
 *  clamped to the document. This IS "the size calculated from my tile addition". `selfMapId` is
 *  forwarded to `contentBounds` so a same-map teleport target keeps the rect from cropping past it. */
export function derivedMapRect(map: MapCanvasContent, selfMapId?: string): MapRect {
  const { cols: docCols, rows: docRows } = layerDims(map);
  const bounds = contentBounds(map, selfMapId);
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

/** Slice the document down to `rect`, shifting every coordinate to the rect's origin. `selfMapId`
 *  is forwarded to `shiftMapContent` so a same-map teleport command's cell moves with the crop. */
export function cropMapToRect(
  map: MapCanvasContent,
  rect: MapRect,
  selfMapId?: string,
): CanvasMapPatch {
  return shiftMapContent(map, -rect.col, -rect.row, rect.cols, rect.rows, selfMapId);
}
