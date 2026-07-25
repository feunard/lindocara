import { PLAYER_SIZE, type Vec2 } from "@lindocara/engine/simulation.js";
import { stairsDescriptor } from "@lindocara/engine/tile-brush.js";
import type { TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { kindAtPoint, TILE_SIZE, type TileMap } from "@lindocara/engine/tilemap.js";
import { decodeTileId, EMPTY_TILE } from "@lindocara/engine/tileset.js";
import { elevationOfSlot } from "@lindocara/engine/tilesets/tiny-swords.js";
import type { Biome, ZoneDefinition } from "./world-layout.js";

export interface TerrainTints {
  land: number;
  water: number;
}

export interface WaterScrollOffsets {
  primary: { x: number; y: number };
  secondary: { x: number; y: number };
}

export interface WaterSurfaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const WATER_RENDER_OBJECTS = 2;

/** Maximum screen-space rise of a hero while their feet traverse a staircase cell. */
export const RAMP_HERO_LIFT_PX = 7;

/** How far the camera looks uphill for each complete authored elevation level. */
export const ELEVATION_CAMERA_RISE_PX = 24;
/** Level 2 gets extra separation so the second climb reads as a higher storey, not a repeated bob. */
export const ELEVATION_LEVEL_2_CAMERA_RISE_PX = 56;

/**
 * A smooth rise-and-settle arc across one ramp cell.
 *
 * Movement remains in world space; this shifts only the rendered hero. The active travel axis
 * chooses the local progress through either native side stair.
 */
export function rampHeroLift(tiles: TileMap, position: Vec2, travel: Vec2): number {
  const centerX = position.x + PLAYER_SIZE / 2;
  const centerY = position.y + PLAYER_SIZE / 2;
  if (kindAtPoint(tiles, centerX, centerY) !== "ramp") return 0;
  const coordinate = Math.abs(travel.x) >= Math.abs(travel.y) ? centerX : centerY;
  const local = ((coordinate % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
  return -Math.sin((local / TILE_SIZE) * Math.PI) * RAMP_HERO_LIFT_PX;
}

/**
 * The fractional authored elevation under a hero's centre.
 *
 * Ordinary ground reads its autotile slot. A ramp reads its frozen direction/level id and blends
 * across the cell towards the high side, so the camera begins rising while the hero is on the
 * stairs instead of snapping only after their feet reach the plateau.
 */
export function authoredElevationAt(layers: readonly TileLayer[], position: Vec2): number {
  const ground = layers[0];
  if (!ground) return 0;
  const centerX = position.x + PLAYER_SIZE / 2;
  const centerY = position.y + PLAYER_SIZE / 2;
  const col = Math.floor(centerX / TILE_SIZE);
  const row = Math.floor(centerY / TILE_SIZE);
  if (col < 0 || row < 0 || col >= ground.cols || row >= ground.rows) return 0;

  const groundRef = decodeTileId(ground.ids[row * ground.cols + col] ?? EMPTY_TILE);
  const baseLevel =
    groundRef.kind === "autotile" ? Math.max(0, elevationOfSlot(groundRef.slot)) : 0;
  const walls = layers[1];
  if (!walls || col >= walls.cols || row >= walls.rows) return baseLevel;
  const wallRef = decodeTileId(walls.ids[row * walls.cols + col] ?? EMPTY_TILE);
  if (wallRef.kind !== "fixed") return baseLevel;
  const stairs = stairsDescriptor(wallRef.index);
  if (!stairs) return baseLevel;

  const localX = ((centerX % TILE_SIZE) + TILE_SIZE) % TILE_SIZE;
  const uphillProgress = stairs.direction === "east" ? localX / TILE_SIZE : 1 - localX / TILE_SIZE;
  return stairs.lowLevel + uphillProgress;
}

/** Positive world-space distance by which the camera target should look uphill. */
export function elevationCameraRise(layers: readonly TileLayer[], position: Vec2): number {
  const elevation = authoredElevationAt(layers, position);
  if (elevation <= 1) return elevation * ELEVATION_CAMERA_RISE_PX;
  const secondClimbProgress = Math.min(1, elevation - 1);
  return (
    ELEVATION_CAMERA_RISE_PX +
    secondClimbProgress * (ELEVATION_LEVEL_2_CAMERA_RISE_PX - ELEVATION_CAMERA_RISE_PX)
  );
}

/** One viewport-sized surface, clipped to the current zone; land tiles mask it from above. */
export function waterSurfaceRect(
  startX: number,
  startY: number,
  columns: number,
  rows: number,
  tileSize: number,
  zoneWidth: number,
  zoneHeight: number,
): WaterSurfaceRect {
  const x = Math.max(0, Math.min(zoneWidth, startX));
  const y = Math.max(0, Math.min(zoneHeight, startY));
  return {
    x,
    y,
    width: Math.max(0, Math.min(zoneWidth - x, columns * tileSize)),
    height: Math.max(0, Math.min(zoneHeight - y, rows * tileSize)),
  };
}

// These are the two authored UV velocities from ocean_surface.tscn. Keeping them here makes the
// browser rendering follow the supplied water material instead of inventing an unrelated pulse.
const WATER_PRIMARY_SCROLL = { x: 0.015, y: 0.001 } as const;
const WATER_SECONDARY_SCROLL = { x: -0.015, y: -0.02 } as const;

/** One full cycle of `Foam.png`'s eight frames. Slow on purpose: the shoreline should breathe, not
 *  flicker. */
export const FOAM_CYCLE_MS = 1_000;

/**
 * Water and foam are *modulation* tints, exactly like `land` already was — not colours.
 *
 * Tiny Swords authored its sea as one flat teal with the foam drawn to sit against it, so a white
 * tint reproduces the pack look verbatim and each biome only bends it from there. Both layers take
 * the same tint, which is what keeps foam reading as foam: multiplying the flat water (71,171,169)
 * and the light foam (198,240,219) by one value preserves the contrast the artist drew between
 * them. Tint them separately and the shoreline stops belonging to the water it sits in.
 */
const WATER_TINTS: Readonly<Record<Biome, number>> = {
  village: 0xffffff,
  meadow: 0xfcffff,
  farm: 0xf6fcfa,
  forest: 0xecf6f0,
  wetland: 0xe6f2ea,
  ruins: 0xe4eef2,
  marsh: 0xd6e8de,
};

function channel(color: number, shift: number): number {
  return (color >> shift) & 0xff;
}

export function blendTint(first: number, second: number, firstWeight: number): number {
  const weight = Math.max(0, Math.min(1, firstWeight));
  const blend = (shift: number) =>
    Math.round(channel(first, shift) * weight + channel(second, shift) * (1 - weight));
  return (blend(16) << 16) | (blend(8) << 8) | blend(0);
}

export function terrainTintsAt(
  x: number,
  y: number,
  regions: readonly ZoneDefinition[],
): TerrainTints {
  if (regions.length === 0) return { land: 0xffffff, water: 0xffffff };
  const nearest = regions
    .map((region) => ({
      region,
      score: Math.hypot((x - region.x) / region.radiusX, (y - region.y) / region.radiusY),
    }))
    .sort((a, b) => a.score - b.score);
  const first = nearest[0];
  if (!first) return { land: 0xffffff, water: 0xffffff };
  const second = nearest[1];
  if (!second) return { land: first.region.tint, water: WATER_TINTS[first.region.biome] };

  // Equal scores sit on a soft 50/50 boundary. Moving towards a region gradually gives it the
  // full palette, avoiding visible Voronoi seams between neighbouring authored districts.
  const firstWeight = Math.min(1, 0.5 + Math.max(0, second.score - first.score) * 0.42);
  return {
    land: blendTint(first.region.tint, second.region.tint, firstWeight),
    water: blendTint(
      WATER_TINTS[first.region.biome],
      WATER_TINTS[second.region.biome],
      firstWeight,
    ),
  };
}

export function waterScrollOffsets(elapsedMs: number, worldPeriod: number): WaterScrollOffsets {
  return writeWaterScrollOffsets(elapsedMs, worldPeriod, {
    primary: { x: 0, y: 0 },
    secondary: { x: 0, y: 0 },
  });
}

/** Allocation-free variant for the render loop. */
export function writeWaterScrollOffsets(
  elapsedMs: number,
  worldPeriod: number,
  output: WaterScrollOffsets,
): WaterScrollOffsets {
  if (worldPeriod <= 0) {
    output.primary.x = 0;
    output.primary.y = 0;
    output.secondary.x = 0;
    output.secondary.y = 0;
    return output;
  }
  const seconds = Math.max(0, elapsedMs) / 1_000;
  const wrap = (value: number) => ((value % worldPeriod) + worldPeriod) % worldPeriod;
  output.primary.x = wrap(WATER_PRIMARY_SCROLL.x * worldPeriod * seconds);
  output.primary.y = wrap(WATER_PRIMARY_SCROLL.y * worldPeriod * seconds);
  output.secondary.x = wrap(WATER_SECONDARY_SCROLL.x * worldPeriod * seconds);
  output.secondary.y = wrap(WATER_SECONDARY_SCROLL.y * worldPeriod * seconds);
  return output;
}

/** Deterministic start frame for one shoreline blob. Orthogonal neighbours use different phases. */
export function foamPhaseAt(col: number, row: number, frames: number): number {
  if (frames <= 0) return 0;
  const phase = col * 3 + row * 5;
  return ((phase % frames) + frames) % frames;
}

/**
 * Which frame one shoreline blob is on. Pixel Frog's guide explicitly starts each Water Foam
 * sprite at a different frame; `phase` keeps that offset while the shared clock advances them.
 */
export function foamFrameAt(elapsedMs: number, frames: number, phase = 0): number {
  if (frames <= 0) return 0;
  const elapsed = Math.max(0, elapsedMs);
  const normalizedPhase = ((phase % frames) + frames) % frames;
  return (Math.floor((elapsed / FOAM_CYCLE_MS) * frames) + normalizedPhase) % frames;
}

export function pulseTint(color: number, factor: number): number {
  const apply = (shift: number) => Math.min(255, Math.round(channel(color, shift) * factor));
  return (apply(16) << 16) | (apply(8) << 8) | apply(0);
}
