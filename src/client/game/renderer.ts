import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from "pixi.js";
import type { MainHandItem, OffHandItem, PrimaryColor } from "../../shared/character.js";
import { isSpirit } from "../../shared/death.js";
import {
  BOUNDARY_OBSTACLES,
  type MonsterSpecies,
  type PlayerClass,
  pointDistance,
  QUEST_DEFINITIONS,
  QUEST_NPC,
  QUEST_SITES,
  SAFE_ZONE,
  TERRAIN_BLOCKERS,
  WORLD_LANDMARKS,
} from "../../shared/game.js";
import type { MessageKey } from "../../shared/i18n/index.js";
import type {
  CorpseSnapshot,
  ItemKind,
  LootSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  QuestState,
} from "../../shared/protocol.js";
import { PLAYER_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/simulation.js";
import { onLocaleChange, t } from "../i18n.js";
import { MAIN_HAND_ART, OFF_HAND_ART, PLAYER_ATLAS_FRAMES } from "./character-art.js";
import type { SceneSample } from "./net.js";
import {
  allUnitSheets,
  TINY_SWORDS_BUILDINGS,
  TINY_SWORDS_EFFECT_SHEETS,
  TINY_SWORDS_EFFECTS,
  TINY_SWORDS_UNIT_FRAME,
  type UnitMotion,
  unitSheet,
} from "./tiny-swords-art.js";
import { VENDOR_MONSTER_ART, VENDOR_QUEST_ART } from "./vendor-art.js";
import {
  DECOR_REGIONS,
  type DecorTheme,
  POINTS_OF_INTEREST,
  type PointOfInterest,
  roadStrength,
  terrainAt,
  WORLD_ZONES,
  zoneAt,
} from "./world-layout.js";

const COLORS = {
  grass: 0x173f32,
  path: 0x8d7653,
  npc: 0xf6c85f,
  hp: 0xe85454,
  hpBack: 0x251f26,
  label: 0xf4f0df,
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

const ATLAS_IMAGE = "/assets/lindocara/atlas/world.png";
const ATLAS_DATA = "/assets/lindocara/atlas/world.json";
const TILE_SIZE = 32;
const STATIC_CULL_MARGIN = 180;
const ENTITY_CULL_MARGIN = 120;
const MAX_ACTIVE_EFFECTS = 96;

interface AtlasData {
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
}

interface ArtTextures {
  players: Record<PrimaryColor, Texture>;
  monsters: Record<MonsterSpecies, Texture>;
  keeper: Texture;
  tiles: {
    grass: Texture[];
    wet: Texture[];
    path: Texture[];
    water: Texture[];
    sanctuary: Texture;
  };
  props: {
    trees: Texture[];
    ruins: Texture[];
    rocks: Texture[];
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
  effects: Record<keyof typeof TINY_SWORDS_EFFECTS, Texture>;
  effectFrames: Record<keyof typeof TINY_SWORDS_EFFECT_SHEETS, readonly Texture[]>;
  questResources: Record<keyof typeof VENDOR_QUEST_ART, Texture>;
}

export interface RenderContext {
  self?: PlayerSnapshot;
  quest: QuestState;
  attackCooldownUntil: number;
  attackRange: number;
  now: number;
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
  attackUntil?: number;
  hitUntil?: number;
  wasDead?: boolean;
  phase?: number;
  unitSprite?: Sprite;
  unitAnimations?: Record<UnitMotion, readonly Texture[]>;
}

interface Effect {
  container: Container;
  bornAt: number;
  duration: number;
  rise: number;
  baseY: number;
  sprite?: Sprite;
  frames?: readonly Texture[];
}

interface AmbientView {
  container: Container;
  baseX: number;
  baseY: number;
  phase: number;
  sway: number;
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

interface WorldBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
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
): readonly Texture[] {
  return Array.from({ length: frames }, (_, index) => {
    const frame = new Rectangle(index * frameWidth, 0, frameWidth, source.height);
    return new Texture({
      source: source.source,
      frame,
      label: `${source.label ?? "sheet"}:${index}`,
    });
  });
}

function tileVariation(tileX: number, tileY: number): number {
  const broadX = Math.floor(tileX / 4);
  const broadY = Math.floor(tileY / 4);
  return seeded(broadX * 977 + broadY * 619 + tileX * 17 + tileY * 29);
}

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
  const buildings = await Promise.all(
    TINY_SWORDS_BUILDINGS.map((source) => Assets.load<Texture>(source)),
  );
  for (const building of buildings) building.source.style.scaleMode = "nearest";
  const effectEntries = await Promise.all(
    Object.entries(TINY_SWORDS_EFFECTS).map(
      async ([name, source]) => [name, await Assets.load<Texture>(source)] as const,
    ),
  );
  const effects = Object.fromEntries(effectEntries) as Record<
    keyof typeof TINY_SWORDS_EFFECTS,
    Texture
  >;
  for (const effect of Object.values(effects)) effect.source.style.scaleMode = "nearest";
  const effectFrames = Object.fromEntries(
    Object.entries(TINY_SWORDS_EFFECT_SHEETS).map(([name, sheet]) => {
      const texture = effects[name as keyof typeof TINY_SWORDS_EFFECTS];
      return [name, sliceHorizontalSheet(texture, sheet.frame, sheet.frames)] as const;
    }),
  ) as Record<keyof typeof TINY_SWORDS_EFFECT_SHEETS, readonly Texture[]>;
  const monsterEntries = await Promise.all(
    Object.entries(VENDOR_MONSTER_ART).map(
      async ([species, source]) => [species, await Assets.load<Texture>(source)] as const,
    ),
  );
  const monsters = Object.fromEntries(monsterEntries) as Record<MonsterSpecies, Texture>;
  for (const monster of Object.values(monsters)) monster.source.style.scaleMode = "linear";
  const questResourceEntries = await Promise.all(
    Object.entries(VENDOR_QUEST_ART).map(
      async ([kind, source]) => [kind, await Assets.load<Texture>(source)] as const,
    ),
  );
  const questResources = Object.fromEntries(questResourceEntries) as Record<
    keyof typeof VENDOR_QUEST_ART,
    Texture
  >;
  for (const resource of Object.values(questResources)) resource.source.style.scaleMode = "nearest";

  return {
    players: {
      azure: texture(PLAYER_ATLAS_FRAMES.azure.name),
      ember: texture(PLAYER_ATLAS_FRAMES.ember.name),
      moss: texture(PLAYER_ATLAS_FRAMES.moss.name),
      violet: texture(PLAYER_ATLAS_FRAMES.violet.name),
    },
    monsters,
    keeper: texture("npc.keeper"),
    tiles: {
      grass: [
        texture("tile.grass.a"),
        texture("tile.grass.b"),
        texture("tile.grass.c"),
        texture("tile.grass.d"),
        texture("tile.grass.moss.a"),
        texture("tile.grass.moss.b"),
        texture("tile.grass.flowers"),
        texture("tile.grass.stones"),
      ],
      wet: [texture("tile.grass.wet.a"), texture("tile.grass.wet.b")],
      path: [
        texture("tile.path.a"),
        texture("tile.path.b"),
        texture("tile.path.c"),
        texture("tile.path.worn.a"),
        texture("tile.path.worn.b"),
      ],
      water: [texture("tile.water.a"), texture("tile.water.b"), texture("tile.water.c")],
      sanctuary: texture("tile.sanctuary"),
    },
    props: {
      trees: [texture("prop.tree.large"), texture("prop.tree.round"), texture("prop.tree.small")],
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
      rocks: [texture("prop.rock.a"), texture("prop.rock.b"), texture("prop.rock.c")],
      mushrooms: [texture("prop.mushroom.a"), texture("prop.mushroom.b")],
      stump: texture("prop.stump"),
      log: texture("prop.log"),
      fence: texture("prop.fence"),
      tufts: [texture("prop.grass.tuft")],
      leaves: [texture("prop.leaf")],
      roots: [texture("prop.root")],
      torch: texture("prop.torch"),
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
    effects,
    effectFrames,
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

function createFittedSprite(texture: Texture, maxWidth: number, maxHeight: number): Sprite {
  const sprite = new Sprite(texture);
  const scale = Math.min(maxWidth / texture.width, maxHeight / texture.height);
  sprite.scale.set(scale);
  return sprite;
}

function pickTexture(textures: readonly Texture[], index: number): Texture {
  const texture = textures[index % textures.length] ?? textures[0];
  if (!texture) throw new Error("Cannot pick from an empty texture list");
  return texture;
}

function placeTile(tile: Sprite, texture: Texture, x: number, y: number): void {
  tile.texture = texture;
  tile.position.set(x, y);
  tile.width = TILE_SIZE;
  tile.height = TILE_SIZE;
}

function createSoftShadow(width: number, height: number, alpha = 0.36): Graphics {
  return new Graphics().ellipse(0, 0, width / 2, height / 2).fill({ color: COLORS.shadow, alpha });
}

function reconcile<T extends { id: string }>(
  views: Map<string, EntityView<T>>,
  entities: readonly T[],
  create: (entity: T) => EntityView<T>,
  update: (view: EntityView<T>, entity: T) => void,
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
    view.container.destroy({ children: true });
    views.delete(id);
  }
}

export class Renderer {
  #app: Application;
  #world = new Container();
  #terrain = new Container();
  #groundDecor = new Container();
  #structures = new Container();
  #ambient = new Container();
  #actors = new Container();
  #worldLabels = new Container();
  #overlay = new Graphics();
  #effects = new Container();
  #questNpcs: Array<{
    chapter: string;
    x: number;
    y: number;
    mark: Text;
    label: Text;
  }> = [];
  #questSites: QuestSiteView[] = [];
  #players = new Map<string, EntityView<PlayerSnapshot>>();
  #monsters = new Map<string, EntityView<MonsterSnapshot>>();
  #loot = new Map<string, EntityView<LootSnapshot>>();
  #corpses = new Map<string, EntityView<CorpseSnapshot>>();
  #activeEffects: Effect[] = [];
  #ambientViews: AmbientView[] = [];
  #staticViews: StaticView[] = [];
  #worldTextViews: WorldTextView[] = [];
  #localizedTexts: Array<{ node: Text; compute: () => string }> = [];
  #terrainTiles: Sprite[] = [];
  #waterTiles: Sprite[] = [];
  #terrainKey = "";
  #selfId: string | null = null;
  #cameraX = SAFE_ZONE.x + SAFE_ZONE.width / 2;
  #cameraY = SAFE_ZONE.y + SAFE_ZONE.height / 2;
  #cameraReady = false;
  #lastCameraAt = 0;

  private constructor(
    app: Application,
    private readonly art: ArtTextures,
  ) {
    this.#app = app;
    onLocaleChange(() => {
      for (const entry of this.#localizedTexts) entry.node.text = entry.compute();
    });
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    const app = new Application();
    await app.init({
      canvas,
      background: COLORS.grass,
      resizeTo: window,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });

    const renderer = new Renderer(app, await loadArt());
    renderer.#buildWorld();
    return renderer;
  }

  setSelfId(id: string): void {
    this.#selfId = id;
  }

  diagnostics(): Record<string, number> {
    return {
      terrainPool: this.#terrainTiles.length,
      staticTotal: this.#staticViews.length,
      staticVisible: this.#staticViews.filter(({ container }) => container.visible).length,
      ambientTotal: this.#ambientViews.length,
      ambientVisible: this.#ambientViews.filter(({ container }) => container.visible).length,
      actorViews: this.#players.size + this.#monsters.size + this.#loot.size + 1,
      activeEffects: this.#activeEffects.length,
    };
  }

  #buildWorld(): void {
    this.#actors.sortableChildren = true;
    this.#terrain.addChild(
      new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color: COLORS.grass }),
    );
    this.#world.addChild(
      this.#terrain,
      this.#groundDecor,
      this.#structures,
      this.#ambient,
      this.#actors,
      this.#worldLabels,
      this.#overlay,
      this.#effects,
    );
    this.#app.stage.addChild(this.#world);

    this.#buildSharedBlockers();
    this.#buildBoundary();
    this.#buildDecor();
    this.#buildSetPieces();
    this.#buildLandmarks();
    this.#buildQuestSites();
    this.#buildWorldLabels();
    this.#buildNpc();
    this.#buildAmbient();
    this.#applyCameraTransform();
    this.#updateTerrain();
    this.#updateStaticVisibility();
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

  #buildSharedBlockers(): void {
    for (const [blockerIndex, blocker] of TERRAIN_BLOCKERS.entries()) {
      const { rect } = blocker;
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      const radius = Math.hypot(rect.width, rect.height) / 2 + 50;
      if (blocker.kind === "water") {
        const bank = new Graphics()
          .rect(rect.x - 3, rect.y - 3, rect.width + 6, rect.height + 6)
          .stroke({ width: 5, color: 0x88a889, alpha: 0.34 })
          .rect(rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4)
          .stroke({ width: 2, color: 0xc2e3d5, alpha: 0.2 });
        this.#registerStatic(bank, centerX, centerY, radius, this.#groundDecor);
        continue;
      }

      const mass = new Container();
      mass.position.set(rect.x, rect.y);
      mass.addChild(
        new Graphics()
          .rect(0, 0, rect.width, rect.height)
          .fill({ color: blocker.kind === "cliff" ? 0x34443c : 0x102f28, alpha: 0.36 }),
      );
      const spacing = blocker.kind === "cliff" ? 52 : 64;
      const columns = Math.max(1, Math.floor(rect.width / spacing));
      const rows = Math.max(1, Math.floor(rect.height / spacing));
      const count = Math.min(88, columns * rows + columns);
      for (let index = 0; index < count; index++) {
        const seed = blockerIndex * 401 + index * 17;
        const x = 18 + seeded(seed + 2) * Math.max(8, rect.width - 36);
        const y = 28 + seeded(seed + 7) * Math.max(8, rect.height - 34);
        const isRock = blocker.kind === "cliff" || index % 9 === 0;
        const texture = isRock
          ? pickTexture(this.art.props.rocks, seed)
          : pickTexture(this.art.props.trees, seed);
        const size = isRock ? 36 + seeded(seed + 3) * 30 : 58 + seeded(seed + 5) * 34;
        const shadow = createSoftShadow(size * 0.78, size * 0.25, 0.3);
        shadow.position.set(x, y - 2);
        mass.addChild(shadow);
        const prop = createFittedSprite(texture, size, size);
        prop.anchor.set(0.5, 1);
        prop.position.set(x, y);
        prop.tint = blocker.kind === "cliff" ? 0xb8c2a8 : 0xcbd8ae;
        mass.addChild(prop);
      }
      this.#registerStatic(mass, centerX, centerY, radius);
    }
  }

  #buildBoundary(): void {
    for (const [side, rect] of BOUNDARY_OBSTACLES.entries()) {
      const horizontal = rect.width > rect.height;
      const length = horizontal ? rect.width : rect.height;
      const count = Math.ceil(length / 58);
      for (let index = 0; index < count; index++) {
        const seed = 2600 + side * 307 + index * 13;
        const x = horizontal
          ? rect.x + ((index + 0.35 + seeded(seed)) / count) * rect.width
          : rect.x + rect.width * (0.25 + seeded(seed + 2) * 0.5);
        const y = horizontal
          ? rect.y + rect.height * (0.35 + seeded(seed + 4) * 0.55)
          : rect.y + ((index + 0.35 + seeded(seed)) / count) * rect.height;
        const container = new Container();
        container.position.set(x, y);
        const rocky = side >= 2 && index % 3 === 0;
        const texture = rocky
          ? pickTexture(this.art.props.rocks, seed)
          : pickTexture(this.art.props.trees, seed);
        const size = rocky ? 44 + seeded(seed + 5) * 24 : 68 + seeded(seed + 7) * 42;
        container.addChild(createSoftShadow(size * 0.75, size * 0.24, 0.32));
        const prop = createFittedSprite(texture, size, size);
        prop.anchor.set(0.5, 1);
        prop.tint = side === 2 ? 0xb8c2a0 : 0xc8d5aa;
        container.addChild(prop);
        this.#registerStatic(container, x, y, size + 30);
      }
    }
  }

  #blockedAt(x: number, y: number): boolean {
    return TERRAIN_BLOCKERS.some(
      ({ rect }) =>
        x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height,
    );
  }

  #nearLandmark(x: number, y: number, margin: number): boolean {
    return WORLD_LANDMARKS.some(
      (landmark) =>
        x >= landmark.x - margin &&
        x <= landmark.x + landmark.width + margin &&
        y >= landmark.y - margin &&
        y <= landmark.y + landmark.height + margin,
    );
  }

  #decorTexture(theme: DecorTheme, seed: number): { texture: Texture; size: number; tint: number } {
    if (theme === "forest") {
      if (seed % 9 === 0)
        return { texture: pickTexture(this.art.props.mushrooms, seed), size: 22, tint: 0xd8e8b8 };
      if (seed % 7 === 0)
        return { texture: pickTexture(this.art.props.rocks, seed), size: 28, tint: 0xc8d2af };
      return {
        texture: pickTexture(this.art.props.trees, seed),
        size: 54 + seeded(seed + 6) * 38,
        tint: 0xd4dfb6,
      };
    }
    if (theme === "marsh" || theme === "wet") {
      const pool =
        seed % 5 === 0
          ? this.art.props.mushrooms
          : seed % 7 === 0
            ? [this.art.props.log, this.art.props.stump]
            : this.art.props.tufts;
      return {
        texture: pickTexture(pool, seed),
        size: seed % 7 === 0 ? 34 : 20 + seeded(seed + 5) * 14,
        tint: 0xbfd2b0,
      };
    }
    if (theme === "ruin" || theme === "gate") {
      const pool = seed % 6 === 0 ? this.art.props.ruins.slice(0, 2) : this.art.props.rocks;
      return {
        texture: pickTexture(pool, seed),
        size: seed % 6 === 0 ? 52 : 24 + seeded(seed + 5) * 24,
        tint: 0xcacbb4,
      };
    }
    if (theme === "farm") {
      const pool =
        seed % 5 === 0 ? [this.art.props.fence, this.art.props.log] : this.art.props.tufts;
      return {
        texture: pickTexture(pool, seed),
        size: seed % 5 === 0 ? 42 : 18 + seeded(seed + 5) * 10,
        tint: 0xe0d1a5,
      };
    }
    if (theme === "road") {
      const pool = seed % 5 === 0 ? [this.art.props.fence] : this.art.props.rocks;
      return {
        texture: pickTexture(pool, seed),
        size: seed % 5 === 0 ? 38 : 20 + seeded(seed + 5) * 14,
        tint: 0xd8cfaa,
      };
    }
    const pool =
      seed % 6 === 0 ? this.art.props.trees : [...this.art.props.tufts, ...this.art.props.leaves];
    return {
      texture: pickTexture(pool, seed),
      size: seed % 6 === 0 ? 52 + seeded(seed + 5) * 26 : 18 + seeded(seed + 5) * 10,
      tint: theme === "village" ? 0xe5dbb7 : 0xe9e1b8,
    };
  }

  #buildDecor(): void {
    for (const region of DECOR_REGIONS) {
      for (let index = 0; index < region.count; index++) {
        const seed = region.seed + index * 19;
        const angle = seeded(seed + 3) * Math.PI * 2;
        const radius = Math.sqrt(seeded(seed + 9));
        const x = region.x + Math.cos(angle) * region.radiusX * radius;
        const y = region.y + Math.sin(angle) * region.radiusY * radius;
        if (x < 120 || y < 120 || x > WORLD_WIDTH - 120 || y > WORLD_HEIGHT - 120) continue;
        if (roadStrength(x, y) > 0) continue;
        if (this.#blockedAt(x, y) || this.#nearLandmark(x, y, 70)) continue;
        const inSquare =
          x > SAFE_ZONE.x + 210 &&
          x < SAFE_ZONE.x + SAFE_ZONE.width - 170 &&
          y > SAFE_ZONE.y + 250 &&
          y < SAFE_ZONE.y + SAFE_ZONE.height - 110;
        if (inSquare) continue;

        const selection = this.#decorTexture(region.theme, seed);
        const container = new Container();
        container.position.set(x, y);
        if (selection.size > 34) {
          container.addChild(createSoftShadow(selection.size * 0.76, selection.size * 0.25, 0.24));
        }
        const prop = createFittedSprite(selection.texture, selection.size, selection.size);
        prop.anchor.set(0.5, 1);
        prop.tint = selection.tint;
        prop.alpha = 0.78 + seeded(seed + 11) * 0.2;
        container.addChild(prop);
        this.#registerStatic(container, x, y, selection.size + 22, this.#groundDecor);
      }
    }
  }

  #buildSetPieces(): void {
    for (const poi of POINTS_OF_INTEREST) {
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
      const stone = createFittedSprite(pickTexture(this.art.props.rocks, index), 22, 18);
      stone.anchor.set(0.5, 1);
      stone.position.set(Math.cos(angle) * 78, Math.sin(angle) * 48);
      square.addChild(stone);
    }
    this.#registerStatic(square, poi.x, poi.y, 320, this.#groundDecor);
  }

  #buildRoadSign(poi: PointOfInterest): void {
    const sign = new Container();
    sign.position.set(poi.x, poi.y);
    sign.addChild(createSoftShadow(48, 13, 0.32));
    sign.addChild(
      new Graphics()
        .rect(-3, -42, 6, 43)
        .fill({ color: 0x493d31 })
        .roundRect(-26, -52, 55, 18, 3)
        .fill({ color: 0xa28254 })
        .moveTo(29, -52)
        .lineTo(42, -43)
        .lineTo(29, -34)
        .fill({ color: 0xa28254 }),
    );
    this.#registerStatic(sign, poi.x, poi.y, 75);
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
      const prop = createFittedSprite(
        index % 3 === 0
          ? pickTexture(this.art.props.rocks, index)
          : pickTexture(this.art.props.tufts, index),
        index % 3 === 0 ? 23 : 18,
        index % 3 === 0 ? 18 : 18,
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
      const rock = createFittedSprite(pickTexture(this.art.props.rocks, index), 30, 24);
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
      const log = createFittedSprite(this.art.props.log, 34, 42);
      log.anchor.set(0.5);
      log.position.set(x, y);
      log.rotation = rotation;
      camp.addChild(log);
    }
    for (const [x, y] of [
      [-118, -52],
      [112, -38],
    ] as const) {
      const shelter = createFittedSprite(pickTexture(this.art.props.ruins, 5), 84, 78);
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
      const prop = createFittedSprite(
        index % 4 === 0 ? this.art.props.stump : pickTexture(this.art.props.mushrooms, index),
        index % 4 === 0 ? 34 : 22,
        index % 4 === 0 ? 38 : 24,
      );
      prop.anchor.set(0.5, 1);
      prop.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius);
      mark.addChild(prop);
    }
    this.#registerStatic(mark, poi.x, poi.y, 145, this.#groundDecor);
  }

  #buildLandmarks(): void {
    for (const [index, landmark] of WORLD_LANDMARKS.entries()) {
      const container = new Container();
      container.position.set(landmark.x, landmark.y);
      const centerX = landmark.x + landmark.width / 2;
      const centerY = landmark.y + landmark.height / 2;
      const radius = Math.hypot(landmark.width, landmark.height) / 2 + 50;

      if (landmark.kind === "sacred_tree") {
        container.addChild(
          new Graphics()
            .ellipse(landmark.width / 2, landmark.height - 28, landmark.width * 0.4, 34)
            .fill({ color: COLORS.shadow, alpha: 0.42 })
            .circle(landmark.width / 2, landmark.height * 0.54, landmark.width * 0.42)
            .stroke({ width: 4, color: 0xf0d98b, alpha: 0.18 }),
        );
        for (let root = 0; root < 7; root++) {
          const sprite = createFittedSprite(
            pickTexture(this.art.props.roots, root),
            30 + root * 2,
            30 + root * 2,
          );
          sprite.anchor.set(0.5, 1);
          sprite.position.set(
            landmark.width / 2 + (root - 3) * 25,
            landmark.height - 12 + Math.abs(root - 3) * 3,
          );
          sprite.rotation = (root - 3) * 0.18;
          container.addChild(sprite);
        }
        const tree = createFittedSprite(
          pickTexture(this.art.props.trees, 0),
          landmark.width,
          landmark.height,
        );
        tree.anchor.set(0.5, 1);
        tree.position.set(landmark.width / 2, landmark.height);
        tree.tint = 0xf0e5b1;
        container.addChild(tree);
      } else if (landmark.kind === "dungeon_gate") {
        container.addChild(
          new Graphics()
            .ellipse(landmark.width / 2, landmark.height - 12, landmark.width * 0.48, 30)
            .fill({ color: COLORS.shadow, alpha: 0.55 }),
        );
        for (let part = 0; part < 5; part++) {
          const prop = createFittedSprite(
            pickTexture(this.art.props.ruins, part < 2 ? 1 : 0),
            landmark.width * (part === 2 ? 0.36 : 0.23),
            landmark.height * (part === 2 ? 0.9 : 0.74),
          );
          prop.anchor.set(0.5, 1);
          prop.position.set((landmark.width * part) / 4, landmark.height);
          prop.tint = 0xbfc6b0;
          container.addChild(prop);
        }
        container.addChild(
          new Graphics()
            .roundRect(
              landmark.width * 0.36,
              landmark.height * 0.52,
              landmark.width * 0.28,
              landmark.height * 0.46,
              26,
            )
            .fill({ color: 0x08110f, alpha: 0.9 })
            .stroke({ width: 4, color: 0x8faaa0, alpha: 0.62 }),
        );
        this.#addTorch(container, landmark.width * 0.28, landmark.height - 40);
        this.#addTorch(container, landmark.width * 0.72, landmark.height - 40);
      } else if (landmark.kind === "graveyard") {
        container.addChild(
          new Graphics()
            .roundRect(-40, -30, landmark.width + 80, landmark.height + 90, 18)
            .fill({ color: 0x121a20, alpha: 0.5 })
            .stroke({ width: 2, color: 0x6f8496, alpha: 0.45 }),
        );
        // 4 is the Monastery in TINY_SWORDS_BUILDINGS — the closest thing the pack has to a chapel.
        const chapel = createFittedSprite(
          pickTexture(this.art.buildings, 4),
          landmark.width,
          landmark.height,
        );
        chapel.anchor.set(0.5, 1);
        chapel.position.set(landmark.width / 2, landmark.height);
        chapel.tint = 0xc3cfdb;
        container.addChild(chapel);
        // Headstones in the yard below the chapel, where the spirit anchor sits.
        for (let stone = 0; stone < 6; stone++) {
          const headstone = createFittedSprite(
            pickTexture(this.art.props.rocks, index + stone),
            26,
            30,
          );
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
        container.addChild(
          new Graphics()
            .ellipse(landmark.width / 2, landmark.height - 12, landmark.width * 0.46, 24)
            .fill({ color: COLORS.shadow, alpha: isBuilding ? 0.48 : 0.4 }),
        );
        const pool = isBuilding ? this.art.buildings : this.art.props.ruins;
        const prop = createFittedSprite(pickTexture(pool, index), landmark.width, landmark.height);
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
    const torch = createFittedSprite(this.art.props.torch, 22, 34);
    torch.anchor.set(0.5, 1);
    torch.position.set(x, y);
    container.addChild(torch);
  }

  #buildWorldLabels(): void {
    for (const zone of WORLD_ZONES) {
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

    for (const poi of POINTS_OF_INTEREST) {
      if (poi.kind === "tree" || poi.kind === "square") continue;
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
    for (const site of QUEST_SITES) {
      const container = new Container();
      container.position.set(site.x, site.y);
      container.zIndex = site.y + PLAYER_SIZE;
      container.addChild(
        new Graphics()
          .ellipse(0, 8, site.kind === "ward" ? 34 : 24, site.kind === "ward" ? 11 : 8)
          .fill({ color: COLORS.shadow, alpha: 0.5 }),
      );
      const signal = new Graphics()
        .circle(0, -18, 30)
        .stroke({ width: 3, color: 0xffdf77, alpha: 0.9 })
        .circle(0, -18, 20)
        .stroke({ width: 1.5, color: 0xfff4bd, alpha: 0.8 });
      signal.alpha = 0;
      container.addChild(signal);
      if (site.kind === "resource") {
        const texture = this.art.questResources[site.art as keyof typeof VENDOR_QUEST_ART];
        const sprite = createFittedSprite(texture, 58, 58);
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
        const tower = createFittedSprite(pickTexture(this.art.buildings, 5), 82, 112);
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
    for (const [index, quest] of QUEST_DEFINITIONS.entries()) {
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
      this.#actors.addChild(npc);
    }
  }

  #buildAmbient(): void {
    const regions = [
      { x: 3000, y: 660, radiusX: 620, radiusY: 450, count: 20, color: 0xc7f3a7 },
      { x: 3710, y: 1910, radiusX: 700, radiusY: 520, count: 28, color: 0xb2e6ac },
      { x: 3100, y: 1770, radiusX: 240, radiusY: 190, count: 10, color: 0xffdf85 },
    ];
    let ambientIndex = 0;
    for (const region of regions) {
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
    return Math.max(
      0.9,
      Math.min(3.2, Math.min(this.#app.screen.width / 1220, this.#app.screen.height / 700)),
    );
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
    const desiredX = this.#app.screen.width / 2 - this.#cameraX * scale;
    const desiredY = this.#app.screen.height / 2 - this.#cameraY * scale;
    const minX = Math.min(0, this.#app.screen.width - WORLD_WIDTH * scale);
    const minY = Math.min(0, this.#app.screen.height - WORLD_HEIGHT * scale);
    this.#world.position.set(
      Math.min(0, Math.max(minX, desiredX)),
      Math.min(0, Math.max(minY, desiredY)),
    );
  }

  #visibleBounds(margin = 0): WorldBounds {
    const scale = this.#world.scale.x || 1;
    return {
      left: Math.max(0, -this.#world.x / scale - margin),
      top: Math.max(0, -this.#world.y / scale - margin),
      right: Math.min(WORLD_WIDTH, (this.#app.screen.width - this.#world.x) / scale + margin),
      bottom: Math.min(WORLD_HEIGHT, (this.#app.screen.height - this.#world.y) / scale + margin),
    };
  }

  #isVisibleWorld(x: number, y: number, margin = 0): boolean {
    const bounds = this.#visibleBounds(margin);
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }

  #updateTerrain(): void {
    const bounds = this.#visibleBounds(TILE_SIZE * 2);
    const startX = Math.max(0, Math.floor(bounds.left / TILE_SIZE) * TILE_SIZE);
    const startY = Math.max(0, Math.floor(bounds.top / TILE_SIZE) * TILE_SIZE);
    const endX = Math.min(WORLD_WIDTH, Math.ceil(bounds.right / TILE_SIZE) * TILE_SIZE);
    const endY = Math.min(WORLD_HEIGHT, Math.ceil(bounds.bottom / TILE_SIZE) * TILE_SIZE);
    const columns = Math.max(0, Math.ceil((endX - startX) / TILE_SIZE));
    const rows = Math.max(0, Math.ceil((endY - startY) / TILE_SIZE));
    const key = `${startX}:${startY}:${columns}:${rows}`;
    if (key === this.#terrainKey) return;
    this.#terrainKey = key;

    const needed = columns * rows;
    while (this.#terrainTiles.length < needed) {
      const tile = new Sprite(Texture.EMPTY);
      this.#terrainTiles.push(tile);
      this.#terrain.addChild(tile);
    }
    this.#waterTiles = [];
    for (let index = 0; index < this.#terrainTiles.length; index++) {
      const tile = this.#terrainTiles[index];
      if (!tile) continue;
      if (index >= needed) {
        tile.visible = false;
        continue;
      }
      tile.visible = true;
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = startX + column * TILE_SIZE;
      const y = startY + row * TILE_SIZE;
      const tileX = Math.floor(x / TILE_SIZE);
      const tileY = Math.floor(y / TILE_SIZE);
      const seed = tileX * 97 + tileY * 131;
      const variation = tileVariation(tileX, tileY);
      const sample = terrainAt(x + TILE_SIZE / 2, y + TILE_SIZE / 2, variation);
      const detail = seeded(seed + 17) > 1 - sample.detailChance;
      const grassBase =
        sample.palette === "earth"
          ? this.art.tiles.grass.slice(0, 2)
          : sample.palette === "moss"
            ? this.art.tiles.grass.slice(3, 6)
            : sample.palette === "stone"
              ? [this.art.tiles.grass[0], this.art.tiles.grass[2], this.art.tiles.grass[7]].filter(
                  (texture): texture is Texture => texture !== undefined,
                )
              : this.art.tiles.grass.slice(2, 4);
      const grassDetail =
        sample.palette === "earth"
          ? [this.art.tiles.grass[1], this.art.tiles.grass[7]].filter(
              (texture): texture is Texture => texture !== undefined,
            )
          : this.art.tiles.grass.slice(4);
      const texture =
        sample.kind === "water"
          ? pickTexture(this.art.tiles.water, seed)
          : sample.kind === "path"
            ? detail
              ? pickTexture(this.art.tiles.path.slice(3), seed)
              : variation > 0.84
                ? pickTexture(this.art.tiles.path.slice(0, 3), seed)
                : pickTexture(this.art.tiles.path.slice(0, 1), seed)
            : sample.kind === "wet"
              ? variation > 0.82
                ? pickTexture(this.art.tiles.wet, seed)
                : pickTexture(this.art.tiles.wet.slice(0, 1), seed)
              : sample.kind === "sanctuary"
                ? variation > 0.995
                  ? this.art.tiles.sanctuary
                  : variation > 0.975
                    ? pickTexture(grassBase, seed)
                    : pickTexture(grassBase.slice(0, 1), seed)
                : detail
                  ? pickTexture(grassDetail, seed)
                  : variation > 0.97
                    ? pickTexture(grassBase, seed)
                    : pickTexture(grassBase.slice(0, 1), seed);
      placeTile(tile, texture, x, y);
      tile.tint = sample.tint;
      tile.alpha = 1;
      if (sample.kind === "water") this.#waterTiles.push(tile);
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
    const shadow = new Graphics().ellipse(16, 31, 16, 6).fill({ color: COLORS.shadow, alpha: 0.6 });
    const animations = playerAnimations(player, this.art.units);
    const unitSprite = new Sprite(animations.idle[0]);
    unitSprite.width = 96;
    unitSprite.height = 96;
    unitSprite.position.set(-32, -43);
    const selfRing = new Graphics();
    if (player.id === this.#selfId) {
      selfRing.ellipse(16, 31, 18, 7).stroke({ width: 2, color: COLORS.selfRing, alpha: 0.82 });
    }
    const flash = new Graphics().roundRect(3, -8, 28, 40, 10).fill({ color: 0xffffff, alpha: 0 });
    actor.addChild(shadow, selfRing);
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
      attackUntil: 0,
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
    const scale =
      monster.kind === "troll"
        ? 112
        : monster.kind === "ogre"
          ? 92
          : monster.kind === "goblin"
            ? 72
            : 82;
    const shadow = new Graphics()
      .ellipse(18, 33, monster.kind === "troll" ? 35 : 25, monster.kind === "troll" ? 12 : 9)
      .fill({ color: COLORS.shadow, alpha: 0.65 });
    const body = createSprite(this.art.monsters[monster.species], scale, scale);
    body.anchor.set(0.5, 1);
    body.position.set(18, 40);
    const flash = new Graphics().ellipse(18, 18, 25, 21).fill({ color: 0xffffff, alpha: 0 });
    actor.addChild(shadow, body, flash);
    container.addChild(actor);
    const hp = new Graphics();
    hp.label = "hp";
    hp.position.set(0, -7);
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
    alert.position.set(18, -29);
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
    label.position.set(18, -15);
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
      attackUntil: 0,
      hitUntil: 0,
      wasDead: monster.dead,
      phase: phaseFor(monster.id),
    };
  }

  /** A fallen body: the class sprite, slumped, drained of colour, with a mote hanging over it. */
  #createCorpse(corpse: CorpseSnapshot): EntityView<CorpseSnapshot> {
    const container = new Container();
    const actor = new Container();
    actor.pivot.set(18, 20);

    const shadow = new Graphics()
      .ellipse(16, 30, 20, 7)
      .fill({ color: COLORS.shadow, alpha: 0.45 });
    const frames = playerAnimations(corpse, this.art.units);
    const body = new Sprite(frames.idle[0]);
    body.width = 96;
    body.height = 96;
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

    container.addChild(shadow, actor, wisp);
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
            : player.hp < player.maxHp
              ? 0.9
              : distance < 175
                ? 0.55
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
    return { x: QUEST_NPC.x + PLAYER_SIZE / 2, y: QUEST_NPC.y };
  }

  #trackEffect(
    container: Container,
    duration: number,
    rise: number,
    frames?: readonly Texture[],
  ): void {
    while (this.#activeEffects.length >= MAX_ACTIVE_EFFECTS) {
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
    };
    if (sprite) effect.sprite = sprite;
    if (frames) effect.frames = frames;
    this.#activeEffects.push(effect);
  }

  #addPulse(x: number, y: number, color: number, radius: number, durationMs: number): void {
    const pulse = new Graphics().circle(0, 0, radius).stroke({ width: 4, color });
    pulse.position.set(x, y);
    this.#trackEffect(pulse, durationMs, 0);
  }

  showWorldEvent(text: string, tone: "info" | "good" | "bad", x?: number, y?: number): void {
    const attacker = text.match(/^You hit /) ? this.#selfId : text.match(/^(.+?) hits /)?.[1];
    if (attacker === this.#selfId || (typeof attacker === "string" && attacker.length > 0)) {
      for (const view of this.#players.values()) {
        if (attacker === this.#selfId ? view.data.id === this.#selfId : view.data.nick === attacker)
          view.attackUntil = performance.now() + 700;
      }
    }
    const position = this.#effectPosition(x, y);
    if (!this.#isVisibleWorld(position.x, position.y, 100)) return;
    const fill = tone === "bad" ? 0xff9b93 : tone === "good" ? 0x9ff0ad : COLORS.label;
    const damage = text.match(/ for (\d+)\./)?.[1];
    const label = new Text({
      text: damage ? `-${damage}` : text,
      style: {
        fontFamily: "Georgia, serif",
        fontWeight: "bold",
        fontSize: damage ? 17 : 12,
        fill,
        stroke: { color: COLORS.shadow, width: 4 },
        dropShadow: { color: 0x000000, alpha: 0.85, blur: 3, distance: 2 },
      },
    });
    label.anchor.set(0.5, 1);
    label.position.set(position.x, position.y - 16);
    this.#trackEffect(label, damage ? 720 : 1_250, damage ? 38 : 25);
    if (damage || tone === "bad") this.#burst(position.x, position.y, fill, 7);
  }

  playAttack(playerId: string): void {
    const view = this.#players.get(playerId);
    if (!view) return;
    view.attackUntil = performance.now() + 700;
    const position = centerOf(view.data);
    this.#addPulse(position.x, position.y, COLORS.selfRing, 44, 180);
    this.#burst(position.x + 14, position.y, 0xffe0a0, 5);
  }

  playRangedHit(
    playerId: string,
    targetX: number,
    targetY: number,
    playerClass: PlayerClass,
  ): void {
    if (playerClass === "warrior") return;
    const view = this.#players.get(playerId);
    if (!view) return;
    const start = centerOf(view.data);
    const target = { x: targetX + 16, y: targetY + 16 };
    const angle = Math.atan2(target.y - start.y, target.x - start.x);
    const color = playerClass === "ranger" ? 0xf3cf78 : 0xb9f5d8;
    if (playerClass === "ranger") {
      const arrow = createSprite(this.art.effects.arrow, 34, 34);
      arrow.anchor.set(0.5);
      arrow.rotation = angle;
      arrow.position.set(target.x - Math.cos(angle) * 18, target.y - Math.sin(angle) * 18);
      this.#trackEffect(arrow, 220, 0);
    } else {
      const projectile = new Graphics()
        .moveTo(start.x, start.y)
        .lineTo(target.x, target.y)
        .stroke({ width: 4, color, alpha: 0.92 });
      this.#trackEffect(projectile, 180, 0);
    }
    this.#burst(target.x, target.y, color, playerClass === "ranger" ? 4 : 7);
  }

  playInteraction(): void {
    const position = this.#effectPosition();
    this.#addPulse(position.x, position.y, COLORS.npc, 34, 220);
  }

  playSkillEffect(playerClass: PlayerClass, x?: number, y?: number): void {
    const position = this.#effectPosition(x, y);
    const sheetKey =
      playerClass === "priest" ? "heal" : playerClass === "ranger" ? "dust" : "explosion";
    const frames = this.art.effectFrames[sheetKey];
    const first = frames[0];
    if (!first) return;
    const display = playerClass === "ranger" ? 56 : playerClass === "priest" ? 96 : 88;
    const sprite = createSprite(first, display, display);
    sprite.anchor.set(0.5);
    sprite.position.set(position.x, position.y);
    this.#trackEffect(
      sprite,
      playerClass === "ranger" ? 360 : 480,
      playerClass === "priest" ? 6 : 4,
      frames,
    );
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
      effect.container.scale.set(1 + progress * 0.55);
      if (progress < 1) continue;
      effect.container.destroy({ children: true });
      this.#activeEffects.splice(index, 1);
    }
  }

  #updateAmbient(now: number): void {
    for (let index = 0; index < this.#waterTiles.length; index++) {
      const tile = this.#waterTiles[index];
      if (!tile) continue;
      tile.alpha = 0.86 + Math.sin(now / 760 + index * 0.37) * 0.07;
      tile.tint = index % 3 === 0 ? 0xd7f5ec : 0xe1ffff;
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
    if (!self) {
      for (const view of this.#worldTextViews) view.label.alpha = 0;
      return;
    }
    const activeZone = zoneAt(self.x, self.y).id;
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

  playAttackMiss(): void {
    const self = this.#selfId ? this.#players.get(this.#selfId)?.data : undefined;
    if (!self) return;
    const position = centerOf(self);
    this.#addPulse(position.x + 18, position.y + 8, 0xffb0a8, 28, 160);
    this.#burst(position.x + 28, position.y + 12, 0xffc8c0, 4);
  }

  /** A gathered quest resource is visually absent until its authoritative respawn window passes. */
  hideQuestSite(id: string, durationMs: number): void {
    const site = this.#questSites.find((candidate) => candidate.id === id);
    if (site) site.hiddenUntil = performance.now() + durationMs;
  }

  #drawOverlay(context: RenderContext): void {
    this.#overlay.clear();
    const { self, now, quest, attackCooldownUntil, attackRange } = context;
    if (!self || isSpirit(self.life)) return;

    const center = centerOf(self);
    const onCooldown = attackCooldownUntil > now;
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
      const expected = active && site.order === quest.progress;
      site.signal.alpha = expected ? 0.72 + Math.sin(now / 160) * 0.22 : 0;
      site.signal.scale.set(expected ? 1 + Math.sin(now / 180) * 0.12 : 1);
      site.label.alpha = expected ? 1 : active ? 0.58 : 0.3;
    }

    let nearest: MonsterSnapshot | undefined;
    let nearestDistance = attackRange;
    for (const view of this.#monsters.values()) {
      const monster = view.data;
      if (monster.dead) continue;
      const distance = pointDistance(self, monster);
      if (distance <= nearestDistance) {
        nearest = monster;
        nearestDistance = distance;
      }
    }
    if (!nearest) return;
    const rangeAlpha = onCooldown ? 0.1 : 0.14 + Math.sin(now / 360) * 0.03;
    this.#overlay
      .circle(center.x, center.y, attackRange)
      .stroke({ width: 1.5, color: onCooldown ? 0xffb0a8 : COLORS.selfRing, alpha: rangeAlpha })
      .circle(nearest.x + 18, nearest.y + 18, 24)
      .stroke({ width: 2, color: 0xffe08a, alpha: 0.75 });
  }

  render(sample: SceneSample, context: RenderContext): void {
    const now = context.now;
    this.#followSelf(sample.players, now);
    this.#updateTerrain();
    this.#updateStaticVisibility();
    const self = sample.players.find((player) => player.id === this.#selfId);

    reconcile(
      this.#players,
      sample.players,
      (player) => this.#createPlayer(player),
      (view, player) => {
        const dx = player.x - (view.lastX ?? player.x);
        const dy = player.y - (view.lastY ?? player.y);
        if (Math.hypot(dx, dy) > 0.2) {
          view.movingUntil = now + 120;
          if (view.actor && Math.abs(dx) > 0.1) view.actor.scale.x = dx < 0 ? -1 : 1;
        }
        if (
          player.hp < (view.lastHp ?? player.hp) &&
          this.#isVisibleWorld(player.x, player.y, 80)
        ) {
          view.hitUntil = now + 190;
          this.#burst(player.x + 16, player.y + 16, 0xff8178, 6);
        }
        const ghost = player.life === "ghost";
        const spirit = isSpirit(player.life);
        if (view.wasDead && !spirit && this.#isVisibleWorld(player.x, player.y, 80)) {
          this.#addPulse(player.x + 16, player.y + 16, 0xa8f2dc, 24, 650);
        }
        // A player lying dead IS their corpse — the corpse layer draws the body, so the
        // avatar steps aside. What is left standing is only ever the living or a ghost.
        const visible =
          this.#isVisibleWorld(player.x, player.y, ENTITY_CULL_MARGIN) && player.life !== "corpse";
        view.container.visible = visible;
        view.container.position.set(player.x, player.y);
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
            view.actor.scale.y = 1;
            view.actor.tint = ghost ? 0x9fd8ff : 0xffffff;
          }
          if (view.unitSprite && view.unitAnimations) {
            const motion: UnitMotion =
              (view.attackUntil ?? 0) > now ? "attack" : moving ? "run" : "idle";
            const frames = view.unitAnimations[motion];
            const frame = frames[Math.floor(now / 95) % frames.length] ?? frames[0];
            if (frame) view.unitSprite.texture = frame;
          }
          if (view.flash) view.flash.alpha = (view.hitUntil ?? 0) > now ? 0.65 : 0;
          view.container.alpha = ghost ? 0.5 : 1;
          // A ghost has no health to show; it has a body to find.
          this.#drawHp(view, ghost ? 0 : player.hp, player.maxHp);
        }
        view.data = player;
        view.lastX = player.x;
        view.lastY = player.y;
        view.lastHp = player.hp;
        view.wasDead = spirit;
      },
    );

    reconcile(
      this.#monsters,
      sample.monsters,
      (monster) => this.#createMonster(monster),
      (view, monster) => {
        const dx = monster.x - (view.lastX ?? monster.x);
        const dy = monster.y - (view.lastY ?? monster.y);
        if (Math.hypot(dx, dy) > 0.15) view.movingUntil = now + 120;
        if (
          monster.hp < (view.lastHp ?? monster.hp) &&
          this.#isVisibleWorld(monster.x, monster.y, 80)
        ) {
          view.hitUntil = now + 210;
          this.#burst(monster.x + 18, monster.y + 18, 0xffd078, 7);
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
            view.actor.scale.set(1 + bounce * 0.07, monster.dead ? 0.28 : 1 - bounce * 0.05);
            view.actor.alpha = monster.dead ? 0.28 : 1;
            if ((view.attackUntil ?? 0) > now) {
              const strike = 1 - ((view.attackUntil ?? now) - now) / 240;
              view.actor.x = 18 + Math.sin(strike * Math.PI) * 7;
              view.actor.rotation = Math.sin(strike * Math.PI) * -0.16;
            } else {
              view.actor.x = 18;
              view.actor.rotation = 0;
            }
          }
          if (view.flash) view.flash.alpha = (view.hitUntil ?? 0) > now ? 0.7 : 0;
          if (view.alert) {
            view.alert.visible = aggro;
            view.alert.y = -29 + Math.sin(now / 120) * 2;
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
              : aggro || monster.hp < monster.maxHp
                ? 1
                : close
                  ? 0.45
                  : 0;
          }
        }
        view.data = monster;
        view.lastX = monster.x;
        view.lastY = monster.y;
        view.lastHp = monster.hp;
        view.wasDead = monster.dead;
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

    this.#layoutPlayerLabels(self);
    this.#updateWorldText(self);
    this.#drawOverlay(context);
    this.#updateAmbient(now);
    this.#updateEffects(now);
  }

  onFrame(callback: (nowMs: number, deltaSeconds: number) => void): void {
    this.#app.ticker.add((ticker) => callback(performance.now(), ticker.deltaMS / 1000));
  }

  destroy(): void {
    this.#app.destroy(true, { children: true });
  }
}
