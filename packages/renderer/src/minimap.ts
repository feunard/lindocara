/**
 * Pure map geometry. No DOM, no Pixi, no React — which is why it is unit-testable inside
 * workerd, and why minimap-surface.ts (the canvas shell next door) has no logic in it.
 */
import type { GroundVector } from "@lindocara/engine/ground.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import { PLAYER_VISIBILITY_RADIUS } from "@lindocara/engine/interest.js";
import type { ZoneId } from "@lindocara/engine/zones.js";

/** Derived, not restated: hand-copying PLAYER_VISIBILITY_RADIUS here would let someone tune
 *  the server's radius without ever seeing this constant, and the minimap would silently start
 *  drawing empty space where players actually are — the server does not send them past it. */
export const MINIMAP_WORLD_RADIUS = PLAYER_VISIBILITY_RADIUS;

/** Texels per tile in the baked texture. A 64-cell grid bakes to 512x512, the same order the
 *  pixel world's 1/8-of-4800 bake produced — the ruler changed, not the resolution. */
export const MINIMAP_TEXELS_PER_TILE = 8;

export interface MapPoint {
  x: number;
  y: number;
  inside: boolean;
}

export interface RingPoint extends MapPoint {
  /** Radians, screen space: 0 is east, +PI/2 is south. */
  angle: number;
}

/**
 * The world's extent, in tile units: a heightfield grid is square and CENTRED ON THE ORIGIN, so one
 * number describes it and the projections below must shift by `size / 2` before they scale. The
 * pixel `width`/`height` pair this replaces needed no shift, which is exactly why keeping it would
 * have let a projection silently drop the origin change and put every marker a half-map out.
 */
export interface MapBounds {
  size: number;
}

export interface MapSize {
  width: number;
  height: number;
}

/** The exact subset of a welcome's WorldInfo that `bakeWorldTexture` reads. */
export interface BakedWorldKey extends MapBounds {
  zoneId: ZoneId;
  revision: number;
}

/**
 * Whether two welcomes would bake to the same texture, so a caller can keep an existing bake
 * instead of paying for an identical one. The terrain comes from the room's heightfield, and
 * `revision` is what changes when that string does; `size` sets the baked footprint. No other
 * welcome field influences the texture.
 */
export function sameBakedWorld(a: BakedWorldKey, b: BakedWorldKey): boolean {
  return a.zoneId === b.zoneId && a.revision === b.revision && a.size === b.size;
}

/** World point to minimap pixel, centred on the viewer. Fixed north: the camera never rotates.
 *  The map's second axis is screen-down, which is `z` on the ground plane. */
export function projectToMinimap(
  point: GroundVector,
  center: GroundVector,
  sizePx: number,
): MapPoint {
  const half = sizePx / 2;
  const scale = half / MINIMAP_WORLD_RADIUS;
  const dx = point.x - center.x;
  const dz = point.z - center.z;
  return {
    x: half + dx * scale,
    y: half + dz * scale,
    inside: Math.hypot(dx, dz) <= MINIMAP_WORLD_RADIUS,
  };
}

/** World point to full-map pixel. The `+ size / 2` is the origin shift: a grid coordinate runs
 *  `-size/2`..`+size/2`, and forgetting it puts the whole world in the bottom-right quadrant. */
export function projectToWorldMap(point: GroundVector, world: MapBounds, size: MapSize): MapPoint {
  return {
    x: ((point.x + world.size / 2) / world.size) * size.width,
    y: ((point.z + world.size / 2) / world.size) * size.height,
    inside: true,
  };
}

/**
 * Where to draw a marker for something that may be off the minimap — your corpse.
 * Inside the radius it is the projected point. Outside, it is pinned to the ring with an
 * angle pointing at the target, so a ghost always knows which way to walk.
 */
export function clampToRing(target: GroundVector, center: GroundVector, sizePx: number): RingPoint {
  const half = sizePx / 2;
  const dx = target.x - center.x;
  const dz = target.z - center.z;
  const angle = Math.atan2(dz, dx);
  const distance = Math.hypot(dx, dz);
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

/**
 * The minimap is a map of what the world IS, so it colours by what the heightfield says is there:
 * water where there is no ground, otherwise the cell's material, darkened by its elevation so a
 * plateau reads as raised rather than as a differently-coloured field.
 */
export function colorForCell(material: TerrainMaterial | undefined, level: number | null): number {
  if (level === null) return 0x3f6f9c;
  const base = MATERIAL_COLORS[material ?? "herbe"] ?? 0x7fa653;
  // Each tier lightens by a fixed step, capped so a tall map does not wash out to white.
  const lift = Math.min(3, Math.max(0, Math.round(level))) * 0x0c;
  const channel = (shift: number) => Math.min(0xff, ((base >> shift) & 0xff) + lift) << shift;
  return channel(16) | channel(8) | channel(0);
}

const MATERIAL_COLORS: Record<TerrainMaterial, number> = {
  sable: 0xc9b783,
  herbe: 0x7fa653,
  neige: 0xdfe7ee,
  glace: 0x9fc4d8,
  "glace-fine": 0xbcd9e6,
};

export interface BakedTerrain {
  /** Texture size in texels, `MINIMAP_TEXELS_PER_TILE` per tile. */
  width: number;
  height: number;
  /** Colour at texel (tx, ty), sampled from the very heightfield the server baked its collision
   *  from — so what is drawn and what is walkable cannot disagree. */
  colorAt(tx: number, ty: number): number;
}

/**
 * The whole bake, minus the canvas: given the room's OWN decoded heightfield, the colour grid the
 * widget paints. Kept here, pure, so "does this map's bake reflect this map's terrain" is a fast
 * unit test rather than a canvas pixel-read — see minimap-surface.ts, which calls this and only
 * handles the DOM/ImageData part.
 */
export function bakeTerrain(map: MapData): BakedTerrain {
  const side = Math.max(1, map.size * MINIMAP_TEXELS_PER_TILE);
  return {
    width: side,
    height: side,
    colorAt: (tx, ty) => {
      const i = Math.min(map.size - 1, Math.max(0, Math.floor(tx / MINIMAP_TEXELS_PER_TILE)));
      const j = Math.min(map.size - 1, Math.max(0, Math.floor(ty / MINIMAP_TEXELS_PER_TILE)));
      const index = j * map.size + i;
      return colorForCell(map.materials[index], map.levels[index] ?? null);
    },
  };
}
