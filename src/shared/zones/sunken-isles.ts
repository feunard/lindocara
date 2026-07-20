/**
 * Sunken Isles — an archipelago in the composition of Tiny Swords' promo art.
 *
 * Land is the positive space here: `scripts/build-map.ts` starts every cell as water and paints
 * these rects as grass, which is the inverse of how Verdant Reach is built. See
 * `docs/superpowers/specs/2026-07-16-sunken-isles-design.md`.
 *
 * The five land rects OVERLAP deliberately. There are no bridges in this game, so detached land is
 * land nobody can ever stand on: the walkable cells must be a single connected component, and the
 * overlaps are the necks that weld the lobes together. `test/zone-connectivity.test.ts` fails if a
 * lobe ever floats free. The islets below are detached ON PURPOSE and carry nothing — no spawn, no
 * portal, no building — precisely because they are unreachable.
 */
import { emptyColliderIndex } from "../collider.js";
import type { Rect, TerrainGeometry, WorldLandmark } from "../game.js";
import type { Vec2, WorldBounds } from "../simulation.js";
import { SUNKEN_ISLES_TILES } from "./sunken-isles-tiles.js";

export const SUNKEN_ISLES_BOUNDS: WorldBounds = { width: 2560, height: 1920 };

/** The single walkable landmass, as overlapping lobes: NW castle, E village, S tower. */
export const SUNKEN_ISLES_LAND: readonly Rect[] = [
  { x: 192, y: 256, width: 704, height: 576 }, // A — NW lobe, the castle
  { x: 768, y: 576, width: 512, height: 320 }, // B — central spine, welds A/C/D
  { x: 1216, y: 384, width: 1152, height: 640 }, // C — E lobe, the village
  { x: 1024, y: 832, width: 384, height: 512 }, // D — S neck
  { x: 704, y: 1280, width: 1024, height: 448 }, // E — S lobe, the tower
] as const;

/** Scenery only — deliberately unreachable, exactly like the promo's rock islets. */
export const SUNKEN_ISLES_ISLETS: readonly Rect[] = [
  { x: 2176, y: 1408, width: 192, height: 128 },
  { x: 256, y: 1536, width: 192, height: 128 },
  { x: 2048, y: 128, width: 128, height: 128 },
] as const;

/** Treelines. Land you cannot walk into, drawn as trees standing on grass. */
export const SUNKEN_ISLES_FORESTS: readonly Rect[] = [
  { x: 192, y: 256, width: 704, height: 128 }, // A's northern treeline
  { x: 2048, y: 384, width: 320, height: 640 }, // C's eastern treeline
  { x: 704, y: 1600, width: 1024, height: 128 }, // E's southern treeline
] as const;

export const SUNKEN_ISLES_LANDMARKS: readonly WorldLandmark[] = [
  {
    id: "isles-castle",
    kind: "building",
    x: 448,
    y: 544,
    width: 224,
    height: 192,
    collider: { x: 384, y: 512, width: 192, height: 128 },
  },
  {
    id: "isles-house-north",
    kind: "building",
    x: 1520,
    y: 560,
    width: 160,
    height: 144,
    collider: { x: 1472, y: 544, width: 128, height: 96 },
  },
  {
    id: "isles-house-east",
    kind: "building",
    x: 1808,
    y: 704,
    width: 160,
    height: 144,
    collider: { x: 1760, y: 688, width: 128, height: 96 },
  },
  {
    id: "isles-house-south",
    kind: "building",
    x: 1616,
    y: 880,
    width: 160,
    height: 144,
    collider: { x: 1568, y: 864, width: 128, height: 96 },
  },
  {
    id: "isles-tower",
    kind: "building",
    x: 1120,
    y: 1424,
    width: 160,
    height: 192,
    collider: { x: 1072, y: 1408, width: 128, height: 128 },
  },
] as const;

/** On the central spine (rect B), which every lobe connects through. */
export const SUNKEN_ISLES_SPAWNS: readonly Vec2[] = [
  { x: 1050, y: 720 },
  { x: 986, y: 720 },
  { x: 1114, y: 720 },
] as const;

export const SUNKEN_ISLES_SAFE_ZONE: Rect = { x: 960, y: 576, width: 384, height: 320 };

export const SUNKEN_ISLES_TERRAIN: TerrainGeometry = {
  width: SUNKEN_ISLES_BOUNDS.width,
  height: SUNKEN_ISLES_BOUNDS.height,
  // `obstacles` is minimap-only legacy (see TerrainGeometry's doc comment); tiles are the collision
  // truth. Listing every water rect here would be a second, drifting description of the sea.
  obstacles: [],
  spawnPoints: SUNKEN_ISLES_SPAWNS,
  safeZone: SUNKEN_ISLES_SAFE_ZONE,
  tiles: SUNKEN_ISLES_TILES,
  colliders: emptyColliderIndex(SUNKEN_ISLES_TILES.cols, SUNKEN_ISLES_TILES.rows),
};
