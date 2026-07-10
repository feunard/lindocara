import { type Rect, SAFE_ZONE, TERRAIN_BLOCKERS } from "../shared/game.js";
import type { Vec2 } from "../shared/simulation.js";

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
  | "sealed-gate";

export type Biome = "village" | "meadow" | "forest" | "farm" | "wetland" | "ruins" | "marsh";

export interface ZoneDefinition extends Vec2 {
  id: ZoneId;
  name: string;
  biome: Biome;
  radiusX: number;
  radiusY: number;
  tint: number;
}

export const WORLD_ZONES: readonly ZoneDefinition[] = [
  {
    id: "heartroot",
    name: "Heartroot Crossing",
    biome: "village",
    x: 920,
    y: 720,
    radiusX: 700,
    radiusY: 520,
    tint: 0xf0edcf,
  },
  {
    id: "old-road",
    name: "The Old Road",
    biome: "meadow",
    x: 1650,
    y: 720,
    radiusX: 520,
    radiusY: 360,
    tint: 0xe8e4bd,
  },
  {
    id: "sunwake",
    name: "Sunwake Clearing",
    biome: "meadow",
    x: 2110,
    y: 560,
    radiusX: 470,
    radiusY: 410,
    tint: 0xf3ebbd,
  },
  {
    id: "gloamwood",
    name: "Gloamwood",
    biome: "forest",
    x: 2180,
    y: 1390,
    radiusX: 620,
    radiusY: 500,
    tint: 0xd4ddb7,
  },
  {
    id: "old-root-farm",
    name: "Old Root Farm",
    biome: "farm",
    x: 1920,
    y: 1980,
    radiusX: 620,
    radiusY: 500,
    tint: 0xe5d6aa,
  },
  {
    id: "moonmere",
    name: "Moonmere Reach",
    biome: "wetland",
    x: 2620,
    y: 1270,
    radiusX: 430,
    radiusY: 930,
    tint: 0xcddbc1,
  },
  {
    id: "wayfarer-camp",
    name: "Wayfarer Camp",
    biome: "meadow",
    x: 2870,
    y: 1810,
    radiusX: 420,
    radiusY: 320,
    tint: 0xded8b4,
  },
  {
    id: "elderfall",
    name: "Elderfall Ruins",
    biome: "ruins",
    x: 3480,
    y: 760,
    radiusX: 650,
    radiusY: 520,
    tint: 0xd6d4b8,
  },
  {
    id: "duskmire",
    name: "Duskmire",
    biome: "marsh",
    x: 3510,
    y: 2150,
    radiusX: 720,
    radiusY: 520,
    tint: 0xbccbb0,
  },
  {
    id: "sealed-gate",
    name: "The Sealed Gate",
    biome: "ruins",
    x: 4470,
    y: 1320,
    radiusX: 420,
    radiusY: 620,
    tint: 0xc7c4ad,
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
  name: string;
  kind: PoiKind;
  revealRadius: number;
}

export const POINTS_OF_INTEREST: readonly PointOfInterest[] = [
  { id: "heartroot-tree", name: "The Heartroot", kind: "tree", x: 550, y: 555, revealRadius: 440 },
  {
    id: "crossing-square",
    name: "Crossing Square",
    kind: "square",
    x: 930,
    y: 790,
    revealRadius: 360,
  },
  {
    id: "old-road-sign",
    name: "Three-Way Stone",
    kind: "sign",
    x: 1530,
    y: 735,
    revealRadius: 310,
  },
  {
    id: "sunwake-ring",
    name: "Sunwake Ring",
    kind: "clearing",
    x: 2100,
    y: 560,
    revealRadius: 420,
  },
  {
    id: "abandoned-farm",
    name: "Old Root Farm",
    kind: "farm",
    x: 1960,
    y: 1910,
    revealRadius: 500,
  },
  { id: "old-bridge", name: "The Old Bridge", kind: "bridge", x: 2610, y: 820, revealRadius: 430 },
  {
    id: "moonmere-lake",
    name: "Moonmere Reach",
    kind: "lake",
    x: 2610,
    y: 1300,
    revealRadius: 560,
  },
  {
    id: "reedwater-ford",
    name: "Reedwater Ford",
    kind: "ford",
    x: 2610,
    y: 1800,
    revealRadius: 380,
  },
  {
    id: "elderfall-court",
    name: "Elderfall Court",
    kind: "ruin",
    x: 3500,
    y: 720,
    revealRadius: 520,
  },
  { id: "wayfarer-fire", name: "Wayfarer Camp", kind: "camp", x: 2880, y: 1810, revealRadius: 390 },
  { id: "mire-heart", name: "Mireheart", kind: "danger", x: 3530, y: 2190, revealRadius: 520 },
  { id: "sealed-gate", name: "The Sealed Gate", kind: "gate", x: 4480, y: 1320, revealRadius: 620 },
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
    count: 54,
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

export type TerrainKind = "grass" | "wet" | "path" | "water" | "sanctuary";
export type GroundPalette = "verdant" | "moss" | "earth" | "stone" | "wet";

export interface TerrainSample {
  kind: TerrainKind;
  palette: GroundPalette;
  tint: number;
  detailChance: number;
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

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

export function roadStrength(x: number, y: number): number {
  let strength = 0;
  for (const road of ROADS) {
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

export function zoneAt(x: number, y: number): ZoneDefinition {
  const fallback = WORLD_ZONES[0];
  if (!fallback) throw new Error("World layout requires at least one zone");
  let nearest = fallback;
  let nearestScore = Number.POSITIVE_INFINITY;
  for (const zone of WORLD_ZONES) {
    const score = Math.hypot((x - zone.x) / zone.radiusX, (y - zone.y) / zone.radiusY);
    if (score >= nearestScore) continue;
    nearest = zone;
    nearestScore = score;
  }
  return nearest;
}

export function terrainAt(x: number, y: number, variation: number): TerrainSample {
  const blocker = TERRAIN_BLOCKERS.find(({ rect }) => contains(rect, x, y));
  if (blocker?.kind === "water") {
    return { kind: "water", palette: "wet", tint: 0xe1ffff, detailChance: 0 };
  }

  const road = roadStrength(x, y);
  if (road > 0) {
    return {
      kind: contains(SAFE_ZONE, x, y) && road < 0.28 ? "sanctuary" : "path",
      palette: "earth",
      tint: road > 0.45 ? 0xf3ddbd : 0xe8d5b7,
      detailChance: 0.04,
    };
  }
  if (contains(SAFE_ZONE, x, y)) {
    return { kind: "sanctuary", palette: "verdant", tint: 0xe5efd0, detailChance: 0.02 };
  }

  const zone = zoneAt(x, y);
  if (zone.biome === "wetland" || zone.biome === "marsh") {
    return {
      kind: variation > 0.36 ? "wet" : "grass",
      palette: "wet",
      tint: zone.tint,
      detailChance: zone.biome === "marsh" ? 0.1 : 0.07,
    };
  }
  return {
    kind: blocker?.kind === "forest" || zone.biome === "forest" ? "grass" : "grass",
    palette:
      blocker?.kind === "forest" || zone.biome === "forest"
        ? "moss"
        : zone.biome === "farm"
          ? "earth"
          : zone.biome === "ruins"
            ? "stone"
            : "verdant",
    tint: blocker?.kind === "forest" ? 0xc4cfaa : zone.tint,
    detailChance: zone.biome === "meadow" ? 0.06 : zone.biome === "forest" ? 0.08 : 0.05,
  };
}
