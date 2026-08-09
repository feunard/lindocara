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

export const EDITOR_ASSETS = GENERATED_EDITOR_ASSETS;
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

/** Palette-safe scenery. Technical source sheets stay resolvable for old maps but are not offered
 * as placeable objects; an author sees only individually cropped props with bounded footprints. */
export const PLACEABLE_EDITOR_ASSETS: readonly EditorAssetDefinition[] = EDITOR_ASSETS.filter(
  (asset) => {
    if (asset.domain === "character" || asset.domain === "enemy") return false;
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
