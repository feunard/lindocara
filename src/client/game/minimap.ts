/**
 * Pure map geometry. No DOM, no Pixi, no React — which is why it is unit-testable inside
 * workerd, and why minimap-surface.ts (the canvas shell next door) has no logic in it.
 */
import type { Rect } from "../../shared/game.js";
import type { Vec2 } from "../../shared/simulation.js";
import { type GroundPalette, type TerrainSample, terrainAt } from "./world-layout.js";

/** Matches PLAYER_VISIBILITY_RADIUS in shared/interest.ts exactly. Raising it would draw
 *  empty space where players actually are: the server does not send them. */
export const MINIMAP_WORLD_RADIUS = 900;

/** The baked texture is 1/8 of world size: 4800x2700 becomes 600x338. */
export const MINIMAP_TEXTURE_SCALE = 8;

export const VERDANT_REACH_ZONE_KEY = "zone.verdant_reach.name";

export interface MapPoint {
  x: number;
  y: number;
  inside: boolean;
}

export interface RingPoint extends MapPoint {
  /** Radians, screen space: 0 is east, +PI/2 is south. */
  angle: number;
}

export interface MapBounds {
  width: number;
  height: number;
}

export interface MapSize {
  width: number;
  height: number;
}

export interface MapWorld extends MapBounds {
  obstacles: readonly Rect[];
  safeZone: Rect;
}

/** World point to minimap pixel, centred on the viewer. Fixed north: the camera never rotates. */
export function projectToMinimap(point: Vec2, center: Vec2, sizePx: number): MapPoint {
  const half = sizePx / 2;
  const scale = half / MINIMAP_WORLD_RADIUS;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: half + dx * scale,
    y: half + dy * scale,
    inside: Math.hypot(dx, dy) <= MINIMAP_WORLD_RADIUS,
  };
}

/** World point to full-map pixel. Callers size the image to the world's aspect ratio. */
export function projectToWorldMap(point: Vec2, world: MapBounds, size: MapSize): MapPoint {
  return {
    x: (point.x / world.width) * size.width,
    y: (point.y / world.height) * size.height,
    inside: true,
  };
}

/**
 * Where to draw a marker for something that may be off the minimap — your corpse.
 * Inside the radius it is the projected point. Outside, it is pinned to the ring with an
 * angle pointing at the target, so a ghost always knows which way to walk.
 */
export function clampToRing(target: Vec2, center: Vec2, sizePx: number): RingPoint {
  const half = sizePx / 2;
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const angle = Math.atan2(dy, dx);
  const distance = Math.hypot(dx, dy);
  if (distance <= MINIMAP_WORLD_RADIUS) {
    const point = projectToMinimap(target, center, sizePx);
    return { x: point.x, y: point.y, inside: true, angle };
  }
  return {
    x: half + Math.cos(angle) * half,
    y: half + Math.sin(angle) * half,
    inside: false,
    angle,
  };
}

const PALETTE_BASE: Record<GroundPalette, number> = {
  verdant: 0x7fa653,
  moss: 0x4e7340,
  earth: 0xa9855c,
  stone: 0x8d8a84,
  wet: 0x5c8d9a,
};

const OBSTACLE_COLOR = 0x2f2a26;
const PLAIN_GROUND_COLOR = 0x6f9350;
const SANCTUARY_COLOR = 0x9dbd6d;
const WATER_COLOR = 0x3f6f9c;

function multiplyChannel(base: number, tint: number, shift: number): number {
  const b = (base >> shift) & 0xff;
  const t = (tint >> shift) & 0xff;
  return Math.round((b * t) / 0xff) & 0xff;
}

/** Palette base multiplied by the sample's tint — the same way Pixi tints a sprite. */
export function groundColor(sample: TerrainSample): number {
  if (sample.kind === "water") return WATER_COLOR;
  const base = PALETTE_BASE[sample.palette];
  const r = multiplyChannel(base, sample.tint, 16);
  const g = multiplyChannel(base, sample.tint, 8);
  const b = multiplyChannel(base, sample.tint, 0);
  return (r << 16) | (g << 8) | b;
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/**
 * The colour of any world point, for the bake.
 *
 * terrainAt() reads Verdant Reach's blockers and safe zone from shared/game.ts directly, so it
 * describes that zone and no other. Painting its roads over mmo-test-zone would be a confident,
 * detailed lie — so any other zone gets a plain sampler built from server geometry alone.
 */
export function terrainColorAt(zoneNameKey: string, world: MapWorld, x: number, y: number): number {
  if (world.obstacles.some((rect) => contains(rect, x, y))) return OBSTACLE_COLOR;
  if (zoneNameKey === VERDANT_REACH_ZONE_KEY) {
    // Variation is per-texel noise at full resolution; at 1/8 scale it would be speckle.
    return groundColor(terrainAt(x, y, 0.5));
  }
  return contains(world.safeZone, x, y) ? SANCTUARY_COLOR : PLAIN_GROUND_COLOR;
}
