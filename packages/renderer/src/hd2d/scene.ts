/**
 * The game's HD-2D scene: ground, sea, foam, sky and light, built from the welcome's heightfield.
 *
 * This file is a near-transcription of `apps/lab/src/main.ts`'s composition root (its lines ~127-330
 * and ~481-520), and deliberately so — the lab reproduces a PoC whose ORDER is load-bearing, and
 * rediscovering that order by feel is exactly what `docs/hd2d-rendering.md` exists to spare the next
 * reader. Where the lab's comments still explain WHY, the reasoning is carried across here in
 * English (the lab and `@lindocara/engine/hd2d/` are a deliberately French-speaking zone; this
 * package is not).
 *
 * What is knowingly NOT transcribed, because this task draws bare ground:
 * - the props, NPCs, sheep, the chest, the house and its interior, and the collider index they
 *   populate — the game's own actors are `billboards.ts`, and its scenery is a later S3 piece;
 * - the day/night TOGGLE, the zone machinery, particles, cloud cover, the wind gusts and the whole
 *   audio layer — they are lab content, not the game's;
 * - camera orbit/zoom/shake and the look-ahead that follows a running hero. The camera DOES follow
 *   now (`focusOn`, with the lab's exponential damping), but it neither leads nor shakes, and it is
 *   parked over the map's spawn until something names a point to follow.
 *
 * `@lindocara/hd2d` stays domain-free: it takes numbers. Everything below the "art direction" line
 * — which tileset a material draws with, which URLs the game serves — is the ADAPTER's knowledge and
 * lives here, never in that package.
 */

import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import type { TerrainQuery, TerrainRamp } from "@lindocara/engine/hd2d/terrain-query.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import {
  interiorShellFloorMaterial,
  interiorShellLevels,
} from "@lindocara/engine/interior-shell.js";
import {
  type MapWeather,
  stormFlashIntensity,
  stormStrikeAt,
  weatherRains,
  weatherStorms,
} from "@lindocara/engine/map-weather.js";
import {
  undergroundAccessVisibleDepths,
  undergroundDepthAtElevation,
  undergroundFloorHeight,
  undergroundSurfaceOpenings,
  undergroundStyleMaterial,
  undergroundTransitionAt,
  undergroundVisibleDepthsAtElevation,
} from "@lindocara/engine/underground.js";
import { RIM_LAYER } from "@lindocara/hd2d/billboard.js";
import type { Hd2dContext } from "@lindocara/hd2d/context.js";
import { createHd2dContext } from "@lindocara/hd2d/context.js";
import type { MoodConfig } from "@lindocara/hd2d/mood.js";
import { createMoodBlend } from "@lindocara/hd2d/mood.js";
import { createPipeline } from "@lindocara/hd2d/pipeline.js";
import { createRainfall } from "@lindocara/hd2d/rainfall.js";
import { createSky } from "@lindocara/hd2d/sky.js";
import type { TerrainAtlas } from "@lindocara/hd2d/terrain/atlas.js";
import type { HeightField } from "@lindocara/hd2d/terrain/field.js";
import { createFoam, FOAM_SPREAD } from "@lindocara/hd2d/terrain/foam.js";
import { heightFieldFromGrid } from "@lindocara/hd2d/terrain/height-field-from-grid.js";
import { createLiquidTerrain } from "@lindocara/hd2d/terrain/liquid.js";
import { meshTerrain } from "@lindocara/hd2d/terrain/mesh.js";
import { meshStairs } from "@lindocara/hd2d/terrain/stairs.js";
import type { Water } from "@lindocara/hd2d/terrain/water.js";
import { createWater } from "@lindocara/hd2d/terrain/water.js";
import type { TextureRegistry, TextureSpec } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";

import { type DayCycleOverride, mapDayCycleAt } from "./day-cycle.js";
import { createInteriorShell, INTERIOR_SHELL_TEXTURES } from "./interior-shell.js";
import { createUnderground } from "./underground.js";

// --- art direction ------------------------------------------------------------------------------

const TERRAIN_ROOT = "/assets/lindocara/tiny-swords/terrain";
const HD2D_TERRAIN_ROOT = "/assets/lindocara/hd2d";

/**
 * The textures this scene needs, all of them already served by the game.
 *
 * The lab syncs its own `public/tex/` out of `packages/catalog/assets/` with a shell script; the
 * game does not need to, because `packages/client/public/` already ships the very same Pixel Frog
 * sheets under these names — `Tilemap_color1..5.png` is the Free Pack's 9x6 tileset in its five
 * hues (576x384, the lab's `tileset-lvl*`), `Tilemap_Flat.png` is Update 010's 10x4 sand sheet
 * (640x256, the lab's `tileset-sand`), and `Water.png`/`Foam.png` are byte-identical to the lab's.
 * So there is no new asset pipeline here, and there must not be one.
 *
 * `atlas: true` on every sheet sampled by sub-rectangle is not optional: with mipmaps, the lower
 * levels average neighbouring tiles and the borders bleed. Foam counts as an atlas too — it is a
 * strip of eight 192px frames, and mipmapping averaged the eight frames INTO EACH OTHER, which is
 * one of the pitfalls `docs/hd2d-rendering.md` records as having cost real time once already.
 */
export const HD2D_TEXTURE_URLS: readonly TextureSpec[] = [
  { url: `${TERRAIN_ROOT}/Tilemap_color1.png`, atlas: true },
  { url: `${TERRAIN_ROOT}/Tilemap_color2.png`, atlas: true },
  { url: `${TERRAIN_ROOT}/Tilemap_color3.png`, atlas: true },
  { url: `${TERRAIN_ROOT}/Tilemap_color4.png`, atlas: true },
  { url: `${TERRAIN_ROOT}/Tilemap_color5.png`, atlas: true },
  { url: `${TERRAIN_ROOT}/Tilemap_Flat.png`, atlas: true },
  { url: `${HD2D_TERRAIN_ROOT}/tileset-neige.png`, atlas: true },
  { url: `${HD2D_TERRAIN_ROOT}/tileset-glace.png`, atlas: true },
  { url: `${HD2D_TERRAIN_ROOT}/tileset-grotte.png`, atlas: true },
  { url: `${HD2D_TERRAIN_ROOT}/tileset-montagne.png`, atlas: true },
  { url: `${HD2D_TERRAIN_ROOT}/tileset-volcan.png`, atlas: true },
  { url: `${HD2D_TERRAIN_ROOT}/tileset-lave.png`, atlas: true },
  { url: `${HD2D_TERRAIN_ROOT}/lava-surface.png` },
  { url: `${HD2D_TERRAIN_ROOT}/interior-floor-atlas.png`, atlas: true },
  { url: `${HD2D_TERRAIN_ROOT}/floor-lino-gray-atlas.png`, atlas: true },
  { url: `${HD2D_TERRAIN_ROOT}/floor-lino-yellow-atlas.png`, atlas: true },
  { url: `${HD2D_TERRAIN_ROOT}/floor-beige-tile-atlas.png`, atlas: true },
  { url: `${TERRAIN_ROOT}/Water.png` },
  { url: `${TERRAIN_ROOT}/Foam.png`, atlas: true },
  ...INTERIOR_SHELL_TEXTURES,
];

const HD2D_GROUND_PALETTES = ["color1", "color2", "color3", "color4", "color5"] as const;
let groundPaletteOverride: (typeof HD2D_GROUND_PALETTES)[number] | null = null;

/** Development witness hook. Call before creating a renderer; production keeps altitude palettes. */
export function setHd2dGroundPalette(palette: string): boolean {
  if (!(HD2D_GROUND_PALETTES as readonly string[]).includes(palette)) return false;
  groundPaletteOverride = palette as (typeof HD2D_GROUND_PALETTES)[number];
  return true;
}

/**
 * Material + level -> atlas key. Art direction, which is why `heightFieldFromGrid` takes it as a
 * callback rather than knowing it (see `packages/hd2d/AGENTS.md`).
 *
 * Grass reads its tileset from its ALTITUDE — the pack ships the same sheet in five hues, so a
 * plateau is a different green rather than the same green with a tint slapped over it. Sand, snow
 * and ice read theirs from the material instead; their identity is the material, not the height.
 */
export function terrainAtlasKey(material: string, level: number): string {
  if (
    material === "parquet" ||
    material === "lino-gris" ||
    material === "lino-jaune" ||
    material === "carrelage-beige"
  ) {
    return material;
  }
  if (material === "sable" || material === "neige") return material;
  if (material === "glace") return "glace";
  if (
    material === "grotte" ||
    material === "montagne" ||
    material === "volcan" ||
    material === "lave"
  ) {
    return `${material}-${level === 0 ? "ground" : "raised"}`;
  }
  // A SUNKEN level takes a raised sheet, not level 0's. Level 0's group is the water-edge one
  // because level 0 is what borders the sea, and its white shore line is painted in; a pit floor
  // borders the wall of the pit it sits in on every side, so that line would draw surf around a
  // dry hole. The clamp below would have sent it there, silently, since `max(0, -2)` is 0.
  if (level < 0) return "lvl1";
  return `lvl${Math.min(3, Math.max(0, Math.round(level)))}`;
}

/**
 * One atlas per key `terrainAtlasKey` can return.
 *
 * `block` says which 4x4 group the sheet holds. Level 0 normally borders the WATER directly (a level-0
 * cell never carries a cliff face towards the sea — see `wallDrop`), so it takes the water-edge
 * group, whose white shore line is already painted in. `heightFieldFor` replaces that atlas with
 * volcanic ground on the cardinal rim of lava, which is not a shoreline. Raised levels border a VOID
 * (they dominate a lower neighbour), so they take the bushy cliff-edge group, the one that joins the
 * stone wall on rows 4-5. Sand only ever exists at level 0, but Update 010's flat sheet reuses the
 * SAME column layout as the cliff-edge group for its own sand-against-grass trim.
 *
 * Snow and ice use the byte-identical atlases proven by the lab. Thin ice remains a rule material
 * and deliberately resolves to the same ice atlas.
 */
export function terrainAtlases(textures: TextureRegistry): Record<string, TerrainAtlas> {
  // `wallRowInWater` only for the 9x6 sheets, which are the ones that carry a wall band at all:
  // rows 4 and 5 are the same cliff face footed on land and footed in water, and the mesher picks
  // between them per wall segment. The 10x4 sand sheet has neither, and must not be handed a row 5
  // that does not exist in it — sand never descends (level 0 emits no wall), so an unread but
  // out-of-range row would be a landmine rather than a harmless default.
  const sheet = (name: string, block: TerrainAtlas["block"], cols: number, rows: number) => ({
    texture: textures.get(`${TERRAIN_ROOT}/${name}`),
    cols,
    rows,
    block,
    wallRow: 4,
    ...(rows > 5 ? { wallRowInWater: 5 } : {}),
    tilePx: 64,
  });
  const palette = groundPaletteOverride ? `Tilemap_${groundPaletteOverride}.png` : null;
  const generated = (material: "grotte" | "montagne" | "volcan" | "lave") => ({
    [`${material}-ground`]: {
      ...sheet("Tilemap_color1.png", "water-edge", 9, 6),
      texture: textures.get(`${HD2D_TERRAIN_ROOT}/tileset-${material}.png`),
    },
    [`${material}-raised`]: {
      ...sheet("Tilemap_color1.png", "cliff-edge", 9, 6),
      texture: textures.get(`${HD2D_TERRAIN_ROOT}/tileset-${material}.png`),
    },
  });
  return {
    lvl0: sheet(palette ?? "Tilemap_color1.png", "water-edge", 9, 6),
    lvl1: sheet(palette ?? "Tilemap_color3.png", "cliff-edge", 9, 6),
    lvl2: sheet(palette ?? "Tilemap_color4.png", "cliff-edge", 9, 6),
    lvl3: sheet(palette ?? "Tilemap_color5.png", "cliff-edge", 9, 6),
    // Never a wall for sand (always at level 0): `wallRow` is never read here, kept at 4 out of
    // consistency with the others rather than out of necessity.
    sable: sheet("Tilemap_Flat.png", "cliff-edge", 10, 4),
    neige: {
      ...sheet("Tilemap_color1.png", "water-edge", 9, 6),
      texture: textures.get(`${HD2D_TERRAIN_ROOT}/tileset-neige.png`),
    },
    glace: {
      ...sheet("Tilemap_color1.png", "cliff-edge", 9, 6),
      texture: textures.get(`${HD2D_TERRAIN_ROOT}/tileset-glace.png`),
    },
    ...generated("grotte"),
    ...generated("montagne"),
    ...generated("volcan"),
    ...generated("lave"),
    interior: {
      ...sheet("Tilemap_color1.png", "water-edge", 9, 6),
      texture: textures.get(`${HD2D_TERRAIN_ROOT}/interior-floor-atlas.png`),
    },
    parquet: {
      ...sheet("Tilemap_color1.png", "water-edge", 9, 6),
      texture: textures.get(`${HD2D_TERRAIN_ROOT}/interior-floor-atlas.png`),
    },
    "lino-gris": {
      ...sheet("Tilemap_color1.png", "water-edge", 9, 6),
      texture: textures.get(`${HD2D_TERRAIN_ROOT}/floor-lino-gray-atlas.png`),
    },
    "lino-jaune": {
      ...sheet("Tilemap_color1.png", "water-edge", 9, 6),
      texture: textures.get(`${HD2D_TERRAIN_ROOT}/floor-lino-yellow-atlas.png`),
    },
    "carrelage-beige": {
      ...sheet("Tilemap_color1.png", "water-edge", 9, 6),
      texture: textures.get(`${HD2D_TERRAIN_ROOT}/floor-beige-tile-atlas.png`),
    },
  };
}

// --- the pure half ------------------------------------------------------------------------------

/**
 * The map's ground, meshed. The half of the composition root that needs neither a canvas nor a GL
 * context, which is what makes it testable in jsdom — `three` builds geometry and materials fine
 * without WebGL.
 *
 * Takes the `Hd2dContext` (unlike the plan's two-argument sketch) because `meshTerrain` grafts THIS
 * context's cloud-shadow uniforms onto every terrain material it builds. Creating a throwaway
 * context in here would silently detach the ground from the scene's own uniforms — precisely the
 * module-singleton failure `Hd2dContext` exists to prevent.
 */
export function terrainGroupFor(
  ctx: Hd2dContext,
  map: MapData,
  atlases: Record<string, TerrainAtlas>,
): { group: THREE.Group; dispose(): void } {
  // The ramps go to the MESHER too, not only to `meshStairs`: it is what opens the cliff face at
  // each ramp's mouth, so a slope arrives on the plateau instead of into a drawn wall.
  return meshTerrain(ctx, surfaceCutawayField(map), {
    atlases,
    levelHeight: map.levelHeight,
    ramps: map.ramps ?? [],
  });
}

/** Rendering-only terrain cut. Collision keeps reading the stored field plus ramps/platforms. */
function surfaceCutawayField(map: MapData): HeightField {
  const source = heightFieldFor(map);
  const openings = undergroundSurfaceOpenings(map.underground, map.size);
  if (!openings.some((cell) => cell !== 0)) return source;
  const open = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < source.cols && j < source.rows && openings[j * source.cols + i] !== 0;
  return {
    cols: source.cols,
    rows: source.rows,
    levelAt: (i, j) => (open(i, j) ? null : source.levelAt(i, j)),
    materialAt: (i, j) => (open(i, j) ? null : source.materialAt(i, j)),
    liquidAt: (i, j) => (open(i, j) ? null : (source.liquidAt?.(i, j) ?? null)),
    liquidLevelAt: (i, j) => (open(i, j) ? null : (source.liquidLevelAt?.(i, j) ?? null)),
    waterAt: (i, j) => (open(i, j) ? null : (source.waterAt?.(i, j) ?? null)),
  };
}

/** The serialized grid, read as the field the mesher consumes. `null` levels stay water outdoors:
 *  they are the water plane's business, never a ground quad laid flat at the sea's height. In an
 *  interior only implicit water with no authored tier is architectural void; a painted water tile
 *  has an explicit liquid level (including zero/negative) and remains a visible pool like lava. */
export function heightFieldFor(map: MapData): HeightField {
  const interior = (map.environment ?? "exterior") === "interior";
  const structuralMaterial = map.interiorShell
    ? interiorShellFloorMaterial(map.interiorShell.style)
    : null;
  const interiorMaterialKey = (material: string, level: number): string => {
    // Legacy interiors without an envelope retain their historical wood floor. Once a coating is
    // selected, only its structural-floor marker adopts the coating; every other terrain keeps the
    // material the author painted.
    if (!map.interiorShell) return "interior";
    if (material !== structuralMaterial) return terrainAtlasKey(material, level);
    switch (map.interiorShell?.style) {
      case "castle":
      case "mountain":
        return terrainAtlasKey("montagne", level);
      case "cave":
        return terrainAtlasKey("grotte", level);
      case "volcano":
        return terrainAtlasKey("volcan", level);
      case "ice":
        return terrainAtlasKey("glace", level);
      case "snow":
        return terrainAtlasKey("neige", level);
      case "timber":
      case undefined:
        return "interior";
    }
  };
  const field = heightFieldFromGrid({
    size: map.size,
    levels: map.levels,
    materials: map.materials,
    ...(map.liquids && map.liquidLevels
      ? { liquids: map.liquids, liquidLevels: map.liquidLevels }
      : {}),
    materialKey: interior ? interiorMaterialKey : terrainAtlasKey,
  });
  // Maps saved before explicit level-zero water used the same empty tile for a pool and the
  // architectural void. A shell can recover the distinction without guessing: an empty cell fully
  // enclosed by structural floor belongs to the room, while one reachable from the edge is void.
  const legacyInteriorLevels =
    interior && map.interiorShell
      ? interiorShellLevels(
          map.size,
          map.levels,
          map.materials,
          map.interiorShell.style,
          map.liquidLevels ?? [],
        )
      : null;
  const legacyInteriorWaterLevel = (i: number, j: number): number | null => {
    if (!legacyInteriorLevels || i < 0 || j < 0 || i >= map.size || j >= map.size) return null;
    return legacyInteriorLevels[j * map.size + i] ?? null;
  };
  return {
    ...field,
    liquidAt(i, j) {
      const liquid = field.liquidAt?.(i, j) ?? null;
      if (!interior) return liquid;
      const level = field.liquidLevelAt?.(i, j) ?? null;
      if (liquid !== "water" || level !== null) return liquid;
      return legacyInteriorWaterLevel(i, j) === null ? null : "water";
    },
    liquidLevelAt(i, j) {
      const liquid = field.liquidAt?.(i, j) ?? null;
      const level = field.liquidLevelAt?.(i, j) ?? null;
      return interior && liquid === "water" && level === null
        ? legacyInteriorWaterLevel(i, j)
        : level;
    },
    materialAt(i, j) {
      const material = field.materialAt(i, j);
      const level = field.levelAt(i, j);
      if (material === null || level === null) return material;
      // A lava lake is not a shoreline. Reuse the volcanic ground language for the one-cell rim
      // around it, so the autotile's open edge is cracked rock rather than the level-zero grass
      // sheet's painted white water fringe. Only presentation changes; the stored material and the
      // shared heightfield collision remain untouched.
      for (const [di, dj] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        if (field.liquidAt?.(i + di, j + dj) === "lava") {
          return terrainAtlasKey("volcan", level);
        }
      }
      return material;
    },
  };
}

/** Atlas key of the bank a stair flight is attached to, including an interior coating override. */
export function stairMaterialKeyFor(
  map: MapData,
  ramp: TerrainRamp,
  field: HeightField = heightFieldFor(map),
): string {
  if (ramp.lowHeight !== undefined && map.underground) {
    const upperDepth =
      ramp.highHeight === undefined ? null : undergroundDepthAtElevation(ramp.highHeight);
    const lowerDepth = undergroundDepthAtElevation(ramp.lowHeight);
    const attachedLevel =
      (upperDepth === null
        ? null
        : map.underground.levels.find((level) => level.depth === upperDepth)) ??
      (lowerDepth === null
        ? null
        : map.underground.levels.find((level) => level.depth === lowerDepth));
    if (attachedLevel) return terrainAtlasKey(undergroundStyleMaterial(attachedLevel.style), 0);
  }
  const half = map.size / 2;
  const middleX = ramp.x + ramp.width / 2;
  const middleZ = ramp.z + ramp.depth / 2;
  const landingX =
    ramp.direction === "east"
      ? ramp.x + ramp.width + 1e-4
      : ramp.direction === "west"
        ? ramp.x - 1e-4
        : middleX;
  const landingZ =
    ramp.direction === "south"
      ? ramp.z + ramp.depth + 1e-4
      : ramp.direction === "north"
        ? ramp.z - 1e-4
        : middleZ;
  const landingCol = Math.floor(landingX + half);
  const landingRow = Math.floor(landingZ + half);
  const attached = field.materialAt(landingCol, landingRow);
  if (attached) return attached;

  // A malformed or edge-clipped ramp can have no high landing cell. Keep it legible with the
  // supporting low cell before falling back to grass, rather than throwing during scene creation.
  const supportCol = Math.floor(middleX + half);
  const supportRow = Math.floor(middleZ + half);
  return field.materialAt(supportCol, supportRow) ?? terrainAtlasKey("herbe", ramp.lowLevel + 1);
}

/** A multi-storey flight belongs to every view it physically crosses, including its surface mouth. */
export function undergroundStairVisible(
  lowDepth: number | null,
  upperDepth: number | null,
  visibleDepths: readonly (number | null)[],
): boolean {
  if (lowDepth === null && upperDepth === null) return visibleDepths.includes(null);
  const lower = lowDepth ?? 0;
  const upper = upperDepth ?? lower - 1;
  const minimum = Math.min(lower, upper);
  const maximum = Math.max(lower, upper);
  return visibleDepths.some((visibleDepth) => {
    const numeric = visibleDepth ?? 0;
    return numeric >= minimum && numeric <= maximum;
  });
}

/** Transparent surface liquids are scenery, never a window onto connected underground geometry. */
export function surfaceAccessPreviewAt(map: MapData, x: number, z: number): boolean {
  const col = Math.floor(x + map.size / 2);
  const row = Math.floor(z + map.size / 2);
  if (col < 0 || row < 0 || col >= map.size || row >= map.size) return false;
  const index = row * map.size + col;
  return (map.liquids?.[index] ?? null) === null && map.levels[index] !== null;
}

// --- settings -----------------------------------------------------------------------------------
// Transcribed from `apps/lab/src/settings.ts`. Copied rather than imported: `apps/lab` sits outside
// the package dependency graph on purpose (root `AGENTS.md`), and no package source may reach into
// it. `levelHeight` and `waterLevel` are NOT copied — they travel with the map, which is the whole
// point of the heightfield.

/** Exported because a billboard's vertical stretch is computed FROM the pitch (`billboardHeight`):
 *  `billboards.ts` must read the very angle this camera uses, or every sprite is compensated for a
 *  plunge the scene does not have. */
export const HD2D_CAMERA = {
  /** A short FOV is what makes the near-orthographic, diorama look. */
  fov: 22,
  distance: 40,
  /** Degrees above the horizon. */
  pitch: 38 * (Math.PI / 180),
  /** How far above the ground the camera aims. */
  height: 1.2,
  /** 1 = fog neutral under zoom, 0 = fog frozen in absolute terms. Unused while the camera cannot
   *  zoom, but `frameCamera` still applies the coupling so the day zoom lands it is already right. */
  fogFar: 0.38,
  /** How fast the camera catches up with what it follows, as an exponential rate (see `render`). */
  follow: 6,
} as const;

const CAMERA = HD2D_CAMERA;

const CAMERA_SURFACE_CEILING_EPSILON = 0.02;

/**
 * The standable surface the camera should follow. `heightAt` intentionally excludes collider tops,
 * so using it alone makes the camera sink to the low terrain beneath bridges and roofs. A tracked
 * body supplies the ceiling that selects the platform it is actually on while rejecting overhead
 * platforms. While airborne, its reported elevation is the reference so terrain far below cannot
 * pull the camera down; editor/manual focus retains terrain-only focus.
 */
export function cameraFocusSurface(
  query: TerrainQuery,
  waterLevel: number,
  x: number,
  z: number,
  elevation?: number,
  airborne = false,
): number {
  if (elevation !== undefined && Number.isFinite(elevation)) {
    // While jumping, the body is its own camera reference. Looking up the surface below here made
    // the camera plunge into every crevasse even though the hero remained high above it.
    if (airborne) return elevation;
    return (
      query.surfaceAt?.(x, z, elevation + CAMERA_SURFACE_CEILING_EPSILON) ??
      query.heightAt(x, z) ??
      waterLevel
    );
  }
  return query.heightAt(x, z) ?? waterLevel;
}

const WATER = { roughness: 0.46, segment: 2, depthRange: 7 } as const;
/**
 * The rain curtain's reach, in world units.
 *
 * A radius wide enough to fill the frame at the game's zoom and no wider: the drops travel with
 * the camera, so what is off screen is waste, and 14 units of height is the top of the frame at
 * the shipped pitch. Both are presentation, unlike everything the map declares.
 */
const RAIN = { radius: 26, height: 14 } as const;
/**
 * What one lightning strike adds to the scene's lights at full brightness.
 *
 * Added to the mood rather than replacing it, so a strike at noon is a glare and the same strike at
 * midnight is the whole sky: the flash is a light, and a light is worth more where there was less.
 */
const FLASH = { sun: 2.6, hemi: 1.9, tint: new THREE.Color("#dceaff") } as const;

/**
 * Daylight, and only daylight. The lab crossfades a second `night` mood on a key press; the game
 * has no such control, so shipping the catalogue's other half would be dead weight. The mixer is
 * still used for the one mood because it is what turns `#rrggbb` strings into blendable
 * `THREE.Color`s, and hand-rolling that conversion here would be a second, divergent copy.
 */
const DAY: MoodConfig = {
  exposure: 1.0,
  sky: { top: "#3d8fd0", horizon: "#a8dced", glow: "#fff4d2", glowStrength: 0.5, stars: 0 },
  // No colour of its own: the fog takes the sky's horizon hue. Two neighbouring-but-distinct tints
  // drew a hard line exactly where the far sea meets the dome.
  fog: { near: 34, far: 86 },
  sun: { color: "#fff2d0", intensity: 2.6, position: [-18, 22, 12] },
  // Rim light, taken from the side OPPOSITE the sun. Sprite normals are bowed left and right, so a
  // grazing side light catches exactly one of their two edges — that is the outline.
  rim: { color: "#cfe6ff", intensity: 0.85, position: [17, 12, -8] },
  hemi: { sky: "#bfe6ff", ground: "#6b7a4a", intensity: 1.15 },
  fire: 1.1,
  clouds: 0.34,
  // Deliberately DARK and saturated. A pale sea goes white: it is a horizontal plane taking the sun
  // head-on, and ACES desaturates everything climbing towards the highlights.
  water: { shallow: "#1eab99", deep: "#08365c", sparkle: 1.0 },
  motes: 0.5,
  fireflies: 0,
  bloom: { strength: 0.38, threshold: 0.78 },
  grade: { saturation: 1.14, lift: 0.0 },
  aurora: 0,
  fogPulse: 0,
};

/** Exact full-night mood from the lab. `dayCycleAt` supplies its continuous blend weight. */
const NIGHT: MoodConfig = {
  exposure: 0.72,
  sky: {
    top: "#02040c",
    horizon: "#080e1e",
    glow: "#8ea6ff",
    glowStrength: 0.22,
    stars: 1,
  },
  fog: { near: 24, far: 62 },
  sun: { color: "#8aa6f5", intensity: 0.62, position: [-15, 21, 10] },
  rim: { color: "#6c88ee", intensity: 0.12, position: [16, 11, -9] },
  hemi: { sky: "#0e1730", ground: "#04060d", intensity: 0.55 },
  fire: 13,
  clouds: 0.1,
  water: { shallow: "#062430", deep: "#01060f", sparkle: 0.5 },
  motes: 0,
  fireflies: 1,
  bloom: { strength: 0.78, threshold: 0.38 },
  grade: { saturation: 1, lift: 0 },
  aurora: 0,
  fogPulse: 0,
};

/** A frame longer than this is clamped: a backgrounded tab returns with a multi-second delta, and
 *  handing that to the water/foam/sky integrators makes them jump. */
const MAX_FRAME_SECONDS = 0.05;

/** Marks native authored architecture that should stop the editor's pointer ray. */
export const AUTHORED_PICK_SURFACE = "authoredPickSurface";

/**
 * Convert the visible face hit by the editor pointer into the ground coordinate the author meant.
 *
 * A horizontal surface is its own answer. A building wall leads INWARD, because its roof and
 * footprint are valid authored destinations rather than empty ground behind the mesh, and that
 * stays true whatever height it was clicked at: "select the architecture you pointed at" is a
 * different question from "which ground did you mean".
 *
 * A terrain cliff belongs to the plateau cell that emitted it, over its whole visible height.
 *
 * The face is one vertical quad on a cell boundary, so it borders exactly two grounds: the low cell
 * it drops into, and the plateau it holds up. Answering with the foot every time is correct in map
 * coordinates and wrong on screen, because the answer is DRAWN at the bottom of the wall: on a
 * ten-level cliff, pointing anywhere on the visible wall must keep the same selected terrain. If
 * the lower neighbour won near the foot, a one-pixel pointer movement changed both the selected
 * cell and the asset under the cursor even though the pointer never left the wall.
 *
 * `groundAt` only proves that the inward side is real terrain. A caller with no heightfield, or a
 * face whose inward side is void, keeps the conservative historical foot.
 */
export function editorGroundPickPoint(
  point: Pick<THREE.Vector3, "x" | "y" | "z">,
  normal: Pick<THREE.Vector3, "x" | "y" | "z">,
  onBuilding: boolean,
  groundAt?: (x: number, z: number) => number | null,
): { x: number; z: number } {
  if (normal.y >= 0.5) return { x: point.x, z: point.z };
  const step = (direction: number): { x: number; z: number } => ({
    x: point.x + normal.x * 0.5 * direction,
    z: point.z + normal.z * 0.5 * direction,
  });
  const foot = step(1);
  if (onBuilding) return step(-1);
  if (!groundAt) return foot;
  const plateau = step(-1);
  const plateauGround = groundAt(plateau.x, plateau.z);
  return plateauGround === null ? foot : plateau;
}

// --- the scene ----------------------------------------------------------------------------------

export interface Hd2dScene {
  render(now: number): void;
  gameHour(): number;
  fireIntensity(): number;
  /** Test-only fixed lighting; null restores this map's independent 24-minute clock. */
  setDayCycleOverride(override: DayCycleOverride): void;
  /** The map's authored weather, pushed live so the editor shows what it just authored without
   *  rebuilding the scene. Presentation only: nothing downstream of this reaches collision. */
  setWeather(weather: MapWeather): void;
  /**
   * Ask the camera to follow a point — the local player, in practice. `x`/`z` are the two GROUND
   * axes in tile units. The optional third argument is the followed body's ELEVATION; it bounds the
   * collision-surface lookup so a bridge or roof under that body drives camera height without a
   * higher platform above it stealing focus. The fourth argument makes an airborne body's own
   * elevation the reference. Recorded here and consumed by the next `render`, which is the only
   * place that knows the frame's `dt` and can therefore damp towards it.
   */
  focusOn(x: number, z: number, elevation?: number, airborne?: boolean): void;
  /** Sets the diorama zoom as a percentage. 100 is the gameplay camera. */
  setZoom(percent: number): void;
  /** Sets the horizontal orbit while keeping the same target, pitch and distance. */
  setYaw(radians: number): void;
  /** Sets the vertical viewing angle while keeping the same target, yaw and distance. */
  setPitch(radians: number): void;
  /** Surface (`null`) or one authored underground storey. */
  setUndergroundDepth(depth: number | null, authoringView?: boolean): void;
  /** Presentation-only screen-space camera impulse. It never changes the followed world point. */
  setCameraShake(xPixels: number, yPixels: number): void;
  /** Enables the gameplay diorama blur. Editor authoring disables it for precise cell work. */
  setTiltShiftEnabled(enabled: boolean): void;
  /** Enables distance fog. Editor authoring disables it so pulling back reveals the whole map
   *  instead of dissolving its edges — see the zoom coupling in the per-frame update. */
  setFogEnabled(enabled: boolean): void;
  /** First visible horizontal terrain/stair/water surface under an editor pointer ray. */
  pickGround(raycaster: THREE.Raycaster): { x: number; z: number } | null;
  resize(): void;
  dispose(): void;
  ctx: Hd2dContext;
  scene: THREE.Scene;
  /** Surface-authored scenery, hidden as one unit while the player is below ground. */
  surfaceRoot: THREE.Group;
  camera: THREE.PerspectiveCamera;
  /** Answers for the terrain currently drawn — it is replaced by `updateTerrain`, so read it off
   *  the scene at the moment you need it rather than capturing it. */
  readonly query: TerrainQuery;
  /** The sea this scene drew with — the one built for it, or the one it was handed. It belongs to
   *  the CALLER either way (see `createHd2dScene`), which is why it is exposed rather than kept
   *  private like the terrain and the sky. */
  water: Water;
  /**
   * Swaps the ground for another heightfield, keeping everything that is not the ground.
   *
   * The scene, the camera and where it is pointed, the lights, the sky, the sea, the post-fx
   * pipeline and the `Hd2dContext` all survive — none of them describes terrain, and rebuilding
   * them was most of what a map edit cost. Only the terrain mesh, the stairs, the foam, the
   * `TerrainQuery` and the sea's shallow gradient actually follow the edit.
   *
   * For an EDIT of the map being drawn. A different map wants a new scene: the day-cycle seed is
   * fixed per scene (`cycleKey`), and a transition should reset the camera rather than inherit the
   * previous map's framing.
   *
   * The caller still owns everything parented into this scene from outside — billboards, scenery,
   * the visual layer. Those are placed against the OLD terrain and must be rebuilt after this call.
   */
  updateTerrain(map: MapData): void;
  /** Refresh gameplay/editor collision against unchanged terrain geometry. */
  updateCollisionMap(map: MapData): void;
}

/**
 * What a sea plane is made of: its extent and its level, and nothing else.
 *
 * Two maps agreeing on this can share one `Water` across a scene rebuild — the plane's 148k
 * vertices are identical, and only `aShallow` has to follow the new coastline. It lives here, one
 * screen from the `createWater` call it mirrors, so that changing the plane's extent (`map.size * 3`)
 * without changing this key is a diff a reader can see rather than a stale cache nobody suspects.
 */
export function waterPlaneKey(map: MapData): string {
  return `${map.environment ?? "exterior"}:${map.size * 3}:${map.waterLevel}`;
}

export function cameraOrbitOffset(
  yaw: number,
  distance: number,
  pitch: number,
): { x: number; y: number; z: number } {
  const horizontal = Math.cos(pitch) * distance;
  return {
    x: Math.sin(yaw) * horizontal,
    y: Math.sin(pitch) * distance,
    z: Math.cos(yaw) * horizontal,
  };
}

const CAMERA_TERRAIN_PROBE_STEP = 0.5;
const CAMERA_TERRAIN_NEAR = 1.25;
const CAMERA_TERRAIN_MARGIN = 0.35;

/**
 * Pulls a followed camera in front of raised terrain lying between it and its target. Sampling the
 * authoritative terrain query keeps this independent from mesh/atlas batching and preserves the
 * requested yaw and pitch: only the distance changes.
 */
export function cameraDistanceBeforeTerrain(
  query: TerrainQuery,
  target: { x: number; y: number; z: number },
  offset: { x: number; y: number; z: number },
  requestedDistance: number,
): number {
  if (!Number.isFinite(requestedDistance) || requestedDistance <= CAMERA_TERRAIN_NEAR) {
    return Math.max(0, requestedDistance);
  }
  for (
    let travelled = CAMERA_TERRAIN_NEAR;
    travelled <= requestedDistance;
    travelled += CAMERA_TERRAIN_PROBE_STEP
  ) {
    const progress = travelled / requestedDistance;
    const x = target.x + offset.x * progress;
    const y = target.y + offset.y * progress;
    const z = target.z + offset.z * progress;
    const terrainY = query.maxHeightAround(x, z, 0.18);
    if (terrainY + CAMERA_TERRAIN_MARGIN >= y) {
      return Math.max(0.75, travelled - CAMERA_TERRAIN_MARGIN);
    }
  }
  return requestedDistance;
}

/**
 * Builds the scene.
 *
 * **The sea outlives it.** `reuse.water` lets a caller hand back the `Water` a previous scene drew
 * with, and this scene will then only refresh its shallow gradient instead of building a new plane.
 * That is not a micro-optimisation: the plane is 385x385 vertices and costs 17-23 ms to allocate,
 * it depends on nothing but `size` and `waterLevel`, and the editor calls this function on every
 * painted cell — so the sea was being rebuilt, in full, for edits that never moved a single one of
 * its vertices. `aShallow`, the only part the terrain drives, is ~1 ms.
 *
 * The consequence for ownership, and it is deliberate: **`dispose()` never disposes the water**,
 * whether this scene built it or was handed it. The caller reads it back from `Hd2dScene.water`
 * and frees it when its `size`/`waterLevel` stop matching, or when the caller itself dies.
 */
export function createHd2dScene(
  canvas: HTMLCanvasElement,
  map: MapData,
  textures: TextureRegistry,
  cycleKey = "map",
  reuse: { water?: Water } = {},
): Hd2dScene {
  const scene = new THREE.Scene();
  const surfaceRoot = new THREE.Group();
  surfaceRoot.name = "surface-content";
  scene.add(surfaceRoot);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.5, 5000);

  const ctx = createHd2dContext({ pitch: CAMERA.pitch });

  // --- world ------------------------------------------------------------------------------------
  // `heightFieldFor` is a stateless adapter over the map's own arrays, so the one `terrainGroupFor`
  // builds for itself and this one are interchangeable — this exists because the sea and the foam
  // need a field too, not because the ground's differs from theirs.
  // Everything the ground is made of is `let`, not `const`: `updateTerrain` replaces the lot in
  // place when only the terrain changed, which is what keeps an editor edit from costing a whole
  // scene. Read them through the closure, never capture them in one.
  let currentMap = map;
  let field = heightFieldFor(map);
  let query = createTerrainQuery(mapToQuerySource(map));

  const atlases = terrainAtlases(textures);
  const fallbackAtlas = atlases.lvl0;
  if (!fallbackAtlas) throw new Error("The level-0 terrain atlas is required for authored stairs");
  // A ramp draws in the hue of the bank it climbs to, the same way `terrainAtlasKey` gives each
  // altitude its own sheet. Handing every ramp the level-0 atlas — as this did — painted a ramp
  // climbing 1 to 2 in level 0's green.
  const stairsFor = (source: MapData): ReturnType<typeof meshStairs> => {
    const sourceField = heightFieldFor(source);
    const ramps = source.ramps ?? [];
    const built = meshStairs(ramps, {
      levelHeight: source.levelHeight,
      atlasFor: (level, ramp) =>
        atlases[stairMaterialKeyFor(source, ramp, sourceField)] ??
        atlases[terrainAtlasKey("herbe", level)] ??
        fallbackAtlas,
    });
    built.group.children.forEach((child, index) => {
      const ramp = ramps[index];
      const lowDepth =
        ramp?.lowHeight === undefined ? null : (undergroundDepthAtElevation(ramp.lowHeight) ?? 0);
      const highDepth =
        ramp?.highHeight === undefined ? null : (undergroundDepthAtElevation(ramp.highHeight) ?? 0);
      child.userData.undergroundDepth = lowDepth;
      child.userData.undergroundUpperDepth = highDepth;
    });
    return built;
  };
  let terrain = terrainGroupFor(ctx, map, atlases);
  scene.add(terrain.group);
  let stairs = stairsFor(map);
  scene.add(stairs.group);
  let interiorShell = createInteriorShell(map, textures);
  scene.add(interiorShell.group);
  let underground = createUnderground(map, textures);
  scene.add(underground.group);

  const liquidsFor = (source: MapData, sourceField: HeightField) =>
    createLiquidTerrain(ctx, sourceField, {
      levelHeight: source.levelHeight,
      waterLevel: source.waterLevel,
      waterTexture: textures.get(`${TERRAIN_ROOT}/Water.png`),
      lavaTexture: textures.get(`${HD2D_TERRAIN_ROOT}/lava-surface.png`),
    });
  let liquids = liquidsFor(map, field);
  scene.add(liquids.group);

  // A plane three times wider than the grid: enough that the sea loses itself in the fog before its
  // own edge does, at every zoom.
  const water =
    reuse.water ??
    createWater(ctx, field, {
      texture: textures.get(`${TERRAIN_ROOT}/Water.png`),
      level: map.waterLevel,
      size: map.size * 3,
      segment: WATER.segment,
      depthRange: WATER.depthRange,
      roughness: WATER.roughness,
    });
  // A reused sea keeps its plane and its material — only the coastline it shades has moved. `add`
  // re-parents it out of the scene it came from, which no longer exists by the time we get here.
  if (reuse.water) reuse.water.setField(field);
  water.mesh.visible = (map.environment ?? "exterior") === "exterior";
  scene.add(water.mesh);

  const foamFor = (source: MapData, sourceField: HeightField): ReturnType<typeof createFoam> =>
    createFoam(ctx, sourceField, {
      texture: textures.get(`${TERRAIN_ROOT}/Foam.png`),
      frames: 8,
      fps: 7,
      spread: FOAM_SPREAD,
      waterLevel: source.waterLevel,
      // Each strip reads its liquid cell's tier. Sea foam keeps `waterLevel`; foam around an
      // elevated pool stays on the authored surface instead of being buried at sea level.
      levelHeight: source.levelHeight,
    });
  let foam = foamFor(map, field);
  foam.group.visible = (map.environment ?? "exterior") === "exterior";
  scene.add(foam.group);
  let viewedUndergroundDepth: number | null = null;
  let undergroundElevation: number | null = null;
  let authoringUndergroundView = false;
  let surfaceAccessPreview = true;
  let terrainOpacity = 1;
  const setTerrainOpacity = (opacity: number): void => {
    if (Math.abs(opacity - terrainOpacity) < 0.005) return;
    terrainOpacity = opacity;
    terrain.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const source = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of source) {
        if (material.userData.surfaceReferenceAlphaTest === undefined) {
          material.userData.surfaceReferenceAlphaTest = material.alphaTest;
        }
        const transparent = opacity < 0.995;
        if (material.transparent !== transparent || material.depthWrite === transparent) {
          material.transparent = transparent;
          material.depthWrite = !transparent;
          material.alphaTest = transparent
            ? 0
            : (material.userData.surfaceReferenceAlphaTest as number);
          material.needsUpdate = true;
        }
        material.opacity = opacity;
      }
      object.castShadow = opacity >= 0.995;
    });
  };
  const applyUndergroundVisibility = (): void => {
    const visibleDepths = [
      ...(undergroundElevation === null
        ? [viewedUndergroundDepth]
        : undergroundVisibleDepthsAtElevation(undergroundElevation)),
    ];
    const seesSurface = visibleDepths.includes(null);
    if ((seesSurface && surfaceAccessPreview) || authoringUndergroundView) {
      for (const depth of undergroundAccessVisibleDepths(
        currentMap.underground,
        viewedUndergroundDepth,
      )) {
        if (!visibleDepths.includes(depth)) visibleDepths.push(depth);
      }
    }
    const surfaceBlend = authoringUndergroundView
      ? viewedUndergroundDepth === null
        ? 1
        : 0
      : undergroundElevation !== null && undergroundElevation < 0
        ? Math.max(
            0,
            Math.min(
              1,
              (undergroundElevation - undergroundFloorHeight(1)) / -undergroundFloorHeight(1),
            ),
          )
        : seesSurface
          ? 1
          : 0;
    terrain.group.visible = surfaceBlend > 0.005;
    setTerrainOpacity(surfaceBlend);
    liquids.group.visible = seesSurface;
    foam.group.visible = seesSurface && (currentMap.environment ?? "exterior") === "exterior";
    water.mesh.visible = seesSurface && (currentMap.environment ?? "exterior") === "exterior";
    interiorShell.group.visible = seesSurface;
    surfaceRoot.visible = true;
    for (const content of surfaceRoot.children) {
      const depth = content.userData.undergroundDepth;
      content.visible =
        depth === undefined || depth === null ? surfaceBlend > 0.04 : visibleDepths.includes(depth);
    }
    rain.group.visible = seesSurface;
    sky.mesh.visible = seesSurface && (currentMap.environment ?? "exterior") === "exterior";
    const undergroundBackground = new THREE.Color(0x020307);
    scene.background =
      (currentMap.environment ?? "exterior") === "exterior"
        ? undergroundBackground.lerp(new THREE.Color(0x7ca5a0), surfaceBlend)
        : undergroundBackground;
    for (const stair of stairs.group.children) {
      const depth = stair.userData.undergroundDepth;
      const upperDepth = stair.userData.undergroundUpperDepth;
      stair.visible = undergroundStairVisible(depth, upperDepth, visibleDepths);
    }
    underground.setSurfaceAccessPreview(surfaceAccessPreview);
    if (authoringUndergroundView) underground.setDepth(viewedUndergroundDepth);
    else underground.setElevation(undergroundElevation);
  };

  // Weather. The curtain exists whatever the map declares and is simply silent under a clear sky:
  // building it lazily would mean building it mid-frame the first time an author flips the control
  // in the editor, which is exactly when a hitch is most visible.
  const rain = createRainfall(ctx, { radius: RAIN.radius, height: RAIN.height });
  let weather: MapWeather = map.weather ?? "none";
  rain.setIntensity(weatherRains(weather) ? 1 : 0);
  scene.add(rain.group);

  const sky = createSky(ctx);
  sky.mesh.visible = (map.environment ?? "exterior") === "exterior";
  scene.add(sky.mesh);
  scene.background = new THREE.Color(
    (map.environment ?? "exterior") === "interior" ? 0x020307 : 0x7ca5a0,
  );
  applyUndergroundVisibility();

  // --- lights -----------------------------------------------------------------------------------
  // Before the pipeline, as in the lab: `createPipeline` compiles the scene's materials, and a
  // material compiled without its lights is a material recompiled on the first frame.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // A fixed extent, not one proportional to the map: the shadow map follows the camera target, and
  // spreading it over the whole island would only waste its resolution.
  const SHADOW_EXTENT = 26;
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  // Sprites receive shadows and their own quad is written into the shadow map (`shadowSide:
  // DoubleSide`, without which they would cast none): with no bias along the normal each one
  // self-shadows. Set here, before any sprite exists, because it is a property of the LIGHT and
  // Task 7 must find the light already correct rather than have to rediscover this.
  sun.shadow.normalBias = 0.09;
  scene.add(sun);
  scene.add(sun.target);

  // Rim light, taken from the side OPPOSITE the sun.
  const rim = new THREE.DirectionalLight(0xffffff, 0);
  // Confined to the sprite layer. Applied to the ground and the cliffs, this shadowless light stops
  // being an outline and becomes a veil that washes the scenery out — in three, a light only lights
  // an object whose layers it shares. Nothing is registered on `RIM_LAYER` until Task 7 draws the
  // first billboard, which is exactly why the confinement must already be here: a rim light that
  // "works" today because it has nothing to light would light EVERYTHING the moment it is moved.
  rim.layers.set(RIM_LAYER);
  scene.add(rim);
  scene.add(rim.target);

  // --- render -----------------------------------------------------------------------------------
  const pipeline = createPipeline(canvas, scene, camera, ctx);

  // --- mood -------------------------------------------------------------------------------------
  const mood = createMoodBlend(DAY, NIGHT);
  let cycleOverride: DayCycleOverride = null;
  let cycle = mapDayCycleAt(Date.now(), cycleKey, cycleOverride);
  mood.set(cycle.nightWeight);
  const fog = new THREE.Fog(0x000000, 1, 100);
  scene.fog = fog;
  // Authoring turns this off (`setFogEnabled`). Detaching `scene.fog` is the whole switch, and the
  // per-frame update below keeps this object's near/far current either way — so re-enabling
  // restores the right band on the next frame rather than showing one stale one.

  const sunOffset = new THREE.Vector3();

  /** Where the camera looks. The map's spawn until `focusOn` names the local player — the one point
   *  on the map the server itself considers the way in, and the honest answer for the frames before
   *  the first snapshot has landed. */
  const target = ((): THREE.Vector3 => {
    const spawn = map.spawns.find((s) => s.name === "default") ?? map.spawns[0];
    const x = spawn?.x ?? 0;
    const z = spawn?.z ?? 0;
    return new THREE.Vector3(x, cameraFocusSurface(query, map.waterLevel, x, z) + CAMERA.height, z);
  })();

  /** The point `focusOn` last named, and whether the camera has already been placed over it once.
   *  Reused every frame rather than reallocated: `render` runs 60 times a second. */
  let focus: { x: number; z: number; elevation?: number; airborne?: boolean } | null = null;
  let focusReached = false;
  let cameraDistance = CAMERA.distance;
  let framedCameraDistance: number = cameraDistance;
  let cameraYaw = 0;
  let cameraPitch = CAMERA.pitch;
  const wantedTarget = new THREE.Vector3();
  let cameraMin = 0;
  let cameraMax = 0;
  const clampCameraTo = (size: number): void => {
    const inset = Math.min(4, Math.max(0, size / 2 - 0.5));
    cameraMin = -size / 2 + inset;
    cameraMax = size / 2 - inset;
  };
  clampCameraTo(map.size);

  function frameCamera(recoveryDt = 0): void {
    // How far back the camera sits. Zoom updates this value while preserving the camera pitch and
    // day a wheel is wired is what makes the two zoom couplings below mean anything.
    const requestedOffset = cameraOrbitOffset(cameraYaw, cameraDistance, cameraPitch);
    const clearDistance =
      viewedUndergroundDepth === null && (currentMap.environment ?? "exterior") === "exterior"
        ? cameraDistanceBeforeTerrain(query, target, requestedOffset, cameraDistance)
        : cameraDistance;
    if (clearDistance < framedCameraDistance) framedCameraDistance = clearDistance;
    else {
      const safeDt = THREE.MathUtils.clamp(recoveryDt, 0, 0.1);
      framedCameraDistance = THREE.MathUtils.lerp(
        framedCameraDistance,
        clearDistance,
        1 - Math.exp(-5 * safeDt),
      );
    }
    framedCameraDistance = Math.min(framedCameraDistance, cameraDistance);
    const distance = framedCameraDistance;
    const offset = cameraOrbitOffset(cameraYaw, distance, cameraPitch);
    camera.position.set(target.x + offset.x, target.y + offset.y, target.z + offset.z);
    camera.lookAt(target);

    // The lights travel with the target rather than sitting at fixed world points: the shadow map's
    // 26-unit box has to stay centred on what is on screen.
    sunOffset.set(...mood.value.sun.position);
    sun.target.position.copy(target);
    sun.position.copy(target).add(sunOffset);
    sunOffset.set(...mood.value.rim.position);
    rim.target.position.copy(target);
    rim.position.copy(target).add(sunOffset);

    // Fog and the tilt-shift radius BOTH follow the camera's zoom, and neither of them the same way
    // (`CAMERA.fogFar`): pulling back must tighten the band so the map dissolves at its edges,
    // rather than showing the same picture smaller. Zoom changes the visible radius, so the factor is
    // exactly 1 and both are neutral — written out rather than folded away because a fog tuned in
    // absolutes drowns the whole map the day the camera does pull back, and this is where the day's
    // reader will look.
    const zoom = distance / CAMERA.distance;
    fog.near = mood.value.fog.near * zoom;
    fog.far = mood.value.fog.far * zoom ** CAMERA.fogFar;
    pipeline.setTiltShiftZoom(zoom);
  }

  function applyCameraShake(xPixels: number, yPixels: number): void {
    if (!Number.isFinite(xPixels) || !Number.isFinite(yPixels)) return;
    if (Math.abs(xPixels) < 0.001 && Math.abs(yPixels) < 0.001) {
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      return;
    }
    const width = Math.max(1, canvas.clientWidth || canvas.width);
    const height = Math.max(1, canvas.clientHeight || canvas.height);
    camera.setViewOffset(width, height, -xPixels, -yPixels, width, height);
    camera.updateProjectionMatrix();
  }

  /** Reused every frame by `updateFocus`: projecting into a fresh vector 60 times a second is an
   *  allocation for nothing. */
  const projected = new THREE.Vector3();

  /**
   * The sharp band tracks what the camera is aimed at, so what matters stays crisp wherever it goes.
   *
   * Called EVERY frame rather than once beside the framing: `setFocusY` damps towards its argument
   * by 8% a call, so a single call barely moves the band off the pipeline's configured default. A
   * camera that never moves converges within a second either way — but the day the camera follows a
   * hero (Task 7), a once-only call would silently be a band that never follows anything.
   */
  function updateFocus(): void {
    projected.copy(target).project(camera);
    pipeline.setFocusY(THREE.MathUtils.clamp(1 - (projected.y * 0.5 + 0.5), 0.25, 0.8));
  }

  /**
   * The current strike's brightness, or 0 under any weather but a storm.
   *
   * Read from the WALL CLOCK and the map's key rather than from a message or a local timer, so
   * every client in this map flashes on the same strike: see `stormStrikeAt` for why a decoration
   * is derived rather than broadcast.
   */
  function flashIntensity(): number {
    if (!weatherStorms(weather)) return 0;
    return stormFlashIntensity(stormStrikeAt(Date.now(), cycleKey).sinceMs);
  }

  function pushMood(): void {
    const m = mood.value;
    // The lightning flash is applied HERE, on top of the mood, rather than as an overlay quad: it
    // is a change in the light falling on the world, so a hero's own shadow shortens with it and a
    // cliff face lights along its normal. A white rectangle composited over the frame does neither,
    // and reads as a screen effect rather than as weather.
    const flash = flashIntensity();
    sun.color.copy(m.sun.color);
    sun.intensity = m.sun.intensity + flash * FLASH.sun;
    hemi.color.copy(m.hemi.sky);
    if (flash > 0) hemi.color.lerp(FLASH.tint, Math.min(1, flash * 0.8));
    hemi.groundColor.copy(m.hemi.ground);
    hemi.intensity = m.hemi.intensity + flash * FLASH.hemi;
    rim.color.copy(m.rim.color);
    rim.intensity = m.rim.intensity;
    pipeline.bloom.strength = m.bloom.strength;
    pipeline.bloom.threshold = m.bloom.threshold;
    pipeline.setGrade({
      saturation: m.grade.saturation,
      contrast: ctx.config.postfx.grade.contrast,
      lift: m.grade.lift,
      vignette: ctx.config.postfx.grade.vignette,
    });
    // Under-exposing reads as an ambience far more directly than dimming each light in turn — those
    // only tint it.
    pipeline.renderer.toneMappingExposure = m.exposure;
    water.colors.shallow.copy(m.water.shallow);
    water.colors.deep.copy(m.water.deep);
    water.setSparkle(m.water.sparkle);
    sky.apply(m, sun.position.clone().sub(sun.target.position));
    // `fog.color` is NOT copied here: the sky's horizon also moves outside a mood crossfade, and
    // `render` copies it every frame, just after `sky.update`.
  }

  // One empty framing before pushing the mood: `pushMood` needs the sun's direction, and it is the
  // camera that places it.
  frameCamera();
  pushMood();

  let last: number | null = null;

  return {
    ctx,
    scene,
    surfaceRoot,
    camera,
    // A GETTER, not the value: `updateTerrain` replaces the query, and anything that had captured
    // the old one would answer heights for the terrain before the edit — a hero standing in the air
    // over a cliff that was just dug away, with nothing failing.
    get query(): TerrainQuery {
      return query;
    },
    water,
    updateTerrain(next: MapData): void {
      currentMap = next;
      field = heightFieldFor(next);
      query = createTerrainQuery(mapToQuerySource(next));
      // `meshTerrain` and `createFoam` clear their group's children but do NOT detach the group
      // itself (`meshStairs` does); removing all three explicitly is the one rule that reads the
      // same for the next person as for the compiler.
      terrain.dispose();
      terrain.group.removeFromParent();
      terrain = terrainGroupFor(ctx, next, atlases);
      terrainOpacity = -1;
      scene.add(terrain.group);
      stairs.dispose();
      stairs.group.removeFromParent();
      stairs = stairsFor(next);
      scene.add(stairs.group);
      interiorShell.dispose();
      interiorShell = createInteriorShell(next, textures);
      interiorShell.setCameraYaw(cameraYaw);
      scene.add(interiorShell.group);
      underground.dispose();
      underground = createUnderground(next, textures);
      underground.setCameraYaw(cameraYaw);
      scene.add(underground.group);
      liquids.dispose();
      liquids.group.removeFromParent();
      liquids = liquidsFor(next, field);
      scene.add(liquids.group);
      foam.dispose();
      foam.group.removeFromParent();
      foam = foamFor(next, field);
      scene.add(foam.group);
      water.setField(field);
      applyUndergroundVisibility();
      clampCameraTo(next.size);
      // The camera is deliberately NOT re-parked: `focusReached` stays true, so an author's pan
      // survives the edit. That parking is what `focusOn`'s comment below had to work around when
      // every painted cell built a whole new scene.
    },
    updateCollisionMap(next: MapData): void {
      currentMap = next;
      query = createTerrainQuery(mapToQuerySource(next));
      clampCameraTo(next.size);
    },
    gameHour: () => cycle.hour,
    fireIntensity: () => mood.value.fire,
    setDayCycleOverride(override): void {
      cycleOverride = override;
      cycle = mapDayCycleAt(Date.now(), cycleKey, cycleOverride);
      mood.set(cycle.nightWeight);
    },
    setWeather(next): void {
      weather = next;
      rain.setIntensity(weatherRains(next) ? 1 : 0);
      if (!weatherStorms(next)) pushMood();
    },
    // The camera follows a player, and a player's position now arrives in the scene's own tile
    // units — there is nothing to convert here any more.
    //
    focusOn(x: number, z: number, elevation?: number, airborne = false): void {
      surfaceAccessPreview = surfaceAccessPreviewAt(currentMap, x, z);
      if (elevation !== undefined && currentMap.underground && !authoringUndergroundView) {
        const transitioning = undergroundTransitionAt(
          currentMap.underground,
          currentMap.size,
          x,
          z,
        );
        // A jump changes the body's Y but not the room it occupies. Preserve the last grounded
        // storey unless the body is physically inside a stair or shaft; those authored openings
        // are the only places where seeing both floors during vertical travel is intentional.
        if (airborne && !transitioning) {
          undergroundElevation =
            viewedUndergroundDepth === null ? 0 : undergroundFloorHeight(viewedUndergroundDepth);
        } else {
          viewedUndergroundDepth = undergroundDepthAtElevation(elevation);
          undergroundElevation = elevation;
        }
        applyUndergroundVisibility();
      }
      focus = {
        x: THREE.MathUtils.clamp(x, cameraMin, cameraMax),
        z: THREE.MathUtils.clamp(z, cameraMin, cameraMax),
        ...(elevation === undefined ? {} : { elevation }),
        ...(airborne ? { airborne: true } : {}),
      };
      // The FIRST focus places the camera at call time, not at the next rendered frame. The
      // editor rebuilds this whole scene mid-stroke (`configureMapTerrain`), and until a frame
      // rendered, the fresh camera still sat parked over the map's spawn — so a pick landing in
      // that one-frame window raycast through the wrong camera and painted a tile displaced by
      // exactly the author's pan distance. Later focuses keep the damped follow in `render`.
      if (!focusReached) {
        target.set(
          focus.x,
          cameraFocusSurface(
            query,
            currentMap.waterLevel,
            focus.x,
            focus.z,
            focus.elevation,
            focus.airborne,
          ) + CAMERA.height,
          focus.z,
        );
        focusReached = true;
        frameCamera();
      }
    },
    setZoom(percent: number): void {
      const safePercent = THREE.MathUtils.clamp(percent, 2, 250);
      cameraDistance = (CAMERA.distance * 100) / safePercent;
      framedCameraDistance = Math.min(framedCameraDistance, cameraDistance);
      frameCamera();
    },
    setYaw(radians: number): void {
      if (!Number.isFinite(radians)) return;
      cameraYaw = Math.atan2(Math.sin(radians), Math.cos(radians));
      ctx.setYaw(cameraYaw);
      interiorShell.setCameraYaw(cameraYaw);
      underground.setCameraYaw(cameraYaw);
      frameCamera();
    },
    setPitch(radians: number): void {
      if (!Number.isFinite(radians)) return;
      cameraPitch = THREE.MathUtils.clamp(radians, Math.PI / 36, (17 * Math.PI) / 36);
      ctx.setPitch(cameraPitch);
      frameCamera();
    },
    setUndergroundDepth(depth: number | null, reference = false): void {
      viewedUndergroundDepth =
        depth === null
          ? null
          : (() => {
              const clamped = THREE.MathUtils.clamp(Math.round(depth), -16, 16);
              return clamped === 0 ? (depth < 0 ? -1 : 1) : clamped;
            })();
      undergroundElevation = null;
      authoringUndergroundView = reference && viewedUndergroundDepth !== null;
      applyUndergroundVisibility();
    },
    setCameraShake: applyCameraShake,
    setFogEnabled(enabled: boolean): void {
      scene.fog = enabled ? fog : null;
    },
    setTiltShiftEnabled(enabled: boolean): void {
      pipeline.setTiltShiftEnabled(enabled);
    },
    pickGround(raycaster: THREE.Raycaster): { x: number; z: number } | null {
      const half = currentMap.size / 2;
      const authoredSurfaces: THREE.Object3D[] = [];
      surfaceRoot.traverse((child) => {
        if (child.userData[AUTHORED_PICK_SURFACE] === "building") authoredSurfaces.push(child);
      });
      for (const hit of raycaster.intersectObjects(
        [
          terrain.group,
          underground.group,
          stairs.group,
          ...liquids.surfaces,
          water.mesh,
          ...authoredSurfaces,
        ],
        true,
      )) {
        const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld);
        if (!normal) continue;
        let ancestor: THREE.Object3D | null = hit.object;
        while (ancestor && ancestor !== scene) {
          if (ancestor.userData[AUTHORED_PICK_SURFACE] === "building") break;
          ancestor = ancestor.parent;
        }
        const onBuilding = ancestor?.userData[AUTHORED_PICK_SURFACE] === "building";
        // A cliff face is not a surface you can stand on, but it IS something an author points at.
        // Skipping it let the ray carry on to the first horizontal surface behind the wall, which
        // marked a cell the pointer was nowhere near. Read a vertical face as the ground at its
        // FOOT instead: step a half cell along the outward normal, which lands in the low cell the
        // wall drops into rather than on the plateau it holds up. Native building walls use the
        // opposite direction so clicking visible architecture selects its footprint/roof.
        const point = editorGroundPickPoint(hit.point, normal, onBuilding, (x, z) =>
          query.heightAt(x, z),
        );
        if (point.x < -half || point.x > half || point.z < -half || point.z > half) {
          continue;
        }
        return point;
      }
      return null;
    },
    render(now: number): void {
      const dt = last === null ? 0 : Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
      last = now;
      if (focus) {
        wantedTarget.set(
          focus.x,
          cameraFocusSurface(
            query,
            currentMap.waterLevel,
            focus.x,
            focus.z,
            focus.elevation,
            focus.airborne,
          ) + CAMERA.height,
          focus.z,
        );
        // Exponential damping, transcribed from `apps/lab/src/main.ts`'s `updateCamera`: it is
        // framerate-independent, unlike a fixed lerp, which converges faster on a fast machine and
        // makes the same follow read as two different games. The FIRST focus snaps instead — the
        // camera starts parked over the map's spawn, and damping from there would be a one-second
        // fly-in every time a hero joins somewhere else.
        if (focusReached && target.distanceToSquared(wantedTarget) <= 25) {
          target.lerp(wantedTarget, 1 - Math.exp(-CAMERA.follow * dt));
        } else {
          target.copy(wantedTarget);
          focusReached = true;
        }
        frameCamera(dt);
      }
      cycle = mapDayCycleAt(Date.now(), cycleKey, cycleOverride);
      mood.set(cycle.nightWeight);
      // The sun/moon, fog and every graded channel evolve even while the hero stands still.
      frameCamera();
      pushMood();
      water.update(dt);
      liquids.update(dt);
      foam.update(dt);
      // The curtain follows what the camera looks at, not the hero: they are the same point while
      // the camera is settled, and during a fly-in it is the frame that must stay full of rain.
      rain.setCentre(target.x, target.z);
      rain.update(dt);
      sky.update(dt, camera, mood.value.aurora);
      // Copied EVERY frame, not only on a mood crossfade: `sky.horizon` also moves with effects
      // that follow their own timing.
      if (viewedUndergroundDepth !== null || (currentMap.environment ?? "exterior") === "interior")
        fog.color.set(0x020307);
      else fog.color.copy(sky.horizon);
      // The mood settles once and then never moves again while only `day` exists — `update` returns
      // false and nothing is pushed. Kept anyway: it is one comparison per frame, and it is the
      // seam a second mood would arrive through.
      updateFocus();
      pipeline.render();
    },
    resize: pipeline.resize,
    /** Gives back every owned resource. The canvas context necessarily survives; `createPipeline`
     * resets its inherited unpack flags before a later renderer performs its first 3D upload. */
    dispose(): void {
      terrain.dispose();
      stairs.dispose();
      interiorShell.dispose();
      underground.dispose();
      liquids.dispose();
      // The sea is NOT disposed here — it belongs to the caller and routinely outlives this scene
      // (see this function's docblock). Putting `water.dispose()` back would free a plane the next
      // scene is about to be handed, and cost 17-23 ms to rebuild for nothing.
      water.mesh.removeFromParent();
      foam.dispose();
      rain.dispose();
      sky.dispose();
      pipeline.dispose();
      ctx.dispose();
    },
  };
}
