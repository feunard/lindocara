// A map, as data. What the lab draws today through procedural code, what an editor will produce
// tomorrow, and what a server must be able to read without a single line of rendering.
//
// `decodeMap` returns `null` rather than throwing: this format will one day cross the network,
// and a corrupted map must not take down an entire room. Same discipline as `parseClientMessage`
// in `@lindocara/engine` — a `JSON.parse` wrapped in a `try` that then returns the object as-is is
// not enough: every field must be checked, not just that the text was valid JSON.
//
// Stays PURE (no DOM, no `three`, no clock, no randomness): this file moved into
// `@lindocara/engine` in Task 11, alongside `terrain-query.ts`, which got there first.

import { type BridgeDimensions, bridgeOrientation, parseBridgeDimensions } from "../bridges.js";
import {
  type BuildingDimensions,
  buildingArchetype,
  parseBuildingDimensions,
} from "../buildings.js";
import {
  type ElementOrientation,
  type ElementRotation,
  parseElementOrientation,
  parseElementRotation,
} from "../element-orientation.js";
import {
  DEFAULT_MAP_ENVIRONMENT,
  type InteriorShell,
  type MapEnvironment,
  parseInteriorShell,
  parseMapEnvironment,
} from "../map-environment.js";
import { DEFAULT_MAP_WEATHER, type MapWeather, parseMapWeather } from "../map-weather.js";
import { isNativeSceneryAsset } from "../native-scenery.js";
import type { ColliderRect, ColliderRoofSurface } from "./collider-index.js";
import {
  isRampDirection,
  type TerrainLiquid,
  type TerrainMaterial,
  type TerrainQuerySource,
  type TerrainRamp,
} from "./terrain-query.js";

/** The four materials of `TerrainMaterial`, as a RUNTIME enumeration — the type alone is not
 *  enough to validate a string coming from the network, it vanishes at compile time. */
const TERRAIN_MATERIALS: readonly TerrainMaterial[] = [
  "sable",
  "herbe",
  "neige",
  "glace",
  "grotte",
  "montagne",
  "volcan",
  "lave",
];

/**
 * The retired thin-ice material, still accepted from storage.
 *
 * `decodeMap` rejects a map OUTRIGHT on one unknown material — the whole grid, not the one cell —
 * so simply dropping `"glace-fine"` from the union would have turned every map ever painted with
 * it into an unjoinable map, with no error anyone would connect to this change. Reading it as
 * ordinary ice is the entire migration: thin ice already shared ice's friction and appearance, so
 * a coerced cell behaves exactly as it looked, minus the cracking that no longer exists.
 *
 * Safe to delete once no stored map contains it — which nothing in this repo can prove, since
 * authored maps live in the database.
 */
const RETIRED_THIN_ICE = "glace-fine";

/** Reads one stored material, or `null` if it is not one. Coerces the retired thin ice to ice. */
function toTerrainMaterial(value: unknown): TerrainMaterial | null {
  if (typeof value !== "string") return null;
  if (value === RETIRED_THIN_ICE) return "glace";
  return (TERRAIN_MATERIALS as readonly string[]).includes(value)
    ? (value as TerrainMaterial)
    : null;
}

function toTerrainLiquid(value: unknown): TerrainLiquid | null {
  return value === "water" || value === "lava" ? value : null;
}

/**
 * The largest grid side a heightfield may declare, in cells — so `decodeMap` bounds `size` rather
 * than only checking it is a positive integer.
 *
 * It is not decoration: `MOVE_COORDINATE_LIMIT` (`protocol.ts`) refuses a reported position beyond
 * half a grid side, and that refusal is only honest if the side itself is bounded. Without this,
 * a heightfield of side 400 decoded happily and a hero past ±128 tiles on it had every movement
 * frame SILENTLY dropped, with no error on either end. Whoever raises this must raise that with it.
 *
 * The value matches `MAP_MAX_COLS`, the legacy tile-map validator's cap, so the two map formats
 * agree on how big a world may get; `map-limits.ts` is not imported here because this file must
 * stay at the bottom of `hd2d/`'s import graph.
 */
export const MAX_HEIGHTFIELD_SIZE = 256;

export interface MapData {
  version: 1;
  /** Exterior maps expose water around land; interior maps expose an unlit void. */
  environment?: MapEnvironment;
  /** Optional world-space cutaway shell, rendered from the same boundary as its colliders. */
  interiorShell?: InteriorShell;
  /**
   * The authored weather. Optional for every heightfield written before it existed, which read as
   * `none` and still do.
   *
   * It travels HERE, inside the terrain string, for the same reason `environment` does: both are
   * map-level presentation an author sets once, and the heightfield is the one authored document
   * that already reaches every consumer -- the room, the client and the editor preview -- with no
   * column, no migration and no second place to forget to copy it to. It is still appearance only:
   * nothing may read it into collision.
   */
  weather?: MapWeather;
  /** Grid side, in cells. At most `MAX_HEIGHTFIELD_SIZE`. */
  size: number;
  levelHeight: number;
  waterLevel: number;
  /** `size * size`, row-major (index = j * size + i). `null` = water. */
  levels: readonly (number | null)[];
  /** `size * size`. Meaningless wherever `levels` is `null`. */
  materials: readonly TerrainMaterial[];
  /** Explicit liquid kind per cell. Optional heightfields retain legacy inference. */
  liquids?: readonly (TerrainLiquid | null)[];
  /** Authored surface tier per explicit liquid. Zero is explicit; `null` means implicit sea/void. */
  liquidLevels?: readonly (number | null)[];
  /** Optional for backward compatibility with heightfields written before authored stairs. */
  ramps?: readonly TerrainRamp[];
  colliders: readonly ColliderRect[];
  spawns: readonly { name: string; x: number; z: number }[];
  /** Decoration. Appearance only. */
  elements: readonly HeightfieldElement[];
  /** Authored events' active page. Appearance only. */
  events: readonly HeightfieldEvent[];
}

/** Decoration, appearance only. Collision comes from `colliders`, never from this list — the
 *  same rule `WorldInfo.elements` follows on the wire. Coordinates are tile units, grid-centred. */
export interface HeightfieldElement {
  assetId: string;
  x: number;
  z: number;
  orientation?: ElementOrientation;
  rotation?: ElementRotation;
  /** Explicit dimensions also signal the centre-based bridge coordinate convention. */
  bridge?: BridgeDimensions;
  /** Custom native-building footprint; height remains archetype-authored. */
  building?: BuildingDimensions;
  /** Custom footprint for native 3D scenery that is not a building. */
  dimensions?: BuildingDimensions;
}

/** An authored event's active page, appearance only. Mirrors `WorldInfo.events`. */
export interface HeightfieldEvent {
  id: string;
  x: number;
  z: number;
  graphicAssetId: string | null;
}

/** No transformation: readability wins for as long as size hasn't become a measured problem.
 *  `tile-layer-codec.ts` (`@lindocara/engine`) is the precedent for the day it is — a run-length
 *  encoding, chosen there because a map is mostly long uniform stretches and because run-length
 *  text stays readable in a baseline and in a failing test, unlike base64. Don't reuse it here
 *  without the same round-trip proof AND the same proof that malformed text always yields `null`:
 *  a compressed codec is harder to debug, and this task hasn't measured any size that justifies
 *  it.
 */
export function encodeMap(m: MapData): string {
  return JSON.stringify(m);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toColliderSurface(value: unknown): ColliderRoofSurface | null {
  if (!isRecord(value) || !isFiniteNumber(value.eave) || !isFiniteNumber(value.peak)) return null;
  if (value.peak < value.eave) return null;
  if (value.shape === "cone") {
    return { shape: "cone", eave: value.eave, peak: value.peak };
  }
  if (value.shape === "gable" && (value.axis === "x" || value.axis === "z")) {
    return {
      shape: "gable",
      eave: value.eave,
      peak: value.peak,
      axis: value.axis,
    };
  }
  return null;
}

// Rebuilt field by field, never assigned as-is: an object with the right fields but also extra
// keys (`{ x, z, w, h, evil: "payload" }`) must not let `evil` surface out of decoding. Same move
// as `decodeMap` at the top level, which already builds its return object field by field rather
// than spreading `value` — internal consistency within the file wins here over `protocol.ts`'s
// `hasOnlyKeys`: this format is a map file re-read by an editor that will gain fields over time,
// not a real-time message where an unknown key deserves to invalidate the whole packet. A map
// enriched by a newer editor (a `locked` flag on a collider, say) stays readable by this code as
// long as it silently ignores what it doesn't yet know about, instead of rejecting the whole map.
function toCollider(value: unknown): ColliderRect | null {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.z) ||
    !isFiniteNumber(value.w) ||
    !isFiniteNumber(value.h)
  )
    return null;
  if (value.top !== undefined && !isFiniteNumber(value.top)) return null;
  if (value.bottom !== undefined && !isFiniteNumber(value.bottom)) return null;
  if (value.rotation !== undefined && !isFiniteNumber(value.rotation)) return null;
  if (value.footprint !== undefined && value.footprint !== "ellipse") return null;
  if (value.support !== undefined && value.support !== "center") return null;
  const surface = value.surface === undefined ? undefined : toColliderSurface(value.surface);
  if (surface === null) return null;
  return {
    x: value.x,
    z: value.z,
    w: value.w,
    h: value.h,
    ...(value.rotation === undefined ? {} : { rotation: value.rotation }),
    ...(value.top === undefined ? {} : { top: value.top }),
    ...(value.bottom === undefined ? {} : { bottom: value.bottom }),
    ...(value.footprint === undefined ? {} : { footprint: value.footprint }),
    ...(value.support === undefined ? {} : { support: value.support }),
    ...(surface === undefined ? {} : { surface }),
  };
}

function toSpawn(value: unknown): { name: string; x: number; z: number } | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.z)
  )
    return null;
  return { name: value.name, x: value.x, z: value.z };
}

function toElement(value: unknown): HeightfieldElement | null {
  if (
    !isRecord(value) ||
    typeof value.assetId !== "string" ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.z)
  )
    return null;
  const orientation = parseElementOrientation(value.orientation);
  const rotation = parseElementRotation(value.rotation);
  const hasRotation = value.rotation !== undefined && value.rotation !== null;
  if (orientation === null || rotation === null || (orientation !== 0 && hasRotation)) return null;
  const bridge = value.bridge === undefined ? undefined : parseBridgeDimensions(value.bridge);
  if (bridge === null || (bridge !== undefined && !bridgeOrientation(value.assetId))) return null;
  const building =
    value.building === undefined ? undefined : parseBuildingDimensions(value.building);
  if (building === null || (building !== undefined && !buildingArchetype(value.assetId)))
    return null;
  const dimensions =
    value.dimensions === undefined ? undefined : parseBuildingDimensions(value.dimensions);
  if (dimensions === null || (dimensions !== undefined && !isNativeSceneryAsset(value.assetId))) {
    return null;
  }
  return {
    assetId: value.assetId,
    x: value.x,
    z: value.z,
    ...(orientation === 0 ? {} : { orientation }),
    ...(hasRotation ? { rotation } : {}),
    ...(bridge ? { bridge } : {}),
    ...(building ? { building } : {}),
    ...(dimensions ? { dimensions } : {}),
  };
}

function toEvent(value: unknown): HeightfieldEvent | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.z) ||
    !(value.graphicAssetId === null || typeof value.graphicAssetId === "string")
  )
    return null;
  return { id: value.id, x: value.x, z: value.z, graphicAssetId: value.graphicAssetId };
}

function toRamp(value: unknown): TerrainRamp | null {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.z) ||
    !isFiniteNumber(value.width) ||
    value.width <= 0 ||
    !isFiniteNumber(value.depth) ||
    value.depth <= 0 ||
    !isRampDirection(value.direction) ||
    !Number.isSafeInteger(value.lowLevel)
  ) {
    return null;
  }
  return {
    x: value.x,
    z: value.z,
    width: value.width,
    depth: value.depth,
    direction: value.direction,
    lowLevel: value.lowLevel as number,
  };
}

/**
 * REALLY validates a map before making it usable: version, positive integer size, both grids at
 * exactly `size * size` entries, every material within the union, every number finite. The
 * slightest violation yields `null` — never an exception, never an object partially taken on
 * faith.
 */
export function decodeMap(s: string): MapData | null {
  let value: unknown;
  try {
    value = JSON.parse(s);
  } catch {
    return null;
  }

  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;

  const environment = parseMapEnvironment(value.environment ?? DEFAULT_MAP_ENVIRONMENT);
  if (!environment) return null;

  const interiorShell =
    value.interiorShell === undefined ? undefined : parseInteriorShell(value.interiorShell);
  if (value.interiorShell !== undefined && !interiorShell) return null;
  if (interiorShell && environment !== "interior") return null;

  const weather = parseMapWeather(value.weather ?? DEFAULT_MAP_WEATHER);
  if (!weather) return null;

  const { size, levelHeight, waterLevel, levels, materials, colliders, spawns } = value;
  if (!Number.isInteger(size) || (size as number) <= 0 || (size as number) > MAX_HEIGHTFIELD_SIZE)
    return null;
  if (
    interiorShell?.innerWalls?.some(
      (run) => run.row >= (size as number) || run.col + run.length > (size as number),
    )
  )
    return null;
  if (
    interiorShell?.openings?.some((run) =>
      run.side === "north" || run.side === "south"
        ? run.row >= (size as number) || run.col + run.length > (size as number)
        : run.col >= (size as number) || run.row + run.length > (size as number),
    )
  )
    return null;
  if (!isFiniteNumber(levelHeight) || !isFiniteNumber(waterLevel)) return null;

  const cells = (size as number) * (size as number);
  if (!Array.isArray(levels) || levels.length !== cells) return null;
  if (!Array.isArray(materials) || materials.length !== cells) return null;
  for (const level of levels) {
    if (level !== null && !isFiniteNumber(level)) return null;
  }
  const decodedMaterials = (materials as unknown[]).map(toTerrainMaterial);
  if (decodedMaterials.some((material) => material === null)) return null;

  const hasLiquids = value.liquids !== undefined;
  const hasLiquidLevels = value.liquidLevels !== undefined;
  if (hasLiquids !== hasLiquidLevels) return null;
  let decodedLiquids: Array<TerrainLiquid | null> | undefined;
  let decodedLiquidLevels: Array<number | null> | undefined;
  if (hasLiquids) {
    if (!Array.isArray(value.liquids) || value.liquids.length !== cells) return null;
    if (!Array.isArray(value.liquidLevels) || value.liquidLevels.length !== cells) return null;
    decodedLiquids = [];
    decodedLiquidLevels = [];
    for (let index = 0; index < cells; index += 1) {
      const rawLiquid = value.liquids[index];
      const liquid = rawLiquid === null ? null : toTerrainLiquid(rawLiquid);
      const level = value.liquidLevels[index];
      if (rawLiquid !== null && liquid === null) return null;
      if (level !== null && !isFiniteNumber(level)) return null;
      if (liquid === null && level !== null) return null;
      if (liquid === "lava" && level === null) return null;
      if (liquid !== null && levels[index] !== null) return null;
      decodedLiquids.push(liquid);
      decodedLiquidLevels.push(level as number | null);
    }
  }

  if (value.ramps !== undefined && !Array.isArray(value.ramps)) return null;
  const rawRamps = Array.isArray(value.ramps) ? value.ramps : [];
  const decodedRamps = rawRamps.map(toRamp);
  if (decodedRamps.some((ramp) => ramp === null)) return null;

  if (!Array.isArray(colliders)) return null;
  const decodedColliders = colliders.map(toCollider);
  if (decodedColliders.some((c) => c === null)) return null;

  if (!Array.isArray(spawns)) return null;
  const decodedSpawns = spawns.map(toSpawn);
  if (decodedSpawns.some((s) => s === null)) return null;

  // Absent means empty (a map written before these fields existed is still readable), malformed
  // means `null` (a corrupt one is not) — the "newer editor may add fields" comment above, applied
  // to a field that is itself new.
  if (value.elements !== undefined && !Array.isArray(value.elements)) return null;
  const rawElements = Array.isArray(value.elements) ? value.elements : [];
  const decodedElements = rawElements.map(toElement);
  if (decodedElements.some((e) => e === null)) return null;

  if (value.events !== undefined && !Array.isArray(value.events)) return null;
  const rawEvents = Array.isArray(value.events) ? value.events : [];
  const decodedEvents = rawEvents.map(toEvent);
  if (decodedEvents.some((e) => e === null)) return null;

  return {
    version: 1,
    environment,
    ...(interiorShell ? { interiorShell } : {}),
    // Present only when the source declared one, exactly like `ramps` below and unlike
    // `environment`: a heightfield written before weather existed must decode to the same object it
    // encoded from, or every round-trip fixture in the suite gains a key it never had.
    ...(value.weather === undefined ? {} : { weather }),
    size: size as number,
    levelHeight,
    waterLevel,
    levels: levels as (number | null)[],
    materials: decodedMaterials as TerrainMaterial[],
    ...(decodedLiquids === undefined
      ? {}
      : { liquids: decodedLiquids, liquidLevels: decodedLiquidLevels as Array<number | null> }),
    ...(value.ramps === undefined ? {} : { ramps: decodedRamps as TerrainRamp[] }),
    colliders: decodedColliders as ColliderRect[],
    spawns: decodedSpawns as { name: string; x: number; z: number }[],
    elements: decodedElements as HeightfieldElement[],
    events: decodedEvents as HeightfieldEvent[],
  };
}

/** Adapts a decoded `MapData` into what `createTerrainQuery` consumes: the same cell-indexed
 *  accessors as `HeightField` (`island.ts`), read from the serialized grid instead of computed by
 *  procedural noise. */
export function mapToQuerySource(m: MapData): TerrainQuerySource {
  const inBounds = (i: number, j: number) => i >= 0 && j >= 0 && i < m.size && j < m.size;
  const indexOf = (i: number, j: number): number => j * m.size + i;
  const liquidAt = (i: number, j: number): TerrainLiquid | null => {
    if (!inBounds(i, j)) return "water";
    const index = indexOf(i, j);
    const explicit = m.liquids?.[index] ?? null;
    if (explicit) return explicit;
    if (m.levels[index] !== null && m.materials[index] === "lave") return "lava";
    return m.levels[index] === null ? "water" : null;
  };
  const liquidLevelAt = (i: number, j: number): number | null => {
    if (!inBounds(i, j)) return null;
    const index = indexOf(i, j);
    const explicit = m.liquids?.[index] ?? null;
    if (explicit) return m.liquidLevels?.[index] ?? null;
    return m.levels[index] !== null && m.materials[index] === "lave"
      ? (m.levels[index] ?? null)
      : null;
  };
  return {
    size: m.size,
    levelHeight: m.levelHeight,
    waterLevel: m.waterLevel,
    at(i, j) {
      if (!inBounds(i, j)) return null;
      if (liquidAt(i, j)) return null;
      return m.levels[indexOf(i, j)] ?? null;
    },
    kindAt(i, j) {
      if (!inBounds(i, j)) return null;
      if (liquidAt(i, j)) return null;
      // Water has no material — `levels` stays the authority, `materials` is "meaningless"
      // wherever it is `null` (see the field's comment), so we don't even read it.
      if (m.levels[indexOf(i, j)] === null) return null;
      return m.materials[indexOf(i, j)] ?? null;
    },
    liquidAt,
    liquidLevelAt,
    waterAt(i, j) {
      return liquidAt(i, j) === "water" ? liquidLevelAt(i, j) : null;
    },
    ramps: m.ramps ?? [],
    platforms: m.colliders.flatMap((collider) =>
      collider.top === undefined && collider.surface === undefined ? [] : [collider],
    ),
  };
}
