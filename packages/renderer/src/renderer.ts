import type { MainHandItem, OffHandItem, PrimaryColor } from "@lindocara/engine/character.js";
import { MONSTER_ACTIONS, PLAYER_ACTIONS } from "@lindocara/engine/combat-actions.js";
import { isSpirit } from "@lindocara/engine/death.js";
import {
  entityBox,
  hashSeed,
  INTERACTION_RANGE,
  type MonsterSpecies,
  type PlayerClass,
  pointDistance,
} from "@lindocara/engine/game.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import type { MapElement } from "@lindocara/engine/map-data.js";
import type { MerchantDefinition } from "@lindocara/engine/merchant.js";
import type {
  CombatActionSnapshot,
  CombatAnimation,
  CorpseSnapshot,
  GuardSnapshot,
  ItemKind,
  LootSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  ProjectileSnapshot,
  QuestState,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";
import { PLAYER_SIZE } from "@lindocara/engine/simulation.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import { emptyLayer, parseTileLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { isSolidKind, kindAt, TILE_SIZE, type TileMap } from "@lindocara/engine/tilemap.js";
import type { TilePriority, Tileset } from "@lindocara/engine/tileset.js";
import {
  TINY_SWORDS_SHEET_COLS,
  TINY_SWORDS_SHEET_ROWS,
  tilesetById,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import { type EditorAssetId, isEditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import {
  DEFAULT_ZONE_ID,
  type PortalDefinition,
  type ZoneId,
  zoneDefinition,
} from "@lindocara/engine/zones.js";
import {
  type Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type Ticker,
  TilingSprite,
} from "pixi.js";
import { landTile, needsFoam, tileVisual } from "./autotile.js";
import {
  catalogElementFrameAt,
  createCatalogElementView,
  createEventGraphicSprite,
} from "./catalog-element-render.js";
import { MAIN_HAND_ART, OFF_HAND_ART, PLAYER_ATLAS_FRAMES } from "./character-art.js";
import {
  allCombatSheets,
  type CombatSheetArt,
  combatActionFrameIndex,
  combatArt,
  monsterCombatArt,
  projectileArt,
} from "./combat-art.js";
import {
  lumenStepOpacity,
  type MobilityVisual,
  mobilityRenderOffset,
  mobilityVisual,
} from "./combat-motion.js";
import { CombatVisualAuthority, clearVisualAction } from "./combat-visual-state.js";
import { type HealthBarMode, shouldShowHealthBar } from "./display-settings.js";
import {
  type EditorAssetArt,
  loadEditorAssetArt,
  loadEditorAssetArts,
} from "./editor-asset-art.js";
import {
  ENEMY_RENDER_METRICS,
  type EnemyArt,
  type EnemySheet,
  TINY_SWORDS_ENEMIES,
} from "./enemy-art.js";
import { MAX_ACTIVE_WORLD_EFFECTS, questSiteFeedback } from "./feedback.js";
import { onLocaleChange, t } from "./locale.js";
import { sameRenderedMap } from "./map-render-cache.js";
import type { SceneSample } from "./scene-sample.js";
import { ServerClock } from "./server-clock.js";
import { acquireStageApp } from "./stage-application.js";
import {
  foamFrameAt,
  pulseTint,
  terrainTintsAt,
  WATER_RENDER_OBJECTS,
  waterScrollOffsets,
  waterSurfaceRect,
  writeWaterScrollOffsets,
} from "./terrain-visuals.js";
import { tileDrawAt } from "./tile-draw.js";
import {
  allUnitSheets,
  type DecorSheet,
  sliceAutotileSheet,
  sliceStrip,
  sliceTilesetSheet,
  TINY_SWORDS_BUILDINGS,
  TINY_SWORDS_BUSHES,
  TINY_SWORDS_DECO,
  TINY_SWORDS_FOAM_FRAME,
  TINY_SWORDS_FOAM_FRAMES,
  TINY_SWORDS_QUEST_ART,
  TINY_SWORDS_ROCKS,
  TINY_SWORDS_SIGN_BOARD,
  TINY_SWORDS_STUMPS,
  TINY_SWORDS_TERRAIN,
  TINY_SWORDS_TREES,
  TINY_SWORDS_UNIT_FRAME,
  type UnitMotion,
  unitSheet,
} from "./tiny-swords-art.js";
import {
  type DecorTheme,
  EMPTY_ZONE_VISUALS,
  type PointOfInterest,
  roadStrength,
  visualConfigFor,
  type ZoneVisualConfig,
  zoneAt,
} from "./world-layout.js";
import {
  cameraAxisOffset,
  gameCameraScale,
  playerRenderScale,
  tileWindowForBounds,
  type WorldBounds,
} from "./world-view.js";

const COLORS = {
  grass: 0x173f32,
  npc: 0xf6c85f,
  hp: 0xe85454,
  hpBack: 0x251f26,
  label: 0xf4f0df,
  /** Only the outline behind world labels now. Every ellipse "shadow" under a prop, a building and
   *  an actor is gone: Tiny Swords draws its own shadow into each sprite, so the added ones were a
   *  second, differently-shaped shadow sitting under the real one. */
  shadow: 0x07120f,
  selfRing: 0xf6c85f,
  lootPotion: 0xe66ea8,
  lootGold: 0xf0c85c,
  lootCrystal: 0x7dd8ff,
} as const;

const CLASS_GLYPHS: Record<PlayerClass, string> = {
  warrior: "⚔",
  ranger: "➶",
  priest: "✚",
};

const CITY_BUILDING_ART: Readonly<Record<string, number>> = {
  "crossing-hall": 8,
  "lantern-house": 7,
  "wayfarer-rest": 11,
  "founders-guildhall": 10,
  "heartroot-sanctuary": 9,
  "eastwatch-barracks": 8,
};

const ATLAS_IMAGE = "/assets/lindocara/atlas/world.png";
const ATLAS_DATA = "/assets/lindocara/atlas/world.json";
const STATIC_CULL_MARGIN = 180;
const ENTITY_CULL_MARGIN = 120;
const WATER_TEXTURE_SCALE = 0.5;
const WATER_SECONDARY_ALPHA = 0.27;
const GRID_LINE_COLOR = 0xffffff;
const GRID_LINE_ALPHA = 0.18;
/** Blocked cells and entity boxes, in the debug overlay the grid toggle turns on. Red is what you
 *  cannot walk into; green is a body. */
const GRID_SOLID_COLOR = 0xff3b30;
const GRID_SOLID_ALPHA = 0.22;
const HITBOX_COLOR = 0x30ff6a;
const PORTAL_RING_COLOR = 0x9b7dff;

/**
 * A unit is drawn at its native 192px frame, like every other Tiny Swords sprite.
 *
 * It used to be forced to 96 — half scale — which made a knight about half a tile tall standing
 * beside a house drawn at full size. That is the whole "map and units don't match" problem: the
 * pack is already in proportion with itself, and shrinking one class of sprite is what broke it.
 *
 * The offsets place the *character*, not the frame. Measured from `Warrior_Blue.png` frame 0: the
 * body sits at bbox (63,45)-(141,136) inside the 192 frame, so its centre is x=102 and its feet are
 * y=136. The actor's own body is 32px wide and its ground line is y=31, so the sprite shifts by
 * (16 - 102) and (31 - 136) to stand the character on the ground rather than hang the frame off it.
 */
const UNIT_OFFSET_X = 16 - 102;
const UNIT_OFFSET_Y = 31 - 136;

interface AtlasData {
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
}

/** A prop and the one number you need to stand it on a cell: how much empty frame sits under it. */
interface PropArt {
  texture: Texture;
  foot: number;
}

interface ArtTextures {
  players: Record<PrimaryColor, Texture>;
  monsters: Record<MonsterSpecies, Record<UnitMotion, readonly Texture[]>>;
  keeper: Texture;
  merchant: readonly Texture[];
  /** The tilemap's ground truth. `land[row][col]` is a cell of the flat sheet's first 4x4
   * autotile group; `water` is the pack's flat BG colour and `foam` its eight shoreline frames.
   * `tileset[row][col]` is the whole 9x6 `Tilemap_color1.png` grid a frozen tile id indexes into —
   * `land` survives only for the compiled catalogue zones, which carry no layers. */
  terrain: {
    land: readonly (readonly Texture[])[];
    water: Texture;
    foam: readonly Texture[];
    tileset: readonly (readonly Texture[])[];
  };
  props: {
    trees: PropArt[];
    /** Wire-map bushes, carrying their own foot offset exactly like `trees`. Distinct from `leaves`
     *  (frame 0, footless) which the catalogue's `#buildDecor` scatters as ground clutter. */
    bushes: PropArt[];
    ruins: Texture[];
    rocks: Texture[];
    /** The pack's four still rocks, in `TINY_SWORDS_ROCKS` order — a wire `stone` element indexes
     *  this directly, so a variant maps to the same rock the map author chose. */
    stones: Texture[];
    mushrooms: Texture[];
    stump: Texture;
    log: Texture;
    fence: Texture;
    tufts: Texture[];
    leaves: Texture[];
    roots: Texture[];
    torch: Texture;
  };
  mainHands: Record<MainHandItem, Texture>;
  offHands: Record<OffHandItem, Texture>;
  loot: Record<ItemKind, Texture>;
  units: Record<string, readonly Texture[]>;
  buildings: Texture[];
  signBoard: Texture;
  combatFrames: Map<string, readonly Texture[]>;
  questResources: Record<keyof typeof TINY_SWORDS_QUEST_ART, Texture>;
}

export interface RenderContext {
  self?: PlayerSnapshot;
  quest: QuestState;
  now: number;
  healthBars: HealthBarMode;
  grid: boolean;
}

interface EntityView<T extends { id: string }> {
  container: Container;
  data: T;
  actor?: Container;
  flash?: Graphics;
  weapon?: Container;
  alert?: Text;
  lastX?: number;
  lastY?: number;
  lastHp?: number;
  drawnHp?: number;
  drawnMaxHp?: number;
  movingUntil?: number;
  hitUntil?: number;
  wasDead?: boolean;
  phase?: number;
  unitSprite?: Sprite;
  unitAnimations?: Record<UnitMotion, readonly Texture[]>;
  actionId?: string;
  actionSkillId?: string;
  actionTalented?: boolean;
  actionEvolved?: boolean;
  actionStartedAt?: number;
  actionImpactAt?: number;
  actionChannelEndsAt?: number;
  actionEndsAt?: number;
  actionDirection?: { x: number; y: number };
  effectPlayedActionId?: string;
  createdAt?: number;
  mobilityActionId?: string;
  mobilityOffsetX?: number;
  mobilityOffsetY?: number;
  mobilityStartedAt?: number;
  mobilityDurationMs?: number;
}

interface Effect {
  container: Container;
  bornAt: number;
  duration: number;
  rise: number;
  baseY: number;
  sprite?: Sprite;
  frames?: readonly Texture[];
  scaleGrowth: number;
  baseScale: number;
  actionId?: string;
}

interface AmbientView {
  container: Container;
  baseX: number;
  baseY: number;
  phase: number;
  sway: number;
}

interface WaterSurfaceView {
  primary: TilingSprite;
  secondary: TilingSprite;
  x: number;
  y: number;
  baseTint: number;
  phase: number;
}

/** One foam blob, centred on a shoreline land tile. It carries no position of its own: the frame
 *  it shows is global (see `foamFrameAt`) and where it sits is decided by `#updateTerrain`. */
interface FoamTileView {
  blob: Sprite;
}

interface StaticView {
  container: Container;
  x: number;
  y: number;
  radius: number;
}

interface WorldTextView {
  label: Text;
  x: number;
  y: number;
  revealRadius: number;
  zoneId?: string;
}

interface QuestSiteView {
  id: string;
  chapter: string;
  order: number;
  container: Container;
  signal: Graphics;
  label: Text;
  hiddenUntil: number;
}

function phaseFor(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return (hash % 628) / 100;
}

function seeded(index: number): number {
  const value = Math.sin(index * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function sliceHorizontalSheet(
  source: Texture,
  frameWidth: number,
  frames: number,
  frameHeight = source.height,
): readonly Texture[] {
  return Array.from({ length: frames }, (_, index) => {
    const frame = new Rectangle(index * frameWidth, 0, frameWidth, frameHeight);
    return new Texture({
      source: source.source,
      frame,
      label: `${source.label ?? "sheet"}:${index}`,
    });
  });
}

function landTexture(
  land: readonly (readonly Texture[])[],
  cell: { col: number; row: number },
): Texture {
  const texture = land[cell.row]?.[cell.col];
  // AUTOTILE_LUT only ever produces coordinates inside the 4x4 group sliced above, but the types
  // do not know that and `noNonNullAssertion` is on.
  if (!texture) throw new Error(`no autotile texture at ${cell.col},${cell.row}`);
  return texture;
}

/** Re-exported from `tile-draw.ts`, which the editor stage draws with too. Kept exported here
 *  because this arithmetic — no Pixi in it — is testable without a live canvas. */
export { autotileSheetCell } from "./tile-draw.js";

const MERCHANT_IDLE_SHEET = new URL(
  "../../catalog/assets/Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Gnome/Gnome_Idle.png",
  import.meta.url,
).href;

function centerOf(entity: { x: number; y: number }): { x: number; y: number } {
  return { x: entity.x + PLAYER_SIZE / 2, y: entity.y + PLAYER_SIZE / 2 };
}

async function loadArt(): Promise<ArtTextures> {
  const externalEquipment = [
    ...Object.values(MAIN_HAND_ART).filter((art) => art.source !== "atlas"),
    ...Object.values(OFF_HAND_ART),
  ];
  const [baseTexture, atlasData, ...equipmentTextures] = await Promise.all([
    Assets.load<Texture>(ATLAS_IMAGE),
    fetch(ATLAS_DATA).then((response) => response.json() as Promise<AtlasData>),
    ...externalEquipment.map((art) => Assets.load<Texture>(art.source)),
  ]);
  baseTexture.source.style.scaleMode = "nearest";

  const atlas: Record<string, Texture> = {};
  for (const [name, frame] of Object.entries(atlasData.frames)) {
    atlas[name] = new Texture({
      source: baseTexture.source,
      frame: new Rectangle(frame.x, frame.y, frame.w, frame.h),
      label: name,
    });
  }

  const texture = (name: string): Texture => {
    const result = atlas[name];
    if (!result) throw new Error(`Missing atlas frame: ${name}`);
    return result;
  };
  const external = new Map(
    externalEquipment.map((art, index) => [art.source, equipmentTextures[index] as Texture]),
  );
  const equipmentTexture = (source: string): Texture => {
    const result = external.get(source);
    if (!result) throw new Error(`Missing equipment texture: ${source}`);
    return result;
  };
  const unitSheets = allUnitSheets();
  const loadedUnits = await Promise.all(
    unitSheets.map((definition) => Assets.load<Texture>(definition.source)),
  );
  const units: Record<string, readonly Texture[]> = {};
  for (let sourceIndex = 0; sourceIndex < unitSheets.length; sourceIndex++) {
    const definition = unitSheets[sourceIndex];
    const sheet = loadedUnits[sourceIndex];
    if (!definition || !sheet) continue;
    sheet.source.style.scaleMode = "nearest";
    units[definition.source] = Array.from(
      { length: definition.frames },
      (_, frame) =>
        new Texture({
          source: sheet.source,
          frame: new Rectangle(
            frame * TINY_SWORDS_UNIT_FRAME,
            0,
            TINY_SWORDS_UNIT_FRAME,
            TINY_SWORDS_UNIT_FRAME,
          ),
          label: `${definition.source}:${frame}`,
        }),
    );
  }
  const combatSheets = allCombatSheets();
  const loadedCombatSheets = await Promise.all(
    combatSheets.map((definition) => Assets.load<Texture>(definition.source)),
  );
  const combatFrames = new Map<string, readonly Texture[]>();
  for (let index = 0; index < combatSheets.length; index++) {
    const definition = combatSheets[index];
    const sheet = loadedCombatSheets[index];
    if (!definition || !sheet) continue;
    sheet.source.style.scaleMode = "nearest";
    combatFrames.set(
      definition.source,
      sliceHorizontalSheet(sheet, definition.frameWidth, definition.frames, definition.frameHeight),
    );
  }
  const [terrainFlatSheet, terrainWaterSurface, terrainFoamSheet, terrainTilesetSheet] =
    await Promise.all([
      Assets.load<Texture>(TINY_SWORDS_TERRAIN.flat),
      Assets.load<Texture>(TINY_SWORDS_TERRAIN.water),
      Assets.load<Texture>(TINY_SWORDS_TERRAIN.foam),
      Assets.load<Texture>(TINY_SWORDS_TERRAIN.tileset),
    ]);
  terrainTilesetSheet.source.style.scaleMode = "nearest";
  // All three are pixel art from the same pack, so all three sample nearest. The water is one flat
  // colour and would look the same either way; it stays consistent so nothing here re-learns the
  // linear sampling the photographic ocean surface used to need.
  terrainFlatSheet.source.style.scaleMode = "nearest";
  terrainWaterSurface.source.style.scaleMode = "nearest";
  terrainFoamSheet.source.style.scaleMode = "nearest";
  const terrainFoam = sliceStrip(terrainFoamSheet, TINY_SWORDS_FOAM_FRAME, TINY_SWORDS_FOAM_FRAMES);
  // Every prop below is loaded at its native size and never resampled: `nearest` keeps the pixels
  // square, and nothing scales them afterwards. See `createPropSprite`.
  const loadStills = async (sources: readonly string[]): Promise<Texture[]> => {
    const loaded = await Promise.all(sources.map((source) => Assets.load<Texture>(source)));
    for (const item of loaded) item.source.style.scaleMode = "nearest";
    return loaded;
  };
  const loadStrip = async (sheet: DecorSheet): Promise<Texture[]> => {
    const loaded = await Assets.load<Texture>(sheet.source);
    loaded.source.style.scaleMode = "nearest";
    return sliceStrip(loaded, sheet.frame, sheet.frames);
  };
  const [treeFrames, bushFrames, rockTextures, stumpTextures] = await Promise.all([
    Promise.all(TINY_SWORDS_TREES.map(loadStrip)),
    Promise.all(TINY_SWORDS_BUSHES.map(loadStrip)),
    loadStills(TINY_SWORDS_ROCKS),
    loadStills(TINY_SWORDS_STUMPS),
  ]);
  const decoEntries = await Promise.all(
    Object.entries(TINY_SWORDS_DECO).map(
      async ([name, sources]) => [name, await loadStills(sources)] as const,
    ),
  );
  const decoTextures = Object.fromEntries(decoEntries) as Record<
    keyof typeof TINY_SWORDS_DECO,
    Texture[]
  >;

  const buildings = await Promise.all(
    TINY_SWORDS_BUILDINGS.map((source) => Assets.load<Texture>(source)),
  );
  for (const building of buildings) building.source.style.scaleMode = "nearest";
  const signBoard = await Assets.load<Texture>(TINY_SWORDS_SIGN_BOARD);
  signBoard.source.style.scaleMode = "nearest";
  const enemySheets = new Map<string, EnemySheet>();
  for (const art of Object.values(TINY_SWORDS_ENEMIES)) {
    for (const motion of ["idle", "run", "attack"] as const)
      enemySheets.set(art[motion].source, art[motion]);
  }
  const enemySheetSources = [...enemySheets.keys()];
  const loadedEnemySheets = await Promise.all(
    enemySheetSources.map((source) => Assets.load<Texture>(source)),
  );
  const enemyTextures = new Map<string, Texture>();
  for (let index = 0; index < enemySheetSources.length; index++) {
    const source = enemySheetSources[index];
    const sheet = loadedEnemySheets[index];
    if (!source || !sheet) continue;
    // The Tiny Swords Enemy Pack is pixel art like everything else in this file, but the
    // vendor monster loader it replaces set "linear", which blurred it. Every other Tiny Swords
    // texture below already uses "nearest"; the enemies now match.
    sheet.source.style.scaleMode = "nearest";
    enemyTextures.set(source, sheet);
  }
  const monsters = monsterAnimations(enemyTextures);
  const questResourceEntries = await Promise.all(
    Object.entries(TINY_SWORDS_QUEST_ART).map(
      async ([kind, source]) => [kind, await Assets.load<Texture>(source)] as const,
    ),
  );
  const questResources = Object.fromEntries(questResourceEntries) as Record<
    keyof typeof TINY_SWORDS_QUEST_ART,
    Texture
  >;
  for (const resource of Object.values(questResources)) resource.source.style.scaleMode = "nearest";
  const merchantSheet = await Assets.load<Texture>(MERCHANT_IDLE_SHEET);
  merchantSheet.source.style.scaleMode = "nearest";

  return {
    players: {
      azure: texture(PLAYER_ATLAS_FRAMES.azure.name),
      ember: texture(PLAYER_ATLAS_FRAMES.ember.name),
      moss: texture(PLAYER_ATLAS_FRAMES.moss.name),
      violet: texture(PLAYER_ATLAS_FRAMES.violet.name),
    },
    monsters,
    keeper: texture("npc.keeper"),
    merchant: sliceHorizontalSheet(merchantSheet, 192, 8, 192),
    terrain: {
      land: sliceAutotileSheet(terrainFlatSheet),
      water: terrainWaterSurface,
      foam: terrainFoam,
      tileset: sliceTilesetSheet(
        terrainTilesetSheet,
        TINY_SWORDS_SHEET_COLS,
        TINY_SWORDS_SHEET_ROWS,
      ),
    },
    props: {
      // Pixel Frog's trees, at Pixel Frog's size, carrying the foot offset that stands them on a
      // cell. Frame 0 of each sway strip: the sheets are sliced and ready when animating them is
      // worth doing.
      trees: TINY_SWORDS_TREES.map((sheet, index) => ({
        texture: treeFrames[index]?.[0] ?? Texture.EMPTY,
        foot: sheet.foot,
      })),
      // A bush frame is 128px with ~49px of empty footer, so it needs the same foot handling a tree
      // does; `leaves` above keeps only frame 0 for footless decor scatter and cannot stand a bush.
      bushes: TINY_SWORDS_BUSHES.map((sheet, index) => ({
        texture: bushFrames[index]?.[0] ?? Texture.EMPTY,
        foot: sheet.foot,
      })),
      ruins: [
        texture("prop.ruin.gate"),
        texture("prop.ruin.wall"),
        texture("prop.ruin.house"),
        texture("prop.ruin.house.vines"),
        texture("prop.ruin.house.dark"),
        texture("prop.hut"),
        texture("prop.hut.vines"),
        texture("prop.hut.dark"),
      ],
      rocks: [...rockTextures, ...decoTextures.pebbles],
      stones: rockTextures,
      mushrooms: decoTextures.mushrooms,
      stump: stumpTextures[0] ?? Texture.EMPTY,
      log: stumpTextures[1] ?? Texture.EMPTY,
      // No Tiny Swords fence, and inventing one would be the only non-pack sprite left in the
      // world. A shrub reads as a verge just as well and is the artist's own.
      fence: decoTextures.shrubs[0] ?? Texture.EMPTY,
      tufts: decoTextures.shrubs,
      leaves: bushFrames.map((frames) => frames[0] ?? Texture.EMPTY),
      roots: decoTextures.bones,
      torch: decoTextures.pumpkins[0] ?? Texture.EMPTY,
    },
    mainHands: {
      weathered_sword: texture("weapon.sword"),
      hunter_bow: equipmentTexture(MAIN_HAND_ART.hunter_bow.source),
      heartwood_staff: equipmentTexture(MAIN_HAND_ART.heartwood_staff.source),
    },
    offHands: {
      oak_shield: equipmentTexture(OFF_HAND_ART.oak_shield.source),
    },
    loot: {
      potion: texture("loot.potion"),
      gold: texture("loot.gold"),
      crystal: texture("loot.crystal"),
    },
    units,
    buildings,
    signBoard,
    combatFrames,
    questResources,
  };
}

function createSprite(texture: Texture, width: number, height: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.width = width;
  sprite.height = height;
  return sprite;
}

function playerAnimations(
  player: Pick<PlayerSnapshot, "class" | "appearance">,
  textures: Record<string, readonly Texture[]>,
): Record<UnitMotion, readonly Texture[]> {
  const result = {} as Record<UnitMotion, readonly Texture[]>;
  for (const motion of ["idle", "run", "attack"] as const) {
    const source = unitSheet(player.class, player.appearance, motion).source;
    const frames = textures[source];
    if (!frames || frames.length === 0) throw new Error(`Missing Tiny Swords unit: ${source}`);
    result[motion] = frames;
  }
  return result;
}

/**
 * Slices every `TINY_SWORDS_ENEMIES` sheet into idle/run/attack frame arrays, once. `textures`
 * holds one loaded `Texture` per distinct sheet source — several species (the three `skull_*`
 * species, `spear_goblin` vs `torch_goblin` do not) share a sheet, so this reads from a
 * source-keyed map rather than loading the same file twice.
 */
function monsterAnimations(
  textures: Map<string, Texture>,
): Record<MonsterSpecies, Record<UnitMotion, readonly Texture[]>> {
  const result = {} as Record<MonsterSpecies, Record<UnitMotion, readonly Texture[]>>;
  for (const [species, art] of Object.entries(TINY_SWORDS_ENEMIES) as [
    MonsterSpecies,
    EnemyArt,
  ][]) {
    const animations = {} as Record<UnitMotion, readonly Texture[]>;
    for (const motion of ["idle", "run", "attack"] as const) {
      const sheet = art[motion];
      const texture = textures.get(sheet.source);
      if (!texture) throw new Error(`Missing Tiny Swords enemy sheet: ${sheet.source}`);
      const frames = sliceHorizontalSheet(texture, sheet.frame, sheet.frames);
      if (frames.length === 0) throw new Error(`Missing Tiny Swords enemy sheet: ${sheet.source}`);
      animations[motion] = frames;
    }
    result[species] = animations;
  }
  return result;
}

/**
 * A prop at the size Pixel Frog drew it.
 *
 * This replaces a `createPropSprite(texture)` that scaled every prop to fit
 * an arbitrary box — rocks into 22x18, a shelter into 84x78. That is the one thing you must not do
 * to this pack. Tiny Swords is drawn as a single coherent set against a 64px grid, so a unit frame
 * (192), a tree (256) and a pebble (64) are already in proportion with each other and with the
 * ground. Native scale is not a detail here; it is the whole reason the art agrees with itself.
 *
 * Anchored at the bottom centre because these things stand on the ground: their footprint is the
 * bottom of the frame, and a sheet with headroom above the object (the stumps have ~200px of it)
 * would float if it were centred.
 */
function createPropSprite(texture: Texture): Sprite {
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5, 1);
  return sprite;
}

function pickTexture(textures: readonly Texture[], index: number): Texture {
  const texture = textures[index % textures.length] ?? textures[0];
  if (!texture) throw new Error("Cannot pick from an empty texture list");
  return texture;
}

/**
 * A wire element's `variant` folded into `[0, length)`. Elements are validated for shape but not
 * range, so a negative or absurd variant must still land on a real sprite rather than read
 * `undefined` — `%` alone keeps the sign in JS, so this wraps it positive.
 */
function placeTile(
  tile: Sprite,
  texture: Texture,
  x: number,
  y: number,
  width = TILE_SIZE,
  height = TILE_SIZE,
): void {
  tile.texture = texture;
  tile.position.set(x, y);
  tile.width = width;
  tile.height = height;
}

/** One drawn authored event: its container, the last snapshot it drew, and the graphic id currently
 *  painted (`undefined` means "needs a (re)draw", the sentinel a just-loaded asset sets). */
interface EventView {
  container: Container;
  data: WorldEventSnapshot;
  drawnGraphic: string | null | undefined;
}

/**
 * Which container an event draws into — the ONE routing decision, extracted pure so it can be pinned
 * without a renderer: an `onTop` page (a treetop the hero passes behind) goes above the actors, in
 * `#tilesAbove`; everything else draws in the ground decor pass. Appearance only, mirrors the
 * `optOnTop` split the map editor already honours.
 */
export function eventRenderLayer(onTop: boolean, decor: Container, above: Container): Container {
  return onTop ? above : decor;
}

function reconcile<T extends { id: string }>(
  views: Map<string, EntityView<T>>,
  entities: readonly T[],
  create: (entity: T) => EntityView<T>,
  update: (view: EntityView<T>, entity: T) => void,
  remove?: (view: EntityView<T>) => void,
): void {
  const present = new Set<string>();
  for (const entity of entities) {
    present.add(entity.id);
    let view = views.get(entity.id);
    if (!view) {
      view = create(entity);
      views.set(entity.id, view);
    }
    update(view, entity);
  }

  for (const [id, view] of views) {
    if (present.has(id)) continue;
    remove?.(view);
    view.container.destroy({ children: true });
    views.delete(id);
  }
}

export class Renderer {
  #app: Application;
  #destroyed = false;
  /** The ticker callbacks this renderer added, kept so `destroy()` can remove exactly its own from
   *  the shared Application's ticker without touching another consumer's or stopping the app. */
  #frameCallbacks: Array<(ticker: Ticker) => void> = [];
  /** Unsubscribes this renderer's locale listener; called in `destroy()` so a discarded renderer
   *  does not keep restyling text nodes it no longer owns. */
  #localeUnsub: () => void;
  #world = new Container();
  #worldBackground = new Graphics();
  #waterTerrain = new Container();
  #foamTerrain = new Container();
  /** Ground tiles a character walks in front of. Everything the compiled catalogue draws lands
   *  here too — priority is a tileset property, and a catalogue zone has no tileset. */
  #tilesBelow = new Container();
  /** Tiles a character walks *behind*, drawn immediately after `#actors`. That placement is the
   *  whole point of per-tile priority: it is what lets a head pass under a treetop. */
  #tilesAbove = new Container();
  #gridOverlay = new Graphics();
  #hitboxOverlay = new Graphics();
  #groundDecor = new Container();
  #forestTreesLayer = new Container();
  #decorLayer = new Container();
  #structures = new Container();
  #ambient = new Container();
  #actors = new Container();
  #worldLabels = new Container();
  #overlay = new Graphics();
  #navigationDebug = new Graphics();
  #navigationDebugLabels = new Container();
  #effects = new Container();
  #questNpcs: Array<{
    chapter: string;
    x: number;
    y: number;
    mark: Text;
    label: Text;
  }> = [];
  // Tracked separately from #questNpcs because that array keeps only the parts later frames
  // animate (mark/label); the wrapping Container is what #teardownWorldFurniture must destroy.
  #npcContainers: Container[] = [];
  #questSites: QuestSiteView[] = [];
  #players = new Map<string, EntityView<PlayerSnapshot>>();
  #monsters = new Map<string, EntityView<MonsterSnapshot>>();
  #guards = new Map<string, EntityView<GuardSnapshot>>();
  #loot = new Map<string, EntityView<LootSnapshot>>();
  #corpses = new Map<string, EntityView<CorpseSnapshot>>();
  #projectiles = new Map<string, EntityView<ProjectileSnapshot>>();
  /** Drawn authored events, keyed by event id. Appearance only — nothing gameplay reads these; the
   *  server already resolved which page is active and baked collision into the tilemap. */
  #events = new Map<string, EventView>();
  /** Loaded art for event page graphics, filled on demand — an event's asset need not be one the
   *  authored-element preload already fetched. */
  #eventAssetArt = new Map<EditorAssetId, EditorAssetArt>();
  #activeEffects: Effect[] = [];
  #ambientViews: AmbientView[] = [];
  #staticViews: StaticView[] = [];
  #worldTextViews: WorldTextView[] = [];
  #localizedTexts: Array<{ node: Text; compute: () => string }> = [];
  /**
   * The tile sprite pools, one per priority container.
   *
   * A cell now draws up to `MAP_LAYERS` sprites instead of exactly one, so the pool can no longer be
   * indexed by cell. Each repaint resets the cursors, hands out sprites in scan order and hides the
   * unused tail; a sprite never changes parent, so the pooling stays the cheap thing it was. Draw
   * order inside a container is child order, which is acquisition order — ground, then the two
   * layers above it, for each cell in turn. Cells never overlap, so only the within-cell order
   * matters.
   */
  #belowTiles: Sprite[] = [];
  #belowUsed = 0;
  #aboveTiles: Sprite[] = [];
  #aboveUsed = 0;
  #waterSurface?: WaterSurfaceView;
  readonly #waterScroll = waterScrollOffsets(0, 1);
  #foamTilePool: FoamTileView[] = [];
  #foamTiles: FoamTileView[] = [];
  #showGrid = false;
  #terrainKey = "";
  /** Which zone's tilemap `#buildForestTrees`/`#buildDecor`/`#updateTerrain` currently read.
   *  Defaults to Verdant Reach so the very first paint (before any welcome) isn't blank; the
   *  real zone lands via `configureZone` moments later, from the welcome's `zoneId`. */
  #currentZoneId: ZoneId = DEFAULT_ZONE_ID;
  #currentMapRevision = zoneDefinition(DEFAULT_ZONE_ID).revision ?? 0;
  #tiles: TileMap = zoneDefinition(DEFAULT_ZONE_ID).terrain.tiles;
  /**
   * The frozen appearance of an authored map: three parsed layers of tile ids, and the tileset they
   * index into. **Appearance only** — `#tiles` above stays the single collision truth, exactly the
   * rule `#mapElements` already follows. Nothing here may be read for walkability or geometry.
   *
   * Empty for a compiled catalogue zone, which predates layers and ships three empty ones. That is
   * the discriminator `#updateTerrain` switches on: no layers means the old derived ground pass,
   * which is the only thing keeping the rollback zones from rendering as bare sea.
   */
  #layers: readonly TileLayer[] = [];
  #tileset: Tileset | null = null;
  /** A wire map's authored props, or `null` for a catalogue zone. When set, it is the ONLY prop
   *  truth: `#buildForestTrees` and `#buildDecor` stand down (a stone bakes to a `forest` cell, and
   *  the hash pass would grow a tree out of it), and `#buildMapElements` draws this list instead. */
  #mapElements: readonly MapElement[] | null = null;
  #mapAssetArt = new Map<EditorAssetId, EditorAssetArt>();
  #mapElementAnimations: Array<{ sprite: Sprite; frames: readonly Texture[] }> = [];
  #merchantContainer: Container | null = null;
  #merchantAnimation: { sprite: Sprite; frames: readonly Texture[] } | null = null;
  /** Read from the shared catalogue, the same place `#tiles` comes from — not from the welcome.
   *  Swapped wholesale in `configureZone`, so a portal from the zone you left can never draw over
   *  the one you arrived in. */
  #portals: readonly PortalDefinition[] = zoneDefinition(DEFAULT_ZONE_ID).portals;
  #visuals: ZoneVisualConfig = visualConfigFor(DEFAULT_ZONE_ID);
  #zoneWidth = zoneDefinition(DEFAULT_ZONE_ID).terrain.width;
  #zoneHeight = zoneDefinition(DEFAULT_ZONE_ID).terrain.height;
  #selfId: string | null = null;
  #cameraX = zoneDefinition(DEFAULT_ZONE_ID).terrain.width / 2;
  #cameraY = zoneDefinition(DEFAULT_ZONE_ID).terrain.height / 2;
  #cameraReady = false;
  #lastCameraAt = 0;
  #healthBarMode: HealthBarMode = "both";
  #combatVisualAuthority = new CombatVisualAuthority();

  private constructor(
    app: Application,
    private readonly art: ArtTextures,
    private readonly serverClock: ServerClock,
  ) {
    this.#app = app;
    this.#localeUnsub = onLocaleChange(() => {
      for (const entry of this.#localizedTexts) entry.node.text = entry.compute();
    });
  }

  static async create(
    canvas: HTMLCanvasElement,
    serverClock = new ServerClock(),
  ): Promise<Renderer> {
    // The one Application on #stage, shared with the map editor. It is created once per page and its
    // init options (background COLORS.void, resize-to-window, no antialias, capped resolution) now
    // live in stage-application.ts; this consumer only builds its own world onto the returned stage.
    const app = await acquireStageApp(canvas);
    const renderer = new Renderer(app, await loadArt(), serverClock);
    renderer.#buildWorld();
    return renderer;
  }

  setSelfId(id: string): void {
    this.#selfId = id;
  }

  /**
   * Called from a welcome's `world.zoneId`. A no-op on a reconnect into the same zone (a fresh
   * bake is real work: a full tree/decor rebuild). On a genuine zone change — a portal, live,
   * same renderer instance across the reconnect — swaps `#tiles` and repaints everything that
   * was built from the previous zone's tile grid, or the old zone's forest and decor would go on
   * standing over the new room forever.
   *
   * The hand-authored world furniture (landmarks, quest sites, NPCs, set pieces, world labels,
   * ambient lights) is Verdant-Reach-only content built from fixed Verdant pixel coordinates, not
   * from `#tiles` — so it is gated on entering/leaving Verdant Reach specifically, the same way
   * `#tiles` itself is gated on the zone actually loaded, rather than left standing over whatever
   * zone the player portals into next.
   */
  configureZone(zoneId: ZoneId): void {
    const zone = zoneDefinition(zoneId);
    const revision = zone.revision ?? 0;
    if (
      sameRenderedMap(
        { mapId: zoneId, revision },
        { mapId: this.#currentZoneId, revision: this.#currentMapRevision },
      )
    )
      return;
    this.#currentZoneId = zoneId;
    this.#currentMapRevision = revision;
    this.#tiles = zone.terrain.tiles;
    // A catalogue zone predates layers and ships three empty ones, which would paint nothing at
    // all. Clearing these is what keeps it on the derived ground pass.
    this.#layers = [];
    this.#tileset = null;
    this.#portals = zone.portals;
    this.#visuals = visualConfigFor(zoneId);
    this.#zoneWidth = zone.terrain.width;
    this.#zoneHeight = zone.terrain.height;
    // A catalogue zone draws its props from the tile grid, not an element list — clearing this is
    // what keeps `#buildForestTrees`/`#buildDecor` on their normal path.
    this.#mapElements = null;
    this.#mapAssetArt.clear();
    this.#mapElementAnimations = [];
    this.#rebuildForZone();
  }

  /**
   * The wire-terrain twin of `configureZone`: an unknown zone id is a D1 map, so its terrain and
   * props travel in the welcome rather than living in the catalogue. `tiles` is the already-baked
   * grid the client collides against; `elements` is the authored scenery drawn on top of it. There
   * are no landmarks, roads or districts, so the visuals are empty and the rebuild is otherwise
   * identical to a catalogue zone's.
   */
  configureMapTerrain(
    zoneId: string,
    tiles: TileMap,
    elements: readonly MapElement[],
    revision: number,
    appearance?: { tilesetId: string; layers: readonly string[] },
  ): void {
    if (
      sameRenderedMap(
        { mapId: zoneId, revision },
        { mapId: this.#currentZoneId, revision: this.#currentMapRevision },
      )
    )
      return;
    this.#currentZoneId = zoneId;
    this.#currentMapRevision = revision;
    this.#tiles = tiles;
    this.#adoptLayers(zoneId, tiles, appearance);
    this.#portals = [];
    this.#visuals = EMPTY_ZONE_VISUALS;
    this.#zoneWidth = tiles.cols * TILE_SIZE;
    this.#zoneHeight = tiles.rows * TILE_SIZE;
    this.#mapElements = elements;
    this.#mapAssetArt = new Map();
    this.#mapElementAnimations = [];
    this.#rebuildForZone();
    void this.#loadMapAssetArt(zoneId, revision, elements);
  }

  configureMerchant(merchant: MerchantDefinition | null): void {
    if (this.#merchantContainer) {
      this.#merchantContainer.destroy({ children: true });
      this.#merchantContainer = null;
    }
    this.#merchantAnimation = null;
    if (!merchant) return;
    const container = new Container();
    container.position.set(merchant.x + PLAYER_SIZE / 2, merchant.y + PLAYER_SIZE);
    container.zIndex = merchant.y + PLAYER_SIZE;
    container.addChild(new Graphics().ellipse(0, 0, 25, 8).fill({ color: 0x000000, alpha: 0.4 }));
    container.addChild(new Graphics().circle(0, -34, 38).fill({ color: 0xffcf62, alpha: 0.09 }));
    const sprite = createSprite(this.art.merchant[0] ?? Texture.EMPTY, 72, 72);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(0, 4);
    container.addChild(sprite);
    const label = new Text({
      text: t("merchant.world_label"),
      style: {
        fontFamily: "Georgia, serif",
        fontSize: 12,
        fill: 0xffdc72,
        align: "center",
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 3, distance: 1 },
      },
    });
    label.anchor.set(0.5, 1);
    label.position.set(0, -66);
    container.addChild(label);
    this.#localizedTexts.push({ node: label, compute: () => t("merchant.world_label") });
    this.#actors.addChild(container);
    this.#merchantContainer = container;
    // Kept separate from authored prop animations: their async asset refresh clears its own list,
    // while an authored merchant must keep idling like every other living NPC.
    this.#merchantAnimation = { sprite, frames: this.art.merchant };
  }

  /**
   * Parses a welcome's appearance layers once, here, and never inside a frame.
   *
   * Degrades the way the server's `decodeLayers` (`server/maps.ts`) does, and for the same reason: a
   * layer that fails to parse is one layer, not the whole world. A malformed one becomes an empty
   * layer and the other two still draw, so a corrupted decoration layer cannot blank the ground a
   * player is standing on. `console.warn` naming the map and the layer index is the only diagnostic
   * signal that exists for this — the protocol has no code for "your scenery is broken", and
   * inventing a player-facing one would say nothing a player could act on.
   *
   * An unresolvable tileset drops *all* layers and falls back to the derived ground pass, which
   * still paints land: with no tileset there is no entry to read a cell, a priority or a tint from,
   * so every id would resolve to nothing and the map would render as bare sea.
   *
   * Doing this at configure time is what makes the robustness claim hold: by the time
   * `#updateTerrain` runs, `#layers` is either well-formed or empty, and no frame can throw.
   */
  #adoptLayers(
    zoneId: string,
    tiles: TileMap,
    appearance: { tilesetId: string; layers: readonly string[] } | undefined,
  ): void {
    this.#layers = [];
    this.#tileset = null;
    if (!appearance) return;
    const tileset = tilesetById(appearance.tilesetId);
    if (!tileset) {
      console.warn(`renderer: map ${zoneId} names unknown tileset "${appearance.tilesetId}"`);
      return;
    }
    this.#tileset = tileset;
    this.#layers = appearance.layers.map((encoded, index) => {
      const layer = parseTileLayer(encoded, tiles.cols, tiles.rows);
      if (layer) return layer;
      console.warn(`renderer: map ${zoneId} layer ${index} is malformed; drawing it empty`);
      return emptyLayer(tiles.cols, tiles.rows);
    });
  }

  async #loadMapAssetArt(
    zoneId: string,
    revision: number,
    elements: readonly MapElement[],
  ): Promise<void> {
    const loaded = await loadEditorAssetArts(elements.map((element) => element.assetId));
    if (
      this.#destroyed ||
      this.#currentZoneId !== zoneId ||
      this.#currentMapRevision !== revision ||
      this.#mapElements !== elements
    ) {
      return;
    }
    this.#mapAssetArt = loaded;
    for (const child of this.#forestTreesLayer.removeChildren()) child.destroy({ children: true });
    for (const child of this.#decorLayer.removeChildren()) child.destroy({ children: true });
    this.#mapElementAnimations = [];
    this.#staticViews = this.#staticViews.filter((view) => view.container.parent !== null);
    this.#buildMapElements(elements);
    this.#updateStaticVisibility();
  }

  /**
   * Tears down the previous zone's tile-derived props and world furniture, then rebuilds from the
   * fields set by whichever `configure*` just ran. Shared verbatim by both configure paths — a
   * second hand-kept copy of this sequence is exactly how a portal leaves the old zone's forest
   * standing over the new room.
   */
  #rebuildForZone(): void {
    this.#clearTransientCombatViews();
    // Events are room-scoped: an `onTop` event lives in the persistent `#tilesAbove` container that
    // survives a zone change, so it must be torn down explicitly or it would draw over the new room.
    this.#clearEventViews();
    this.#teardownWorldFurniture();
    for (const child of this.#forestTreesLayer.removeChildren()) child.destroy({ children: true });
    for (const child of this.#decorLayer.removeChildren()) child.destroy({ children: true });
    this.#mapElementAnimations = [];
    this.#cameraX = this.#zoneWidth / 2;
    this.#cameraY = this.#zoneHeight / 2;
    this.#cameraReady = false;
    this.#resizeWorldBackground();
    // Static views for the props above are now unparented; drop them rather than let
    // #updateStaticVisibility keep toggling .visible on containers nothing will ever draw.
    this.#staticViews = this.#staticViews.filter((view) => view.container.parent !== null);
    this.#buildForestTrees();
    this.#buildDecor();
    this.#buildWorldFurniture();
    // Bounds-derived, not tile-derived: a same-size window after a zone change can compute the
    // same key even though the tiles underneath it are entirely different. Force the repaint.
    this.#terrainKey = "";
    this.#applyCameraTransform();
    this.#updateTerrain();
    this.#updateStaticVisibility();
  }

  /**
   * Draw the room's active authored events. Appearance only — nothing here is read for collision,
   * movement, interaction or monster awareness; the server already picked which page is active and
   * baked its collision into the tilemap. An `onTop` page draws above the actors (`#tilesAbove`),
   * everything else in the ground decor pass — the one `eventRenderLayer` routing decision. Events
   * change only on a party state flip, so this is cheap: a same-set frame touches nothing.
   */
  #reconcileEvents(events: readonly WorldEventSnapshot[]): void {
    const present = new Set<string>();
    for (const event of events) {
      present.add(event.id);
      let view = this.#events.get(event.id);
      // A decor-pass container is destroyed when `#decorLayer` is cleared on a map/element reload;
      // recreate it (the sentinel forces a redraw) rather than draw into a dead container.
      if (!view || view.container.destroyed) {
        view = { container: new Container(), data: event, drawnGraphic: undefined };
        this.#events.set(event.id, view);
      }
      const parent = eventRenderLayer(event.onTop, this.#decorLayer, this.#tilesAbove);
      if (view.container.parent !== parent) parent.addChild(view.container);
      if (view.drawnGraphic !== event.graphicAssetId) {
        view.drawnGraphic = event.graphicAssetId;
        this.#drawEventGraphic(view, event);
      }
      view.data = event;
    }
    for (const [id, view] of this.#events) {
      if (present.has(id)) continue;
      if (!view.container.destroyed) view.container.destroy({ children: true });
      this.#events.delete(id);
    }
  }

  /** Paint one event's active-page graphic into its container via the shared event crop. A `null`
   *  graphic is the authored blank tile — a legitimate active page that simply draws nothing. Art is
   *  loaded on demand; until it arrives the cell is empty and the next reconcile redraws it. */
  #drawEventGraphic(view: EventView, event: WorldEventSnapshot): void {
    for (const child of view.container.removeChildren()) child.destroy({ children: true });
    const graphicId = event.graphicAssetId;
    if (graphicId === null || !isEditorAssetId(graphicId)) return;
    const art = this.#eventAssetArt.get(graphicId);
    if (art) {
      const frame = art.frames[0];
      if (frame) view.container.addChild(createEventGraphicSprite(event.col, event.row, frame));
      return;
    }
    void loadEditorAssetArt(graphicId)
      .then((loaded) => {
        if (this.#destroyed) return;
        this.#eventAssetArt.set(graphicId, loaded);
        // Force the next reconcile to redraw this event now that its art is in hand.
        const current = this.#events.get(event.id);
        if (current && current.data.graphicAssetId === graphicId) current.drawnGraphic = undefined;
      })
      .catch(() => {
        // An unknown asset draws nothing — appearance only, so a missing graphic is never fatal.
      });
  }

  #clearEventViews(): void {
    for (const view of this.#events.values()) {
      if (!view.container.destroyed) view.container.destroy({ children: true });
    }
    this.#events.clear();
  }

  #clearTransientCombatViews(): void {
    for (const view of this.#projectiles.values()) view.container.destroy({ children: true });
    this.#projectiles.clear();
    for (const effect of this.#activeEffects) effect.container.destroy({ children: true });
    this.#activeEffects = [];
    for (const view of this.#players.values()) this.#resetVisualAction(view);
    for (const view of this.#monsters.values()) this.#resetVisualAction(view);
    this.#combatVisualAuthority.clearSnapshots();
  }

  diagnostics(): Record<string, number> {
    return {
      terrainPool: this.#belowTiles.length + this.#aboveTiles.length,
      terrainPoolAbove: this.#aboveTiles.length,
      waterObjects: this.#waterTerrain.children.length,
      staticTotal: this.#staticViews.length,
      staticVisible: this.#staticViews.filter(({ container }) => container.visible).length,
      ambientTotal: this.#ambientViews.length,
      ambientVisible: this.#ambientViews.filter(({ container }) => container.visible).length,
      actorViews:
        this.#players.size +
        this.#monsters.size +
        this.#guards.size +
        this.#loot.size +
        this.#projectiles.size +
        1,
      projectileViews: this.#projectiles.size,
      activeEffects: this.#activeEffects.length,
    };
  }

  #buildWorld(): void {
    this.#actors.sortableChildren = true;
    this.#waterSurface = this.#createWaterSurface();
    this.#resizeWorldBackground();
    // Tiny Swords' own tilemap documentation stacks these as BG Color -> Water Foam -> Flat
    // Ground, and the order is the whole trick: the foam blob is *wider* than its land tile, so
    // the ground drawn over it clips it back to a rim hugging the coast. Put foam above the
    // terrain and every island wears a halo instead of a shoreline.
    this.#world.addChild(
      this.#worldBackground,
      this.#waterTerrain,
      this.#foamTerrain,
      this.#tilesBelow,
      this.#gridOverlay,
      this.#groundDecor,
      this.#structures,
      this.#ambient,
      this.#actors,
      // Immediately after the actors, and that is the entire point of per-tile priority: an
      // `above` tile is a treetop, an awning, an upper cliff lip — something a character walks
      // *behind*. One place further down this list and a head would clip through every one of them.
      this.#tilesAbove,
      // Above the actors: a body box drawn under its own sprite would be exactly the thing you
      // cannot see when you need it.
      this.#hitboxOverlay,
      this.#worldLabels,
      this.#navigationDebug,
      this.#navigationDebugLabels,
      this.#overlay,
      this.#effects,
    );
    this.#app.stage.addChild(this.#world);
    this.#groundDecor.addChild(this.#forestTreesLayer, this.#decorLayer);

    this.#buildForestTrees();
    this.#buildDecor();
    this.#buildWorldFurniture();
    this.#applyCameraTransform();
    this.#updateTerrain();
    this.#updateStaticVisibility();
  }

  #resizeWorldBackground(): void {
    this.#worldBackground
      .clear()
      .rect(0, 0, this.#zoneWidth, this.#zoneHeight)
      .fill({ color: COLORS.grass });
  }

  #createWaterSurface(): WaterSurfaceView {
    const makeLayer = (alpha: number) =>
      new TilingSprite({
        texture: this.art.terrain.water,
        width: 0,
        height: 0,
        tileScale: { x: WATER_TEXTURE_SCALE, y: WATER_TEXTURE_SCALE },
        alpha,
      });
    const primary = makeLayer(1);
    const secondary = makeLayer(WATER_SECONDARY_ALPHA);
    this.#waterTerrain.addChild(primary, secondary);
    if (this.#waterTerrain.children.length !== WATER_RENDER_OBJECTS) {
      throw new Error("water surface must stay at two render objects");
    }
    return { primary, secondary, x: 0, y: 0, baseTint: 0xffffff, phase: 0 };
  }

  #createFoamTile(): FoamTileView {
    const blob = new Sprite({ texture: this.art.terrain.foam[0] ?? Texture.EMPTY, anchor: 0.5 });
    this.#foamTerrain.addChild(blob);
    return { blob };
  }

  /** Builds only the current zone's explicitly configured visual content. */
  #buildWorldFurniture(): void {
    // A wire map (a D1 zone, and the map-editor preview) has no authored furniture: its zone id is
    // unknown, so `#buildNpc`/`#buildQuestSites` would resolve `zoneDefinition` to the Verdant Reach
    // fallback and stamp that zone's quest keepers and rune sites onto an unrelated map. The
    // set-piece/landmark/label/ambient builders read `#visuals` (EMPTY for a wire map) and are
    // already no-ops; standing the whole thing down keeps the two catalogue-driven builders honest
    // too — same reason `#buildForestTrees`/`#buildDecor` defer to the element list here.
    if (this.#mapElements !== null) return;
    this.#buildSetPieces();
    this.#buildLandmarks();
    this.#buildQuestSites();
    this.#buildWorldLabels();
    this.#buildNpc();
    this.#buildAmbient();
  }

  /** The inverse of `#buildWorldFurniture`, called when a portal leaves Verdant Reach. `#actors`
   *  also hosts the dynamic player/monster/guard/loot/corpse views, so quest sites and NPCs are
   *  torn down individually rather than by clearing the whole container; `#groundDecor` also
   *  parents the persistent `#forestTreesLayer`/`#decorLayer`, so only their set-piece siblings
   *  are removed. */
  #teardownWorldFurniture(): void {
    for (const child of this.#structures.removeChildren()) child.destroy({ children: true });
    for (const child of this.#worldLabels.removeChildren()) child.destroy({ children: true });
    for (const child of this.#ambient.removeChildren()) child.destroy({ children: true });
    for (const child of [...this.#groundDecor.children]) {
      if (child === this.#forestTreesLayer || child === this.#decorLayer) continue;
      this.#groundDecor.removeChild(child);
      child.destroy({ children: true });
    }
    for (const site of this.#questSites) site.container.destroy({ children: true });
    for (const npc of this.#npcContainers) npc.destroy({ children: true });
    this.#questSites = [];
    this.#questNpcs = [];
    this.#npcContainers = [];
    this.#worldTextViews = [];
    this.#ambientViews = [];
    // The destroys above cascade onto every Text node this teardown owns, but never touch
    // #localizedTexts itself — filter out the now-destroyed entries rather than resetting to
    // `[]`, since #createGuard also pushes into this same array for a view that outlives
    // Verdant-Reach-only furniture and must not be dropped here.
    this.#localizedTexts = this.#localizedTexts.filter((entry) => !entry.node.destroyed);
  }

  #registerStatic(
    container: Container,
    x: number,
    y: number,
    radius: number,
    parent: Container = this.#structures,
  ): void {
    parent.addChild(container);
    this.#staticViews.push({ container, x, y, radius });
  }

  /**
   * A `forest` cell is land with a tree standing on it — not a lake and not a shoreline
   * (`isLandKind` says so). Built once per zone from `this.#tiles` — the current zone's own
   * tilemap, set by `configureZone` — not the visible-bounds window `#updateTerrain` scrolls, so
   * a tree never reshuffles when the camera moves: it is seeded from its own cell coordinates via
   * `hashSeed`, and it goes through the same static pool as every other prop in `#groundDecor`,
   * so `#updateStaticVisibility` culls it for free.
   */
  /**
   * One tree per trunk cell, standing on the grid.
   *
   * A `forest` cell *is* a tree — `build-map.ts` already thinned the forest to trunks with an open
   * canopy row above each, so there is no second list of tree positions to keep in step with
   * collision. What you collide with and what you see are the same cell, by construction.
   *
   * Nothing here is jittered or randomly sized. The old version nudged every tree by up to ±6px and
   * scaled it 0.9–1.3x, which is what made a forest look like scattered noise instead of trees: at
   * native size the art already tiles, and moving it off the grid only breaks the one thing making
   * it read. The single seeded choice left is *which* of the two sheets, so a treeline is not one
   * tree stamped in a row.
   */
  #buildForestTrees(): void {
    // On a wire map the element list is the only prop truth, so the hash-grown forest stands down.
    // A colliding element (a tree AND a stone) bakes to a `forest` cell, so this hash pass would
    // grow a tree out of every stone — `#buildMapElements` draws the authored props instead.
    if (this.#mapElements !== null) {
      this.#buildMapElements(this.#mapElements);
      return;
    }
    const tiles = this.#tiles;
    for (let row = 0; row < tiles.rows; row++) {
      for (let col = 0; col < tiles.cols; col++) {
        if (kindAt(tiles, col, row) !== "forest") continue;
        const variant = hashSeed(`forest:${col}:${row}`) % this.art.props.trees.length;
        const tree = this.art.props.trees[variant];
        if (!tree) continue;
        const x = col * TILE_SIZE + TILE_SIZE / 2;
        // The bottom of the trunk's own cell, pushed down by the sheet's empty footer so the tree
        // stands on the cell rather than hovering over it.
        const y = (row + 1) * TILE_SIZE + tree.foot;
        const container = new Container();
        container.position.set(x, y);
        const prop = createPropSprite(tree.texture);
        prop.tint = 0xcbd8ae;
        container.addChild(prop);
        this.#registerStatic(container, x, y, TILE_SIZE * 2, this.#forestTreesLayer);
      }
    }
  }

  /**
   * A wire map's authored scenery, one sprite per element. The list is the whole prop truth here:
   * a colliding element already baked its cell to `forest` in `bakeCollision`, so there is no cell
   * scan and no decor scatter — either would double a prop the author already placed, and the
   * scatter would grow a tree where a stone stands.
   *
   * Trees and bushes are strip props carrying a foot offset, stood on their cell exactly as
   * `#buildForestTrees` stands a forest tree; stones are still rocks placed on the cell's base. The
   * `variant` is folded into range because the wire validates its shape, not its magnitude. Props
   * are untinted: a D1 map has no regional palette to bend toward, and `terrainTintsAt` already
   * draws its ground at the pack's own colours (empty `worldRegions` → white).
   *
   * Drawn row-major, not in wire order: these layers have no `sortableChildren`, so draw order is
   * insertion order, and the elements arrive in D1 creation order. `#buildForestTrees` earns its
   * back-to-front depth from its row-then-col loops; a copy sorted the same way earns it here, so a
   * tree behind another never paints over the one in front regardless of which was authored first.
   */
  #buildMapElements(elements: readonly MapElement[]): void {
    const ordered = [...elements].sort((a, b) => a.row - b.row || a.col - b.col);
    for (const element of ordered) {
      const art = this.#mapAssetArt.get(element.assetId);
      if (!art) continue;
      const view = createCatalogElementView(element, art);
      if (!view) continue;
      const layer = view.layer === "canopy" ? this.#forestTreesLayer : this.#decorLayer;
      this.#registerStatic(view.container, view.x, view.y, TILE_SIZE * 2, layer);
      if (view.frames.length > 1) {
        this.#mapElementAnimations.push({ sprite: view.sprite, frames: view.frames });
      }
    }
  }

  #nearLandmark(x: number, y: number, margin: number): boolean {
    return this.#visuals.landmarks.some(
      (landmark) =>
        x >= landmark.x - margin &&
        x <= landmark.x + landmark.width + margin &&
        y >= landmark.y - margin &&
        y <= landmark.y + landmark.height + margin,
    );
  }

  /**
   * `solid` marks a pick as a tree — a prop that reads as something you'd expect to collide
   * with. `#buildDecor` only lets one stand where the tile grid agrees a tree could be: on a
   * `forest` (or `building`) cell. Everything else here (tufts, mushrooms, rocks, fences, ruins)
   * is small enough or already understood as walk-through set dressing, so it is not held to that
   * rule — only the water check applies to it.
   */
  #decorTexture(theme: DecorTheme, seed: number): { texture: Texture; tint: number } {
    // No trees here, ever. A tree is a forest cell — `#buildForestTrees` draws exactly one per
    // trunk, so a decor pass that also scattered trees would stack a second tree on a cell that
    // already has one, which is the rule this whole system exists to enforce. Decor is ground
    // clutter: what grows *between* the trees.
    if (theme === "forest") {
      const pool = seed % 3 === 0 ? this.art.props.mushrooms : this.art.props.leaves;
      return { texture: pickTexture(pool, seed), tint: 0xd8e8b8 };
    }
    if (theme === "marsh" || theme === "wet") {
      const pool =
        seed % 5 === 0
          ? this.art.props.mushrooms
          : seed % 7 === 0
            ? [this.art.props.log, this.art.props.stump]
            : this.art.props.tufts;
      return { texture: pickTexture(pool, seed), tint: 0xbfd2b0 };
    }
    if (theme === "ruin" || theme === "gate") {
      return { texture: pickTexture(this.art.props.rocks, seed), tint: 0xcacbb4 };
    }
    if (theme === "farm") {
      const pool = seed % 5 === 0 ? this.art.props.roots : this.art.props.tufts;
      return { texture: pickTexture(pool, seed), tint: 0xe0d1a5 };
    }
    if (theme === "road") {
      return { texture: pickTexture(this.art.props.rocks, seed), tint: 0xd8cfaa };
    }
    const pool = seed % 4 === 0 ? this.art.props.leaves : this.art.props.tufts;
    return { texture: pickTexture(pool, seed), tint: theme === "village" ? 0xe5dbb7 : 0xe9e1b8 };
  }

  #buildDecor(): void {
    // A wire map has no decor regions and its props are the authored element list, drawn by
    // `#buildMapElements`. Skipping keeps a scatter pass from growing clutter over those props —
    // and `EMPTY_ZONE_VISUALS.decorRegions` is empty anyway, so this only makes the intent explicit.
    if (this.#mapElements !== null) return;
    const tiles = this.#tiles;
    const safeZone = this.#visuals.safeZone;
    /** Cells already holding a prop, so a region cannot stack two on one square. */
    const taken = new Set<string>();
    for (const region of this.#visuals.decorRegions) {
      for (let index = 0; index < region.count; index++) {
        const seed = region.seed + index * 19;
        const angle = seeded(seed + 3) * Math.PI * 2;
        const radius = Math.sqrt(seeded(seed + 9));
        // The region still *chooses* where clutter clusters, but the cell it lands on is the grid's
        // to decide: snap to the cell that point falls in and draw on that cell's centre line.
        // Nothing sits at a pixel nobody chose.
        const col = Math.floor((region.x + Math.cos(angle) * region.radiusX * radius) / TILE_SIZE);
        const row = Math.floor((region.y + Math.sin(angle) * region.radiusY * radius) / TILE_SIZE);
        const cell = `${col}:${row}`;
        // One prop per cell. Two bushes on one square is the same mistake as two trees on one.
        if (taken.has(cell)) continue;
        const x = col * TILE_SIZE + TILE_SIZE / 2;
        const y = (row + 1) * TILE_SIZE;
        if (x < 120 || y < 120 || x > this.#zoneWidth - 120 || y > this.#zoneHeight - 120) continue;
        if (roadStrength(x, y, this.#visuals.roads) > 0) continue;
        if (this.#nearLandmark(x, y, 70)) continue;
        const inSquare =
          safeZone !== null &&
          x > safeZone.x + 210 &&
          x < safeZone.x + safeZone.width - 170 &&
          y > safeZone.y + 250 &&
          y < safeZone.y + safeZone.height - 110;
        if (inSquare) continue;

        // Clutter grows on open ground. `forest` cells are trunks and already hold a tree; water is
        // water. What you see must be what you collide with, and the tile grid is the one truth.
        const kind = kindAt(tiles, col, row);
        if (kind !== "grass") continue;

        taken.add(cell);
        const selection = this.#decorTexture(region.theme, seed);
        const container = new Container();
        container.position.set(x, y);
        const prop = createPropSprite(selection.texture);
        prop.tint = selection.tint;
        container.addChild(prop);
        this.#registerStatic(container, x, y, TILE_SIZE * 2, this.#decorLayer);
      }
    }
  }

  #buildSetPieces(): void {
    for (const poi of this.#visuals.pointsOfInterest) {
      if (poi.kind === "square") this.#buildSquare(poi);
      else if (poi.kind === "sign") this.#buildRoadSign(poi);
      else if (poi.kind === "clearing") this.#buildClearing(poi);
      else if (poi.kind === "farm") this.#buildFarmFields(poi);
      else if (poi.kind === "bridge") this.#buildBridge(poi);
      else if (poi.kind === "ford") this.#buildFord(poi);
      else if (poi.kind === "camp") this.#buildCamp(poi);
      else if (poi.kind === "danger") this.#buildDangerMark(poi);
    }
  }

  #buildSquare(poi: PointOfInterest): void {
    const square = new Container();
    square.position.set(poi.x, poi.y);
    square.addChild(
      new Graphics()
        .roundRect(-260, -145, 520, 290, 72)
        .fill({ color: 0xc5d7a9, alpha: 0.08 })
        .stroke({ width: 3, color: 0xf0d58f, alpha: 0.22 })
        .circle(0, 0, 82)
        .stroke({ width: 2, color: 0xa6d2b7, alpha: 0.24 }),
    );
    for (let index = 0; index < 8; index++) {
      const angle = (index / 8) * Math.PI * 2;
      const stone = createPropSprite(pickTexture(this.art.props.rocks, index));
      stone.anchor.set(0.5, 1);
      stone.position.set(Math.cos(angle) * 78, Math.sin(angle) * 48);
      square.addChild(stone);
    }
    this.#registerStatic(square, poi.x, poi.y, 320, this.#groundDecor);
  }

  #buildRoadSign(poi: PointOfInterest): void {
    const sign = new Container();
    sign.position.set(poi.x, poi.y);
    const board = createPropSprite(this.art.signBoard);
    board.anchor.set(0.5, 1);
    board.position.set(0, 0);
    sign.addChild(board);
    const computeText = () => t(poi.nameKey);
    const text = new Text({
      text: computeText(),
      style: {
        fontFamily: "Georgia, serif",
        fontSize: 10,
        fontWeight: "bold",
        fill: 0x493627,
        align: "center",
        wordWrap: true,
        wordWrapWidth: 92,
      },
    });
    text.anchor.set(0.5);
    text.position.set(0, -38);
    sign.addChild(text);
    this.#localizedTexts.push({ node: text, compute: computeText });
    this.#registerStatic(sign, poi.x, poi.y, 90);
  }

  #buildClearing(poi: PointOfInterest): void {
    const ring = new Container();
    ring.position.set(poi.x, poi.y);
    ring.addChild(
      new Graphics()
        .circle(0, 0, 176)
        .fill({ color: 0xf4e7a6, alpha: 0.04 })
        .stroke({ width: 2, color: 0xf3d38c, alpha: 0.18 }),
    );
    for (let index = 0; index < 18; index++) {
      const angle = (index / 18) * Math.PI * 2 + seeded(index + 70) * 0.08;
      const radius = 164 + seeded(index + 80) * 22;
      const prop = createPropSprite(
        index % 3 === 0
          ? pickTexture(this.art.props.rocks, index)
          : pickTexture(this.art.props.tufts, index),
      );
      prop.anchor.set(0.5, 1);
      prop.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius);
      ring.addChild(prop);
    }
    this.#registerStatic(ring, poi.x, poi.y, 230, this.#groundDecor);
  }

  #buildFarmFields(poi: PointOfInterest): void {
    const fields = new Container();
    fields.position.set(poi.x, poi.y);
    const plots = [
      { x: -520, y: -180, width: 250, height: 360 },
      { x: 270, y: -170, width: 250, height: 340 },
    ];
    for (const plot of plots) {
      const ground = new Graphics()
        .roundRect(plot.x, plot.y, plot.width, plot.height, 22)
        .fill({ color: 0x806b45, alpha: 0.38 })
        .stroke({ width: 2, color: 0xc4a670, alpha: 0.24 });
      for (let row = plot.y + 28; row < plot.y + plot.height - 12; row += 34) {
        ground
          .moveTo(plot.x + 18, row)
          .lineTo(plot.x + plot.width - 18, row)
          .stroke({ width: 3, color: 0xb2955f, alpha: 0.42 });
      }
      fields.addChild(ground);
      const fence = new Graphics()
        .rect(plot.x, plot.y + plot.height - 4, plot.width, 7)
        .fill({ color: 0x574735 });
      for (let post = 0; post < 6; post++) {
        fence
          .rect(plot.x + post * (plot.width / 5) - 3, plot.y + plot.height - 18, 6, 25)
          .fill({ color: 0x755b3d });
      }
      fields.addChild(fence);
    }
    this.#registerStatic(fields, poi.x, poi.y, 610, this.#groundDecor);
  }

  #buildBridge(poi: PointOfInterest): void {
    const bridge = new Container();
    bridge.position.set(poi.x, poi.y);
    const wood = new Graphics().roundRect(-132, -104, 264, 208, 8).fill({ color: 0x816746 });
    for (let x = -120; x <= 120; x += 24) {
      wood.rect(x, -100, 4, 200).fill({ color: 0xc09a63, alpha: 0.68 });
    }
    wood
      .rect(-132, -104, 264, 8)
      .fill({ color: 0x4d4636 })
      .rect(-132, 96, 264, 8)
      .fill({ color: 0x4d4636 });
    bridge.addChild(wood);
    const rails = new Graphics();
    for (const y of [-98, 98]) {
      rails.rect(-132, y - 4, 264, 8).fill({ color: 0x4d4233 });
      for (let x = -120; x <= 120; x += 48) {
        rails.rect(x - 3, y - 18, 6, 36).fill({ color: 0x73583c });
      }
    }
    bridge.addChild(rails);
    this.#registerStatic(bridge, poi.x, poi.y, 220, this.#groundDecor);
  }

  #buildFord(poi: PointOfInterest): void {
    const ford = new Container();
    ford.position.set(poi.x, poi.y);
    ford.addChild(
      new Graphics()
        .ellipse(0, 0, 132, 72)
        .fill({ color: 0x7ca9a0, alpha: 0.2 })
        .stroke({ width: 2, color: 0xb9dbca, alpha: 0.24 }),
    );
    for (let index = 0; index < 9; index++) {
      const rock = createPropSprite(pickTexture(this.art.props.rocks, index));
      rock.anchor.set(0.5, 1);
      rock.position.set(-104 + index * 26, Math.sin(index * 1.7) * 18);
      ford.addChild(rock);
    }
    this.#registerStatic(ford, poi.x, poi.y, 160, this.#groundDecor);
  }

  #buildCamp(poi: PointOfInterest): void {
    const camp = new Container();
    camp.position.set(poi.x, poi.y);
    camp.addChild(
      new Graphics()
        .circle(0, 0, 24)
        .fill({ color: 0x352f29, alpha: 0.75 })
        .circle(0, -3, 12)
        .fill({ color: 0xf6b24d, alpha: 0.88 })
        .circle(0, -6, 6)
        .fill({ color: 0xffe39a, alpha: 0.9 }),
    );
    for (const [x, y, rotation] of [
      [-38, 8, -0.7],
      [38, 8, 0.7],
      [0, 35, 1.55],
    ] as const) {
      const log = createPropSprite(this.art.props.log);
      log.anchor.set(0.5);
      log.position.set(x, y);
      log.rotation = rotation;
      camp.addChild(log);
    }
    for (const [x, y] of [
      [-118, -52],
      [112, -38],
    ] as const) {
      const shelter = createPropSprite(pickTexture(this.art.props.ruins, 5));
      shelter.anchor.set(0.5, 1);
      shelter.position.set(x, y);
      camp.addChild(shelter);
    }
    this.#registerStatic(camp, poi.x, poi.y, 210);
  }

  #buildDangerMark(poi: PointOfInterest): void {
    const mark = new Container();
    mark.position.set(poi.x, poi.y);
    mark.addChild(
      new Graphics()
        .circle(0, 0, 92)
        .stroke({ width: 3, color: 0x77947c, alpha: 0.24 })
        .circle(0, 0, 54)
        .stroke({ width: 2, color: 0xb7ce91, alpha: 0.18 }),
    );
    for (let index = 0; index < 14; index++) {
      const angle = (index / 14) * Math.PI * 2;
      const radius = 54 + seeded(index + 410) * 44;
      const prop = createPropSprite(
        index % 4 === 0 ? this.art.props.stump : pickTexture(this.art.props.mushrooms, index),
      );
      prop.anchor.set(0.5, 1);
      prop.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius);
      mark.addChild(prop);
    }
    this.#registerStatic(mark, poi.x, poi.y, 145, this.#groundDecor);
  }

  #buildLandmarks(): void {
    for (const [index, landmark] of this.#visuals.landmarks.entries()) {
      const container = new Container();
      container.position.set(landmark.x, landmark.y);
      const centerX = landmark.x + landmark.width / 2;
      const centerY = landmark.y + landmark.height / 2;
      const radius = Math.hypot(landmark.width, landmark.height) / 2 + 50;

      if (landmark.kind === "sacred_tree") {
        container.addChild(
          new Graphics()
            .circle(landmark.width / 2, landmark.height * 0.54, landmark.width * 0.42)
            .stroke({ width: 4, color: 0xf0d98b, alpha: 0.18 }),
        );
        for (let root = 0; root < 7; root++) {
          const sprite = createPropSprite(pickTexture(this.art.props.roots, root));
          sprite.anchor.set(0.5, 1);
          sprite.position.set(
            landmark.width / 2 + (root - 3) * 25,
            landmark.height - 12 + Math.abs(root - 3) * 3,
          );
          sprite.rotation = (root - 3) * 0.18;
          container.addChild(sprite);
        }
        const tree = createPropSprite(this.art.props.trees[0]?.texture ?? Texture.EMPTY);
        tree.anchor.set(0.5, 1);
        tree.position.set(landmark.width / 2, landmark.height);
        tree.tint = 0xf0e5b1;
        container.addChild(tree);
      } else if (landmark.kind === "dungeon_gate") {
        for (let part = 0; part < 5; part++) {
          const prop = createPropSprite(pickTexture(this.art.props.ruins, part < 2 ? 1 : 0));
          prop.anchor.set(0.5, 1);
          prop.position.set((landmark.width * part) / 4, landmark.height);
          prop.tint = 0xbfc6b0;
          container.addChild(prop);
        }
        this.#addTorch(container, landmark.width * 0.28, landmark.height - 40);
        this.#addTorch(container, landmark.width * 0.72, landmark.height - 40);
      } else if (landmark.kind === "graveyard") {
        container.addChild(
          new Graphics()
            .ellipse(landmark.width / 2, landmark.height + 32, landmark.width * 0.48, 22)
            .fill({ color: 0x324348, alpha: 0.16 }),
        );
        // 4 is the Monastery in TINY_SWORDS_BUILDINGS — the closest thing the pack has to a chapel.
        const chapel = createPropSprite(pickTexture(this.art.buildings, 4));
        chapel.anchor.set(0.5, 1);
        chapel.position.set(landmark.width / 2, landmark.height);
        chapel.tint = 0xc3cfdb;
        container.addChild(chapel);
        // Headstones in the yard below the chapel, where the spirit anchor sits.
        for (let stone = 0; stone < 6; stone++) {
          const headstone = createPropSprite(pickTexture(this.art.props.rocks, index + stone));
          headstone.anchor.set(0.5, 1);
          headstone.position.set(
            8 + stone * ((landmark.width - 16) / 5),
            landmark.height + 34 + (stone % 2) * 20,
          );
          headstone.tint = 0x9fb0bd;
          container.addChild(headstone);
        }
        this.#addTorch(container, -18, landmark.height + 14);
        this.#addTorch(container, landmark.width + 18, landmark.height + 14);
      } else {
        const isBuilding = landmark.kind === "building" || landmark.kind === "farm";
        const pool = isBuilding ? this.art.buildings : this.art.props.ruins;
        const artIndex = isBuilding ? (CITY_BUILDING_ART[landmark.id] ?? index) : index;
        const prop = createPropSprite(pickTexture(pool, artIndex));
        prop.anchor.set(0.5, 1);
        prop.position.set(landmark.width / 2, landmark.height);
        prop.tint = isBuilding
          ? 0xffffff
          : landmark.kind === "swamp_shrine"
            ? 0xb8c4a7
            : landmark.kind === "farm"
              ? 0xe2cf9f
              : landmark.kind === "ruin"
                ? 0xd2d0b5
                : 0xf1e4be;
        container.addChild(prop);
        if (landmark.kind === "building") {
          this.#addTorch(container, landmark.width / 2 + 38, landmark.height - 26);
        }
      }
      this.#registerStatic(container, centerX, centerY, radius);
    }
  }

  #addTorch(container: Container, x: number, y: number): void {
    const torch = createPropSprite(this.art.props.torch);
    torch.anchor.set(0.5, 1);
    torch.position.set(x, y);
    container.addChild(torch);
  }

  #buildWorldLabels(): void {
    for (const zone of this.#visuals.worldRegions) {
      const computeZoneLabel = () => t(zone.nameKey).toUpperCase();
      const label = new Text({
        text: computeZoneLabel(),
        style: {
          fontFamily: "Georgia, serif",
          fontSize: 13,
          fill: 0xdde3c8,
          letterSpacing: 0,
          dropShadow: { color: 0x000000, alpha: 0.7, blur: 3, distance: 2 },
        },
      });
      label.anchor.set(0.5);
      label.position.set(zone.x, zone.y - Math.min(220, zone.radiusY * 0.4));
      label.alpha = 0;
      this.#worldLabels.addChild(label);
      this.#worldTextViews.push({
        label,
        x: label.x,
        y: label.y,
        revealRadius: Math.max(420, Math.min(zone.radiusX, zone.radiusY)),
        zoneId: zone.id,
      });
      this.#localizedTexts.push({ node: label, compute: computeZoneLabel });
    }

    for (const poi of this.#visuals.pointsOfInterest) {
      if (poi.kind === "tree" || poi.kind === "square" || poi.kind === "sign") continue;
      const computePoiLabel = () => t(poi.nameKey);
      const label = new Text({
        text: computePoiLabel(),
        style: {
          fontFamily: "Georgia, serif",
          fontSize: 11,
          fill: poi.kind === "gate" || poi.kind === "danger" ? 0xe4c0a8 : 0xece5c9,
          letterSpacing: 0,
          dropShadow: { color: 0x000000, alpha: 0.85, blur: 3, distance: 1 },
        },
      });
      label.anchor.set(0.5, 1);
      label.position.set(poi.x, poi.y - 86);
      label.alpha = 0;
      this.#worldLabels.addChild(label);
      this.#worldTextViews.push({
        label,
        x: label.x,
        y: label.y,
        revealRadius: poi.revealRadius,
      });
      this.#localizedTexts.push({ node: label, compute: computePoiLabel });
    }
  }

  #buildQuestSites(): void {
    const runeGlyphs = ["◆", "☾", "▲", "♛"] as const;
    for (const site of zoneDefinition(this.#currentZoneId).questSites) {
      const container = new Container();
      container.position.set(site.x, site.y);
      container.zIndex = site.y + PLAYER_SIZE;
      const signal = new Graphics()
        .circle(0, -18, 30)
        .stroke({ width: 3, color: 0xffdf77, alpha: 0.9 })
        .circle(0, -18, 20)
        .stroke({ width: 1.5, color: 0xfff4bd, alpha: 0.8 });
      signal.alpha = 0;
      container.addChild(signal);
      if (site.kind === "resource") {
        const texture = this.art.questResources[site.art as keyof typeof TINY_SWORDS_QUEST_ART];
        const sprite = createPropSprite(texture);
        sprite.anchor.set(0.5, 1);
        sprite.position.set(0, 12);
        container.addChild(sprite);
      } else if (site.kind === "rune") {
        container.addChild(
          new Graphics()
            .roundRect(-22, -38, 44, 50, 9)
            .fill({ color: 0x5b665f, alpha: 1 })
            .stroke({ width: 3, color: 0x9dc9aa, alpha: 0.75 }),
        );
        const glyph = new Text({
          text: runeGlyphs[site.order] ?? "◆",
          style: { fontFamily: "Georgia, serif", fontSize: 22, fill: 0x9effc2 },
        });
        glyph.anchor.set(0.5);
        glyph.position.set(0, -14);
        container.addChild(glyph);
      } else {
        const tower = createPropSprite(pickTexture(this.art.buildings, 5));
        tower.anchor.set(0.5, 1);
        tower.position.set(0, 12);
        tower.tint = 0xd9c5a2;
        container.addChild(tower);
        this.#addTorch(container, 0, -52);
      }

      const computeLabel = () => t(`quest.site.${site.id}` as MessageKey);
      const label = new Text({
        text: computeLabel(),
        style: {
          fontFamily: "Georgia, serif",
          fontSize: 11,
          fill: 0xffe8a5,
          align: "center",
          dropShadow: { color: 0x000000, alpha: 0.9, blur: 3, distance: 1 },
        },
      });
      label.anchor.set(0.5, 1);
      label.position.set(0, site.kind === "ward" ? -100 : -48);
      container.addChild(label);
      this.#localizedTexts.push({ node: label, compute: computeLabel });
      this.#questSites.push({
        id: site.id,
        chapter: site.chapter,
        order: site.order,
        container,
        signal,
        label,
        hiddenUntil: 0,
      });
      this.#registerStatic(container, site.x, site.y, site.kind === "ward" ? 90 : 60, this.#actors);
    }
  }

  #buildNpc(): void {
    const tints = [0xffffff, 0xd8e5ff, 0xbef1cf, 0xffd6ab] as const;
    for (const [index, quest] of zoneDefinition(this.#currentZoneId).quests.entries()) {
      const npc = new Container();
      npc.position.set(quest.giver.x, quest.giver.y);
      npc.zIndex = quest.giver.y + PLAYER_SIZE;
      npc.addChild(new Graphics().ellipse(16, 31, 18, 7).fill({ color: 0x000000, alpha: 0.38 }));
      npc.addChild(new Graphics().circle(16, 15, 27).fill({ color: COLORS.npc, alpha: 0.08 }));
      const keeper = createSprite(this.art.keeper, 34, 34);
      keeper.anchor.set(0.5, 1);
      keeper.position.set(16, 35);
      keeper.tint = tints[index] ?? 0xffffff;
      npc.addChild(keeper);
      const questMark = new Text({
        text: "!",
        style: {
          fontFamily: "Georgia, serif",
          fontSize: 38,
          fill: COLORS.npc,
          dropShadow: { color: 0x4a2f00, alpha: 1, blur: 8, distance: 0 },
        },
      });
      questMark.anchor.set(0.5);
      questMark.position.set(16, -40);
      npc.addChild(questMark);
      const computeNpcLabel = () =>
        `${t(`npc.${quest.giver.id}.name` as MessageKey)}\n${t(`npc.${quest.giver.id}.role` as MessageKey)}`;
      const label = new Text({
        text: computeNpcLabel(),
        style: {
          fontFamily: "Georgia, serif",
          fontSize: 11,
          fill: 0xffe5a6,
          align: "center",
          dropShadow: { color: 0x000000, alpha: 0.9, blur: 3, distance: 1 },
        },
      });
      label.anchor.set(0.5, 1);
      label.position.set(16, -3);
      label.alpha = 0;
      npc.addChild(label);
      this.#questNpcs.push({
        chapter: quest.id,
        x: quest.giver.x,
        y: quest.giver.y,
        mark: questMark,
        label,
      });
      this.#localizedTexts.push({ node: label, compute: computeNpcLabel });
      this.#npcContainers.push(npc);
      this.#actors.addChild(npc);
    }
  }

  #buildAmbient(): void {
    let ambientIndex = 0;
    for (const region of this.#visuals.ambientRegions) {
      for (let index = 0; index < region.count; index++) {
        const seed = 5100 + ambientIndex * 29;
        ambientIndex += 1;
        const light = new Graphics().rect(-1, -1, 2, 2).fill({ color: region.color, alpha: 0.78 });
        light.position.set(
          region.x + (seeded(seed + 3) - 0.5) * region.radiusX * 2,
          region.y + (seeded(seed + 7) - 0.5) * region.radiusY * 2,
        );
        this.#ambient.addChild(light);
        this.#ambientViews.push({
          container: light,
          baseX: light.x,
          baseY: light.y,
          phase: seeded(seed + 11) * Math.PI * 2,
          sway: 5 + seeded(seed + 17) * 9,
        });
      }
    }
  }

  #cameraScale(): number {
    return gameCameraScale(this.#app.screen.width, this.#app.screen.height);
  }

  #followSelf(players: readonly PlayerSnapshot[], now: number): void {
    const self = players.find((player) => player.id === this.#selfId);
    const target = self ? centerOf(self) : { x: this.#cameraX, y: this.#cameraY };
    const distance = Math.hypot(target.x - this.#cameraX, target.y - this.#cameraY);
    if (!this.#cameraReady || distance > 640) {
      this.#cameraX = target.x;
      this.#cameraY = target.y;
      this.#cameraReady = true;
    } else {
      const dt = Math.min(0.05, Math.max(0, (now - this.#lastCameraAt) / 1000));
      const alpha = 1 - Math.exp(-dt * 8.5);
      this.#cameraX += (target.x - this.#cameraX) * alpha;
      this.#cameraY += (target.y - this.#cameraY) * alpha;
    }
    this.#lastCameraAt = now;
    this.#applyCameraTransform();
  }

  #applyCameraTransform(): void {
    const scale = this.#cameraScale();
    this.#world.scale.set(scale);
    this.#world.position.set(
      cameraAxisOffset(this.#app.screen.width, this.#zoneWidth, scale, this.#cameraX),
      cameraAxisOffset(this.#app.screen.height, this.#zoneHeight, scale, this.#cameraY),
    );
  }

  #visibleBounds(margin = 0): WorldBounds {
    const scale = this.#world.scale.x || 1;
    return {
      left: Math.max(0, -this.#world.x / scale - margin),
      top: Math.max(0, -this.#world.y / scale - margin),
      right: Math.min(this.#zoneWidth, (this.#app.screen.width - this.#world.x) / scale + margin),
      bottom: Math.min(
        this.#zoneHeight,
        (this.#app.screen.height - this.#world.y) / scale + margin,
      ),
    };
  }

  #isVisibleWorld(x: number, y: number, margin = 0): boolean {
    const bounds = this.#visibleBounds(margin);
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }

  /**
   * Paints the visible window.
   *
   * An authored map is drawn from **frozen ids**: the variant was decided when the map was painted,
   * so this reads `#layers` and looks the cell up in the tileset. The mask computation that used to
   * happen here per cell, per repaint, is gone — it belongs to the brush, not the renderer, and a
   * renderer that re-derives it is a second opinion nothing keeps in step with the first.
   *
   * A compiled catalogue zone carries no layers and keeps the old derived pass, which paints from
   * the `TileMap` itself via `tileVisual`/`landTile`. That is the whole reason the two live side by
   * side: the catalogue is rollback content, and it would otherwise render as bare sea.
   *
   * Both passes share the water and foam work above them, and `needsFoam` reads the baked `tiles` in
   * both — deliberately. Foam belongs where the water actually meets something, so a cliff standing
   * at the shore gets its rim at the wall's own cell.
   *
   * `#layers` is appearance only. Nothing below reads it for walkability, geometry or collision;
   * `#tiles` remains the single truth for all three, exactly the rule `#mapElements` follows.
   *
   * The sprite pool, the visible-bounds culling and the `#terrainKey` early-out are unchanged; only
   * the per-cell decision, and the fact that a cell may now produce more than one sprite, are new.
   */
  #updateTerrain(): void {
    const tiles = this.#tiles;
    const bounds = this.#visibleBounds(TILE_SIZE * 2);
    const { startX, startY, columns, rows } = tileWindowForBounds(
      bounds,
      this.#zoneWidth,
      this.#zoneHeight,
      TILE_SIZE,
    );
    // `#showGrid` belongs in the key: this method early-returns when nothing has changed, so a
    // toggle that is not part of the key would not repaint until the player happened to walk into
    // a new tile window.
    const key = `${this.#currentZoneId}:${this.#currentMapRevision}:${startX}:${startY}:${columns}:${rows}:${this.#showGrid}`;
    if (key === this.#terrainKey) return;
    this.#terrainKey = key;

    this.#belowUsed = 0;
    this.#aboveUsed = 0;
    const waterRect = waterSurfaceRect(
      startX,
      startY,
      columns,
      rows,
      TILE_SIZE,
      this.#zoneWidth,
      this.#zoneHeight,
    );
    const water = this.#waterSurface;
    if (water) {
      const visible = waterRect.width > 0 && waterRect.height > 0;
      const tints = terrainTintsAt(
        waterRect.x + waterRect.width / 2,
        waterRect.y + waterRect.height / 2,
        this.#visuals.worldRegions,
      );
      for (const layer of [water.primary, water.secondary]) {
        layer.visible = visible;
        layer.position.set(waterRect.x, waterRect.y);
        layer.width = waterRect.width;
        layer.height = waterRect.height;
        layer.tint = tints.water;
      }
      water.x = waterRect.x;
      water.y = waterRect.y;
      water.baseTint = tints.water;
      water.phase = (waterRect.x * 0.0057 + waterRect.y * 0.0091) % (Math.PI * 2);
    }
    for (const view of this.#foamTilePool) view.blob.visible = false;
    this.#foamTiles = [];
    // This is `false` only when `#adoptLayers` bailed out on an unknown tileset, leaving `#layers`
    // the literal `[]` it starts as — so the loop below falls through to the derived autotile pass
    // over `tiles`, which still paints land, because with no tileset there is nothing else left to
    // read a cell from.
    //
    // It stays `true` when every layer parsed but came back malformed: `#adoptLayers` maps each bad
    // layer to `emptyLayer(...)`, not to nothing, so `#layers.length` still equals the appearance's
    // declared layer count and every cell below resolves to `{ kind: "empty" }` and draws nothing —
    // the map renders as bare sea, not the derived pass.
    //
    // Both are intentional, not an oversight one of them should match: an unknown tileset means
    // there is no tileset to read a cell, a priority or a tint from at all, so falling back to
    // derived terrain is the only data left to draw. Three malformed layers under a *known* tileset
    // did parse — they just said "empty" for every cell — and falling back the same way would make
    // an authored, legitimately empty layer indistinguishable from a corrupted one.
    const layered = this.#layers.length > 0;
    for (let index = 0; index < columns * rows; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = startX + column * TILE_SIZE;
      const y = startY + row * TILE_SIZE;
      const col = Math.floor(x / TILE_SIZE);
      const tileRow = Math.floor(y / TILE_SIZE);
      const tints = terrainTintsAt(
        x + TILE_SIZE / 2,
        y + TILE_SIZE / 2,
        this.#visuals.worldRegions,
      );
      if (layered) {
        this.#paintLayeredCell(col, tileRow, x, y);
      } else if (tileVisual(kindAt(tiles, col, tileRow)) === "land") {
        const tile = this.#acquireTile("below");
        placeTile(
          tile,
          landTexture(this.art.terrain.land, landTile(tiles, col, tileRow)),
          x,
          y,
          Math.min(TILE_SIZE, this.#zoneWidth - x),
          Math.min(TILE_SIZE, this.#zoneHeight - y),
        );
        tile.alpha = 1;
        tile.tint = tints.land;
      }
      // Foam reads the baked `tiles` in both passes, and that is the point: a cliff wall meeting
      // the sea is not a land *tile*, but it is where the water meets something, and that is where
      // the rim belongs.
      if (needsFoam(tiles, col, tileRow)) {
        const foam = this.#foamTilePool[this.#foamTiles.length] ?? this.#createFoamTile();
        if (this.#foamTiles.length >= this.#foamTilePool.length) this.#foamTilePool.push(foam);
        // Centred on the tile at the sheet's native size: the frame is 192px of mostly nothing
        // around an ~82px blob, so an unscaled draw is what puts that blob 9px past a 64px tile.
        // Scaling it to the tile would shrink the bleed to nothing and the shore would vanish.
        foam.blob.visible = true;
        foam.blob.position.set(x + TILE_SIZE / 2, y + TILE_SIZE / 2);
        foam.blob.tint = tints.water;
        this.#foamTiles.push(foam);
      }
    }
    this.#hideUnusedTiles();
    this.#drawGrid(startX, startY, columns, rows);
  }

  /**
   * One cell of an authored map: every layer that has something to say about it, in order, each
   * routed to the container its own tileset entry asks for.
   *
   * An id nothing can answer for — an empty cell, a slot past what the tileset declares, a variant
   * its autotile's kind can't produce (`autotileSheetCell`), a sheet cell outside the sliced grid —
   * draws nothing rather than throwing. This runs inside a repaint, and a frame is the worst
   * possible place to discover a bad id; the parse-time warning in `#adoptLayers` is where a broken
   * map is reported.
   */
  #paintLayeredCell(col: number, row: number, x: number, y: number): void {
    const tileset = this.#tileset;
    if (!tileset) return;
    for (const layer of this.#layers) {
      const draw = tileDrawAt(tileset, layer, col, row);
      if (!draw) continue;
      const texture = this.art.terrain.tileset[draw.cell.row]?.[draw.cell.col];
      if (!texture) continue;
      const sprite = this.#acquireTile(draw.priority);
      placeTile(
        sprite,
        texture,
        x,
        y,
        Math.min(TILE_SIZE, this.#zoneWidth - x),
        Math.min(TILE_SIZE, this.#zoneHeight - y),
      );
      sprite.alpha = 1;
      // The tileset's own tint, not the zone's regional one: elevation shading is baked into the
      // entry, and an authored map has no regional palette to bend toward in the first place.
      sprite.tint = draw.tint;
    }
  }

  /** Hands out the next pooled sprite for a priority, growing that container's pool on demand. */
  #acquireTile(priority: TilePriority): Sprite {
    const above = priority === "above";
    const pool = above ? this.#aboveTiles : this.#belowTiles;
    const index = above ? this.#aboveUsed++ : this.#belowUsed++;
    const existing = pool[index];
    if (existing) {
      existing.visible = true;
      return existing;
    }
    const sprite = new Sprite(Texture.EMPTY);
    pool.push(sprite);
    (above ? this.#tilesAbove : this.#tilesBelow).addChild(sprite);
    return sprite;
  }

  /** The tail of each pool that this repaint did not need. Hidden rather than destroyed — the next
   *  window is very likely to want them back. */
  #hideUnusedTiles(): void {
    for (let index = this.#belowUsed; index < this.#belowTiles.length; index += 1) {
      const sprite = this.#belowTiles[index];
      if (sprite) sprite.visible = false;
    }
    for (let index = this.#aboveUsed; index < this.#aboveTiles.length; index += 1) {
      const sprite = this.#aboveTiles[index];
      if (sprite) sprite.visible = false;
    }
  }

  /** A debug overlay, drawn in world space so the lines sit exactly on the cells `tilemap.ts`
   *  actually stores — a grid drawn in screen space would drift from the collision truth it is
   *  there to reveal.
   *
   *  It reads `isSolidKind` rather than "is it drawn as water", because those are different
   *  questions: a forest cell is grass with a tree on it and blocks you all the same. Shading what
   *  the renderer *paints* would draw a pretty lie over the thing being debugged.
   */
  #drawGrid(startX: number, startY: number, columns: number, rows: number): void {
    this.#gridOverlay.clear();
    if (!this.#showGrid) return;
    const tiles = this.#tiles;
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const x = startX + column * TILE_SIZE;
        const y = startY + row * TILE_SIZE;
        const col = Math.floor(x / TILE_SIZE);
        const tileRow = Math.floor(y / TILE_SIZE);
        if (!isSolidKind(kindAt(tiles, col, tileRow))) continue;
        this.#gridOverlay.rect(x, y, TILE_SIZE, TILE_SIZE);
      }
    }
    this.#gridOverlay.fill({ color: GRID_SOLID_COLOR, alpha: GRID_SOLID_ALPHA });
    for (let column = 0; column <= columns; column += 1) {
      const x = startX + column * TILE_SIZE;
      this.#gridOverlay.moveTo(x, startY).lineTo(x, startY + rows * TILE_SIZE);
    }
    for (let row = 0; row <= rows; row += 1) {
      const y = startY + row * TILE_SIZE;
      this.#gridOverlay.moveTo(startX, y).lineTo(startX + columns * TILE_SIZE, y);
    }
    this.#gridOverlay.stroke({ width: 1, color: GRID_LINE_COLOR, alpha: GRID_LINE_ALPHA });

    // Portals have no art by design; this debug ring is the only way to see one. It is drawn at the
    // real INTERACTION_RANGE, so what you see is the distance the server actually tests in
    // `#interact` — a ring at any other radius would be a lie about where the portal starts working.
    for (const portal of this.#portals) {
      this.#gridOverlay.circle(portal.x, portal.y, INTERACTION_RANGE);
    }
    if (this.#portals.length > 0) {
      this.#gridOverlay.stroke({ width: 2, color: PORTAL_RING_COLOR, alpha: 0.9 });
    }
  }

  /**
   * Every body the simulation collides as a box, drawn where it actually is.
   *
   * Redrawn per frame rather than with the grid: bodies move and the terrain does not. The boxes
   * come from `entityBox`, the same helper the rules use, so a sprite that looks off-centre from
   * its box is telling the truth about the art, not about a bug in this overlay.
   */
  #drawHitboxes(sample: SceneSample): void {
    this.#hitboxOverlay.clear();
    if (!import.meta.env.DEV || !this.#showGrid) return;
    const bodies = [...sample.players, ...sample.monsters, ...sample.guards];
    for (const body of bodies) {
      const box = entityBox({ x: body.x, y: body.y });
      this.#hitboxOverlay.rect(box.x, box.y, box.width, box.height);
    }
    if (bodies.length > 0) {
      this.#hitboxOverlay.stroke({ width: 1, color: HITBOX_COLOR, alpha: 0.85 });
    }
    const localNow = performance.now();
    for (const player of sample.players) {
      const action = player.action;
      const view = this.#players.get(player.id);
      if (!action?.skillId) continue;
      const definition = PLAYER_ACTIONS[player.class].find(
        (candidate) => candidate.skillId === action.skillId,
      );
      const skill = CLASS_SKILLS[player.class].find((candidate) => candidate.id === action.skillId);
      if (!definition || !skill) continue;
      const origin = centerOf(player);
      const active =
        (view?.actionImpactAt ?? Number.POSITIVE_INFINITY) <= localNow &&
        localNow <= (view?.actionImpactAt ?? Number.NEGATIVE_INFINITY) + 80;
      const color = active ? 0xff453a : 0x47d7ff;
      if (
        definition.shape === "projectile" ||
        definition.shape === "heal_projectile" ||
        definition.shape === "volley" ||
        definition.shape === "charge"
      ) {
        const range = skill.distance ?? skill.range;
        this.#hitboxOverlay
          .moveTo(origin.x, origin.y)
          .lineTo(origin.x + action.direction.x * range, origin.y + action.direction.y * range)
          .stroke({
            width: Math.max(2, (definition.hitboxRadius ?? definition.projectile?.radius ?? 2) * 2),
            color,
            alpha: 0.5,
          });
      } else if (
        definition.shape === "area_damage" ||
        definition.shape === "area_heal" ||
        definition.shape === "nova"
      ) {
        this.#hitboxOverlay
          .circle(origin.x, origin.y, skill.radius ?? skill.range)
          .stroke({ width: 2, color, alpha: 0.65 });
      } else if (definition.shape === "arc") {
        const range = skill.range;
        const halfAngle = definition.halfAngleRadians ?? Math.PI / 3;
        const heading = Math.atan2(action.direction.y, action.direction.x);
        for (const angle of [heading - halfAngle, heading + halfAngle]) {
          this.#hitboxOverlay
            .moveTo(origin.x, origin.y)
            .lineTo(origin.x + Math.cos(angle) * range, origin.y + Math.sin(angle) * range);
        }
        this.#hitboxOverlay.stroke({ width: 2, color, alpha: 0.65 });
      }
    }
    for (const projectile of sample.projectiles) {
      this.#hitboxOverlay
        .moveTo(
          projectile.x - projectile.direction.x * 32,
          projectile.y - projectile.direction.y * 32,
        )
        .lineTo(projectile.x, projectile.y)
        .stroke({ width: projectile.radius * 2, color: 0xffdf61, alpha: 0.55 });
    }
  }

  #updateStaticVisibility(): void {
    const bounds = this.#visibleBounds(STATIC_CULL_MARGIN);
    for (const view of this.#staticViews) {
      view.container.visible =
        view.x + view.radius >= bounds.left &&
        view.x - view.radius <= bounds.right &&
        view.y + view.radius >= bounds.top &&
        view.y - view.radius <= bounds.bottom;
    }
  }

  #createPlayer(player: PlayerSnapshot): EntityView<PlayerSnapshot> {
    const container = new Container();
    const actor = new Container();
    actor.pivot.set(16, 17);
    actor.position.set(16, 17);
    const animations = playerAnimations(player, this.art.units);
    const unitSprite = new Sprite(animations.idle[0]);
    unitSprite.width = TINY_SWORDS_UNIT_FRAME;
    unitSprite.height = TINY_SWORDS_UNIT_FRAME;
    unitSprite.position.set(UNIT_OFFSET_X, UNIT_OFFSET_Y);
    const selfRing = new Graphics();
    if (player.id === this.#selfId) {
      selfRing.ellipse(16, 31, 18, 7).stroke({ width: 2, color: COLORS.selfRing, alpha: 0.82 });
    }
    const flash = new Graphics().roundRect(3, -8, 28, 40, 10).fill({ color: 0xffffff, alpha: 0 });
    actor.addChild(selfRing);
    actor.addChild(unitSprite, flash);
    container.addChild(actor);
    const hp = new Graphics();
    hp.label = "hp";
    hp.position.set(0, -10);
    container.addChild(hp);
    const label = new Text({
      text: player.nick,
      style: {
        fontFamily: "Georgia, serif",
        fontSize: 12,
        fill: player.id === this.#selfId ? 0xe8fff0 : COLORS.label,
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 3, distance: 1 },
      },
    });
    label.label = "label";
    label.anchor.set(0.5, 1);
    label.position.set(PLAYER_SIZE / 2, -14);
    container.addChild(label);
    this.#actors.addChild(container);
    return {
      container,
      data: player,
      actor,
      flash,
      lastX: player.x,
      lastY: player.y,
      lastHp: player.hp,
      movingUntil: 0,
      hitUntil: 0,
      wasDead: isSpirit(player.life),
      phase: phaseFor(player.id),
      unitSprite,
      unitAnimations: animations,
    };
  }

  #createMonster(monster: MonsterSnapshot): EntityView<MonsterSnapshot> {
    const container = new Container();
    const actor = new Container();
    actor.pivot.set(18, 20);
    actor.position.set(18, 20);
    const metrics = ENEMY_RENDER_METRICS[monster.species];
    const animations = this.art.monsters[monster.species];
    const unitSprite = new Sprite(animations.idle[0]);
    unitSprite.width = metrics.spriteSize;
    unitSprite.height = metrics.spriteSize;
    unitSprite.anchor.set(0.5, 1);
    unitSprite.position.set(18, metrics.spriteY);
    const flash = new Graphics().ellipse(18, 18, 25, 21).fill({ color: 0xffffff, alpha: 0 });
    actor.addChild(unitSprite, flash);
    container.addChild(actor);
    const hp = new Graphics();
    hp.label = "hp";
    hp.position.set(0, metrics.hpY);
    container.addChild(hp);
    const alert = new Text({
      text: "!",
      style: {
        fontFamily: "Georgia, serif",
        fontWeight: "bold",
        fontSize: 18,
        fill: 0xff6b62,
        dropShadow: { color: 0x000000, alpha: 1, blur: 3, distance: 1 },
      },
    });
    alert.anchor.set(0.5);
    alert.position.set(18, metrics.alertY);
    alert.visible = false;
    container.addChild(alert);
    const label = new Text({
      text: t(`monster.${monster.species}` as MessageKey),
      style: {
        fontFamily: "Georgia, serif",
        fontSize: 11,
        fill: 0xcff5bf,
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 3, distance: 1 },
      },
    });
    label.label = "label";
    label.anchor.set(0.5, 1);
    label.position.set(18, metrics.labelY);
    label.alpha = 0;
    container.addChild(label);
    this.#actors.addChild(container);
    return {
      container,
      data: monster,
      actor,
      flash,
      alert,
      lastX: monster.x,
      lastY: monster.y,
      lastHp: monster.hp,
      movingUntil: 0,
      hitUntil: 0,
      wasDead: monster.dead,
      phase: phaseFor(monster.id),
      unitSprite,
      unitAnimations: animations,
    };
  }

  #createGuard(guard: GuardSnapshot): EntityView<GuardSnapshot> {
    const container = new Container();
    const actor = new Container();
    actor.pivot.set(16, 17);
    actor.position.set(16, 17);
    const animations = playerAnimations(
      { class: "warrior", appearance: { body: "wayfarer", primaryColor: "moss" } },
      this.art.units,
    );
    const ring = new Graphics()
      .ellipse(16, 31, 20, 8)
      .stroke({ width: 2, color: 0xf6c85f, alpha: 0.55 });
    // A guard is a Tiny Swords unit like any other: same sheet, same frame, so the same native size
    // and the same measured offsets. It was 102 while players were 96 — two different wrong answers
    // to a question that has one right one.
    const unitSprite = new Sprite(animations.idle[0]);
    unitSprite.width = TINY_SWORDS_UNIT_FRAME;
    unitSprite.height = TINY_SWORDS_UNIT_FRAME;
    unitSprite.position.set(UNIT_OFFSET_X, UNIT_OFFSET_Y);
    actor.addChild(ring, unitSprite);
    container.addChild(actor);
    const hp = new Graphics();
    hp.label = "hp";
    hp.position.set(0, -10);
    container.addChild(hp);
    const label = new Text({
      text: t("npc.city_guard.name"),
      style: {
        fontFamily: "Georgia, serif",
        fontWeight: "bold",
        fontSize: 11,
        fill: 0xffe49a,
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 3, distance: 1 },
      },
    });
    label.label = "label";
    label.anchor.set(0.5, 1);
    label.position.set(16, -14);
    container.addChild(label);
    this.#localizedTexts.push({ node: label, compute: () => t("npc.city_guard.name") });
    this.#actors.addChild(container);
    return {
      container,
      data: guard,
      actor,
      unitSprite,
      unitAnimations: animations,
      lastX: guard.x,
      lastY: guard.y,
      lastHp: guard.hp,
      movingUntil: 0,
      phase: phaseFor(guard.id),
    };
  }

  /** A fallen body: the class sprite, slumped, drained of colour, with a mote hanging over it. */
  #createCorpse(corpse: CorpseSnapshot): EntityView<CorpseSnapshot> {
    const container = new Container();
    const actor = new Container();
    actor.pivot.set(18, 20);
    const bodyScale = playerRenderScale(corpse.id, this.#selfId);
    actor.scale.set(bodyScale);

    const frames = playerAnimations(corpse, this.art.units);
    // Every body keeps the same scale as its living hero on every client.
    const body = new Sprite(frames.idle[0]);
    body.width = TINY_SWORDS_UNIT_FRAME;
    body.height = TINY_SWORDS_UNIT_FRAME;
    body.anchor.set(0.5, 0.85);
    body.position.set(18, 30);
    body.rotation = 1.35;
    body.tint = 0x6d7b86;
    body.alpha = 0.85;
    actor.addChild(body);

    const wisp = new Graphics()
      .circle(0, 0, 5)
      .fill({ color: 0xa8dcff, alpha: 0.5 })
      .circle(0, 0, 9)
      .stroke({ width: 1, color: 0xa8dcff, alpha: 0.28 });
    wisp.position.set(18, 2);

    container.addChild(actor, wisp);
    this.#actors.addChild(container);
    return { container, data: corpse, actor, flash: wisp, phase: phaseFor(corpse.id) };
  }

  #createLoot(loot: LootSnapshot): EntityView<LootSnapshot> {
    const color =
      loot.kind === "potion"
        ? COLORS.lootPotion
        : loot.kind === "gold"
          ? COLORS.lootGold
          : COLORS.lootCrystal;
    const container = new Container();
    const glow = new Graphics()
      .circle(8, 8, 15)
      .fill({ color, alpha: 0.08 })
      .circle(8, 8, 11)
      .stroke({ width: 1.5, color, alpha: 0.5 });
    const icon = createSprite(this.art.loot[loot.kind], 24, 24);
    icon.anchor.set(0.5);
    icon.position.set(8, 8);
    container.addChild(glow, icon);
    this.#actors.addChild(container);
    return { container, data: loot, flash: glow, phase: phaseFor(loot.id) };
  }

  #createProjectile(projectile: ProjectileSnapshot): EntityView<ProjectileSnapshot> {
    const art = projectileArt(projectile.kind, projectile.color);
    const frames = this.art.combatFrames.get(art.source) ?? [Texture.EMPTY];
    const sprite = new Sprite(frames[0]);
    sprite.anchor.set(art.anchor.x, art.anchor.y);
    sprite.tint = art.tint ?? 0xffffff;
    sprite.scale.set(art.scale ?? 1);
    sprite.rotation =
      Math.atan2(projectile.direction.y, projectile.direction.x) + art.rotationOffset;
    const container = new Container();
    const trail = art.trail ? new Graphics() : undefined;
    if (trail && art.trail) {
      this.#drawProjectileTrail(trail, projectile.direction, art.trail);
      container.addChild(trail);
    }
    container.addChild(sprite);
    container.position.set(projectile.x, projectile.y);
    container.zIndex = Math.round(projectile.y + PLAYER_SIZE / 2);
    this.#actors.addChild(container);
    return {
      container,
      data: projectile,
      unitSprite: sprite,
      ...(trail ? { flash: trail } : {}),
      phase: phaseFor(projectile.id),
      createdAt: performance.now(),
    };
  }

  #drawProjectileTrail(
    trail: Graphics,
    direction: { x: number; y: number },
    art: NonNullable<ReturnType<typeof projectileArt>["trail"]>,
  ): void {
    const endX = -direction.x * art.length;
    const endY = -direction.y * art.length;
    trail
      .clear()
      .moveTo(endX, endY)
      .lineTo(0, 0)
      .stroke({ width: art.width * 2.4, color: art.color, alpha: 0.16 })
      .moveTo(endX, endY)
      .lineTo(0, 0)
      .stroke({ width: art.width, color: art.color, alpha: 0.82 })
      .circle(0, 0, art.glowRadius)
      .fill({ color: art.color, alpha: 0.18 });
  }

  #drawHp(view: EntityView<{ id: string }>, hp: number, maxHp: number): void {
    if (view.drawnHp === hp && view.drawnMaxHp === maxHp) return;
    const child = view.container.getChildByLabel("hp");
    if (!(child instanceof Graphics)) return;
    const ratio = maxHp <= 0 ? 0 : Math.max(0, Math.min(1, hp / maxHp));
    const color = ratio > 0.55 ? 0x65d17d : ratio > 0.25 ? 0xf0b85a : COLORS.hp;
    child
      .clear()
      .roundRect(-4, 0, PLAYER_SIZE + 8, 6, 3)
      .fill(COLORS.hpBack)
      .roundRect(-3, 1, (PLAYER_SIZE + 6) * ratio, 4, 2)
      .fill(color);
    view.drawnHp = hp;
    view.drawnMaxHp = maxHp;
  }

  #layoutPlayerLabels(self: PlayerSnapshot | undefined): void {
    const views = Array.from(this.#players.values()).sort((a, b) => {
      if (a.data.id === this.#selfId) return -1;
      if (b.data.id === this.#selfId) return 1;
      if (!self) return a.data.id.localeCompare(b.data.id);
      return pointDistance(self, a.data) - pointDistance(self, b.data);
    });
    const occupied: Array<{ x: number; y: number }> = [];
    for (const view of views) {
      const player = view.data;
      const label = view.container.getChildByLabel("label");
      const hp = view.container.getChildByLabel("hp");
      const distance = self ? pointDistance(self, player) : Number.POSITIVE_INFINITY;
      const local = player.id === this.#selfId;
      const baseAlpha = local ? 1 : distance < 260 ? 0.82 : distance < 520 ? 0.48 : 0;
      const onScreen = this.#isVisibleWorld(
        player.x + PLAYER_SIZE / 2,
        player.y + PLAYER_SIZE / 2,
        -42,
      );
      if (hp instanceof Graphics) {
        hp.alpha = !onScreen
          ? 0
          : local
            ? 0.92
            : !isSpirit(player.life) && shouldShowHealthBar(this.#healthBarMode, "ally", distance)
              ? 0.9
              : 0;
      }
      if (!(label instanceof Text)) continue;
      const glyph = CLASS_GLYPHS[player.class];
      label.text = local
        ? `${glyph} ${player.nick}  ${t("hud.lv", { level: player.level })}`
        : `${glyph} ${player.nick}`;
      const spirit = isSpirit(player.life);
      if (!view.container.visible || !onScreen || spirit || baseAlpha <= 0) {
        label.alpha = spirit && local ? 0.45 : 0;
        continue;
      }

      let level = 0;
      while (level < 4) {
        const candidate = { x: player.x + PLAYER_SIZE / 2, y: player.y - 14 - level * 15 };
        const collides = occupied.some(
          (other) => Math.abs(other.x - candidate.x) < 88 && Math.abs(other.y - candidate.y) < 15,
        );
        if (!collides || local) {
          label.position.set(PLAYER_SIZE / 2, -14 - level * 15);
          label.alpha = baseAlpha;
          occupied.push(candidate);
          break;
        }
        level += 1;
      }
      if (level >= 4) label.alpha = 0;
    }
  }

  #effectPosition(x?: number, y?: number): { x: number; y: number } {
    if (typeof x === "number" && typeof y === "number") return { x, y };
    const self = this.#selfId ? this.#players.get(this.#selfId)?.data : undefined;
    if (self) return centerOf(self);
    const zone = zoneDefinition(this.#currentZoneId);
    const fallback = zone.quests[0]?.giver ?? zone.terrain.spawnPoints[0];
    return fallback
      ? { x: fallback.x + PLAYER_SIZE / 2, y: fallback.y }
      : { x: this.#zoneWidth / 2, y: this.#zoneHeight / 2 };
  }

  #trackEffect(
    container: Container,
    duration: number,
    rise: number,
    frames?: readonly Texture[],
    scaleGrowth = 0.55,
    actionId?: string,
  ): void {
    while (this.#activeEffects.length >= MAX_ACTIVE_WORLD_EFFECTS) {
      const oldest = this.#activeEffects.shift();
      oldest?.container.destroy({ children: true });
    }
    this.#effects.addChild(container);
    const sprite = container instanceof Sprite ? container : undefined;
    const effect: Effect = {
      container,
      bornAt: performance.now(),
      duration,
      rise,
      baseY: container.y,
      scaleGrowth,
      baseScale: container.scale.x,
    };
    if (sprite) effect.sprite = sprite;
    if (frames) effect.frames = frames;
    if (actionId) effect.actionId = actionId;
    this.#activeEffects.push(effect);
  }

  #addPulse(x: number, y: number, color: number, radius: number, durationMs: number): void {
    const pulse = new Graphics().circle(0, 0, radius).stroke({ width: 4, color });
    pulse.position.set(x, y);
    this.#trackEffect(pulse, durationMs, 0);
  }

  showWorldEvent(text: string, tone: "info" | "good" | "bad", x?: number, y?: number): void {
    const position = this.#effectPosition(x, y);
    if (!this.#isVisibleWorld(position.x, position.y, 100)) return;
    const fill = tone === "bad" ? 0xff9b93 : tone === "good" ? 0x9ff0ad : COLORS.label;
    const compactAmount = /^[+-]\d+$/.test(text);
    const label = new Text({
      text,
      style: {
        fontFamily: "Georgia, serif",
        fontWeight: "bold",
        fontSize: compactAmount ? 17 : 12,
        fill,
        stroke: { color: COLORS.shadow, width: 4 },
        dropShadow: { color: 0x000000, alpha: 0.85, blur: 3, distance: 2 },
      },
    });
    label.anchor.set(0.5, 1);
    label.position.set(position.x, position.y - 16);
    this.#trackEffect(label, compactAmount ? 720 : 1_100, compactAmount ? 38 : 25);
    // Damage/heal numbers already receive their authoritative Tiny Swords contact effect. Keeping
    // the old procedural burst as well made every real impact appear twice.
    if (!compactAmount && tone === "bad") this.#burst(position.x, position.y, fill, 5);
  }

  #setVisualAction<T extends PlayerSnapshot | MonsterSnapshot>(
    view: EntityView<T>,
    action: {
      id: string;
      skillId?: string;
      talented?: true;
      evolved?: true;
      direction: { x: number; y: number };
      startedAt: number;
      impactAt: number;
      recoveryEndsAt: number;
      channelEndsAt?: number;
    },
  ): void {
    if (!this.#combatVisualAuthority.acceptsAction(action.id)) return;
    const localNow = performance.now();
    const localTimeline = this.serverClock.combatTimeline(action, localNow);
    const replacingAction = view.actionId !== action.id;
    view.actionId = action.id;
    if (action.skillId === undefined) delete view.actionSkillId;
    else view.actionSkillId = action.skillId;
    if (action.talented === true) view.actionTalented = true;
    else if (replacingAction) delete view.actionTalented;
    if (action.evolved === true) view.actionEvolved = true;
    else if (replacingAction) delete view.actionEvolved;
    view.actionDirection = { ...action.direction };
    view.actionStartedAt = localTimeline.startedAt;
    view.actionImpactAt = localTimeline.impactAt;
    view.actionEndsAt = localTimeline.recoveryEndsAt;
    if (action.channelEndsAt === undefined) delete view.actionChannelEndsAt;
    else {
      view.actionChannelEndsAt =
        this.serverClock.toLocal(action.channelEndsAt) ??
        localNow + Math.max(0, action.channelEndsAt - action.startedAt);
    }
  }

  #syncActionSnapshot<T extends PlayerSnapshot | MonsterSnapshot>(
    view: EntityView<T>,
    action: CombatActionSnapshot | null,
  ): void {
    if (!this.#combatVisualAuthority.recordSnapshot(view.data.id, action?.id ?? null)) return;
    if (!action) {
      this.#resetVisualAction(view);
      return;
    }
    this.#setVisualAction(view, action);
  }

  playCombatAnimation(animation: CombatAnimation): void {
    if (!this.#combatVisualAuthority.acceptsAnimation(animation.actorId, animation.actionId))
      return;
    const action = {
      id: animation.actionId,
      ...(animation.skillId === undefined ? {} : { skillId: animation.skillId }),
      ...(animation.talented === true ? { talented: true as const } : {}),
      ...(animation.evolved === true ? { evolved: true as const } : {}),
      direction: animation.direction,
      startedAt: animation.startedAt,
      impactAt: animation.impactAt,
      recoveryEndsAt: animation.recoveryEndsAt,
    };
    if (animation.actorKind === "player") {
      const view = this.#players.get(animation.actorId);
      if (view) this.#setVisualAction(view, action);
      return;
    }
    const view = this.#monsters.get(animation.actorId);
    if (view) this.#setVisualAction(view, action);
  }

  #actionFrame(
    frames: readonly Texture[],
    activeFrame: number,
    startedAt: number,
    impactAt: number,
    endsAt: number,
    now: number,
  ): Texture | undefined {
    return (
      frames[
        combatActionFrameIndex(
          frames.length,
          activeFrame,
          { startedAt, impactAt, recoveryEndsAt: endsAt },
          now,
        )
      ] ?? frames[0]
    );
  }

  #clearExpiredAction<T extends PlayerSnapshot | MonsterSnapshot>(
    view: EntityView<T>,
    now: number,
  ): void {
    if ((view.actionEndsAt ?? 0) > now) return;
    this.#resetVisualAction(view);
  }

  #resetVisualAction<T extends PlayerSnapshot | MonsterSnapshot>(view: EntityView<T>): void {
    const cancelledActionId = clearVisualAction(view);
    this.#combatVisualAuthority.cancel(cancelledActionId);
    if (cancelledActionId) {
      for (let index = this.#activeEffects.length - 1; index >= 0; index--) {
        const effect = this.#activeEffects[index];
        if (!effect || effect.actionId !== cancelledActionId) continue;
        effect.container.destroy({ children: true });
        this.#activeEffects.splice(index, 1);
      }
    }
  }

  #updatePlayerActionArt(
    view: EntityView<PlayerSnapshot>,
    player: PlayerSnapshot,
    now: number,
  ): boolean {
    const actionSkillId = view.actionSkillId;
    const actionActive =
      Boolean(view.actionId && actionSkillId) &&
      typeof view.actionStartedAt === "number" &&
      typeof view.actionEndsAt === "number" &&
      view.actionEndsAt > now;
    const guarding = player.guarding === true;
    if (!actionActive && !guarding) {
      this.#clearExpiredAction(view, now);
      return false;
    }
    const skillId = guarding ? "iron_guard" : actionSkillId;
    if (!skillId || !view.unitSprite) return false;
    const art = combatArt(player.class, skillId, player.appearance.primaryColor);
    const frames = this.art.combatFrames.get(art.caster.source);
    if (!frames || frames.length === 0) return false;
    const frame =
      guarding && !actionActive
        ? frames[Math.floor(now / 120) % frames.length]
        : this.#actionFrame(
            frames,
            art.caster.activeFrame,
            view.actionStartedAt ?? now,
            view.actionImpactAt ?? now,
            view.actionEndsAt ?? now + 1,
            now,
          );
    if (frame) view.unitSprite.texture = frame;

    if (
      actionActive &&
      view.actionId &&
      view.effectPlayedActionId !== view.actionId &&
      (view.actionImpactAt ?? Number.POSITIVE_INFINITY) <= now
    ) {
      const mobilityImpact =
        skillId === "shield_bash" || skillId === "dash" || skillId === "blink"
          ? art.impact
          : undefined;
      const effect = art.zone ?? mobilityImpact;
      if (effect) {
        const position = centerOf(player);
        this.#playCombatSheet(effect, position.x, position.y, view.actionId);
        if (art.accent) this.#playCombatSheet(art.accent, position.x, position.y, view.actionId);
        this.#playActionFlourish(skillId, position.x, position.y, view.actionId);
        if (view.actionTalented) {
          this.#playTalentedFlourish(
            art,
            position.x,
            position.y,
            view.actionId,
            view.actionEvolved === true,
          );
        }
        if (skillId === "prayer") {
          const radius = CLASS_SKILLS.priest.find((skill) => skill.id === "prayer")?.radius ?? 0;
          this.#playRangeIndicator(position.x, position.y, radius, 0x8df0aa, view.actionId);
        }
      }
      view.effectPlayedActionId = view.actionId;
    }
    return true;
  }

  #updateMonsterActionArt(view: EntityView<MonsterSnapshot>, now: number): boolean {
    const active =
      Boolean(view.actionId) &&
      typeof view.actionStartedAt === "number" &&
      typeof view.actionEndsAt === "number" &&
      view.actionEndsAt > now;
    if (!active) {
      this.#clearExpiredAction(view, now);
      return false;
    }
    const speciesArt = monsterCombatArt(view.data.species);
    const frames = view.unitAnimations?.attack;
    if (!frames || !view.unitSprite) return false;
    const frame = this.#actionFrame(
      frames,
      speciesArt.activeFrame,
      view.actionStartedAt ?? now,
      view.actionImpactAt ?? now,
      view.actionEndsAt ?? now + 1,
      now,
    );
    if (frame) view.unitSprite.texture = frame;
    if (view.actor && (view.actionImpactAt ?? Number.POSITIVE_INFINITY) <= now) {
      const progress = Math.max(
        0,
        Math.min(
          1,
          (now - (view.actionImpactAt ?? now)) /
            Math.max(1, (view.actionEndsAt ?? now) - (view.actionImpactAt ?? now)),
        ),
      );
      view.actor.x = 18 + Math.sin(progress * Math.PI) * 7 * (view.actionDirection?.x ?? 1);
      view.actor.rotation = Math.sin(progress * Math.PI) * -0.16;
    }
    return true;
  }

  playInteraction(): void {
    const position = this.#effectPosition();
    this.#addPulse(position.x, position.y, COLORS.npc, 34, 220);
  }

  #playCombatSheet(art: CombatSheetArt, x: number, y: number, actionId?: string): void {
    const frames = this.art.combatFrames.get(art.source);
    const first = frames?.[0];
    if (!frames || !first) return;
    const sprite = new Sprite(first);
    sprite.anchor.set(art.anchor.x, art.anchor.y);
    sprite.tint = art.tint ?? 0xffffff;
    sprite.scale.set(art.scale ?? 1);
    sprite.position.set(x, y);
    this.#trackEffect(sprite, art.durationMs, 0, frames, 0, actionId);
  }

  #playRangeIndicator(
    x: number,
    y: number,
    radius: number,
    color: number,
    actionId?: string,
  ): void {
    if (radius <= 0) return;
    const ring = new Graphics()
      .circle(0, 0, radius)
      .stroke({ width: 3, color, alpha: 0.8 })
      .circle(0, 0, Math.max(0, radius - 6))
      .stroke({ width: 1, color, alpha: 0.35 });
    ring.position.set(x, y);
    this.#trackEffect(ring, 720, 0, undefined, 0, actionId);
  }

  #playMobilityTrail(
    from: { x: number; y: number },
    to: { x: number; y: number },
    visual: MobilityVisual,
    actionId?: string,
  ): void {
    const trail = new Graphics()
      .moveTo(from.x, from.y)
      .lineTo(to.x, to.y)
      .stroke({ width: visual.width * 2.2, color: visual.color, alpha: 0.12 })
      .moveTo(from.x, from.y)
      .lineTo(to.x, to.y)
      .stroke({ width: visual.width, color: visual.color, alpha: 0.46 });
    this.#trackEffect(trail, visual.durationMs, 0, undefined, 0, actionId);
    this.#addPulse(from.x, from.y, visual.color, visual.width, visual.durationMs);
    this.#addPulse(to.x, to.y, visual.color, visual.width * 1.25, visual.durationMs + 80);
  }

  #playLumenCloudTrail(
    from: { x: number; y: number },
    to: { x: number; y: number },
    color: PrimaryColor,
    actionId: string,
  ): void {
    const cloud = combatArt("priest", "blink", color).impact;
    if (!cloud) return;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.min(3, Math.ceil(distance / 24)));
    for (let index = 0; index < count; index++) {
      const progress = count === 1 ? 0 : index / (count - 1);
      this.#playCombatSheet(
        { ...cloud, scale: (cloud.scale ?? 1) * (0.72 + progress * 0.4) },
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        actionId,
      );
    }
  }

  #playActionFlourish(skillId: string, x: number, y: number, actionId: string): void {
    if (skillId === "battle_cry") {
      const radius = CLASS_SKILLS.warrior[3]?.radius ?? 0;
      this.#playRangeIndicator(x, y, radius, 0xffb34f, actionId);
      this.#playRangeIndicator(x, y, radius * 0.62, 0xffe08a, actionId);
      this.#burst(x, y, 0xffc35a, 12);
      return;
    }
    if (skillId === "whirlwind") {
      const radius = CLASS_SKILLS.warrior[4]?.radius ?? 0;
      this.#playRangeIndicator(x, y, radius, 0xffe08a, actionId);
      this.#playRangeIndicator(x, y, radius * 0.72, 0xffffff, actionId);
      this.#burst(x, y, 0xffe7a3, 14);
      return;
    }
    if (skillId === "heartseeker") {
      this.#addPulse(x, y, 0xff416c, 38, 520);
      this.#addPulse(x, y, 0xffa0b7, 22, 380);
      this.#burst(x, y, 0xff557d, 10);
      return;
    }
    if (skillId === "divine_nova") {
      const radius = CLASS_SKILLS.priest[4]?.radius ?? 0;
      this.#playRangeIndicator(x, y, radius, 0xd8a0ff, actionId);
      this.#playRangeIndicator(x, y, radius * 0.68, 0x8df0aa, actionId);
      this.#burst(x, y, 0xe6bdff, 14);
    }
  }

  /** Talent flourishes only echo the skill's own Tiny Swords sheet; no substitute is generated. */
  #playTalentedFlourish(
    art: ReturnType<typeof combatArt>,
    x: number,
    y: number,
    actionId: string,
    evolved: boolean,
  ): void {
    const asset = art.accent ?? art.zone ?? art.impact;
    if (!asset) return;
    this.#playCombatSheet({ ...asset, scale: (asset.scale ?? 1) * 1.28 }, x, y, actionId);
    this.#playCombatSheet(
      { ...asset, scale: (asset.scale ?? 1) * 0.72, durationMs: asset.durationMs * 0.82 },
      x,
      y,
      actionId,
    );
    if (!evolved) return;
    this.#playCombatSheet(
      { ...asset, scale: (asset.scale ?? 1) * 1.68, durationMs: asset.durationMs * 1.18 },
      x,
      y,
      actionId,
    );
    this.#playCombatSheet(
      { ...asset, scale: (asset.scale ?? 1) * 1.02, durationMs: asset.durationMs * 1.35 },
      x,
      y,
      actionId,
    );
  }

  playCombatImpact(
    playerId: string,
    skillId: string,
    x: number,
    y: number,
  ): PlayerClass | undefined {
    const player = this.#players.get(playerId)?.data;
    if (!player) return undefined;
    const art = combatArt(player.class, skillId, player.appearance.primaryColor).impact;
    if (!art) return player.class;
    this.#playCombatSheet(art, x + 16, y + 16);
    return player.class;
  }

  playMonsterImpact(species: MonsterSpecies, x?: number, y?: number): void {
    const position = this.#effectPosition(x, y);
    const art = monsterCombatArt(species).impact;
    this.#playCombatSheet(art, position.x + 16, position.y + 16);
  }

  playHealingImpact(
    color: PrimaryColor,
    skillId: "mend" | "prayer" | "divine_nova" = "mend",
    x?: number,
    y?: number,
  ): void {
    const position = this.#effectPosition(x, y);
    const definition = combatArt("priest", skillId, color);
    const art = definition.impact ?? definition.zone;
    if (!art) return;
    this.#playCombatSheet(art, position.x + 16, position.y + 16);
  }

  #burst(x: number, y: number, color: number, count: number): void {
    if (!this.#isVisibleWorld(x, y, 80)) return;
    for (let index = 0; index < count; index++) {
      const angle = (index / count) * Math.PI * 2 + seeded(index + count);
      const distance = 7 + seeded(index + 90) * 16;
      const particle = new Graphics()
        .circle(0, 0, 1.5 + seeded(index + 30) * 2)
        .fill({ color, alpha: 0.9 });
      particle.position.set(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance);
      this.#trackEffect(particle, 360, 10 + seeded(index + 60) * 16);
    }
  }

  #updateEffects(now: number): void {
    for (let index = this.#activeEffects.length - 1; index >= 0; index--) {
      const effect = this.#activeEffects[index];
      if (!effect) continue;
      const progress = Math.min(1, (now - effect.bornAt) / effect.duration);
      if (effect.frames && effect.sprite) {
        const frameIndex = Math.min(
          effect.frames.length - 1,
          Math.floor(progress * effect.frames.length),
        );
        const frame = effect.frames[frameIndex];
        if (frame) effect.sprite.texture = frame;
      }
      effect.container.alpha = 1 - progress;
      effect.container.y = effect.baseY - effect.rise * progress;
      effect.container.scale.set(effect.baseScale * (1 + progress * effect.scaleGrowth));
      if (progress < 1) continue;
      effect.container.destroy({ children: true });
      this.#activeEffects.splice(index, 1);
    }
  }

  #updateAmbient(now: number): void {
    const waterPeriod = this.art.terrain.water.width * WATER_TEXTURE_SCALE;
    const scroll = writeWaterScrollOffsets(now, waterPeriod, this.#waterScroll);
    const view = this.#waterSurface;
    if (view?.primary.visible) {
      // The sea is one flat colour, so the shoreline foam carries most of the visible motion.
      const foamFrame = this.art.terrain.foam[foamFrameAt(now, this.art.terrain.foam.length)];
      if (foamFrame) {
        for (const foam of this.#foamTiles) foam.blob.texture = foamFrame;
      }
      const shimmer = Math.sin(now / 1_100 + view.phase);
      view.primary.tilePosition.set(scroll.primary.x - view.x, scroll.primary.y - view.y);
      view.secondary.tilePosition.set(scroll.secondary.x - view.x, scroll.secondary.y - view.y);
      view.primary.tint = pulseTint(view.baseTint, 1 + shimmer * 0.02);
      view.secondary.tint = pulseTint(view.baseTint, 1.035 + shimmer * 0.02);
      view.primary.alpha = 1;
      view.secondary.alpha = WATER_SECONDARY_ALPHA + shimmer * 0.02;
    }
    for (const view of this.#ambientViews) {
      const visible = this.#isVisibleWorld(view.baseX, view.baseY, 80);
      view.container.visible = visible;
      if (!visible) continue;
      const wave = Math.sin(now / 900 + view.phase);
      view.container.x = view.baseX + wave * view.sway;
      view.container.y = view.baseY + Math.cos(now / 1100 + view.phase) * (view.sway * 0.45);
      view.container.alpha = 0.4 + Math.abs(wave) * 0.5;
      const scale = 1 + Math.sin(now / 420 + view.phase) * 0.12;
      view.container.scale.set(scale);
    }
  }

  #updateWorldText(self: PlayerSnapshot | undefined): void {
    if (!self || this.#visuals.worldRegions.length === 0) {
      for (const view of this.#worldTextViews) view.label.alpha = 0;
      return;
    }
    const activeZone = zoneAt(self.x, self.y, this.#visuals.worldRegions).id;
    for (const view of this.#worldTextViews) {
      if (!this.#isVisibleWorld(view.x, view.y, 80)) {
        view.label.alpha = 0;
        continue;
      }
      const distance = Math.hypot(self.x - view.x, self.y - view.y);
      if (distance > view.revealRadius || (view.zoneId && view.zoneId !== activeZone)) {
        view.label.alpha = 0;
        continue;
      }
      const proximity = 1 - distance / view.revealRadius;
      view.label.alpha = view.zoneId
        ? Math.min(0.34, proximity * 0.42)
        : Math.min(0.62, proximity * 0.78);
    }
  }

  /** A gathered quest resource is visually absent until its authoritative respawn window passes. */
  hideQuestSite(id: string, durationMs: number): void {
    const site = this.#questSites.find((candidate) => candidate.id === id);
    if (site) site.hiddenUntil = performance.now() + durationMs;
  }

  #drawOverlay(context: RenderContext): void {
    this.#overlay.clear();
    const { self, now, quest } = context;
    if (!self || isSpirit(self.life)) return;
    for (const npc of this.#questNpcs) {
      const npcDistance = pointDistance(self, npc);
      const current = npc.chapter === (quest.chapter ?? "three_offerings");
      const pulse = quest.status === "ready" ? 1.2 : quest.status === "available" ? 1 : 0.45;
      npc.mark.alpha = current ? pulse * (0.76 + Math.sin(now / 180) * 0.24) : 0;
      npc.mark.scale.set(current ? 1.05 + Math.sin(now / 180) * 0.13 : 0.8);
      npc.label.alpha = npcDistance < 150 ? 0.92 : 0;
    }
    const chapter = quest.chapter ?? "three_offerings";
    for (const site of this.#questSites) {
      const hidden = site.hiddenUntil > now;
      site.container.visible =
        !hidden && this.#isVisibleWorld(site.container.x, site.container.y, 100);
      const active = quest.status === "active" && site.chapter === chapter;
      // The ordered puzzle is read from its glyphs and quest clue. Never pulse the expected
      // answer: feedback arrives only after the player commits an interaction.
      site.signal.alpha = 0;
      site.signal.scale.set(1);
      const siteDistance = Math.hypot(self.x - site.container.x, self.y - site.container.y);
      const feedback = questSiteFeedback(active, siteDistance);
      site.signal.alpha = feedback.signalAlpha;
      site.label.alpha = feedback.labelAlpha;
    }

    for (const view of this.#monsters.values()) {
      const monster = view.data;
      const impactAt = view.actionImpactAt;
      const startedAt = view.actionStartedAt;
      const direction = view.actionDirection;
      if (
        monster.dead ||
        !view.actionId ||
        impactAt === undefined ||
        startedAt === undefined ||
        !direction ||
        impactAt <= now
      )
        continue;
      const definition = MONSTER_ACTIONS[monster.species];
      const origin = centerOf(monster);
      const remaining = Math.max(0, impactAt - now);
      const anticipation = Math.max(1, impactAt - startedAt);
      const urgency = 1 - Math.min(1, remaining / anticipation);
      const end = {
        x: origin.x + direction.x * definition.range,
        y: origin.y + direction.y * definition.range,
      };
      this.#overlay
        .moveTo(origin.x, origin.y)
        .lineTo(end.x, end.y)
        .stroke({
          width: Math.max(3, definition.hitboxRadius * 2),
          color: 0xff665c,
          alpha: 0.1 + urgency * 0.24,
        })
        .circle(end.x, end.y, definition.hitboxRadius)
        .stroke({ width: 2, color: 0xffc2a8, alpha: 0.35 + urgency * 0.55 });
    }
  }

  render(sample: SceneSample, context: RenderContext): void {
    const now = context.now;
    for (const animation of this.#mapElementAnimations) {
      const frame = catalogElementFrameAt(now, animation.frames);
      if (frame) animation.sprite.texture = frame;
    }
    if (this.#merchantAnimation) {
      const frame = catalogElementFrameAt(now, this.#merchantAnimation.frames);
      if (frame) this.#merchantAnimation.sprite.texture = frame;
    }
    this.#healthBarMode = context.healthBars;
    this.#showGrid = context.grid;
    this.#followSelf(sample.players, now);
    this.#updateTerrain();
    this.#drawHitboxes(sample);
    this.#updateStaticVisibility();
    const self = sample.players.find((player) => player.id === this.#selfId);

    reconcile(
      this.#players,
      sample.players,
      (player) => this.#createPlayer(player),
      (view, player) => {
        this.#syncActionSnapshot(view, player.action);
        const dx = player.x - (view.lastX ?? player.x);
        const dy = player.y - (view.lastY ?? player.y);
        const movementDistance = Math.hypot(dx, dy);
        if (movementDistance > 0.2) {
          view.movingUntil = now + 120;
        }
        const mobility = mobilityVisual(view.actionSkillId);
        const continuousLumen = view.actionSkillId === "blink";
        if (
          mobility &&
          view.actionId &&
          ((continuousLumen && movementDistance > 2) ||
            (!continuousLumen && view.mobilityActionId !== view.actionId && movementDistance > 12))
        ) {
          if (!continuousLumen) view.mobilityActionId = view.actionId;
          view.mobilityOffsetX = -dx;
          view.mobilityOffsetY = -dy;
          view.mobilityStartedAt = now;
          view.mobilityDurationMs = mobility.durationMs;
          if (continuousLumen) {
            this.#playLumenCloudTrail(
              {
                x: (view.lastX ?? player.x) + PLAYER_SIZE / 2,
                y: (view.lastY ?? player.y) + PLAYER_SIZE / 2,
              },
              { x: player.x + PLAYER_SIZE / 2, y: player.y + PLAYER_SIZE / 2 },
              player.appearance.primaryColor,
              view.actionId,
            );
          } else
            this.#playMobilityTrail(
              {
                x: (view.lastX ?? player.x) + PLAYER_SIZE / 2,
                y: (view.lastY ?? player.y) + PLAYER_SIZE / 2,
              },
              { x: player.x + PLAYER_SIZE / 2, y: player.y + PLAYER_SIZE / 2 },
              mobility,
              view.actionId,
            );
        }
        const mobilityOffset =
          view.mobilityStartedAt === undefined || view.mobilityDurationMs === undefined
            ? { x: 0, y: 0 }
            : mobilityRenderOffset(
                view.mobilityOffsetX ?? 0,
                view.mobilityOffsetY ?? 0,
                view.mobilityStartedAt,
                view.mobilityDurationMs,
                now,
              );
        const horizontalFacing = view.actionDirection?.x ?? player.facing.x;
        const actorScale = playerRenderScale(player.id, this.#selfId);
        if (view.actor && Math.abs(horizontalFacing) > 0.01)
          view.actor.scale.x = (horizontalFacing < 0 ? -1 : 1) * actorScale;
        if (
          player.hp < (view.lastHp ?? player.hp) &&
          this.#isVisibleWorld(player.x, player.y, 80)
        ) {
          view.hitUntil = now + 190;
        }
        const ghost = player.life === "ghost";
        const spirit = isSpirit(player.life);
        if (spirit) this.#resetVisualAction(view);
        if (view.wasDead && !spirit && this.#isVisibleWorld(player.x, player.y, 80)) {
          this.#addPulse(player.x + 16, player.y + 16, 0xa8f2dc, 24, 650);
        }
        // A player lying dead IS their corpse — the corpse layer draws the body, so the
        // avatar steps aside. What is left standing is only ever the living or a ghost.
        const visible =
          this.#isVisibleWorld(player.x, player.y, ENTITY_CULL_MARGIN) && player.life !== "corpse";
        view.container.visible = visible;
        view.container.position.set(player.x + mobilityOffset.x, player.y + mobilityOffset.y);
        view.container.zIndex = Math.round(player.y + PLAYER_SIZE);
        if (visible) {
          const moving = (view.movingUntil ?? 0) > now;
          const stride = Math.sin(now / 85 + (view.phase ?? 0));
          const idle = Math.sin(now / 480 + (view.phase ?? 0));
          const drift = Math.sin(now / 520 + (view.phase ?? 0));
          if (view.actor) {
            // A ghost does not walk, it drifts: no footfalls, a slow bob, and no weight.
            view.actor.y = ghost
              ? 13 + drift * 2.6
              : 17 + (moving ? -Math.abs(stride) * 2.4 : idle * -0.8);
            view.actor.rotation = ghost ? drift * 0.03 : moving ? stride * 0.045 : idle * 0.012;
            view.actor.alpha = ghost ? 0.42 : 1;
            view.actor.scale.y = actorScale;
            view.actor.tint = ghost ? 0x9fd8ff : 0xffffff;
          }
          if (view.unitSprite && view.unitAnimations) {
            const actionRendered = !spirit && this.#updatePlayerActionArt(view, player, now);
            if (!actionRendered) {
              const motion: UnitMotion = moving ? "run" : "idle";
              const frames = view.unitAnimations[motion];
              const frame = frames[Math.floor(now / 95) % frames.length] ?? frames[0];
              if (frame) view.unitSprite.texture = frame;
            }
          }
          if (
            view.actor &&
            !ghost &&
            view.actionSkillId === "blink" &&
            view.actionStartedAt !== undefined &&
            view.actionImpactAt !== undefined &&
            view.actionEndsAt !== undefined
          ) {
            view.actor.alpha = lumenStepOpacity(
              view.actionStartedAt,
              view.actionImpactAt,
              view.actionChannelEndsAt,
              view.actionEndsAt,
              now,
            );
          }
          if (view.flash) view.flash.alpha = (view.hitUntil ?? 0) > now ? 0.65 : 0;
          view.container.alpha = ghost
            ? 0.5
            : player.invisible
              ? player.id === this.#selfId
                ? 0.28
                : 0.06
              : 1;
          // A ghost has no health to show; it has a body to find.
          this.#drawHp(view, ghost ? 0 : player.hp, player.maxHp);
        }
        view.data = player;
        view.lastX = player.x;
        view.lastY = player.y;
        view.lastHp = player.hp;
        view.wasDead = spirit;
      },
      (view) => this.#resetVisualAction(view),
    );

    reconcile(
      this.#monsters,
      sample.monsters,
      (monster) => this.#createMonster(monster),
      (view, monster) => {
        this.#syncActionSnapshot(view, monster.action);
        if (monster.dead) this.#resetVisualAction(view);
        const dx = monster.x - (view.lastX ?? monster.x);
        const dy = monster.y - (view.lastY ?? monster.y);
        if (Math.hypot(dx, dy) > 0.15) view.movingUntil = now + 120;
        const horizontalFacing = view.actionDirection?.x ?? monster.facing.x;
        if (view.actor && Math.abs(horizontalFacing) > 0.01)
          view.actor.scale.x = horizontalFacing < 0 ? -1 : 1;
        if (
          monster.hp < (view.lastHp ?? monster.hp) &&
          this.#isVisibleWorld(monster.x, monster.y, 80)
        ) {
          view.hitUntil = now + 210;
        }
        if (!view.wasDead && monster.dead && this.#isVisibleWorld(monster.x, monster.y, 80)) {
          this.#burst(monster.x + 18, monster.y + 18, 0x93e07e, 12);
        } else if (
          view.wasDead &&
          !monster.dead &&
          this.#isVisibleWorld(monster.x, monster.y, 80)
        ) {
          this.#addPulse(monster.x + 18, monster.y + 18, 0x8afa95, 22, 600);
        }
        const visible = this.#isVisibleWorld(monster.x, monster.y, ENTITY_CULL_MARGIN);
        view.container.visible = visible;
        view.container.position.set(monster.x, monster.y);
        view.container.zIndex = Math.round(monster.y + PLAYER_SIZE);
        if (visible) {
          const moving = (view.movingUntil ?? 0) > now && !monster.dead;
          const bounce = Math.sin(now / (moving ? 105 : 360) + (view.phase ?? 0));
          const distance = self ? pointDistance(self, monster) : Number.POSITIVE_INFINITY;
          const aggro = Boolean(self && !isSpirit(self.life) && !monster.dead && distance < 215);
          const close = Boolean(self && !isSpirit(self.life) && !monster.dead && distance < 155);
          if (view.actor) {
            view.actor.y = 20 + bounce * (moving ? -2.3 : -1.1);
            const facingScale = view.actor.scale.x < 0 ? -1 : 1;
            view.actor.scale.set(
              facingScale * (1 + bounce * 0.07),
              monster.dead ? 0.28 : 1 - bounce * 0.05,
            );
            view.actor.alpha = monster.dead ? 0.28 : 1;
            view.actor.x = 18;
            view.actor.rotation = 0;
          }
          if (view.unitSprite && view.unitAnimations) {
            const actionRendered = this.#updateMonsterActionArt(view, now);
            if (!actionRendered) {
              const motion: UnitMotion = moving ? "run" : "idle";
              const frames = view.unitAnimations[motion];
              const frame = frames[Math.floor(now / 95) % frames.length] ?? frames[0];
              if (frame) view.unitSprite.texture = frame;
            }
          }
          if (view.flash) view.flash.alpha = (view.hitUntil ?? 0) > now ? 0.7 : 0;
          if (view.alert) {
            view.alert.visible = aggro;
            view.alert.y = ENEMY_RENDER_METRICS[monster.species].alertY + Math.sin(now / 120) * 2;
          }
          const label = view.container.getChildByLabel("label");
          if (label instanceof Text) {
            const name = t(`monster.${monster.species}` as MessageKey);
            label.text = aggro ? `!  ${name}` : name;
            label.alpha = monster.dead ? 0 : aggro || close ? 0.92 : 0;
          }
          this.#drawHp(view, monster.hp, monster.maxHp);
          const hp = view.container.getChildByLabel("hp");
          if (hp instanceof Graphics) {
            hp.alpha = monster.dead
              ? 0
              : shouldShowHealthBar(context.healthBars, "enemy", distance)
                ? 1
                : 0;
          }
        }
        view.data = monster;
        view.lastX = monster.x;
        view.lastY = monster.y;
        view.lastHp = monster.hp;
        view.wasDead = monster.dead;
      },
      (view) => this.#resetVisualAction(view),
    );

    if (import.meta.env.DEV) this.#drawNavigationDebug(sample.monsters);

    reconcile(
      this.#guards,
      sample.guards,
      (guard) => this.#createGuard(guard),
      (view, guard) => {
        const dx = guard.x - (view.lastX ?? guard.x);
        const dy = guard.y - (view.lastY ?? guard.y);
        if (Math.hypot(dx, dy) > 0.15) view.movingUntil = now + 120;
        if (guard.hp < (view.lastHp ?? guard.hp) && this.#isVisibleWorld(guard.x, guard.y, 80)) {
          view.hitUntil = now + 210;
          this.#burst(guard.x + 16, guard.y + 16, 0xffd078, 7);
        }
        const visible = this.#isVisibleWorld(guard.x, guard.y, ENTITY_CULL_MARGIN);
        view.container.visible = visible;
        view.container.position.set(guard.x, guard.y);
        view.container.zIndex = Math.round(guard.y + PLAYER_SIZE);
        if (visible && view.actor && view.unitSprite && view.unitAnimations) {
          const moving = (view.movingUntil ?? 0) > now;
          const motion: UnitMotion = guard.fighting ? "attack" : moving ? "run" : "idle";
          const frames = view.unitAnimations[motion];
          const frame = frames[Math.floor(now / 90) % frames.length] ?? frames[0];
          if (frame) view.unitSprite.texture = frame;
          if (Math.abs(dx) > 0.1) view.actor.scale.x = dx < 0 ? -1 : 1;
          view.actor.y = 17 + Math.sin(now / (moving ? 90 : 440) + (view.phase ?? 0)) * -1.2;
          const label = view.container.getChildByLabel("label");
          if (label instanceof Text) label.alpha = guard.fighting ? 1 : 0.72;
          const distance = self ? pointDistance(self, guard) : Number.POSITIVE_INFINITY;
          this.#drawHp(view, guard.hp, guard.maxHp);
          const hp = view.container.getChildByLabel("hp");
          if (hp instanceof Graphics) {
            hp.alpha = shouldShowHealthBar(context.healthBars, "ally", distance) ? 1 : 0;
          }
        }
        view.data = guard;
        view.lastX = guard.x;
        view.lastY = guard.y;
        view.lastHp = guard.hp;
      },
    );

    reconcile(
      this.#corpses,
      sample.corpses,
      (corpse) => this.#createCorpse(corpse),
      (view, corpse) => {
        const visible = this.#isVisibleWorld(corpse.x, corpse.y, ENTITY_CULL_MARGIN);
        view.container.visible = visible;
        view.container.position.set(corpse.x, corpse.y);
        view.container.zIndex = Math.round(corpse.y + 4);
        if (visible && view.flash) {
          const float = Math.sin(now / 620 + (view.phase ?? 0));
          view.flash.position.set(18, 2 + float * 3);
          view.flash.alpha = 0.45 + float * 0.2;
        }
        view.data = corpse;
      },
    );

    reconcile(
      this.#loot,
      sample.loot,
      (loot) => this.#createLoot(loot),
      (view, loot) => {
        const visible = this.#isVisibleWorld(loot.x, loot.y, ENTITY_CULL_MARGIN);
        view.container.visible = visible;
        view.container.position.set(
          loot.x,
          loot.y - 3 + Math.sin(now / 300 + (view.phase ?? 0)) * 4,
        );
        view.container.zIndex = Math.round(loot.y + 6);
        if (visible && view.flash) {
          view.flash.alpha = 0.6 + Math.sin(now / 260 + (view.phase ?? 0)) * 0.22;
        }
        view.data = loot;
      },
    );

    reconcile(
      this.#projectiles,
      sample.projectiles,
      (projectile) => this.#createProjectile(projectile),
      (view, projectile) => {
        const visible = this.#isVisibleWorld(projectile.x, projectile.y, ENTITY_CULL_MARGIN);
        view.container.visible = visible;
        view.container.position.set(projectile.x, projectile.y);
        view.container.zIndex = Math.round(projectile.y + PLAYER_SIZE / 2);
        if (visible && view.unitSprite) {
          const art = projectileArt(projectile.kind, projectile.color);
          const frames = this.art.combatFrames.get(art.source);
          if (frames && frames.length > 0) {
            const elapsed = Math.max(0, now - (view.createdAt ?? now));
            const frame =
              frames[
                Math.floor((elapsed / Math.max(1, art.durationMs)) * frames.length) % frames.length
              ];
            if (frame) view.unitSprite.texture = frame;
          }
          view.unitSprite.rotation =
            Math.atan2(projectile.direction.y, projectile.direction.x) + art.rotationOffset;
          view.unitSprite.tint = art.tint ?? 0xffffff;
          view.unitSprite.scale.set(art.scale ?? 1);
          if (view.flash && art.trail)
            this.#drawProjectileTrail(view.flash, projectile.direction, art.trail);
        }
        view.data = projectile;
      },
    );

    this.#reconcileEvents(sample.events);
    this.#layoutPlayerLabels(self);
    this.#updateWorldText(self);
    this.#drawOverlay(context);
    this.#updateAmbient(now);
    this.#updateEffects(now);
  }

  #drawNavigationDebug(monsters: readonly MonsterSnapshot[]): void {
    this.#navigationDebug.clear();
    for (const child of this.#navigationDebugLabels.removeChildren()) child.destroy();
    for (const monster of monsters) {
      const debug = monster.navigationDebug;
      if (!debug) continue;
      let previous = { x: monster.x + PLAYER_SIZE / 2, y: monster.y + PLAYER_SIZE / 2 };
      for (const node of debug.path) {
        const center = { x: node.x + PLAYER_SIZE / 2, y: node.y + PLAYER_SIZE / 2 };
        this.#navigationDebug
          .moveTo(previous.x, previous.y)
          .lineTo(center.x, center.y)
          .stroke({ width: 2, color: 0x45e8ff, alpha: 0.8 })
          .circle(center.x, center.y, 3)
          .fill({ color: 0x45e8ff, alpha: 0.9 });
        previous = center;
      }
      if (debug.destination) {
        this.#navigationDebug
          .circle(debug.destination.x + PLAYER_SIZE / 2, debug.destination.y + PLAYER_SIZE / 2, 8)
          .stroke({ width: 2, color: 0xffd54a, alpha: 0.95 });
      }
      const label = new Text({
        text: `${debug.state}${debug.reason ? ` · ${debug.reason}` : ""}`,
        style: { fontFamily: "monospace", fontSize: 10, fill: 0xffffff },
      });
      label.position.set(monster.x, monster.y - 42);
      this.#navigationDebugLabels.addChild(label);
    }
  }

  onFrame(callback: (nowMs: number, deltaSeconds: number) => void): void {
    const tick = (ticker: Ticker): void => callback(performance.now(), ticker.deltaMS / 1000);
    this.#frameCallbacks.push(tick);
    this.#app.ticker.add(tick);
  }

  /**
   * Detaches this renderer from the shared `#stage` Application without destroying it. The app is
   * owned by stage-application.ts and outlives any single renderer, so a later consumer (the editor,
   * a map preview) can build a fresh scene on the same canvas — destroying the app here would leave
   * the canvas un-re-initializable under Pixi 8. Removes only what this renderer added: its ticker
   * callbacks, its locale listener and its world container.
   */
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const tick of this.#frameCallbacks) this.#app.ticker.remove(tick);
    this.#frameCallbacks = [];
    this.#localeUnsub();
    this.#app.stage.removeChild(this.#world);
    this.#world.destroy({ children: true });
  }
}
