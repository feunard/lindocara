import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Rect } from "@lindocara/engine/game.js";
import type {
  AssetDomain,
  AssetFrameMetadata,
  AssetNature,
  EditorAssetDefinition,
  EditorPlacementMetadata,
  TinySwordsCatalogEntry,
  TinySwordsCatalogFile,
  TinySwordsPack,
} from "@lindocara/engine/tiny-swords-catalog.js";

// This lib lives in packages/catalog/src. The raw art is co-located in this package's assets/;
// the generated outputs land in their consuming packages (engine, client) and in the repo docs.
const CATALOG_DIR = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
/** The catalog package root — holds the raw `assets/`. Exported for the catalog test. */
export const PROJECT_ROOT = CATALOG_DIR;
export const RAW_INDEX_PATH = path.join(CATALOG_DIR, "assets", "index.json");
export const CATALOG_SOURCE_PATH = path.join(CATALOG_DIR, "assets", "lindocara-asset-catalog.json");
export const CLIENT_CATALOG_PATH = path.join(
  REPO_ROOT,
  "packages",
  "client",
  "public",
  "assets",
  "lindocara",
  "tiny-swords",
  "catalog.json",
);
export const GENERATED_SHARED_PATH = path.join(
  REPO_ROOT,
  "packages",
  "engine",
  "src",
  "tiny-swords-catalog.generated.ts",
);
export const COVERAGE_REPORT_PATH = path.join(
  REPO_ROOT,
  "docs",
  "generated",
  "tiny-swords-catalog-coverage.md",
);

export interface RawAsset {
  path: string;
  pack: TinySwordsPack;
  category: string;
  name: string;
  w: number;
  h: number;
  alpha_bbox: [number, number, number, number] | null;
  x_frames: number;
  y_frames: number;
  est_frames: number;
  cell_hint?: number;
  error?: string;
}

export interface RawIndex {
  count: number;
  files: RawAsset[];
}

const PACKS = new Set<TinySwordsPack>([
  "Tiny Swords (Free Pack)",
  "Tiny Swords (Update 010)",
  "Tiny Swords (Enemy Pack)",
]);

/**
 * Update 010's twelve combined troop atlases. Catalogue IDs are the stable authoring contract;
 * source paths are deliberately absent so moving the raw packs cannot silently change previews.
 */
export const COMBINED_TROOP_SHEET_IDS = [
  "character.factions-knights-troops-archer-blue.archer-blue",
  "character.factions-knights-troops-archer-purple.archer-purlple",
  "character.factions-knights-troops-archer-red.archer-red",
  "character.factions-knights-troops-archer-yellow.archer-yellow",
  "character.factions-knights-troops-pawn-blue.pawn-blue",
  "character.factions-knights-troops-pawn-purple.pawn-purple",
  "character.factions-knights-troops-pawn-red.pawn-red",
  "character.factions-knights-troops-pawn-yellow.pawn-yellow",
  "character.factions-knights-troops-warrior-blue.warrior-blue",
  "character.factions-knights-troops-warrior-purple.warrior-purple",
  "character.factions-knights-troops-warrior-red.warrior-red",
  "character.factions-knights-troops-warrior-yellow.warrior-yellow",
] as const;

const COMBINED_TROOP_SHEET_ID_SET = new Set<string>(COMBINED_TROOP_SHEET_IDS);

export function isCombinedTroopSheetId(id: string): boolean {
  return COMBINED_TROOP_SHEET_ID_SET.has(id);
}

const UI_PREFIXES = ["UI/", "UI Elements/"];

function isUi(raw: RawAsset): boolean {
  return UI_PREFIXES.some((prefix) => raw.category.startsWith(prefix));
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[()]/g, " ")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function packTag(pack: TinySwordsPack): string {
  if (pack === "Tiny Swords (Free Pack)") return "free";
  if (pack === "Tiny Swords (Update 010)") return "update-010";
  return "enemy-pack";
}

function domainOf(raw: RawAsset): AssetDomain {
  if (isUi(raw)) return "ui";
  if (/Buildings|\b(Hut|Tower|Cave|Boat|Cannon)\b/i.test(raw.category)) return "building";
  if (/^Terrain\/(Ground|Tileset|Water|Bridge)/.test(raw.category)) return "terrain";
  if (raw.category === "Deco" || raw.category.startsWith("Terrain/Decorations")) {
    return "decoration";
  }
  if (raw.category.startsWith("Resources") || raw.category.startsWith("Terrain/Resources")) {
    return "resource";
  }
  if (raw.category.startsWith("Units") || raw.category.includes("Factions/Knights/Troops")) {
    return "character";
  }
  if (raw.category.includes("Enemies/")) return "enemy";
  if (/Effects|Particle FX/.test(raw.category)) return "effect";
  return "reference";
}

function uiFamily(raw: RawAsset): string {
  if (raw.category.includes("Buttons")) return "button";
  if (raw.category.includes("Bars")) return "bar";
  if (raw.category.includes("Cursors")) return "cursor";
  if (raw.category === "UI/Pointers" && raw.name === "01") return "cursor";
  if (raw.category === "UI/Pointers") return "panel-corner";
  if (raw.category.includes("Human Avatars")) return "portrait";
  if (raw.category.includes("Icons")) return "icon";
  if (raw.category.includes("Papers")) return "paper";
  if (raw.category.includes("Ribbons")) return "ribbon";
  if (raw.category.includes("Banners")) return "banner";
  if (raw.category.includes("Wood Table")) return "panel";
  if (raw.category.includes("Swords")) return "ornament";
  return "component";
}

function uiState(name: string): "normal" | "hover" | "pressed" | "disabled" {
  if (/Pressed/i.test(name)) return "pressed";
  if (/Disable/i.test(name)) return "disabled";
  if (/Hover/i.test(name)) return "hover";
  return "normal";
}

function uiBaseId(raw: RawAsset): string {
  const family = uiFamily(raw);
  if (family === "button") {
    const color = /Red/i.test(raw.name) ? "red" : /Blue/i.test(raw.name) ? "blue" : "shared";
    const format = /9Slides/i.test(raw.name)
      ? "9-slice"
      : /3Slides/i.test(raw.name)
        ? "3-slice"
        : /Round/i.test(raw.name)
          ? "round"
          : /Square/i.test(raw.name)
            ? "square"
            : "fixed";
    const size = /Big/i.test(raw.name) ? "large" : /Small/i.test(raw.name) ? "small" : "tiny";
    return raw.category.startsWith("UI/Buttons")
      ? `ui.button.${color}.${uiState(raw.name)}.${format}`
      : `ui.button.${size}.${color}.${uiState(raw.name)}.${format}`;
  }
  if (raw.category.includes("Bars")) {
    const size = /Big/i.test(raw.name) ? "large" : "small";
    const part = /Fill/i.test(raw.name) ? "fill" : "base";
    return `ui.bar.${size}.${part}`;
  }
  if (raw.category.includes("Cursors")) {
    const role: Record<string, string> = {
      Cursor_01: "default",
      Cursor_02: "link",
      Cursor_03: "unavailable",
      Cursor_04: "resize-corners",
    };
    return `ui.cursor.${role[raw.name] ?? slug(raw.name)}`;
  }
  if (raw.category === "UI/Pointers" && raw.name === "01") return "ui.cursor.paint";
  if (raw.category === "UI/Pointers") return `ui.panel.corner.${slug(raw.name)}`;
  if (raw.category.includes("Human Avatars")) {
    return `ui.portrait.human.${slug(raw.name.replace("Avatars_", ""))}`;
  }
  if (raw.category.includes("Icons")) {
    return `ui.icon.${uiState(raw.name)}.${slug(raw.name.replace(/^(Disable|Pressed|Regular)_/, ""))}`;
  }
  return `ui.${family}.${slug(raw.name)}`;
}

function baseId(raw: RawAsset): string {
  if (isUi(raw)) return uiBaseId(raw);
  const domain = domainOf(raw);
  const category = slug(raw.category);
  const name = slug(raw.name);
  return `${domain}.${category}.${name}`;
}

const DECO_SEMANTIC_TAGS: Readonly<Record<string, readonly string[]>> = {
  "01": ["mushroom", "champignon", "fungus", "small"],
  "02": ["mushroom", "champignon", "fungus", "medium"],
  "03": ["mushroom", "champignon", "fungus", "large"],
  "04": ["stone", "pierre", "pebble", "small"],
  "05": ["stone", "pierre", "pebble", "medium"],
  "06": ["stone", "pierre", "pebble", "large"],
  "07": ["plant", "plante", "foliage", "small"],
  "08": ["plant", "plante", "foliage", "medium"],
  "09": ["plant", "plante", "foliage", "large"],
  "10": ["plant", "plante", "shoot", "sprout"],
  "11": ["plant", "plante", "reeds", "roseaux"],
  "12": ["pumpkin", "citrouille", "harvest", "single"],
  "13": ["pumpkin", "citrouille", "harvest", "patch"],
  "14": ["bone", "os", "remains", "large"],
  "15": ["bone", "os", "remains", "small"],
  "16": ["grave", "tombe", "skull", "warning", "panneau"],
  "17": ["signpost", "panneau", "direction", "road"],
  "18": ["scarecrow", "epouvantail", "farm", "field"],
};

function tagsOf(raw: RawAsset, domain: AssetDomain): string[] {
  const words = `${raw.category} ${raw.name} ${domain} ${packTag(raw.pack)}`
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 1);
  const semantic = raw.category === "Deco" ? (DECO_SEMANTIC_TAGS[raw.name] ?? []) : [];
  return [...new Set([...words, ...semantic])];
}

/**
 * Water rocks and the rubber duck ship as horizontal strips of SQUARE animation frames (foam ripples
 * around a static rock; the duck bobs). `isAnimation` excludes the terrain/decoration domains these
 * live in, so without this branch they fall through to `nature: "static"` with no `frame`, and the
 * renderer's `sliceFrames` draws the ENTIRE 1024px strip as one sprite — the "rock rendered eight
 * times side by side" bug (D20). Their raw frame estimate is unreliable (alpha-bbox noise counts a
 * 16-frame strip as 18 or 20), but the cell is always the sheet's height, so the frame count is
 * exactly `w / h`; that is why this cannot lean on `x_frames`/`est_frames` like the generic path does.
 */
const SQUARE_STRIP_ANIMATION_CATEGORIES = new Set<string>([
  "Terrain/Water/Rocks",
  "Terrain/Decorations/Rocks in the Water",
  "Terrain/Decorations/Rubber Duck",
]);

function isSquareStripAnimation(raw: RawAsset): boolean {
  return (
    (SQUARE_STRIP_ANIMATION_CATEGORIES.has(raw.category) || raw.category === "Particle FX") &&
    raw.w > raw.h &&
    raw.w % raw.h === 0 &&
    raw.est_frames > 1
  );
}

function isAnimation(raw: RawAsset, domain: AssetDomain): boolean {
  if (isSquareStripAnimation(raw)) return true;
  if (domain === "ui" || domain === "terrain" || raw.category === "Deco") return false;
  if (/Buildings/.test(raw.category)) return false;
  if (/(_Idle|_Run|_Attack|_Move|_Spawn|_Highlight|Tree[1-4]|Bushe[1-4])$/i.test(raw.name)) {
    return raw.est_frames > 1;
  }
  return raw.est_frames > 1 && ["character", "enemy", "effect"].includes(domain);
}

function frameOf(raw: RawAsset, domain: AssetDomain): AssetFrameMetadata | undefined {
  if (!isAnimation(raw, domain)) return undefined;
  if (isSquareStripAnimation(raw)) {
    // Square cells, count fixed by geometry (see `isSquareStripAnimation`): one frame per `h`-wide
    // column across a `w`-wide strip.
    return {
      width: raw.h,
      height: raw.h,
      count: raw.w / raw.h,
      axis: "x",
      durationMs: domain === "effect" ? 800 : 1_400,
    };
  }
  const axis = raw.x_frames > 1 || raw.w >= raw.h ? "x" : "y";
  const count = Math.max(1, axis === "x" ? raw.x_frames : raw.y_frames, raw.est_frames);
  const width = axis === "x" ? Math.floor(raw.w / count) : raw.w;
  const height = axis === "y" ? Math.floor(raw.h / count) : raw.h;
  return { width, height, count, axis, durationMs: domain === "effect" ? 800 : 1_400 };
}

function natureOf(
  raw: RawAsset,
  domain: AssetDomain,
  frame: AssetFrameMetadata | undefined,
): AssetNature {
  if (frame) return "animated";
  if (
    raw.category.includes("Tileset") ||
    raw.category.includes("UI Banners from the store page") ||
    raw.name.endsWith("_All") ||
    (domain === "ui" && raw.est_frames > 1)
  ) {
    return "sheet";
  }
  return "static";
}

function footOffset(raw: RawAsset, domain: AssetDomain): number {
  if (domain === "ui" || raw.alpha_bbox === null) return 0;
  return Math.max(0, raw.h - raw.alpha_bbox[3]);
}

/**
 * The cells an asset's art visually occupies, in foot space.
 *
 * Derived from the sprite's real PIXEL span and rounded outward, not from a column count.
 *
 * The old form used `-floor(cols/2)` as the first column, which is only centred when the count is
 * odd: a 320px castle (5 cols) claimed -160..160 under a sprite spanning -160..160, but a 128px
 * house (2 cols) claimed -96..32 under a sprite spanning -64..64 — half a tile too far west.
 * `buildingCollider` derives from the same footprint, so every even-width building blocked a strip
 * of empty grass on its left while leaving its own right edge walk-through.
 *
 * A cell `c` spans `[c*64-32, (c+1)*64-32)` (see the TILE_PX comment), so an even-width sprite
 * centred on the foot point never aligns with the grid; covering it needs the partial cells on both
 * sides. Over-claiming by half a cell is the conservative direction: it can only reserve a little
 * more room around a building, never leave part of one unclaimed.
 */
function visualCells(width: number, height: number): { col: number; row: number }[] {
  const rows = Math.max(1, Math.ceil(height / 64));
  const halfWidth = width / 2;
  const firstCol = Math.floor((-halfWidth + TILE_PX / 2) / TILE_PX);
  const lastCol = Math.ceil((halfWidth + TILE_PX / 2) / TILE_PX) - 1;
  const result: { col: number; row: number }[] = [];
  for (let row = -(rows - 1); row <= 0; row++) {
    for (let col = firstCol; col <= lastCol; col++) result.push({ col, row });
  }
  return result;
}

// Foot-space collider math shares this with the build invariant below: the origin is the sprite's
// VISIBLE FOOT — cell-centre horizontally (col*64+32), the ground line the art stands on vertically
// ((row+1)*64) — so a cell-wide box resting on the foot spans [-32, 32) in x and [-64, 0) in y per
// row, rising into negative y. This is footOffset-independent by construction: see the `collider`
// doc comment on `EditorPlacementMetadata` for why authoring against the sprite container instead
// would be wrong.
const TILE_PX = 64;

// Trees (Tree1-4, Stump): a trunk, not a canopy. ~24px wide, centred, rising ~20px from the ground.
const TREE_COLLIDER: Rect = { x: -12, y: -20, width: 24, height: 20 };

// Rocks: squatter and wider than a trunk.
const ROCK_COLLIDER: Rect = { x: -20, y: -14, width: 40, height: 14 };

// Buildings still block their whole visual footprint (unchanged behavior this tranche) — just
// expressed in foot space instead of cells, so the collider survives the removal of
// `collisionFootprint` without a gameplay change.
/** The building's own pixel footprint, centred on the foot point the sprite is anchored to. */
function buildingCollider(width: number, height: number): Rect {
  const rows = Math.min(2, Math.ceil(height / TILE_PX));
  return { x: -width / 2, y: -(rows * TILE_PX), width, height: rows * TILE_PX };
}

/** Stable catalogue identities for farm animals that authors may place as scenery or resources.
 * This is deliberately an id allow-list: moving the source PNG does not silently remove it from
 * the editor, and no gameplay meaning is inferred from a filename or directory. */
const FARM_ANIMAL_EDITOR_ASSET_IDS = new Set([
  "resource.resources-sheep.happysheep-idle",
  "resource.terrain-resources-meat-sheep.sheep-idle",
]);

function editorMetadata(
  raw: RawAsset,
  id: string,
  domain: AssetDomain,
  frame: AssetFrameMetadata | undefined,
): EditorPlacementMetadata | undefined {
  const normalized = raw.path.replaceAll("\\", "/");
  const frameWidth = frame?.width ?? raw.w;
  const frameHeight = frame?.height ?? raw.h;
  const common = {
    visualFootprint: visualCells(frameWidth, frameHeight),
    renderLayer: "object" as const,
  };

  if (FARM_ANIMAL_EDITOR_ASSET_IDS.has(id)) {
    return {
      ...common,
      category: "farm-and-village",
      allowedTerrain: ["grass"],
    };
  }

  // Idle character/enemy sheets are valid event appearances (NPCs, quest actors and encounter
  // previews). Their detected frame metadata crops one real frame instead of exposing the sheet.
  if ((domain === "character" || domain === "enemy") && /idle/i.test(raw.name)) {
    return {
      ...common,
      category: domain === "character" ? "characters" : "creatures",
      allowedTerrain: ["grass"],
    };
  }

  if (domain === "building" && raw.est_frames === 1 && !raw.category.includes("Enemy Pack")) {
    return {
      ...common,
      category: "buildings",
      allowedTerrain: ["grass"],
      collider: buildingCollider(frameWidth, frameHeight),
    };
  }

  if (raw.category === "Terrain/Decorations/Clouds") {
    return {
      ...common,
      category: "atmosphere",
      allowedTerrain: ["grass", "water"],
      renderLayer: "sky",
    };
  }

  if (/Terrain\/Resources\/Wood\/Trees\/(Tree[1-4]|Stump [1-4])\.png$/.test(normalized)) {
    return {
      ...common,
      category: raw.name.startsWith("Tree") ? "trees" : "farm-and-village",
      allowedTerrain: ["grass"],
      renderLayer: raw.name.startsWith("Tree") ? "canopy" : "object",
      collider: TREE_COLLIDER,
    };
  }

  if (raw.category === "Terrain/Decorations/Bushes") {
    return {
      ...common,
      category: "vegetation",
      allowedTerrain: ["grass"],
    };
  }

  if (
    raw.category === "Terrain/Water/Rocks" ||
    raw.category === "Terrain/Decorations/Rocks in the Water"
  ) {
    return {
      ...common,
      category: "water-decor",
      allowedTerrain: ["water"],
      collider: ROCK_COLLIDER,
    };
  }

  if (/Terrain\/(Decorations\/)?(Rocks|Water\/Rocks)/.test(raw.category)) {
    return {
      ...common,
      category: "rocks",
      // The legacy editor allowed its four dry rock variants in shallows. Preserve that authored
      // map behavior while also exposing the pack's dedicated water-rock families.
      allowedTerrain: ["grass", "water"],
      collider: ROCK_COLLIDER,
    };
  }

  if (raw.category === "Terrain/Decorations/Rubber Duck") {
    return {
      ...common,
      category: "water-decor",
      allowedTerrain: ["water"],
    };
  }

  if (raw.category === "Particle FX" && raw.name === "Water Splash") {
    return {
      ...common,
      category: "water-decor",
      allowedTerrain: ["water"],
    };
  }

  if (raw.category === "Deco") {
    return {
      ...common,
      category: raw.name === "17" ? "signs" : "small-decor",
      allowedTerrain: ["grass"],
    };
  }

  if (
    /Terrain\/Resources\/(Wood\/Wood Resource|Meat\/Meat Resource|Tools)/.test(raw.category) ||
    (/Terrain\/Resources\/Gold\/(Gold Stones|Gold Resource)/.test(raw.category) &&
      !raw.name.includes("Highlight")) ||
    (raw.category === "Resources/Resources" && /_Idle/.test(raw.name))
  ) {
    return {
      ...common,
      category: raw.category.includes("Tools") ? "farm-and-village" : "resources",
      allowedTerrain: ["grass"],
      // Gold stone piles read the same as a small rock outcrop underfoot; reuse ROCK_COLLIDER
      // rather than invent a third fixed footprint for one resource variant.
      ...(raw.category.includes("Gold Stones") ? { collider: ROCK_COLLIDER } : {}),
    };
  }

  return undefined;
}

function uiMetadata(raw: RawAsset, id: string): TinySwordsCatalogEntry["ui"] | undefined {
  if (!isUi(raw)) return undefined;
  const family = uiFamily(raw);
  const state = uiState(raw.name);
  const common = { family, state } as const;
  if (raw.category.includes("UI Banners from the store page")) return { family };
  if (raw.category.startsWith("UI/Buttons") && /3Slides/.test(raw.name)) {
    return { ...common, slice: { type: "three", left: 64, right: 64 } };
  }
  if (raw.category.startsWith("UI/Buttons") && /9Slides/.test(raw.name)) {
    return { ...common, slice: { type: "nine", top: 64, right: 64, bottom: 64, left: 64 } };
  }
  if (raw.name === "Carved_3Slides") {
    return { family: "panel", slice: { type: "three", left: 64, right: 64 } };
  }
  if (raw.name === "Carved_9Slides") {
    return {
      family: "panel",
      slice: { type: "nine", top: 64, right: 64, bottom: 64, left: 64 },
    };
  }
  if (raw.category.includes("Cursors")) {
    // The 64x64 canvases pad the artwork with transparency; hotspots must point at the
    // visible tip, not the empty corner. Measured from each PNG's opaque bounding box.
    if (raw.name === "Cursor_01") return { family, hotspot: { x: 22, y: 17 } };
    if (raw.name === "Cursor_02") return { family, hotspot: { x: 24, y: 17 } };
    if (raw.name === "Cursor_03") return { family, hotspot: { x: 32, y: 31 } };
    return { family, componentOf: "ui.cursor.resize" };
  }
  if (id === "ui.cursor.paint") return { family, hotspot: { x: 22, y: 17 } };
  return common;
}

function classification(raw: RawAsset, role: string): TinySwordsCatalogEntry["classification"] {
  if (raw.category.includes("UI Banners from the store page")) {
    return {
      status: "ignored",
      reason: "Store-page presentation composite; runtime uses the separated UI components.",
    };
  }
  return { status: "catalogued", role };
}

function roleOf(raw: RawAsset, domain: AssetDomain): string {
  if (domain === "ui") return `${uiFamily(raw)}-${raw.est_frames > 1 ? "component-sheet" : "skin"}`;
  if (domain === "building") return "world-building";
  if (domain === "terrain") return "terrain-source";
  if (domain === "decoration") return "world-decoration";
  if (domain === "resource") return "world-resource";
  if (domain === "character") return "character-animation";
  if (domain === "enemy") return "enemy-animation";
  if (domain === "effect") return "visual-effect";
  return "source-reference";
}

export function readRawIndex(): RawIndex {
  return JSON.parse(readFileSync(RAW_INDEX_PATH, "utf8")) as RawIndex;
}

export function createCatalogSource(index: RawIndex): TinySwordsCatalogFile {
  const rawBaseIds = index.files.map(baseId);
  const baseCounts = new Map<string, number>();
  for (const id of rawBaseIds) baseCounts.set(id, (baseCounts.get(id) ?? 0) + 1);
  const used = new Map<string, number>();

  const entries = index.files.map((raw, rawIndex): TinySwordsCatalogEntry => {
    const initial = rawBaseIds[rawIndex] ?? `reference.asset.${rawIndex}`;
    const withPack =
      (baseCounts.get(initial) ?? 0) > 1 ? `${initial}.${packTag(raw.pack)}` : initial;
    const seen = used.get(withPack) ?? 0;
    used.set(withPack, seen + 1);
    const id = seen === 0 ? withPack : `${withPack}.${seen + 1}`;
    const domain = domainOf(raw);
    const frame = frameOf(raw, domain);
    const role = roleOf(raw, domain);
    const ui = uiMetadata(raw, id);
    const editor = editorMetadata(raw, id, domain, frame);
    return {
      id,
      sourcePath: raw.path,
      pack: raw.pack,
      domain,
      category: raw.category,
      tags: tagsOf(raw, domain),
      width: raw.w,
      height: raw.h,
      nature: natureOf(raw, domain, frame),
      ...(frame ? { frame } : {}),
      anchor: domain === "ui" ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 1 },
      footOffset: footOffset(raw, domain),
      classification: classification(raw, role),
      ...(ui ? { ui } : {}),
      ...(editor ? { editor } : {}),
    };
  });
  return { version: 1, generatedFrom: "assets/index.json", entries };
}

export function readCatalogSource(): TinySwordsCatalogFile {
  return JSON.parse(readFileSync(CATALOG_SOURCE_PATH, "utf8")) as TinySwordsCatalogFile;
}

function rawByPath(index: RawIndex): Map<string, RawAsset> {
  return new Map(index.files.map((raw) => [raw.path, raw]));
}

function fail(errors: string[], message: string): void {
  errors.push(message);
}

export interface CatalogReport {
  raw: number;
  catalogued: number;
  editor: number;
  ui: number;
  ignored: number;
  unclassified: string[];
}

export function validateCatalog(
  index: RawIndex,
  catalog: TinySwordsCatalogFile,
): { errors: string[]; report: CatalogReport } {
  const errors: string[] = [];
  const rawPaths = rawByPath(index);
  const ids = new Set<string>();
  const seenPaths = new Map<string, number>();

  if (index.count !== index.files.length)
    fail(errors, `raw count ${index.count} != ${index.files.length}`);
  if (catalog.entries.length !== index.files.length) {
    fail(
      errors,
      `catalog has ${catalog.entries.length} entries for ${index.files.length} raw files`,
    );
  }

  for (const entry of catalog.entries) {
    if (ids.has(entry.id)) fail(errors, `duplicate id: ${entry.id}`);
    ids.add(entry.id);
    seenPaths.set(entry.sourcePath, (seenPaths.get(entry.sourcePath) ?? 0) + 1);
    const raw = rawPaths.get(entry.sourcePath);
    if (!raw) {
      fail(errors, `catalog path is absent from index: ${entry.sourcePath}`);
      continue;
    }
    if (!PACKS.has(entry.pack) || entry.pack !== raw.pack)
      fail(errors, `invalid pack: ${entry.id}`);
    const normalized = entry.sourcePath.replaceAll("\\", "/");
    if (!normalized.startsWith(`${entry.pack}/`) || normalized.includes("../")) {
      fail(errors, `path leaves Tiny Swords pack: ${entry.sourcePath}`);
    }
    if (!existsSync(path.join(PROJECT_ROOT, "assets", ...normalized.split("/")))) {
      fail(errors, `missing file: ${entry.sourcePath}`);
    }
    if (entry.width !== raw.w || entry.height !== raw.h)
      fail(errors, `dimension mismatch: ${entry.id}`);
    if (
      entry.classification.status === "ignored" &&
      entry.classification.reason.trim().length === 0
    ) {
      fail(errors, `ignored without reason: ${entry.id}`);
    }
    if (isUi(raw) && !entry.ui) fail(errors, `UI entry has no curated UI metadata: ${entry.id}`);
    if (entry.frame) {
      const occupied =
        entry.frame.axis === "x"
          ? entry.frame.width * entry.frame.count
          : entry.frame.height * entry.frame.count;
      const available = entry.frame.axis === "x" ? entry.width : entry.height;
      if (
        entry.frame.width <= 0 ||
        entry.frame.height <= 0 ||
        entry.frame.count <= 0 ||
        entry.frame.durationMs <= 0 ||
        occupied > available
      ) {
        fail(errors, `invalid frame metadata: ${entry.id}`);
      }
    }
    const slice = entry.ui?.slice;
    if (
      slice?.type === "three" &&
      (slice.left <= 0 || slice.right <= 0 || slice.left + slice.right >= entry.width)
    ) {
      fail(errors, `invalid 3-slice: ${entry.id}`);
    }
    if (
      slice?.type === "nine" &&
      (slice.top <= 0 ||
        slice.right <= 0 ||
        slice.bottom <= 0 ||
        slice.left <= 0 ||
        slice.left + slice.right >= entry.width ||
        slice.top + slice.bottom >= entry.height)
    ) {
      fail(errors, `invalid 9-slice: ${entry.id}`);
    }
    const hotspot = entry.ui?.hotspot;
    if (
      hotspot &&
      (hotspot.x < 0 || hotspot.y < 0 || hotspot.x >= entry.width || hotspot.y >= entry.height)
    ) {
      fail(errors, `invalid cursor hotspot: ${entry.id}`);
    }
    if (entry.editor) {
      if (entry.editor.allowedTerrain.length === 0 || entry.editor.visualFootprint.length === 0) {
        fail(errors, `incoherent editor placement: ${entry.id}`);
      }
      const editor = entry.editor;
      if (editor.collider) {
        // Foot space, not cell space (see TILE_PX comment above): the footprint's lowest (closest
        // to the ground line) row sits at y=0, and higher (further-back) rows extend upward from
        // there, so a footprint cell at (col, row) spans x in [col*64-32, (col+1)*64-32) and y in
        // [(row - maxRow - 1)*64, (row - maxRow)*64).
        //
        // y=0 is the ground line the art stands on, so a collider that hangs below it
        // (y + height > 0) sits in the cell SOUTH of the art — exactly the coordinate-space bug
        // this shape exists to catch. Do not relax this bound.
        const cols = editor.visualFootprint.map((cell) => cell.col);
        const rows = editor.visualFootprint.map((cell) => cell.row);
        const minX = Math.min(...cols) * TILE_PX - TILE_PX / 2;
        const maxX = (Math.max(...cols) + 1) * TILE_PX - TILE_PX / 2;
        const minY = (Math.min(...rows) - Math.max(...rows) - 1) * TILE_PX;
        if (
          editor.collider.x < minX ||
          editor.collider.x + editor.collider.width > maxX ||
          editor.collider.y < minY ||
          editor.collider.y + editor.collider.height > 0
        ) {
          fail(errors, `${entry.id}: collider escapes its visual footprint`);
        }
      }
    }
  }

  for (const raw of index.files) {
    if ((seenPaths.get(raw.path) ?? 0) !== 1)
      fail(errors, `raw path must be classified once: ${raw.path}`);
  }

  const unclassified = index.files.filter((raw) => !seenPaths.has(raw.path)).map((raw) => raw.path);
  return {
    errors,
    report: {
      raw: index.files.length,
      catalogued: catalog.entries.filter((entry) => entry.classification.status === "catalogued")
        .length,
      editor:
        catalog.entries.filter(
          (entry) =>
            entry.classification.status === "catalogued" &&
            (entry.editor !== undefined ||
              entry.domain === "character" ||
              entry.domain === "enemy"),
        ).length +
        bridgeDefinitions(catalog).length +
        updateTreeDefinitions(catalog).length,
      ui: catalog.entries.filter((entry) => entry.domain === "ui").length,
      ignored: catalog.entries.filter((entry) => entry.classification.status === "ignored").length,
      unclassified,
    },
  };
}

function bridgeDefinitions(catalog: TinySwordsCatalogFile): EditorAssetDefinition[] {
  const bridge = catalog.entries.find((entry) =>
    entry.sourcePath.endsWith("Terrain/Bridge/Bridge_All.png"),
  );
  if (!bridge) throw new Error("Bridge_All is missing from the catalogue");
  const common = {
    sourcePath: bridge.sourcePath,
    pack: bridge.pack,
    domain: bridge.domain,
    category: "bridges",
    role: "walkable-bridge",
    tags: [...bridge.tags, "walkable", "crossing"],
    nature: "static" as const,
    anchor: { x: 0.5, y: 1 },
    footOffset: 0,
  };
  return [
    {
      ...common,
      id: "terrain.bridge.wood.horizontal",
      width: 192,
      height: 64,
      editor: {
        category: "bridges",
        allowedTerrain: ["water"],
        renderLayer: "ground",
        visualFootprint: [
          { col: -1, row: 0 },
          { col: 0, row: 0 },
          { col: 1, row: 0 },
        ],
        terrainOverride: "walkable",
        sourceRect: { x: 0, y: 0, width: 192, height: 64 },
      },
    },
    {
      ...common,
      id: "terrain.bridge.wood.vertical",
      width: 64,
      height: 192,
      editor: {
        category: "bridges",
        allowedTerrain: ["water"],
        renderLayer: "ground",
        visualFootprint: [
          { col: 0, row: -2 },
          { col: 0, row: -1 },
          { col: 0, row: 0 },
        ],
        terrainOverride: "walkable",
        sourceRect: { x: 0, y: 64, width: 64, height: 192 },
      },
    },
  ];
}

/** Update 010 packs six distinct 192px tree models and one stump into a sparse 4x3 sheet. Expose
 * each painted model as its own stable authoring asset so a map never animates through unrelated
 * silhouettes or draws the complete technical sheet. */
function updateTreeDefinitions(catalog: TinySwordsCatalogFile): EditorAssetDefinition[] {
  const source = catalog.entries.find((entry) => entry.id === "resource.resources-trees.tree");
  if (!source) throw new Error("Update 010 tree sheet is missing from the catalogue");
  const treeFootprint = [-2, -1, 0].flatMap((row) =>
    [-1, 0, 1].map((col) => ({ col, row })),
  );
  const common = {
    sourcePath: source.sourcePath,
    pack: source.pack,
    domain: source.domain,
    category: source.category,
    role: "world-resource",
    tags: [...source.tags, "harvestable"],
    width: 192,
    height: 192,
    nature: "static" as const,
    anchor: { x: 0.5, y: 1 },
    footOffset: 16,
  };
  const treeCells = [
    { x: 0, y: 0 },
    { x: 192, y: 0 },
    { x: 384, y: 0 },
    { x: 576, y: 0 },
    { x: 0, y: 192 },
    { x: 192, y: 192 },
  ];
  const trees = treeCells.map(
    (cell, index): EditorAssetDefinition => ({
      ...common,
      id: `resource.resources-trees.tree-${index + 1}`,
      editor: {
        category: "trees",
        allowedTerrain: ["grass"],
        renderLayer: "canopy",
        visualFootprint: treeFootprint,
        collider: { x: -12, y: -20, width: 24, height: 20 },
        sourceRect: { ...cell, width: 192, height: 192 },
      },
    }),
  );
  return [
    ...trees,
    {
      ...common,
      id: "resource.resources-trees.stump",
      editor: {
        category: "trees",
        allowedTerrain: ["grass"],
        renderLayer: "object",
        visualFootprint: [{ col: 0, row: 0 }],
        collider: { x: -12, y: -12, width: 24, height: 12 },
        sourceRect: { x: 0, y: 384, width: 192, height: 192 },
      },
    },
  ];
}

function runSourcePath(idleSourcePath: string): string | null {
  if (idleSourcePath.endsWith("/Idle.png")) {
    return `${idleSourcePath.slice(0, -"/Idle.png".length)}/Run.png`;
  }
  if (/_Idle(?= |\.png$)/.test(idleSourcePath)) {
    return idleSourcePath.replace(/_Idle(?= |\.png$)/, "_Run");
  }
  return null;
}

function runMotion(
  catalog: TinySwordsCatalogFile,
  entry: TinySwordsCatalogEntry,
): NonNullable<EditorAssetDefinition["motions"]>["run"] | undefined {
  if ((entry.domain !== "character" && entry.domain !== "enemy") || !/idle/i.test(entry.sourcePath))
    return undefined;
  const sourcePath = runSourcePath(entry.sourcePath);
  if (!sourcePath) return undefined;
  const run = catalog.entries.find((candidate) => candidate.sourcePath === sourcePath);
  if (run?.domain !== entry.domain || run.height <= 0 || run.width % run.height !== 0) {
    return undefined;
  }
  const count = run.width / run.height;
  return {
    sourcePath: run.sourcePath,
    frame: {
      width: run.height,
      height: run.height,
      count,
      axis: "x",
      durationMs: Math.max(400, count * 90),
    },
    anchor: run.anchor,
    footOffset: run.footOffset,
  };
}

/** Every catalogue character/enemy animation is a valid event appearance, even when it was not
 * manually annotated as scenery. The one-cell, non-colliding placement is deliberately conservative:
 * an NPC's collision remains authoritative event geometry, never inferred from its chosen picture. */
function inferredActorPlacement(
  entry: TinySwordsCatalogEntry,
): EditorPlacementMetadata | undefined {
  if (entry.domain !== "character" && entry.domain !== "enemy") return undefined;
  // Update 010's coloured Archer/Pawn/Warrior files are 2D animation grids, unlike the horizontal
  // strips used by the Free and Enemy packs. The raw frame detector has a one-axis model, so it
  // flattens e.g. an 8x7 Archer grid into 56 slices of 27x1344 transparent slivers. For editor/NPC
  // appearances we need one representative pose, not the whole action atlas: derive its square cell
  // from total area / frame count and crop the top-left pose. This stays scoped to the twelve known
  // troop atlases; other action sheets retain their existing animation metadata. Membership uses
  // the stable catalogue id, never the raw pack's physical path.
  const combinedTroop = isCombinedTroopSheetId(entry.id);
  const cellSize = entry.frame
    ? Math.sqrt((entry.width * entry.height) / entry.frame.count)
    : Number.NaN;
  const sourceRect =
    combinedTroop &&
    Number.isSafeInteger(cellSize) &&
    cellSize > 0 &&
    entry.width % cellSize === 0 &&
    entry.height % cellSize === 0
      ? { sourceRect: { x: 0, y: 0, width: cellSize, height: cellSize } }
      : {};
  return {
    category: entry.domain === "character" ? "characters" : "creatures",
    allowedTerrain: ["grass"],
    renderLayer: "object",
    visualFootprint: [{ col: 0, row: 0 }],
    ...sourceRect,
  };
}

export function editorDefinitions(catalog: TinySwordsCatalogFile): EditorAssetDefinition[] {
  const definitions = catalog.entries.flatMap((entry): EditorAssetDefinition[] => {
    if (entry.classification.status !== "catalogued") return [];
    const editor = entry.editor ?? inferredActorPlacement(entry);
    if (!editor) return [];
    const run = runMotion(catalog, entry);
    return [
      {
        id: entry.id,
        sourcePath: entry.sourcePath,
        pack: entry.pack,
        domain: entry.domain,
        category: entry.category,
        role: entry.classification.role,
        tags: entry.tags,
        width: entry.frame?.width ?? entry.width,
        height: entry.frame?.height ?? entry.height,
        nature: entry.nature,
        ...(entry.frame ? { frame: entry.frame } : {}),
        anchor: entry.anchor,
        footOffset: entry.footOffset,
        ...(run ? { motions: { run } } : {}),
        editor,
      },
    ];
  });
  return [...definitions, ...bridgeDefinitions(catalog), ...updateTreeDefinitions(catalog)].sort(
    (a, b) => a.id.localeCompare(b.id),
  );
}

function idForPath(catalog: TinySwordsCatalogFile, suffix: string): string {
  const entry = catalog.entries.find((candidate) => candidate.sourcePath.endsWith(suffix));
  if (!entry) throw new Error(`catalogue UI path missing: ${suffix}`);
  return entry.id;
}

function refForPath(catalog: TinySwordsCatalogFile, suffix: string) {
  const id = idForPath(catalog, suffix);
  const entry = catalog.entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`catalogue UI id missing: ${id}`);
  return {
    id,
    sourcePath: entry.sourcePath,
    ...(entry.ui?.hotspot ? { hotspot: entry.ui.hotspot } : {}),
    ...(entry.ui?.slice ? { slice: entry.ui.slice } : {}),
  };
}

export function uiAssets(catalog: TinySwordsCatalogFile) {
  const ref = (suffix: string) => refForPath(catalog, suffix);
  return {
    button: {
      blue: {
        normal: ref("UI/Buttons/Button_Blue_3Slides.png"),
        hover: ref("UI/Buttons/Button_Hover_3Slides.png"),
        pressed: ref("UI/Buttons/Button_Blue_3Slides_Pressed.png"),
        disabled: ref("UI/Buttons/Button_Disable_3Slides.png"),
      },
      red: {
        normal: ref("UI/Buttons/Button_Red_3Slides.png"),
        hover: ref("UI/Buttons/Button_Hover_3Slides.png"),
        pressed: ref("UI/Buttons/Button_Red_3Slides_Pressed.png"),
        disabled: ref("UI/Buttons/Button_Disable_3Slides.png"),
      },
    },
    panel: {
      carved: ref("UI/Banners/Carved_9Slides.png"),
      paper: ref("UI Elements/UI Elements/Papers/RegularPaper.png"),
    },
    ribbon: {
      blue: ref("UI/Ribbons/Ribbon_Blue_3Slides.png"),
      yellow: ref("UI/Ribbons/Ribbon_Yellow_3Slides.png"),
    },
    control: {
      checkbox: {
        normal: ref("UI Elements/UI Elements/Buttons/SmallBlueSquareButton_Regular.png"),
        checked: ref("UI Elements/UI Elements/Buttons/SmallBlueSquareButton_Pressed.png"),
      },
      rangeThumb: ref("UI Elements/UI Elements/Buttons/TinyRoundBlueButton.png"),
      iconButton: {
        normal: ref("UI Elements/UI Elements/Buttons/SmallBlueSquareButton_Regular.png"),
        pressed: ref("UI Elements/UI Elements/Buttons/SmallBlueSquareButton_Pressed.png"),
        danger: ref("UI Elements/UI Elements/Buttons/SmallRedSquareButton_Regular.png"),
      },
      slot: ref("UI Elements/UI Elements/Banners/Banner_Slots.png"),
      icon: {
        quest: ref("UI Elements/UI Elements/Icons/Icon_01.png"),
        oath: ref("UI Elements/UI Elements/Icons/Icon_02.png"),
        sword: ref("UI Elements/UI Elements/Icons/Icon_03.png"),
        potion: ref("UI Elements/UI Elements/Icons/Icon_04.png"),
        gold: ref("UI Elements/UI Elements/Icons/Icon_05.png"),
        crystal: ref("UI Elements/UI Elements/Icons/Icon_06.png"),
      },
    },
    cursor: {
      default: ref("UI Elements/UI Elements/Cursors/Cursor_01.png"),
      link: ref("UI Elements/UI Elements/Cursors/Cursor_02.png"),
      interact: ref("UI Elements/UI Elements/Cursors/Cursor_02.png"),
      move: ref("UI Elements/UI Elements/Cursors/Cursor_02.png"),
      paint: ref("UI/Pointers/01.png"),
      unavailable: ref("UI Elements/UI Elements/Cursors/Cursor_03.png"),
    },
    bar: {
      largeBase: ref("UI Elements/UI Elements/Bars/BigBar_Base.png"),
      largeFill: ref("UI Elements/UI Elements/Bars/BigBar_Fill.png"),
      smallBase: ref("UI Elements/UI Elements/Bars/SmallBar_Base.png"),
      smallFill: ref("UI Elements/UI Elements/Bars/SmallBar_Fill.png"),
    },
    scene: {
      cloudOne: ref("Terrain/Decorations/Clouds/Clouds_01.png"),
      cloudTwo: ref("Terrain/Decorations/Clouds/Clouds_02.png"),
      cloudThree: ref("Terrain/Decorations/Clouds/Clouds_05.png"),
      bridge: ref("Terrain/Bridge/Bridge_All.png"),
      foam: ref("Terrain/Water/Foam/Foam.png"),
      houseOne: ref("Buildings/Blue Buildings/House1.png"),
      houseThree: ref("Buildings/Blue Buildings/House3.png"),
      tower: ref("Buildings/Blue Buildings/Tower.png"),
      castle: ref("Buildings/Blue Buildings/Castle.png"),
      treeThree: ref("Terrain/Resources/Wood/Trees/Tree3.png"),
      treeFour: ref("Terrain/Resources/Wood/Trees/Tree4.png"),
      rockTwo: ref("Terrain/Decorations/Rocks/Rock2.png"),
      bush: ref("Deco/09.png"),
      sign: ref("Deco/17.png"),
      fire: ref("Particle FX/Fire_01.png"),
      dust: ref("Particle FX/Dust_01.png"),
    },
  } as const;
}

export function clientCatalogJson(catalog: TinySwordsCatalogFile): string {
  const compact = {
    version: catalog.version,
    entries: catalog.entries.map((entry) => ({
      id: entry.id,
      sourcePath: entry.sourcePath,
      pack: entry.pack,
      domain: entry.domain,
      category: entry.category,
      tags: entry.tags,
      width: entry.width,
      height: entry.height,
      nature: entry.nature,
      ...(entry.frame ? { frame: entry.frame } : {}),
      classification: entry.classification,
      ...(entry.editor ? { editor: entry.editor } : {}),
    })),
  };
  return `${JSON.stringify(compact)}\n`;
}

export function generatedSharedSource(catalog: TinySwordsCatalogFile): string {
  const definitions = editorDefinitions(catalog);
  const selectedUi = uiAssets(catalog);
  return `/* Generated by scripts/build-tiny-swords-catalog.ts. Run npm run catalog:build. */\nimport type { EditorAssetDefinition } from "./tiny-swords-catalog.js";\n\nexport const GENERATED_EDITOR_ASSETS = ${JSON.stringify(definitions, null, 2)} as const satisfies readonly EditorAssetDefinition[];\n\nexport const GENERATED_TINY_SWORDS_UI_ASSETS = ${JSON.stringify(selectedUi, null, 2)} as const;\n`;
}

export function sourceCatalogJson(catalog: TinySwordsCatalogFile): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

export function coverageReportMarkdown(
  catalog: TinySwordsCatalogFile,
  report: CatalogReport,
): string {
  const ignored = catalog.entries.filter((entry) => entry.classification.status === "ignored");
  const ignoredRows = ignored.map((entry) => {
    const reason = entry.classification.status === "ignored" ? entry.classification.reason : "";
    return `| \`${entry.id}\` | \`${entry.sourcePath}\` | ${reason} |`;
  });
  const unclassified =
    report.unclassified.length === 0
      ? "None."
      : report.unclassified.map((sourcePath) => `- \`${sourcePath}\``).join("\n");
  return `# Tiny Swords catalogue coverage\n\nGenerated by \`npm run catalog:build\`. Do not edit this report by hand.\n\n| Metric | Count |\n| --- | ---: |\n| Raw PNGs indexed | ${report.raw} |\n| Catalogued for a semantic role | ${report.catalogued} |\n| UI PNGs covered | ${report.ui} |\n| Assets available in the editor | ${report.editor} |\n| Explicitly ignored | ${report.ignored} |\n| Unclassified | ${report.unclassified.length} |\n\n## Explicitly ignored\n\n| Stable id | Source | Reason |\n| --- | --- | --- |\n${ignoredRows.join("\n")}\n\n## Unclassified entries\n\n${unclassified}\n`;
}
