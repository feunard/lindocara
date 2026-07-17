import {
  GENERATED_EDITOR_ASSETS,
  GENERATED_TINY_SWORDS_UI_IDS,
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
export type EditorRenderLayer = "ground" | "object" | "canopy";

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
  collisionFootprint: readonly CellOffset[];
  /** A bridge can replace solid water with walkable ground under its authored deck. */
  terrainOverride?: "walkable";
  sourceRect?: AssetSourceRect;
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

export const TINY_SWORDS_UI_IDS = GENERATED_TINY_SWORDS_UI_IDS;
