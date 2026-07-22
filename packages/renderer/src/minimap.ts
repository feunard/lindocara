/**
 * Pure map geometry. No DOM, no Pixi, no React — which is why it is unit-testable inside
 * workerd, and why minimap-surface.ts (the canvas shell next door) has no logic in it.
 */
import { PLAYER_VISIBILITY_RADIUS } from "@lindocara/engine/interest.js";
import type { Vec2 } from "@lindocara/engine/simulation.js";
import { kindAtPoint, type TileKind, type TileMap } from "@lindocara/engine/tilemap.js";
import { type ZoneId, zoneDefinition } from "@lindocara/engine/zones.js";

/** Derived, not restated: hand-copying PLAYER_VISIBILITY_RADIUS here would let someone tune
 *  the server's radius without ever seeing this constant, and the minimap would silently start
 *  drawing empty space where players actually are — the server does not send them past it. */
export const MINIMAP_WORLD_RADIUS = PLAYER_VISIBILITY_RADIUS;

/** The baked texture is 1/8 of world size: 4800x2700 becomes 600x338. */
export const MINIMAP_TEXTURE_SCALE = 8;

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

/** The exact subset of a welcome's WorldInfo that `bakeWorldTexture` reads. */
export interface BakedWorldKey extends MapBounds {
  zoneId: ZoneId;
  revision: number;
}

/**
 * Whether two welcomes would bake to the same texture, so a caller can keep an existing bake
 * instead of paying for an identical one. The tilemap comes from `zoneId`; width and height set
 * the baked footprint. No other welcome field influences the texture.
 */
export function sameBakedWorld(a: BakedWorldKey, b: BakedWorldKey): boolean {
  return (
    a.zoneId === b.zoneId &&
    a.revision === b.revision &&
    a.width === b.width &&
    a.height === b.height
  );
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

/** The minimap is a map of what the world IS, so it colours by tile kind — not by sampling a
 *  function that no longer describes anything. */
export function colorForKind(kind: TileKind): number {
  switch (kind) {
    case "water":
      return 0x3f6f9c;
    case "forest":
      return 0x4e7340;
    case "building":
      return 0x8d7256;
    case "bridge":
      return 0xa9855c;
    case "plateau":
      return 0x9dbd6d;
    default:
      return 0x7fa653;
  }
}

export interface BakedTerrain {
  /** Texture size in texels, `MINIMAP_TEXTURE_SCALE` world-units each. */
  width: number;
  height: number;
  /** Colour at texel (tx, ty), sampled from the same `TileMap` collision reads the server uses —
   *  so what is baked and what is walkable cannot disagree. */
  colorAt(tx: number, ty: number): number;
}

/**
 * The whole bake, minus the canvas: given a zone's OWN tile map (never another zone's), the
 * colour grid the widget paints. Kept here, pure, so "does zone X's bake reflect zone X's
 * tiles" is a fast unit test rather than a canvas pixel-read — see minimap-surface.ts, which
 * calls this and only handles the DOM/ImageData part.
 */
export function bakeTerrain(tiles: TileMap, worldWidth: number, worldHeight: number): BakedTerrain {
  const width = Math.ceil(worldWidth / MINIMAP_TEXTURE_SCALE);
  const height = Math.ceil(worldHeight / MINIMAP_TEXTURE_SCALE);
  return {
    width,
    height,
    colorAt: (tx, ty) =>
      colorForKind(kindAtPoint(tiles, tx * MINIMAP_TEXTURE_SCALE, ty * MINIMAP_TEXTURE_SCALE)),
  };
}

/**
 * `bakeTerrain`, but resolving which zone's tiles to use from `zoneId` — the one field a welcome
 * carries for that. Never resolve this from `zoneNameKey`: it is prose the client localizes, not
 * an identifier, and reverse-matching a display string back to a zone is exactly the pattern
 * that let a hardcoded import go unnoticed here before.
 */
export function bakeZoneTerrain(
  zoneId: ZoneId,
  worldWidth: number,
  worldHeight: number,
): BakedTerrain {
  return bakeTerrain(zoneDefinition(zoneId).terrain.tiles, worldWidth, worldHeight);
}
