import { type Rect, SAFE_ZONE, WORLD_LANDMARKS, type WorldLandmark } from "../../shared/game.js";
import type { MessageKey } from "../../shared/i18n/index.js";
import type { Vec2 } from "../../shared/simulation.js";
import { SUNKEN_ISLES_LANDMARKS } from "../../shared/zones/sunken-isles.js";
import type { ZoneId as RuntimeZoneId } from "../../shared/zones.js";

export type ZoneId =
  | "heartroot"
  | "old-road"
  | "sunwake"
  | "gloamwood"
  | "old-root-farm"
  | "moonmere"
  | "wayfarer-camp"
  | "elderfall"
  | "duskmire"
  | "sealed-gate"
  | "sunken-isles";

export type Biome = "village" | "meadow" | "forest" | "farm" | "wetland" | "ruins" | "marsh";

export interface ZoneDefinition extends Vec2 {
  id: ZoneId;
  nameKey: MessageKey;
  biome: Biome;
  radiusX: number;
  radiusY: number;
  tint: number;
}

export const WORLD_ZONES: readonly ZoneDefinition[] = [
  {
    id: "heartroot",
    nameKey: "zone.heartroot_crossing",
    biome: "village",
    x: 920,
    y: 720,
    radiusX: 700,
    radiusY: 520,
    tint: 0xf4ead1,
  },
  {
    id: "old-road",
    nameKey: "zone.old_road",
    biome: "meadow",
    x: 1650,
    y: 720,
    radiusX: 520,
    radiusY: 360,
    tint: 0xe0dfb4,
  },
  {
    id: "sunwake",
    nameKey: "zone.sunwake_clearing",
    biome: "meadow",
    x: 2110,
    y: 560,
    radiusX: 470,
    radiusY: 410,
    tint: 0xf2e6b2,
  },
  {
    id: "gloamwood",
    nameKey: "zone.gloamwood",
    biome: "forest",
    x: 2180,
    y: 1390,
    radiusX: 620,
    radiusY: 500,
    tint: 0xb9c9a4,
  },
  {
    id: "old-root-farm",
    nameKey: "zone.old_root_farm",
    biome: "farm",
    x: 1920,
    y: 1980,
    radiusX: 620,
    radiusY: 500,
    tint: 0xdcc798,
  },
  {
    id: "moonmere",
    nameKey: "zone.moonmere_reach",
    biome: "wetland",
    x: 2620,
    y: 1270,
    radiusX: 430,
    radiusY: 930,
    tint: 0xb9d1c0,
  },
  {
    id: "wayfarer-camp",
    nameKey: "zone.wayfarer_camp",
    biome: "meadow",
    x: 2870,
    y: 1810,
    radiusX: 420,
    radiusY: 320,
    tint: 0xd6ceb0,
  },
  {
    id: "elderfall",
    nameKey: "zone.elderfall_ruins",
    biome: "ruins",
    x: 3480,
    y: 760,
    radiusX: 650,
    radiusY: 520,
    tint: 0xbfc0ae,
  },
  {
    id: "duskmire",
    nameKey: "zone.duskmire",
    biome: "marsh",
    x: 3510,
    y: 2150,
    radiusX: 720,
    radiusY: 520,
    tint: 0x9fb499,
  },
  {
    id: "sealed-gate",
    nameKey: "zone.sealed_gate",
    biome: "ruins",
    x: 4470,
    y: 1320,
    radiusX: 420,
    radiusY: 620,
    tint: 0xaeb0a3,
  },
] as const;

export interface RoadDefinition {
  id: string;
  width: number;
  points: readonly Vec2[];
}

/** Wide shared routes form two loops, so travel creates meetings without becoming a corridor. */
export const ROADS: readonly RoadDefinition[] = [
  {
    id: "city-main-street",
    width: 148,
    points: [
      { x: 480, y: 760 },
      { x: 760, y: 760 },
      { x: 1040, y: 760 },
      { x: 1320, y: 760 },
      { x: 1580, y: 760 },
    ],
  },
  {
    id: "city-civic-crossing",
    width: 118,
    points: [
      { x: 1040, y: 480 },
      { x: 1040, y: 760 },
      { x: 1040, y: 1120 },
    ],
  },
  {
    id: "old-road-east",
    width: 132,
    points: [
      { x: 1080, y: 760 },
      { x: 1460, y: 735 },
      { x: 1840, y: 790 },
      { x: 2200, y: 800 },
      { x: 2590, y: 820 },
      { x: 2960, y: 800 },
      { x: 3360, y: 720 },
      { x: 3740, y: 820 },
      { x: 4100, y: 1030 },
      { x: 4430, y: 1260 },
    ],
  },
  {
    id: "farm-loop",
    width: 118,
    points: [
      { x: 1450, y: 820 },
      { x: 1490, y: 1180 },
      { x: 1500, y: 1530 },
      { x: 1680, y: 1870 },
      { x: 2050, y: 2030 },
      { x: 2480, y: 1800 },
      { x: 2600, y: 1800 },
      { x: 2920, y: 1810 },
      { x: 3220, y: 2020 },
      { x: 3560, y: 2180 },
    ],
  },
  {
    id: "forest-loop",
    width: 96,
    points: [
      { x: 2180, y: 790 },
      { x: 2040, y: 1080 },
      { x: 2020, y: 1420 },
      { x: 2300, y: 1660 },
      { x: 2600, y: 1800 },
    ],
  },
  {
    id: "ruin-descent",
    width: 104,
    points: [
      { x: 3440, y: 760 },
      { x: 3600, y: 1080 },
      { x: 3800, y: 1370 },
      { x: 3970, y: 1600 },
      { x: 3800, y: 1850 },
      { x: 3580, y: 2150 },
    ],
  },
  {
    id: "south-return",
    width: 88,
    points: [
      { x: 1040, y: 940 },
      { x: 1290, y: 1160 },
      { x: 1490, y: 1450 },
      { x: 1680, y: 1870 },
    ],
  },
] as const;

export type PoiKind =
  | "tree"
  | "square"
  | "sign"
  | "clearing"
  | "farm"
  | "bridge"
  | "ford"
  | "lake"
  | "ruin"
  | "camp"
  | "danger"
  | "gate";

export interface PointOfInterest extends Vec2 {
  id: string;
  nameKey: MessageKey;
  kind: PoiKind;
  revealRadius: number;
}

export const POINTS_OF_INTEREST: readonly PointOfInterest[] = [
  {
    id: "heartroot-tree",
    nameKey: "poi.heartroot",
    kind: "tree",
    x: 550,
    y: 555,
    revealRadius: 440,
  },
  {
    id: "crossing-square",
    nameKey: "poi.crossing_square",
    kind: "square",
    x: 930,
    y: 790,
    revealRadius: 360,
  },
  {
    id: "old-road-sign",
    nameKey: "sign.city_east",
    kind: "sign",
    x: 1530,
    y: 735,
    revealRadius: 310,
  },
  {
    id: "city-south-sign",
    nameKey: "sign.city_south",
    kind: "sign",
    x: 1320,
    y: 1120,
    revealRadius: 280,
  },
  {
    id: "sunwake-ring",
    nameKey: "poi.sunwake_ring",
    kind: "clearing",
    x: 2100,
    y: 560,
    revealRadius: 420,
  },
  {
    id: "abandoned-farm",
    nameKey: "poi.old_root_farm",
    kind: "farm",
    x: 1960,
    y: 1910,
    revealRadius: 500,
  },
  {
    id: "old-bridge",
    nameKey: "poi.old_bridge",
    kind: "bridge",
    x: 2610,
    y: 820,
    revealRadius: 430,
  },
  {
    id: "bridge-direction-sign",
    nameKey: "sign.bridge",
    kind: "sign",
    x: 2810,
    y: 835,
    revealRadius: 300,
  },
  {
    id: "moonmere-lake",
    nameKey: "poi.moonmere_reach",
    kind: "lake",
    x: 2610,
    y: 1300,
    revealRadius: 560,
  },
  {
    id: "reedwater-ford",
    nameKey: "poi.reedwater_ford",
    kind: "ford",
    x: 2610,
    y: 1800,
    revealRadius: 380,
  },
  {
    id: "elderfall-court",
    nameKey: "poi.elderfall_court",
    kind: "ruin",
    x: 3500,
    y: 720,
    revealRadius: 520,
  },
  {
    id: "wayfarer-fire",
    nameKey: "poi.wayfarer_camp",
    kind: "camp",
    x: 2880,
    y: 1810,
    revealRadius: 390,
  },
  {
    id: "mire-direction-sign",
    nameKey: "sign.mire",
    kind: "sign",
    x: 3030,
    y: 1810,
    revealRadius: 300,
  },
  {
    id: "mire-heart",
    nameKey: "poi.mireheart",
    kind: "danger",
    x: 3530,
    y: 2190,
    revealRadius: 520,
  },
  {
    id: "sealed-gate",
    nameKey: "poi.sealed_gate",
    kind: "gate",
    x: 4480,
    y: 1320,
    revealRadius: 620,
  },
] as const;

export type DecorTheme =
  | "village"
  | "road"
  | "meadow"
  | "forest"
  | "farm"
  | "wet"
  | "ruin"
  | "marsh"
  | "gate";

export interface DecorRegion extends Vec2 {
  id: string;
  theme: DecorTheme;
  radiusX: number;
  radiusY: number;
  count: number;
  seed: number;
}

export const DECOR_REGIONS: readonly DecorRegion[] = [
  {
    id: "hub-verges",
    theme: "village",
    x: 930,
    y: 720,
    radiusX: 720,
    radiusY: 520,
    count: 28,
    seed: 110,
  },
  {
    id: "road-verges",
    theme: "road",
    x: 1680,
    y: 720,
    radiusX: 620,
    radiusY: 390,
    count: 48,
    seed: 240,
  },
  {
    id: "sunwake-edge",
    theme: "meadow",
    x: 2100,
    y: 560,
    radiusX: 500,
    radiusY: 430,
    count: 52,
    seed: 360,
  },
  {
    id: "gloamwood-south",
    theme: "forest",
    x: 2180,
    y: 1420,
    radiusX: 640,
    radiusY: 520,
    count: 110,
    seed: 510,
  },
  {
    id: "farm-fields",
    theme: "farm",
    x: 1900,
    y: 1980,
    radiusX: 620,
    radiusY: 500,
    count: 72,
    seed: 680,
  },
  {
    id: "moonmere-bank",
    theme: "wet",
    x: 2670,
    y: 1320,
    radiusX: 440,
    radiusY: 940,
    count: 82,
    seed: 810,
  },
  {
    id: "elderfall-stones",
    theme: "ruin",
    x: 3500,
    y: 750,
    radiusX: 690,
    radiusY: 540,
    count: 78,
    seed: 970,
  },
  {
    id: "duskmire-growth",
    theme: "marsh",
    x: 3510,
    y: 2150,
    radiusX: 720,
    radiusY: 520,
    count: 108,
    seed: 1140,
  },
  {
    id: "gate-cliffs",
    theme: "gate",
    x: 4480,
    y: 1320,
    radiusX: 420,
    radiusY: 620,
    count: 54,
    seed: 1320,
  },
] as const;

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

export function roadStrength(
  x: number,
  y: number,
  roads: readonly RoadDefinition[] = ROADS,
): number {
  let strength = 0;
  for (const road of roads) {
    for (let index = 0; index < road.points.length - 1; index++) {
      const start = road.points[index];
      const end = road.points[index + 1];
      if (!start || !end) continue;
      const distance = distanceToSegment({ x, y }, start, end);
      strength = Math.max(strength, 1 - distance / (road.width / 2));
    }
  }
  return strength;
}

export interface AmbientRegion extends Vec2 {
  radiusX: number;
  radiusY: number;
  count: number;
  color: number;
}

export interface ZoneVisualConfig {
  safeZone: Rect | null;
  landmarks: readonly WorldLandmark[];
  roads: readonly RoadDefinition[];
  decorRegions: readonly DecorRegion[];
  pointsOfInterest: readonly PointOfInterest[];
  worldRegions: readonly ZoneDefinition[];
  ambientRegions: readonly AmbientRegion[];
}

const VERDANT_REACH_AMBIENT: readonly AmbientRegion[] = [
  { x: 3000, y: 660, radiusX: 620, radiusY: 450, count: 20, color: 0xc7f3a7 },
  { x: 3710, y: 1910, radiusX: 700, radiusY: 520, count: 28, color: 0xb2e6ac },
  { x: 3100, y: 1770, radiusX: 240, radiusY: 190, count: 10, color: 0xffdf85 },
] as const;

/**
 * One region covering the whole archipelago, at a neutral tint.
 *
 * `terrainTintsAt` bends the land and water away from Tiny Swords' authored palette per biome; a
 * white tint means "exactly as the artist drew it". The isles are new ground with no regional
 * story to tell yet, so they get the pack's own colours rather than an invented mood.
 */
const SUNKEN_ISLES_REGIONS: readonly ZoneDefinition[] = [
  {
    id: "sunken-isles",
    nameKey: "zone.sunken_isles.name",
    biome: "meadow",
    x: 1280,
    y: 960,
    radiusX: 1280,
    radiusY: 960,
    tint: 0xffffff,
  },
] as const;

const SUNKEN_ISLES_DECOR: readonly DecorRegion[] = [
  {
    id: "isles-castle-verge",
    theme: "meadow",
    x: 540,
    y: 620,
    radiusX: 300,
    radiusY: 220,
    count: 14,
    seed: 41,
  },
  {
    id: "isles-village-verge",
    theme: "village",
    x: 1790,
    y: 700,
    radiusX: 420,
    radiusY: 280,
    count: 18,
    seed: 42,
  },
  {
    id: "isles-tower-verge",
    theme: "forest",
    x: 1180,
    y: 1460,
    radiusX: 400,
    radiusY: 180,
    count: 16,
    seed: 43,
  },
] as const;

/** A D1 map has no authored roads, districts or signs — nothing but its own tiles and elements. */
export const EMPTY_ZONE_VISUALS: ZoneVisualConfig = {
  safeZone: null,
  landmarks: [],
  roads: [],
  decorRegions: [],
  pointsOfInterest: [],
  worldRegions: [],
  ambientRegions: [],
};

export const ZONE_VISUALS: Readonly<Record<RuntimeZoneId, ZoneVisualConfig>> = {
  "verdant-reach": {
    safeZone: SAFE_ZONE,
    landmarks: WORLD_LANDMARKS,
    roads: ROADS,
    decorRegions: DECOR_REGIONS,
    pointsOfInterest: POINTS_OF_INTEREST,
    worldRegions: WORLD_ZONES,
    ambientRegions: VERDANT_REACH_AMBIENT,
  },
  "mmo-test-zone": EMPTY_ZONE_VISUALS,
  "sunken-isles": {
    // No guards to protect anything, so no safe zone to draw — the terrain's `safeZone` rect exists
    // only because `TerrainGeometry` demands one.
    safeZone: null,
    landmarks: SUNKEN_ISLES_LANDMARKS,
    roads: [],
    decorRegions: SUNKEN_ISLES_DECOR,
    pointsOfInterest: [],
    worldRegions: SUNKEN_ISLES_REGIONS,
    ambientRegions: [],
  },
};

/**
 * A D1 map has no authored visuals — no landmarks, no roads, no districts. It is terrain and the
 * things standing on it, and that is drawn from the welcome rather than from here.
 *
 * So an id this build has never heard of is the normal case now, not an error: it is a map somebody
 * made. It gets the empty config, and the renderer draws what the server sent.
 */
export function visualConfigFor(zoneId: RuntimeZoneId): ZoneVisualConfig {
  return ZONE_VISUALS[zoneId] ?? EMPTY_ZONE_VISUALS;
}

export function zoneAt(
  x: number,
  y: number,
  zones: readonly ZoneDefinition[] = WORLD_ZONES,
): ZoneDefinition {
  const fallback = zones[0];
  if (!fallback) throw new Error("World layout requires at least one zone");
  let nearest = fallback;
  let nearestScore = Number.POSITIVE_INFINITY;
  for (const zone of zones) {
    const score = Math.hypot((x - zone.x) / zone.radiusX, (y - zone.y) / zone.radiusY);
    if (score >= nearestScore) continue;
    nearest = zone;
    nearestScore = score;
  }
  return nearest;
}
