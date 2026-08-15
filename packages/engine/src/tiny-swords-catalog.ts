import type { PrimaryColor } from "./character.js";
import type { Rect } from "./game.js";
import {
  GENERATED_EDITOR_ASSETS,
  GENERATED_TINY_SWORDS_UI_ASSETS,
} from "./tiny-swords-catalog.generated.js";

export const TINY_SWORDS_PACKS = [
  "Tiny Swords (Free Pack)",
  "Tiny Swords (Update 010)",
  "Tiny Swords (Enemy Pack)",
  "LindoCara Lab",
] as const;

export type TinySwordsPack = (typeof TINY_SWORDS_PACKS)[number];

export const ASSET_DOMAINS = [
  "ui",
  "terrain",
  "building",
  "decoration",
  "resource",
  "character",
  "enemy",
  "effect",
  "reference",
] as const;

export type AssetDomain = (typeof ASSET_DOMAINS)[number];
export type AssetNature = "static" | "animated" | "sheet";
export type AnimationAxis = "x" | "y";
export type EditorTerrain = "grass" | "water";
export type EditorRenderLayer = "ground" | "object" | "canopy" | "sky";

export interface AssetFrameMetadata {
  width: number;
  height: number;
  count: number;
  axis: AnimationAxis;
  durationMs: number;
}

export interface AssetAnchor {
  x: number;
  y: number;
}

export interface AssetSourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CellOffset {
  col: number;
  row: number;
}

export interface EditorPlacementMetadata {
  category: string;
  allowedTerrain: readonly EditorTerrain[];
  renderLayer: EditorRenderLayer;
  visualFootprint: readonly CellOffset[];
  /**
   * Sub-cell collision, in pixels relative to the sprite's VISIBLE FOOT — `col*64 + 32`
   * horizontally, `(row+1)*64` vertically. So `y` is negative: the collider rises from the ground
   * line the art stands on.
   *
   * Deliberately NOT the sprite container's position. `createCatalogElementView` places the
   * container at `(row+1)*64 + footOffset`, and `footOffset` is `frameHeight - alphaBboxBottom`, so
   * it cancels: the visible pixels always end exactly on the cell's bottom edge and the container
   * point sits `footOffset` px BELOW them. Authoring against the container would make every value
   * `footOffset`-dependent and would put a tree's collider in the empty cell south of the tree.
   *
   * Absent means the asset does not collide at all — the correct value for bushes, flowers and any
   * pure decoration. This replaces `collisionFootprint`: a whole-cell footprint was the only shape
   * expressible before, and it made every tree block a 64x64 square you could see straight through.
   */
  collider?: Rect;
  /** A bridge can replace solid water with walkable ground under its authored deck. */
  terrainOverride?: "walkable";
  sourceRect?: AssetSourceRect;
}

/**
 * Alternate animation art for one editor appearance. It deliberately carries its own geometry:
 * Tiny Swords idle and run sheets do not always have the same frame count or foot padding.
 */
export interface EditorAssetMotionDefinition {
  sourcePath: string;
  frame: AssetFrameMetadata;
  anchor: AssetAnchor;
  footOffset: number;
}

export interface EditorAssetDefinition {
  id: string;
  sourcePath: string;
  pack: TinySwordsPack;
  domain: AssetDomain;
  category: string;
  role: string;
  tags: readonly string[];
  width: number;
  height: number;
  nature: AssetNature;
  frame?: AssetFrameMetadata;
  anchor: AssetAnchor;
  footOffset: number;
  motions?: {
    run?: EditorAssetMotionDefinition;
    attack?: EditorAssetMotionDefinition;
  };
  editor: EditorPlacementMetadata;
}

export interface UiSliceThree {
  type: "three";
  left: number;
  right: number;
}

export interface UiSliceNine {
  type: "nine";
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type UiSlice = UiSliceThree | UiSliceNine;

export interface CursorHotspot {
  x: number;
  y: number;
}

export interface CataloguedAssetClassification {
  status: "catalogued";
  role: string;
}

export interface IgnoredAssetClassification {
  status: "ignored";
  reason: string;
}

export type AssetClassification = CataloguedAssetClassification | IgnoredAssetClassification;

export interface TinySwordsCatalogEntry {
  id: string;
  sourcePath: string;
  pack: TinySwordsPack;
  domain: AssetDomain;
  category: string;
  tags: string[];
  width: number;
  height: number;
  nature: AssetNature;
  frame?: AssetFrameMetadata;
  anchor: AssetAnchor;
  footOffset: number;
  classification: AssetClassification;
  ui?: {
    family: string;
    state?: "normal" | "hover" | "pressed" | "disabled";
    slice?: UiSlice;
    hotspot?: CursorHotspot;
    componentOf?: string;
  };
  editor?: EditorPlacementMetadata;
}

export interface TinySwordsCatalogFile {
  version: 1;
  generatedFrom: "assets/index.json";
  entries: TinySwordsCatalogEntry[];
}

export interface CatalogAssetRef {
  id: string;
  sourcePath: string;
  hotspot?: CursorHotspot;
  slice?: UiSlice;
}

export const LINDOCARA_CAMPFIRE_ASSET_ID = "decoration.lindocara-lab.campfire" as const;
export const LINDOCARA_CHEST_CLOSED_ASSET_ID = "resource.lindocara-lab.chest-closed" as const;
export const LINDOCARA_CHEST_OPEN_ASSET_ID = "resource.lindocara-lab.chest-open" as const;
export const LINDOCARA_BUILDING_ASSET_IDS = {
  house: "building.lindocara.house",
  stoneTower: "building.lindocara.stone-tower",
  archeryGuild: "building.lindocara.archery-guild",
  barracks: "building.lindocara.barracks",
  windmill: "building.lindocara.windmill",
} as const;
const LINDOCARA_BUILDING_ASSET_ID_SET: ReadonlySet<string> = new Set(
  Object.values(LINDOCARA_BUILDING_ASSET_IDS),
);
export const LINDOCARA_INTERIOR_ASSET_IDS = {
  hearth: "decoration.lindocara-interior.hearth",
  bed: "decoration.lindocara-interior.bed",
  table: "decoration.lindocara-interior.table",
  cupboard: "decoration.lindocara-interior.cupboard",
  rug: "decoration.lindocara-interior.rug",
} as const;

function lindocaraBuilding<const Id extends string>(
  id: Id,
  sourcePath: string,
  tags: readonly string[],
  width: number,
  height: number,
  visualFootprint: readonly CellOffset[],
  collider: Rect,
) {
  return {
    id,
    sourcePath,
    pack: "LindoCara Lab",
    domain: "building",
    category: "Lindocara/Buildings",
    role: "world-building",
    tags: ["building", "generated", "hd2d", ...tags],
    width,
    height,
    nature: "static",
    anchor: { x: 0.5, y: 1 },
    footOffset: 0,
    editor: {
      category: "buildings",
      allowedTerrain: ["grass", "water"],
      renderLayer: "object",
      visualFootprint,
      collider,
    },
  } as const satisfies EditorAssetDefinition;
}

function lindocaraInteriorProp<const Id extends string>(
  id: Id,
  file: string,
  width: number,
  height: number,
  collider?: Rect,
) {
  return {
    id,
    sourcePath: `/assets/lindocara/hd2d/interiors/${file}`,
    pack: "LindoCara Lab",
    domain: "decoration",
    category: "Lindocara/Interiors",
    role: "interior-decoration",
    tags: ["interior", "generated", "furniture"],
    width,
    height,
    nature: "static",
    anchor: { x: 0.5, y: 1 },
    footOffset: 0,
    editor: {
      category: "interior-furniture",
      allowedTerrain: ["grass", "water"],
      renderLayer: "object",
      visualFootprint: [{ col: 0, row: 0 }],
      ...(collider ? { collider } : {}),
    },
  } as const satisfies EditorAssetDefinition;
}

const LINDOCARA_LAB_EDITOR_ASSETS = [
  {
    id: LINDOCARA_CAMPFIRE_ASSET_ID,
    sourcePath: "/assets/lindocara/hd2d/campfire-base.png",
    pack: "LindoCara Lab",
    domain: "decoration",
    category: "Lab/Props",
    role: "world-decoration",
    tags: ["campfire", "fire", "animated", "lab"],
    width: 57,
    height: 66,
    nature: "animated",
    anchor: { x: 0.5, y: 1 },
    footOffset: 0,
    editor: {
      category: "camp-and-treasure",
      allowedTerrain: ["grass", "water"],
      renderLayer: "object",
      visualFootprint: [{ col: 0, row: 0 }],
      collider: { x: -29, y: -29, width: 58, height: 58 },
    },
  },
  {
    id: LINDOCARA_CHEST_CLOSED_ASSET_ID,
    sourcePath: "/assets/lindocara/hd2d/chest-closed.png",
    pack: "LindoCara Lab",
    domain: "resource",
    category: "Lab/Props",
    role: "world-resource",
    tags: ["chest", "treasure", "closed", "lab"],
    width: 80,
    height: 80,
    nature: "static",
    anchor: { x: 0.5, y: 1 },
    footOffset: 2,
    editor: {
      category: "camp-and-treasure",
      allowedTerrain: ["grass", "water"],
      renderLayer: "object",
      visualFootprint: [{ col: 0, row: 0 }],
      collider: { x: -27, y: -54, width: 54, height: 54 },
    },
  },
  {
    id: LINDOCARA_CHEST_OPEN_ASSET_ID,
    sourcePath: "/assets/lindocara/hd2d/chest-open.png",
    pack: "LindoCara Lab",
    domain: "resource",
    category: "Lab/Props",
    role: "event-state",
    tags: ["chest", "treasure", "open", "lab"],
    width: 80,
    height: 80,
    nature: "static",
    anchor: { x: 0.5, y: 1 },
    footOffset: 2,
    editor: {
      category: "camp-and-treasure",
      allowedTerrain: ["grass", "water"],
      renderLayer: "object",
      visualFootprint: [{ col: 0, row: 0 }],
      collider: { x: -27, y: -54, width: 54, height: 54 },
    },
  },
  lindocaraBuilding(
    LINDOCARA_BUILDING_ASSET_IDS.house,
    "/assets/lindocara/hd2d/buildings/house-front.png",
    ["house", "habitable"],
    203,
    194,
    [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => ({ col, row }))),
    { x: -80, y: -112, width: 160, height: 112 },
  ),
  lindocaraBuilding(
    LINDOCARA_BUILDING_ASSET_IDS.stoneTower,
    "/assets/lindocara/hd2d/buildings/tower-front.png",
    ["tower", "stone", "habitable"],
    108,
    258,
    [-1, 0].flatMap((row) => [-1, 0].map((col) => ({ col, row }))),
    { x: -54, y: -88, width: 108, height: 88 },
  ),
  lindocaraBuilding(
    LINDOCARA_BUILDING_ASSET_IDS.archeryGuild,
    "/assets/lindocara/hd2d/buildings/archery-front.png",
    ["archery", "guild", "habitable"],
    209,
    210,
    [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => ({ col, row }))),
    { x: -88, y: -112, width: 176, height: 112 },
  ),
  lindocaraBuilding(
    LINDOCARA_BUILDING_ASSET_IDS.barracks,
    "/assets/lindocara/hd2d/buildings/barracks-front.png",
    ["barracks", "habitable"],
    209,
    226,
    [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => ({ col, row }))),
    { x: -92, y: -120, width: 184, height: 120 },
  ),
  lindocaraBuilding(
    LINDOCARA_BUILDING_ASSET_IDS.windmill,
    "/assets/lindocara/hd2d/buildings/tower-front.png",
    ["tower", "windmill", "mill", "habitable"],
    192,
    258,
    [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => ({ col, row }))),
    { x: -64, y: -96, width: 128, height: 96 },
  ),
  lindocaraInteriorProp(LINDOCARA_INTERIOR_ASSET_IDS.hearth, "hearth.png", 80, 94, {
    x: -34,
    y: -46,
    width: 68,
    height: 46,
  }),
  lindocaraInteriorProp(LINDOCARA_INTERIOR_ASSET_IDS.bed, "bed.png", 70, 60, {
    x: -34,
    y: -48,
    width: 68,
    height: 48,
  }),
  lindocaraInteriorProp(LINDOCARA_INTERIOR_ASSET_IDS.table, "table.png", 58, 54, {
    x: -25,
    y: -35,
    width: 50,
    height: 35,
  }),
  lindocaraInteriorProp(LINDOCARA_INTERIOR_ASSET_IDS.cupboard, "cupboard.png", 49, 78, {
    x: -23,
    y: -32,
    width: 46,
    height: 32,
  }),
  lindocaraInteriorProp(LINDOCARA_INTERIOR_ASSET_IDS.rug, "rug.png", 98, 99),
] as const satisfies readonly EditorAssetDefinition[];

export const EDITOR_ASSETS = [...GENERATED_EDITOR_ASSETS, ...LINDOCARA_LAB_EDITOR_ASSETS] as const;
export type EditorAssetId = (typeof EDITOR_ASSETS)[number]["id"];

const EDITOR_ASSET_BY_ID = new Map<string, EditorAssetDefinition>(
  EDITOR_ASSETS.map((asset) => [asset.id, asset]),
);

export function isEditorAssetId(value: unknown): value is EditorAssetId {
  return typeof value === "string" && EDITOR_ASSET_BY_ID.has(value);
}

export function editorAsset(value: string): EditorAssetDefinition | null {
  return EDITOR_ASSET_BY_ID.get(value) ?? null;
}

/** Historical focused-test subset retained for fixture compatibility. It no longer gates the
 * authoring palettes; those use `PLACEABLE_EDITOR_ASSETS` and `EVENT_GRAPHIC_ASSETS` below. */
export const CURATED_EDITOR_ASSET_IDS = [
  "resource.terrain-resources-wood-trees.tree3",
  "decoration.terrain-decorations-bushes.bushe1",
  "terrain.bridge.wood.horizontal",
  "terrain.bridge.wood.vertical",
] as const;

const CURATED_EDITOR_ASSET_ID_SET: ReadonlySet<string> = new Set(CURATED_EDITOR_ASSET_IDS);

/** Historical focused-test definitions in catalogue order. */
export const CURATED_EDITOR_ASSETS: readonly EditorAssetDefinition[] = EDITOR_ASSETS.filter(
  (asset) => CURATED_EDITOR_ASSET_ID_SET.has(asset.id),
);

function effectiveAssetSize(asset: EditorAssetDefinition): { width: number; height: number } {
  const crop = asset.editor.sourceRect;
  return {
    width: crop?.width ?? asset.frame?.width ?? asset.width,
    height: crop?.height ?? asset.frame?.height ?? asset.height,
  };
}

/**
 * Update 010 stores one six-frame tree animation as six crop-shaped catalogue identities. Keep the
 * old identities resolvable for saved maps, but offer only the first/canonical identity for new
 * scenery placement so the editor does not show the same tree six times.
 */
const DUPLICATE_EDITOR_ASSET_IDS: ReadonlySet<string> = new Set([
  "resource.resources-trees.tree-2",
  "resource.resources-trees.tree-3",
  "resource.resources-trees.tree-4",
  "resource.resources-trees.tree-5",
  "resource.resources-trees.tree-6",
  // Shadow/no-shadow files are the same prop; the shadowed source is the canonical HD-2D entry.
  "resource.resources-resources.g-idle-noshadow",
  "resource.resources-resources.m-idle-noshadow",
  "resource.resources-resources.w-idle-noshadow",
  // Free-pack water rocks already expose the same four silhouettes as smoother 16-frame strips.
  "terrain.terrain-water-rocks.rocks-01",
  "terrain.terrain-water-rocks.rocks-02",
  "terrain.terrain-water-rocks.rocks-03",
  "terrain.terrain-water-rocks.rocks-04",
]);

/** Palette-safe scenery. Technical source sheets stay resolvable for old maps but are not offered
 * as placeable objects; an author sees only individually cropped props with bounded footprints. */
export const PLACEABLE_EDITOR_ASSETS: readonly EditorAssetDefinition[] = EDITOR_ASSETS.filter(
  (asset) => {
    if (DUPLICATE_EDITOR_ASSET_IDS.has(asset.id)) return false;
    if (asset.role === "event-state") return false;
    if (asset.domain === "character" || asset.domain === "enemy") return false;
    // Legacy Tiny Swords building ids stay readable for every saved map, but new authoring uses the
    // five coherent Lindocara volumes. That is a storage-compatible replacement, not 62 recoloured
    // cards followed by the actual production buildings on the last palette page.
    if (asset.editor.category === "buildings" && !LINDOCARA_BUILDING_ASSET_ID_SET.has(asset.id)) {
      return false;
    }
    // Raw tilemaps/foam/shadow stay automatic terrain sources, but the pack's dedicated animated
    // water rocks carry explicit placement metadata and are authored offshore decorations.
    if (asset.role === "terrain-source" && asset.editor.category !== "water-decor") return false;
    const { width, height } = effectiveAssetSize(asset);
    const maxWidth = asset.editor.renderLayer === "sky" ? 576 : 384;
    return width <= maxWidth && height <= 384 && asset.editor.visualFootprint.length <= 36;
  },
);

/** Event appearances include palette-safe scenery plus cropped idle NPC/creature sprites. */
export const EVENT_GRAPHIC_ASSETS: readonly EditorAssetDefinition[] = EDITOR_ASSETS.filter(
  (asset) =>
    PLACEABLE_EDITOR_ASSETS.includes(asset) ||
    asset.role === "event-state" ||
    asset.domain === "character" ||
    asset.domain === "enemy",
);

/** Complete catalogue-backed actor palette for free NPCs: every character and enemy animation,
 * including hero classes, workers carrying resources, villagers and creatures. */
export const NPC_CHARACTER_ASSETS: readonly EditorAssetDefinition[] = EDITOR_ASSETS.filter(
  (asset) => asset.domain === "character" || asset.domain === "enemy",
);

/**
 * Actual actor MODELS offered to free NPC authoring. Idle sheets represent every Free/Enemy Pack
 * model and native colour/resource variant; a paired run sheet is linked when the pack provides one.
 * Update 010 instead ships one combined sheet per coloured troop, so those canonical troop sheets
 * are included explicitly while component layers (bows, arrows, detached arms) are not presented as
 * characters.
 */
export const NPC_MODEL_ASSETS: readonly EditorAssetDefinition[] = NPC_CHARACTER_ASSETS.filter(
  (asset) =>
    asset.motions?.run !== undefined ||
    asset.tags.includes("idle") ||
    /\/Factions\/Knights\/Troops\/(?:Archer|Pawn|Warrior)\/(?:Blue|Purple|Red|Yellow)\/[^/]+\.png$/i.test(
      asset.sourcePath,
    ),
);

const GUARD_ASSET_BY_COLOR: Readonly<Record<PrimaryColor, EditorAssetId>> = {
  azure: "character.units-blue-units-warrior.warrior-idle",
  ember: "character.units-red-units-warrior.warrior-idle",
  moss: "character.units-yellow-units-warrior.warrior-idle",
  violet: "character.units-purple-units-warrior.warrior-idle",
};

const GUARD_COLOR_BY_ASSET = new Map<string, PrimaryColor>(
  Object.entries(GUARD_ASSET_BY_COLOR).map(([color, assetId]) => [assetId, color as PrimaryColor]),
);

/** Four native Tiny Swords guard recolours, not artificial sprite tinting. */
export const GUARD_APPEARANCE_ASSETS: readonly EditorAssetDefinition[] = Object.values(
  GUARD_ASSET_BY_COLOR,
).flatMap((assetId) => {
  const asset = editorAsset(assetId);
  return asset ? [asset] : [];
});

export const DEFAULT_NPC_MODEL_ASSET_ID =
  "character.units-blue-units-pawn.pawn-idle" as EditorAssetId;
export const DEFAULT_GUARD_APPEARANCE_ASSET_ID = GUARD_ASSET_BY_COLOR.moss;
export const DEFAULT_MONSTER_APPEARANCE_ASSET_ID =
  "enemy.enemy-pack-enemies-goblin-raiders-spear-goblin.spear-goblin-idle" as EditorAssetId;

export function isGuardAppearanceAssetId(value: unknown): value is EditorAssetId {
  return typeof value === "string" && GUARD_COLOR_BY_ASSET.has(value);
}

/** Maps an authored native guard sheet back to the renderer's semantic colour. */
export function guardPrimaryColorForAsset(assetId: string | null | undefined): PrimaryColor {
  return (assetId && GUARD_COLOR_BY_ASSET.get(assetId)) || "moss";
}

/** Whether an asset id belongs to the historical focused-test subset. */
export function isCuratedEditorAssetId(value: unknown): value is EditorAssetId {
  return typeof value === "string" && CURATED_EDITOR_ASSET_ID_SET.has(value);
}

export const TINY_SWORDS_UI = GENERATED_TINY_SWORDS_UI_ASSETS;
