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

/**
 * UX wave #13: the rigorously-tested subset of the catalogue an author may PLACE from the editor
 * palette — exactly one bush, one tree, and the two functional wood bridges (load-bearing water
 * crossings, the only assets carrying `terrainOverride: "walkable"`). The tree and bush chosen are the
 * ones the test/fixture harnesses already exercise most. Every other catalogue asset is hidden from
 * the palette until it, too, is tested rigorously.
 *
 * This gates AUTHORING only, never RENDERING: `editorAsset` / `EDITOR_ASSET_BY_ID` still resolve every
 * definition, so a stored map that already references a non-curated asset (older content, fixtures)
 * keeps drawing exactly as before. Narrowing what the palette OFFERS must never narrow what the
 * renderer can SHOW.
 */
export const CURATED_EDITOR_ASSET_IDS = [
  "resource.terrain-resources-wood-trees.tree3",
  "decoration.terrain-decorations-bushes.bushe1",
  "terrain.bridge.wood.horizontal",
  "terrain.bridge.wood.vertical",
] as const;

const CURATED_EDITOR_ASSET_ID_SET: ReadonlySet<string> = new Set(CURATED_EDITOR_ASSET_IDS);

/** The curated allowlist as full definitions, in catalogue order — the palette decor grid's source. */
export const CURATED_EDITOR_ASSETS: readonly EditorAssetDefinition[] = EDITOR_ASSETS.filter(
  (asset) => CURATED_EDITOR_ASSET_ID_SET.has(asset.id),
);

/** Whether an asset id is on the curated authoring allowlist (rendering is never gated by this). */
export function isCuratedEditorAssetId(value: unknown): value is EditorAssetId {
  return typeof value === "string" && CURATED_EDITOR_ASSET_ID_SET.has(value);
}

export const TINY_SWORDS_UI = GENERATED_TINY_SWORDS_UI_ASSETS;
