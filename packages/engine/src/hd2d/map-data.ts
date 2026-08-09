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

import type { ColliderRect } from "./collider-index.js";
import type { TerrainMaterial, TerrainQuerySource, TerrainRamp } from "./terrain-query.js";

/** The five materials of `TerrainMaterial`, as a RUNTIME enumeration — the type alone is not
 *  enough to validate a string coming from the network, it vanishes at compile time. */
const TERRAIN_MATERIALS: readonly TerrainMaterial[] = [
  "sable",
  "herbe",
  "neige",
  "glace",
  "glace-fine",
];

function isTerrainMaterial(value: unknown): value is TerrainMaterial {
  return typeof value === "string" && (TERRAIN_MATERIALS as readonly string[]).includes(value);
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
  /** Grid side, in cells. At most `MAX_HEIGHTFIELD_SIZE`. */
  size: number;
  levelHeight: number;
  waterLevel: number;
  /** `size * size`, row-major (index = j * size + i). `null` = water. */
  levels: readonly (number | null)[];
  /** `size * size`. Meaningless wherever `levels` is `null`. */
  materials: readonly TerrainMaterial[];
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
  return { x: value.x, z: value.z, w: value.w, h: value.h };
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
  return { assetId: value.assetId, x: value.x, z: value.z };
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
    (value.direction !== "east" && value.direction !== "west") ||
    !Number.isSafeInteger(value.lowLevel) ||
    (value.lowLevel as number) < 0
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

  const { size, levelHeight, waterLevel, levels, materials, colliders, spawns } = value;
  if (!Number.isInteger(size) || (size as number) <= 0 || (size as number) > MAX_HEIGHTFIELD_SIZE)
    return null;
  if (!isFiniteNumber(levelHeight) || !isFiniteNumber(waterLevel)) return null;

  const cells = (size as number) * (size as number);
  if (!Array.isArray(levels) || levels.length !== cells) return null;
  if (!Array.isArray(materials) || materials.length !== cells) return null;
  for (const level of levels) {
    if (level !== null && !isFiniteNumber(level)) return null;
  }
  for (const material of materials) {
    if (!isTerrainMaterial(material)) return null;
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
    size: size as number,
    levelHeight,
    waterLevel,
    levels: levels as (number | null)[],
    materials: materials as TerrainMaterial[],
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
  return {
    size: m.size,
    levelHeight: m.levelHeight,
    waterLevel: m.waterLevel,
    at(i, j) {
      if (!inBounds(i, j)) return null;
      return m.levels[j * m.size + i] ?? null;
    },
    kindAt(i, j) {
      if (!inBounds(i, j)) return null;
      // Water has no material — `levels` stays the authority, `materials` is "meaningless"
      // wherever it is `null` (see the field's comment), so we don't even read it.
      if (m.levels[j * m.size + i] === null) return null;
      return m.materials[j * m.size + i] ?? null;
    },
    ramps: m.ramps ?? [],
  };
}
