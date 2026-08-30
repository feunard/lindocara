import { BRIDGE_ASSET_IDS } from "./bridges.js";
import type { PrimaryColor } from "./character.js";
import { FACTION_BUILDING_MODELS } from "./faction-buildings.js";
import type { Rect } from "./game.js";
import {
  GENERATED_EDITOR_ASSETS,
  GENERATED_TINY_SWORDS_UI_ASSETS,
} from "./generated/tiny-swords-catalog.js";

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
/** Number of authored terrain levels occupied by one solid scenery volume. */
export type CollisionElevation = 1 | 2 | 3;

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
  /**
   * Height of the solid volume, in authored terrain levels. A finite collision elevation makes
   * its upper face a real movement surface: a hero may clear it in the air and land on it.
   */
  collisionElevation?: CollisionElevation;
  /** A bridge can replace solid water with walkable ground under its authored deck. */
  terrainOverride?: "walkable";
  sourceRect?: AssetSourceRect;
  /** Native world-space footprint for fixed 3D scenery. The authored point is the centre of the
   * front edge, matching buildings, so every future native prop inherits the same rotation and
   * proportional-resize tools without an asset-specific editor branch. */
  native3d?: { readonly width: number; readonly depth: number };
  /** Vertical card authored against a wall. Unlike an ordinary billboard it keeps its world
   * orientation while the camera orbits, and therefore exposes the rotation control. */
  wallMounted?: boolean;
  /** Authored cave/castle shell. The collider compiler and native renderer share these dimensions;
   * a ceiling is a raised slab, while a wall rises from the terrain. */
  architecturalVolume?: {
    readonly kind: "wall" | "ceiling";
    readonly style: "cave" | "castle" | "timber";
    readonly height?: number;
    readonly clearance?: number;
    readonly thickness?: number;
  };
  /** Explicit for every authored 3D placeable introduced outside the building state machine. */
  destructibility?: "indestructible" | "destructible";
  /** Optional creator-facing grouping for authored architecture. Legacy assets omit it. */
  buildingFaction?: "human" | "goblin" | "orc-troll" | "beastfolk" | "wild-tribe";
  /** Function inside a faction pack; used only to organize authoring, never as a gameplay rule. */
  buildingPurpose?: "housing" | "command" | "training" | "community" | "daily-life";
  /** Two visibly different models are shipped for every faction/purpose pair. */
  buildingVariant?: "a" | "b";
  /** Creator-facing faction bucket for props that are not buildings. */
  editorFaction?: "general" | "goblin" | "orc-troll" | "beastfolk" | "wild-tribe";
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
  monastery: "building.lindocara.monastery",
  castle: "building.lindocara.castle",
  windmill: "building.lindocara.windmill",
} as const;
const LINDOCARA_BUILDING_ASSET_ID_SET: ReadonlySet<string> = new Set([
  ...Object.values(LINDOCARA_BUILDING_ASSET_IDS),
  ...FACTION_BUILDING_MODELS.map(({ id }) => id),
]);
export const LINDOCARA_INTERIOR_ASSET_IDS = {
  hearth: "decoration.lindocara-interior.hearth",
  bed: "decoration.lindocara-interior.bed",
  table: "decoration.lindocara-interior.table",
  cupboard: "decoration.lindocara-interior.cupboard",
  rug: "decoration.lindocara-interior.rug",
  doubleBed: "decoration.lindocara-interior.double-bed",
  wardrobe: "decoration.lindocara-interior.wardrobe",
  diningTable: "decoration.lindocara-interior.dining-table",
  chair: "decoration.lindocara-interior.chair",
  sofa: "decoration.lindocara-interior.sofa",
  coffeeTable: "decoration.lindocara-interior.coffee-table",
  bar: "decoration.lindocara-interior.bar",
  fireplace: "decoration.lindocara-interior.fireplace",
  wallTapestry: "decoration.lindocara-interior.wall-tapestry",
  oilLampTable: "decoration.lindocara-interior.oil-lamp-table",
  oilLampWall: "decoration.lindocara-interior.oil-lamp-wall",
  torchFloor: "decoration.lindocara-interior.torch-floor",
  torchWall: "decoration.lindocara-interior.torch-wall",
  doorTimber: "decoration.lindocara-interior.door-timber",
  doorStone: "decoration.lindocara-interior.door-stone",
} as const;
export const LINDOCARA_RUNNER_ASSET_IDS = {
  spikeTrap: "decoration.lindocara-runner.spike-trap",
  pushTrap: "decoration.lindocara-runner.push-trap",
  launchTrap: "decoration.lindocara-runner.launch-trap",
  barricade: "decoration.lindocara-runner.barricade",
  goblinBarricade: "decoration.lindocara-runner.goblin-barricade",
  orcBarricade: "decoration.lindocara-runner.orc-barricade",
} as const;
export const LINDOCARA_STRUCTURE_ASSET_IDS = {
  caveWall: "building.lindocara-structure.cave-wall",
  castleWall: "building.lindocara-structure.castle-wall",
  timberWall: "building.lindocara-structure.timber-wall",
  caveCeiling: "building.lindocara-structure.cave-ceiling",
  castleCeiling: "building.lindocara-structure.castle-ceiling",
  timberCeiling: "building.lindocara-structure.timber-ceiling",
} as const;
export const LINDOCARA_PICKUP_ASSET_IDS = {
  speed_boost: "resource.lindocara-pickup.speed-boost",
  light_gravity: "resource.lindocara-pickup.light-gravity",
  double_jump: "resource.lindocara-pickup.double-jump",
  speed_slow: "resource.lindocara-pickup.speed-slow",
  heavy_gravity: "resource.lindocara-pickup.heavy-gravity",
  inverted_controls: "resource.lindocara-pickup.inverted-controls",
} as const;
/** Presentation fallback shared by authoring presets and the live renderer. */
export const LINDOCARA_PICKUP_FLOAT_HEIGHT = 0.55;

/**
 * Removed runner art, accepted only while old authored maps are migrated to their species model.
 */
export const RETIRED_RUNNER_HOUND_ASSET_ID = "enemy.lindocara-runner.nightmare-hound" as const;

function lindocaraBuilding<const Id extends string>(
  id: Id,
  sourcePath: string,
  tags: readonly string[],
  width: number,
  height: number,
  visualFootprint: readonly CellOffset[],
  collider: Rect,
  collisionElevation: CollisionElevation,
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
      collisionElevation,
    },
  } as const satisfies EditorAssetDefinition;
}

function centredFootprint(width: number, depth: number): CellOffset[] {
  const columns = Math.ceil(width);
  const rows = Math.ceil(depth);
  const firstColumn = -Math.floor(columns / 2);
  const firstRow = -Math.floor(rows / 2);
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, col) => ({
      col: firstColumn + col,
      row: firstRow + row,
    })),
  ).flat();
}

function lindocaraFactionBuilding(model: (typeof FACTION_BUILDING_MODELS)[number]) {
  const goblinHouse =
    "Tiny Swords (Update 010)/Factions/Goblins/Buildings/Wood_House/Goblin_House.png";
  const goblinTower =
    "Tiny Swords (Update 010)/Factions/Goblins/Buildings/Wood_Tower/Wood_Tower_Red.png";
  const orcRootHall = "Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Root Troll/Dead Tree.png";
  const beastfolkGnoll = "Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Gnoll/Gnoll_Idle.png";
  const wildCave = "Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Caveborn/Cave/Cave_Idle.png";
  const usesGoblinSprite = model.faction === "goblin";
  const usesGoblinTower = usesGoblinSprite && model.variant === "b";
  const usesOrcSprite = model.faction === "orc-troll";
  const usesBeastfolkSprite = model.faction === "beastfolk";
  const usesWildSprite = model.faction === "wild-tribe";
  return {
    id: model.id,
    // Finished faction packs use their own shipped Tiny Swords art for palette previews and for
    // the material source sampled by their native volumes. Packs not rebuilt yet keep a temporary
    // preview until they receive the same from-scratch treatment.
    sourcePath: usesWildSprite
      ? wildCave
      : usesBeastfolkSprite
        ? beastfolkGnoll
        : usesOrcSprite
          ? orcRootHall
          : usesGoblinTower
            ? goblinTower
            : goblinHouse,
    pack: "LindoCara Lab",
    domain: "building",
    category: `Lindocara/Buildings/${model.faction}`,
    role: "world-building",
    tags: [
      "building",
      "generated",
      "hd2d",
      "habitable",
      model.faction,
      model.purpose,
      `variant-${model.variant}`,
    ],
    width: usesWildSprite
      ? 1536
      : usesBeastfolkSprite
        ? 1152
        : usesOrcSprite
          ? 384
          : usesGoblinTower
            ? 1024
            : 128,
    height: usesWildSprite ? 192 : usesBeastfolkSprite ? 128 : usesOrcSprite ? 320 : 192,
    nature: "static",
    anchor: { x: 0.5, y: 1 },
    footOffset: 0,
    editor: {
      category: "buildings",
      allowedTerrain: ["grass", "water"],
      renderLayer: "object",
      ...(usesBeastfolkSprite ? { sourceRect: { x: 0, y: 0, width: 192, height: 128 } } : {}),
      ...(usesWildSprite ? { sourceRect: { x: 0, y: 0, width: 192, height: 192 } } : {}),
      ...(usesGoblinTower ? { sourceRect: { x: 0, y: 0, width: 256, height: 192 } } : {}),
      visualFootprint: centredFootprint(model.width, model.depth),
      collider: {
        x: (-model.width * 64) / 2,
        y: -model.depth * 64,
        width: model.width * 64,
        height: model.depth * 64,
      },
      collisionElevation: model.collisionElevation,
      buildingFaction: model.faction,
      buildingPurpose: model.purpose,
      buildingVariant: model.variant,
    },
  } as const satisfies EditorAssetDefinition;
}

function lindocaraInteriorProp<const Id extends string>(
  id: Id,
  file: string,
  width: number,
  height: number,
  collider?: Rect,
  options: { wallMounted?: boolean; tags?: readonly string[] } = {},
) {
  return {
    id,
    sourcePath: `/assets/lindocara/hd2d/interiors/${file}`,
    pack: "LindoCara Lab",
    domain: "decoration",
    category: "Lindocara/Interiors",
    role: "interior-decoration",
    tags: ["interior", "generated", "furniture", ...(options.tags ?? [])],
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
      ...(options.wallMounted ? { wallMounted: true } : {}),
    },
  } as const satisfies EditorAssetDefinition;
}

function lindocaraPickup<const Id extends string>(id: Id, file: string, tags: readonly string[]) {
  return {
    id,
    sourcePath: `/assets/lindocara/hd2d/pickups/${file}`,
    pack: "LindoCara Lab",
    domain: "resource",
    category: "Lindocara/Pickups",
    role: "event-state",
    tags: ["pickup", "movement", "generated", "hd2d", ...tags],
    width: 192,
    height: 192,
    nature: "static",
    anchor: { x: 0.5, y: 1 },
    footOffset: 0,
    editor: {
      category: "runner",
      allowedTerrain: ["grass", "water"],
      renderLayer: "object",
      visualFootprint: [{ col: 0, row: 0 }],
    },
  } as const satisfies EditorAssetDefinition;
}

function lindocaraRunnerProp<const Id extends string>(options: {
  id: Id;
  file: "spike-trap.png" | "barricade.png";
  tags: readonly string[];
  width: number;
  height: number;
  renderLayer: EditorRenderLayer;
  visualFootprint: readonly CellOffset[];
  collider: Rect;
  collisionElevation: CollisionElevation;
  native3d: { readonly width: number; readonly depth: number };
  editorFaction: NonNullable<EditorPlacementMetadata["editorFaction"]>;
}) {
  return {
    id: options.id,
    sourcePath: `/assets/lindocara/hd2d/runner/${options.file}`,
    pack: "LindoCara Lab",
    domain: "decoration",
    category: "Lindocara/Runner",
    role: "world-obstacle",
    tags: ["runner", "generated", "hd2d", ...options.tags],
    width: options.width,
    height: options.height,
    nature: "static",
    anchor: { x: 0.5, y: 1 },
    footOffset: 0,
    editor: {
      category: "traps-and-defenses",
      allowedTerrain: ["grass"],
      renderLayer: options.renderLayer,
      visualFootprint: options.visualFootprint,
      collider: options.collider,
      collisionElevation: options.collisionElevation,
      native3d: options.native3d,
      editorFaction: options.editorFaction,
    },
  } as const satisfies EditorAssetDefinition;
}

function lindocaraStructure<const Id extends string>(options: {
  id: Id;
  style: "cave" | "castle" | "timber";
  kind: "wall" | "ceiling";
  native3d: { readonly width: number; readonly depth: number };
  height?: number;
  clearance?: number;
  thickness?: number;
}) {
  const preview =
    options.style === "timber"
      ? {
          sourcePath: "/assets/lindocara/hd2d/buildings/house-front.png",
          width: 199,
          height: 198,
        }
      : {
          sourcePath: `/assets/lindocara/hd2d/tileset-${options.style === "cave" ? "grotte" : "montagne"}.png`,
          width: 64,
          height: 64,
        };
  const { width, depth } = options.native3d;
  return {
    id: options.id,
    sourcePath: preview.sourcePath,
    pack: "LindoCara Lab",
    domain: "building",
    category: `Lindocara/Architecture/${options.style}`,
    role: "world-architecture",
    tags: ["architecture", "generated", "hd2d", options.style, options.kind, "indestructible"],
    width: preview.width,
    height: preview.height,
    nature: "static",
    anchor: { x: 0.5, y: 1 },
    footOffset: 0,
    editor: {
      category: "architecture",
      allowedTerrain: ["grass", "water"],
      renderLayer: "object",
      sourceRect: { x: 0, y: 0, width: preview.width, height: preview.height },
      visualFootprint: centredFootprint(width, depth),
      collider: {
        x: (-width * 64) / 2,
        y: -depth * 64,
        width: width * 64,
        height: depth * 64,
      },
      native3d: options.native3d,
      architecturalVolume: {
        kind: options.kind,
        style: options.style,
        ...(options.height === undefined ? {} : { height: options.height }),
        ...(options.clearance === undefined ? {} : { clearance: options.clearance }),
        ...(options.thickness === undefined ? {} : { thickness: options.thickness }),
      },
      destructibility: "indestructible",
    },
  } as const satisfies EditorAssetDefinition;
}

const LINDOCARA_LAB_EDITOR_ASSETS = [
  lindocaraPickup(LINDOCARA_PICKUP_ASSET_IDS.speed_boost, "speed-boost.png", ["buff", "speed"]),
  lindocaraPickup(LINDOCARA_PICKUP_ASSET_IDS.light_gravity, "light-gravity.png", [
    "buff",
    "gravity",
    "feather",
  ]),
  lindocaraPickup(LINDOCARA_PICKUP_ASSET_IDS.double_jump, "double-jump.png", ["buff", "jump"]),
  lindocaraPickup(LINDOCARA_PICKUP_ASSET_IDS.speed_slow, "speed-slow.png", ["debuff", "speed"]),
  lindocaraPickup(LINDOCARA_PICKUP_ASSET_IDS.heavy_gravity, "heavy-gravity.png", [
    "debuff",
    "gravity",
  ]),
  lindocaraPickup(LINDOCARA_PICKUP_ASSET_IDS.inverted_controls, "inverted-controls.png", [
    "debuff",
    "controls",
  ]),
  lindocaraRunnerProp({
    id: LINDOCARA_RUNNER_ASSET_IDS.spikeTrap,
    file: "spike-trap.png",
    tags: ["trap", "spikes"],
    width: 107,
    height: 94,
    renderLayer: "ground",
    visualFootprint: [{ col: 0, row: 0 }],
    collider: { x: -28, y: -38, width: 56, height: 38 },
    collisionElevation: 1,
    native3d: { width: 1.5, depth: 1.5 },
    editorFaction: "general",
  }),
  lindocaraRunnerProp({
    id: LINDOCARA_RUNNER_ASSET_IDS.pushTrap,
    file: "spike-trap.png",
    tags: ["trap", "push", "spring"],
    width: 112,
    height: 96,
    renderLayer: "ground",
    visualFootprint: [{ col: 0, row: 0 }],
    collider: { x: -34, y: -48, width: 68, height: 48 },
    collisionElevation: 1,
    native3d: { width: 1.75, depth: 1.5 },
    editorFaction: "general",
  }),
  lindocaraRunnerProp({
    id: LINDOCARA_RUNNER_ASSET_IDS.launchTrap,
    file: "spike-trap.png",
    tags: ["trap", "launch", "spring", "air"],
    width: 108,
    height: 96,
    renderLayer: "ground",
    visualFootprint: [{ col: 0, row: 0 }],
    collider: { x: -34, y: -48, width: 68, height: 48 },
    collisionElevation: 1,
    native3d: { width: 1.6, depth: 1.6 },
    editorFaction: "general",
  }),
  lindocaraRunnerProp({
    id: LINDOCARA_RUNNER_ASSET_IDS.barricade,
    file: "barricade.png",
    tags: ["obstacle", "barricade", "wood"],
    width: 136,
    height: 122,
    renderLayer: "object",
    visualFootprint: [
      { col: -1, row: 0 },
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    collider: { x: -58, y: -48, width: 116, height: 48 },
    collisionElevation: 2,
    native3d: { width: 2.75, depth: 1.125 },
    editorFaction: "general",
  }),
  lindocaraRunnerProp({
    id: LINDOCARA_RUNNER_ASSET_IDS.goblinBarricade,
    file: "barricade.png",
    tags: ["obstacle", "barricade", "goblin", "scrap"],
    width: 136,
    height: 92,
    renderLayer: "object",
    visualFootprint: [
      { col: -1, row: 0 },
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    collider: { x: -67, y: -45, width: 134, height: 45 },
    collisionElevation: 1,
    native3d: { width: 2.5, depth: 1.05 },
    editorFaction: "goblin",
  }),
  lindocaraRunnerProp({
    id: LINDOCARA_RUNNER_ASSET_IDS.orcBarricade,
    file: "barricade.png",
    tags: ["obstacle", "barricade", "orc", "troll", "fortified"],
    width: 166,
    height: 174,
    renderLayer: "object",
    visualFootprint: [
      { col: -1, row: 0 },
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    collider: { x: -88, y: -62, width: 176, height: 62 },
    collisionElevation: 3,
    native3d: { width: 3.25, depth: 1.45 },
    editorFaction: "orc-troll",
  }),
  lindocaraStructure({
    id: LINDOCARA_STRUCTURE_ASSET_IDS.caveWall,
    style: "cave",
    kind: "wall",
    native3d: { width: 3, depth: 0.8 },
    height: 2.7,
  }),
  lindocaraStructure({
    id: LINDOCARA_STRUCTURE_ASSET_IDS.castleWall,
    style: "castle",
    kind: "wall",
    native3d: { width: 3, depth: 0.75 },
    height: 2.8,
  }),
  lindocaraStructure({
    id: LINDOCARA_STRUCTURE_ASSET_IDS.timberWall,
    style: "timber",
    kind: "wall",
    native3d: { width: 3, depth: 0.65 },
    height: 2.55,
  }),
  lindocaraStructure({
    id: LINDOCARA_STRUCTURE_ASSET_IDS.caveCeiling,
    style: "cave",
    kind: "ceiling",
    native3d: { width: 3, depth: 3 },
    clearance: 1.35,
    thickness: 0.42,
  }),
  lindocaraStructure({
    id: LINDOCARA_STRUCTURE_ASSET_IDS.castleCeiling,
    style: "castle",
    kind: "ceiling",
    native3d: { width: 3, depth: 3 },
    clearance: 1.5,
    thickness: 0.34,
  }),
  lindocaraStructure({
    id: LINDOCARA_STRUCTURE_ASSET_IDS.timberCeiling,
    style: "timber",
    kind: "ceiling",
    native3d: { width: 3, depth: 3 },
    clearance: 1.45,
    thickness: 0.3,
  }),
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
    199,
    198,
    [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => ({ col, row }))),
    { x: -88, y: -136, width: 176, height: 136 },
    2,
  ),
  lindocaraBuilding(
    LINDOCARA_BUILDING_ASSET_IDS.stoneTower,
    "/assets/lindocara/hd2d/buildings/tower-front.png",
    ["tower", "stone", "habitable"],
    159,
    220,
    [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => ({ col, row }))),
    { x: -64, y: -128, width: 128, height: 128 },
    3,
  ),
  lindocaraBuilding(
    LINDOCARA_BUILDING_ASSET_IDS.archeryGuild,
    "/assets/lindocara/hd2d/buildings/archery-front.png",
    ["archery", "guild", "habitable"],
    225,
    202,
    [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => ({ col, row }))),
    { x: -96, y: -144, width: 192, height: 144 },
    2,
  ),
  lindocaraBuilding(
    LINDOCARA_BUILDING_ASSET_IDS.barracks,
    "/assets/lindocara/hd2d/buildings/barracks-front.png",
    ["barracks", "habitable"],
    267,
    206,
    [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => ({ col, row }))),
    { x: -96, y: -152, width: 192, height: 152 },
    2,
  ),
  lindocaraBuilding(
    LINDOCARA_BUILDING_ASSET_IDS.monastery,
    "/assets/lindocara/hd2d/buildings/archery-front.png",
    ["monastery", "habitable"],
    225,
    202,
    [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => ({ col, row }))),
    { x: -96, y: -144, width: 192, height: 144 },
    2,
  ),
  lindocaraBuilding(
    LINDOCARA_BUILDING_ASSET_IDS.castle,
    "/assets/lindocara/hd2d/buildings/barracks-front.png",
    ["castle", "habitable"],
    267,
    206,
    [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => ({ col, row }))),
    { x: -96, y: -152, width: 192, height: 152 },
    3,
  ),
  lindocaraBuilding(
    LINDOCARA_BUILDING_ASSET_IDS.windmill,
    "/assets/lindocara/hd2d/buildings/windmill-front.png",
    ["tower", "windmill", "mill", "habitable"],
    210,
    224,
    [-1, 0, 1].flatMap((row) => [-1, 0, 1].map((col) => ({ col, row }))),
    { x: -88, y: -128, width: 176, height: 128 },
    3,
  ),
  ...FACTION_BUILDING_MODELS.map(lindocaraFactionBuilding),
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
  lindocaraInteriorProp(LINDOCARA_INTERIOR_ASSET_IDS.doubleBed, "double-bed.png", 90, 92, {
    x: -43,
    y: -66,
    width: 86,
    height: 66,
  }),
  lindocaraInteriorProp(LINDOCARA_INTERIOR_ASSET_IDS.wardrobe, "wardrobe.png", 65, 102, {
    x: -29,
    y: -32,
    width: 58,
    height: 32,
  }),
  lindocaraInteriorProp(LINDOCARA_INTERIOR_ASSET_IDS.diningTable, "dining-table.png", 97, 82, {
    x: -44,
    y: -44,
    width: 88,
    height: 44,
  }),
  lindocaraInteriorProp(LINDOCARA_INTERIOR_ASSET_IDS.chair, "chair.png", 50, 84, {
    x: -20,
    y: -27,
    width: 40,
    height: 27,
  }),
  lindocaraInteriorProp(LINDOCARA_INTERIOR_ASSET_IDS.sofa, "sofa.png", 84, 88, {
    x: -38,
    y: -42,
    width: 76,
    height: 42,
  }),
  lindocaraInteriorProp(LINDOCARA_INTERIOR_ASSET_IDS.coffeeTable, "coffee-table.png", 70, 64, {
    x: -31,
    y: -31,
    width: 62,
    height: 31,
  }),
  lindocaraInteriorProp(LINDOCARA_INTERIOR_ASSET_IDS.bar, "bar.png", 81, 90, {
    x: -37,
    y: -45,
    width: 74,
    height: 45,
  }),
  lindocaraInteriorProp(
    LINDOCARA_INTERIOR_ASSET_IDS.fireplace,
    "fireplace.png",
    101,
    110,
    { x: -44, y: -34, width: 88, height: 34 },
    { tags: ["fire"] },
  ),
  lindocaraInteriorProp(
    LINDOCARA_INTERIOR_ASSET_IDS.wallTapestry,
    "wall-tapestry.png",
    84,
    102,
    undefined,
    { wallMounted: true },
  ),
  lindocaraInteriorProp(
    LINDOCARA_INTERIOR_ASSET_IDS.oilLampTable,
    "oil-lamp-table.png",
    36,
    60,
    undefined,
    { tags: ["torch"] },
  ),
  lindocaraInteriorProp(
    LINDOCARA_INTERIOR_ASSET_IDS.oilLampWall,
    "oil-lamp-wall.png",
    45,
    74,
    undefined,
    { wallMounted: true, tags: ["torch"] },
  ),
  lindocaraInteriorProp(
    LINDOCARA_INTERIOR_ASSET_IDS.torchFloor,
    "torch-floor.png",
    62,
    100,
    { x: -13, y: -14, width: 26, height: 14 },
    { tags: ["torch"] },
  ),
  lindocaraInteriorProp(
    LINDOCARA_INTERIOR_ASSET_IDS.torchWall,
    "torch-wall.png",
    62,
    94,
    undefined,
    { wallMounted: true, tags: ["torch"] },
  ),
  lindocaraInteriorProp(
    LINDOCARA_INTERIOR_ASSET_IDS.doorTimber,
    "door-timber.png",
    75,
    108,
    undefined,
    { wallMounted: true },
  ),
  lindocaraInteriorProp(
    LINDOCARA_INTERIOR_ASSET_IDS.doorStone,
    "door-stone.png",
    176,
    114,
    undefined,
    { wallMounted: true },
  ),
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

/**
 * Collision height for both new Lindocara assets and historical catalogue ids still present in
 * saved maps. Explicit metadata wins; conservative category/tag fallbacks keep old buildings and
 * resource decorations playable without rewriting their generated catalogue entries.
 */
export function editorAssetCollisionElevation(
  value: string | EditorAssetDefinition,
): CollisionElevation | null {
  const asset = typeof value === "string" ? editorAsset(value) : value;
  if (!asset?.editor.collider) return null;
  if (asset.editor.collisionElevation !== undefined) return asset.editor.collisionElevation;

  if (asset.editor.category === "buildings") {
    return asset.tags.some((tag) => tag === "tower" || tag === "castle" || tag === "windmill")
      ? 3
      : 2;
  }

  const stump = asset.tags.some((tag) => tag.includes("stump"));
  const tree = asset.editor.category === "trees" || asset.tags.includes("trees");
  if (tree && !stump) return 3;

  // Rocks, stumps, chests, furniture and other bounded props are one-level obstacles.
  return 1;
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
    // Legacy Tiny Swords building ids stay readable for every saved map, but new authoring uses one
    // coherent Lindocara card for each native 3D archetype. Recolours belong in the selected
    // building's inspector instead of becoming dozens of near-identical palette cards.
    if (asset.editor.category === "buildings" && !LINDOCARA_BUILDING_ASSET_ID_SET.has(asset.id)) {
      return false;
    }
    // Raw tilemaps/foam/shadow stay automatic terrain sources, but the pack's dedicated animated
    // water rocks carry explicit placement metadata and are authored offshore decorations.
    if (asset.role === "terrain-source" && asset.editor.category !== "water-decor") return false;
    // The two wooden bridges are one sheet at two rotations, and a bridge is native 3D geometry
    // now: a resizable raised deck with rails, not the flat crop those two cards were named after.
    // One card is offered; placement picks the orientation from the crossing and the inspector
    // switches it afterwards, so the vertical id stays reachable without being a second card.
    if (asset.id === BRIDGE_ASSET_IDS.vertical) return false;
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
