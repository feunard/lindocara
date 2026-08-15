/**
 * The authoring shape of a map (`MapInput`) and the one template a new map is ever born from.
 *
 * This lives in the engine rather than beside the server's map validation because BOTH sides mint
 * it now: `MapService.createMap` when the database creates a map, and the editor when it opens a
 * local sandbox that has not been saved yet. Two copies of a "blank map" would drift silently — the
 * sandbox would be born on a template the server would never have produced, and the difference
 * would only surface as a diff on the author's very first save.
 *
 * Validation is NOT here: `validateMapInput` (server) remains the semantic gate every stored map
 * passes through. This file only describes the shape and hands out the blank one.
 */
import { EMPTY_MAP_AUDIO, type MapAudioConfig } from "./audio-catalog.js";
import { EMPTY_MARKERS, type MapElement, type MapMarkers } from "./map-data.js";
import { DEFAULT_MAP_ENVIRONMENT, type MapEnvironment } from "./map-environment.js";
import type { MapEvent } from "./map-events.js";
import { defaultMapHeroSettings, type MapHeroSettings } from "./map-hero-settings.js";
import { DEFAULT_MAP_FIXED_LIGHTING, type MapFixedLighting } from "./map-lighting.js";
import { MAP_MAX_COLS, MAP_MAX_ROWS, MAP_MIN_COLS, MAP_MIN_ROWS } from "./map-limits.js";
import { layersFromBlocks } from "./map-migrate.js";
import type { TileLayer } from "./tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "./tilesets/tiny-swords.js";

/** The name a fresh adventure's first map is born with (UX wave #16). */
export const DEFAULT_FIRST_MAP_NAME = "Map1";

export interface MapInput {
  name: string;
  /** Missing keeps legacy maps on the exterior presentation. */
  environment?: MapEnvironment | undefined;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: readonly TileLayer[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  markers?: MapMarkers | undefined;
  events?: readonly MapEvent[] | undefined;
  audio?: MapAudioConfig | undefined;
  heroSettings?: MapHeroSettings | undefined;
  /** Missing keeps legacy writers on the historical cycle-enabled behaviour. */
  dayNightCycle?: boolean | undefined;
  /** Missing keeps disabled legacy maps fixed in daylight. */
  fixedLighting?: MapFixedLighting | undefined;
  /** Encoded HD-2D terrain derived or authored by the editor. Omission preserves stored terrain. */
  heightfield?: string | undefined;
}

/**
 * The one template a new map is ever created from — ported verbatim from `maps.ts`. Bounded field of
 * flat grass, walkable everywhere, spawn dead centre, no elements, no events.
 */
export function defaultMapInput(name: string, cols = MAP_MIN_COLS, rows = MAP_MIN_ROWS): MapInput {
  if (
    !Number.isSafeInteger(cols) ||
    !Number.isSafeInteger(rows) ||
    cols < MAP_MIN_COLS ||
    cols > MAP_MAX_COLS ||
    rows < MAP_MIN_ROWS ||
    rows > MAP_MAX_ROWS
  ) {
    throw new Error("size: map dimensions are out of bounds");
  }
  const { layers } = layersFromBlocks(Array.from({ length: rows }, () => ".".repeat(cols)));
  const spawn = { col: Math.floor(cols / 2), row: Math.floor(rows / 2) };
  return {
    name,
    environment: DEFAULT_MAP_ENVIRONMENT,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols,
    rows,
    layers,
    elements: [],
    spawn,
    markers: EMPTY_MARKERS,
    events: [],
    audio: EMPTY_MAP_AUDIO,
    heroSettings: defaultMapHeroSettings(),
    // Permanent day, NOT the cycle. A blank map is something an author is about to paint, and a
    // clock that dims the stage mid-stroke fights that; the cycle is a deliberate choice made in the
    // toolbar's ambience menu, not the state a map is born in. Only the TEMPLATE moved: a stored map
    // that never wrote the field still reads as cycle-enabled (`MapInput.dayNightCycle`'s docblock,
    // `mapAuthoring`'s `?? true`), so nothing already authored changes ambience under its author.
    dayNightCycle: false,
    fixedLighting: DEFAULT_MAP_FIXED_LIGHTING,
  };
}
