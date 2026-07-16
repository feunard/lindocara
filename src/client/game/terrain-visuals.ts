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

/**
 * Which foam frame the whole shoreline is on. Deliberately global rather than per-tile: Tiny
 * Swords' foam is one animation ringing a landmass, and giving each tile its own phase would break
 * the blobs apart into a shimmer of unrelated puddles instead of one moving coastline.
 */
export function foamFrameAt(elapsedMs: number, frames: number): number {
  if (frames <= 0) return 0;
  const elapsed = Math.max(0, elapsedMs);
  return Math.floor((elapsed / FOAM_CYCLE_MS) * frames) % frames;
}

export function pulseTint(color: number, factor: number): number {
  const apply = (shift: number) => Math.min(255, Math.round(channel(color, shift) * factor));
  return (apply(16) << 16) | (apply(8) << 8) | apply(0);
}
