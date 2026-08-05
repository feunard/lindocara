/**
 * Area-of-interest radii, in tile units with the grid centre as origin — not pixels. Each value
 * is the exact quotient of its former pixel radius by `TILE_SIZE`, so the ground a radius covers
 * is unchanged; only the ruler measuring it is. Do not round these to "nicer" numbers — a changed
 * radius is a gameplay change, not a unit conversion.
 *
 * `SPATIAL_CELL_SIZE` and `SPATIAL_EVENT_RADIUS` stay in pixels here: their call sites still
 * query grids built from pixel positions, and converting them ahead of those positions (a later
 * task) would silently break the queries rather than the tests that should catch it.
 */
import { TILE_SIZE } from "./tilemap.js";

/** Spatial index cell edge. Close to the entity radii while keeping queries to few cells. */
export const SPATIAL_CELL_SIZE = 256;

export const PLAYER_VISIBILITY_RADIUS = 900 / TILE_SIZE;
export const MONSTER_VISIBILITY_RADIUS = 850 / TILE_SIZE;
export const LOOT_VISIBILITY_RADIUS = 650 / TILE_SIZE;
export const GUARD_VISIBILITY_RADIUS = 900 / TILE_SIZE;
export const CORPSE_VISIBILITY_RADIUS = 900 / TILE_SIZE;

/** Existing entities remain visible this far beyond their enter radius to prevent edge flicker. */
export const INTEREST_HYSTERESIS = 96 / TILE_SIZE;

export const SPATIAL_EVENT_RADIUS = 850;
export const LOCAL_CHAT_RADIUS = 700 / TILE_SIZE;

export const CHAT_CHANNELS = ["local", "party", "guild", "global", "whisper"] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];
