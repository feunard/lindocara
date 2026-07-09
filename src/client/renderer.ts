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
import {
  INTERACTION_RANGE,
  OBSTACLES,
  pointDistance,
  QUEST_NPC,
  SAFE_ZONE,
} from "../shared/game.js";
import type {
  Appearance,
  ItemKind,
  LootSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  QuestStatus,
} from "../shared/protocol.js";
import { PLAYER_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "../shared/simulation.js";
import type { SceneSample } from "./net.js";

const COLORS = {
  grass: 0x173f32,
  grassAlt: 0x1b4938,
  path: 0x8d7653,
  wall: 0x36454a,
  wallEdge: 0x89a39d,
  safe: 0x356f78,
  npc: 0xf6c85f,
  slime: 0x63d471,
  hp: 0xe85454,
  hpBack: 0x251f26,
  label: 0xf4f0df,
  shadow: 0x07120f,
  selfRing: 0xf6c85f,
  lootPotion: 0xe66ea8,
  lootGold: 0xf0c85c,
  lootCrystal: 0x7dd8ff,
} as const;

const ATLAS_IMAGE = "/assets/lindocara/atlas/world.png";
const ATLAS_DATA = "/assets/lindocara/atlas/world.json";

const TILE_SIZE = 32;

interface AtlasData {
  frames: Record<string, { x: number; y: number; w: number; h: number }>;
}

interface ArtTextures {
  atlas: Record<string, Texture>;
  players: Record<Appearance, Texture>;
  slime: Texture;
  keeper: Texture;
  tiles: {
    grass: Texture[];
    path: Texture[];
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
  };
  sword: Texture;
  loot: Record<ItemKind, Texture>;
}

export interface RenderContext {
  self?: PlayerSnapshot;
  questStatus: QuestStatus;
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
  movingUntil?: number;
  attackUntil?: number;
  hitUntil?: number;
  wasDead?: boolean;
  phase?: number;
}

interface Effect {
  container: Container;
  bornAt: number;
  duration: number;
  rise: number;
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

function centerOf(entity: { x: number; y: number }): { x: number; y: number } {
  return { x: entity.x + PLAYER_SIZE / 2, y: entity.y + PLAYER_SIZE / 2 };
}

async function loadArt(): Promise<ArtTextures> {
  const [baseTexture, atlasData] = await Promise.all([
    Assets.load<Texture>(ATLAS_IMAGE),
    fetch(ATLAS_DATA).then((response) => response.json() as Promise<AtlasData>),
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

  return {
    atlas,
    players: {
      azure: texture("player.azure"),
      ember: texture("player.ember"),
      moss: texture("player.moss"),
      violet: texture("player.violet"),
    },
    slime: texture("monster.slime"),
    keeper: texture("npc.keeper"),
    tiles: {
      grass: [
        texture("tile.grass.a"),
        texture("tile.grass.b"),
        texture("tile.grass.c"),
        texture("tile.grass.d"),
      ],
      path: [texture("tile.path.a"), texture("tile.path.b"), texture("tile.path.c")],
      sanctuary: texture("tile.sanctuary"),
    },
    props: {
      trees: [texture("prop.tree.large"), texture("prop.tree.round"), texture("prop.tree.small")],
      ruins: [
        texture("prop.ruin.gate"),
        texture("prop.ruin.wall"),
        texture("prop.ruin.house"),
        texture("prop.hut"),
      ],
      rocks: [texture("prop.rock.a"), texture("prop.rock.b"), texture("prop.rock.c")],
      mushrooms: [texture("prop.mushroom.a"), texture("prop.mushroom.b")],
      stump: texture("prop.stump"),
      log: texture("prop.log"),
      fence: texture("prop.fence"),
    },
    sword: texture("weapon.sword"),
    loot: {
      potion: texture("loot.potion"),
      gold: texture("loot.gold"),
      crystal: texture("loot.crystal"),
    },
  };
}

function createSprite(texture: Texture, width: number, height: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.width = width;
  sprite.height = height;
  return sprite;
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
  #effects = new Container();
  #overlay = new Graphics();
  #npcMark?: Text;
  #sanctuaryLabel?: Text;
  #players = new Map<string, EntityView<PlayerSnapshot>>();
  #monsters = new Map<string, EntityView<MonsterSnapshot>>();
  #loot = new Map<string, EntityView<LootSnapshot>>();
  #activeEffects: Effect[] = [];
  #selfId: string | null = null;
  #cameraX = WORLD_WIDTH / 2;
  #cameraY = WORLD_HEIGHT / 2;

  private constructor(
    app: Application,
    private readonly art: ArtTextures,
  ) {
    this.#app = app;
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    const app = new Application();
    await app.init({
      canvas,
      background: COLORS.grass,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });

    const art = await loadArt();
    const renderer = new Renderer(app, art);
    renderer.#buildWorld();
    return renderer;
  }

  setSelfId(id: string): void {
    this.#selfId = id;
  }

  #buildWorld(): void {
    this.#app.stage.addChild(this.#world);

    const ground = new Container();
    for (let y = 0; y < WORLD_HEIGHT; y += TILE_SIZE) {
      for (let x = 0; x < WORLD_WIDTH; x += TILE_SIZE) {
        const tileX = Math.floor(x / TILE_SIZE);
        const tileY = Math.floor(y / TILE_SIZE);
        const inSafe =
          x >= SAFE_ZONE.x - TILE_SIZE &&
          x <= SAFE_ZONE.x + SAFE_ZONE.width &&
          y >= SAFE_ZONE.y - TILE_SIZE &&
          y <= SAFE_ZONE.y + SAFE_ZONE.height;
        const onPath = (y > 384 && y < 512) || (x > 736 && x < 864);
        const variants = onPath ? this.art.tiles.path : this.art.tiles.grass;
        const texture = inSafe
          ? this.art.tiles.sanctuary
          : pickTexture(variants, tileX * 7 + tileY * 13);
        const tile = createSprite(texture, TILE_SIZE, TILE_SIZE);
        tile.position.set(x, y);
        ground.addChild(tile);
      }
    }
    this.#world.addChild(ground);

    const decor = new Container();
    for (let index = 0; index < 105; index++) {
      const x = seeded(index + 1000) * WORLD_WIDTH;
      const y = seeded(index + 1400) * WORLD_HEIGHT;
      const onPath = (y > 384 && y < 512) || (x > 736 && x < 864);
      const inSafe =
        x >= SAFE_ZONE.x - 20 &&
        x <= SAFE_ZONE.x + SAFE_ZONE.width + 20 &&
        y >= SAFE_ZONE.y - 20 &&
        y <= SAFE_ZONE.y + SAFE_ZONE.height + 20;
      if (onPath || inSafe) continue;
      const pool =
        index % 9 === 0
          ? this.art.props.rocks
          : index % 7 === 0
            ? this.art.props.mushrooms
            : index % 5 === 0
              ? [this.art.props.log, this.art.props.stump]
              : this.art.props.trees.slice(1);
      const texture = pickTexture(pool, index);
      const size = index % 5 === 0 ? 28 : index % 9 === 0 ? 22 : 34;
      const prop = createFittedSprite(texture, size, size);
      prop.anchor.set(0.5, 1);
      prop.position.set(x, y);
      decor.addChild(prop);
    }
    this.#world.addChild(decor);

    const safeMark = new Graphics()
      .roundRect(SAFE_ZONE.x, SAFE_ZONE.y, SAFE_ZONE.width, SAFE_ZONE.height, 42)
      .fill({ color: COLORS.safe, alpha: 0.18 })
      .stroke({ width: 3, color: 0x72d5cb, alpha: 0.72 });
    for (let inset = 14; inset < 58; inset += 14) {
      safeMark
        .roundRect(
          SAFE_ZONE.x + inset,
          SAFE_ZONE.y + inset,
          SAFE_ZONE.width - inset * 2,
          SAFE_ZONE.height - inset * 2,
          28,
        )
        .stroke({ width: 1.2, color: 0xb3f2dc, alpha: 0.15 });
    }
    this.#world.addChild(safeMark);

    for (const [obstacleIndex, obstacle] of OBSTACLES.entries()) {
      const ruin = new Container();
      ruin.position.set(obstacle.x, obstacle.y);
      const shadow = new Graphics()
        .ellipse(obstacle.width / 2, obstacle.height - 10, obstacle.width * 0.46, 18)
        .fill({ color: COLORS.shadow, alpha: 0.45 });
      ruin.addChild(shadow);
      const mainProp = createFittedSprite(
        pickTexture(this.art.props.ruins, obstacleIndex),
        obstacle.width * 0.96,
        obstacle.height * 0.95,
      );
      mainProp.anchor.set(0.5, 1);
      mainProp.position.set(obstacle.width / 2, obstacle.height);
      ruin.addChild(mainProp);
      for (let tree = 0; tree < 4; tree++) {
        const isRock = tree % 3 === 0;
        const texture = isRock
          ? pickTexture(this.art.props.rocks, tree)
          : pickTexture(this.art.props.trees, tree);
        const treeSprite = createFittedSprite(texture, isRock ? 28 : 48, isRock ? 22 : 58);
        treeSprite.anchor.set(0.5, 1);
        treeSprite.position.set(
          16 + seeded(obstacleIndex * 31 + tree) * (obstacle.width - 32),
          26 + seeded(obstacleIndex * 31 + tree + 13) * (obstacle.height - 20),
        );
        ruin.addChild(treeSprite);
      }
      this.#world.addChild(ruin);
    }

    for (const [text, x, y] of [
      ["THE GLOAMWOOD", 120, 58],
      ["WARDEN'S CROSSING", 800, 540],
      ["OLD ROOT ARCADE", 1415, 825],
    ] as const) {
      const region = new Text({
        text,
        style: {
          fontFamily: "Georgia, serif",
          fontSize: 14,
          fill: 0xc3d6bd,
          letterSpacing: 3,
          dropShadow: { color: 0x000000, alpha: 0.7, blur: 3, distance: 2 },
        },
      });
      region.anchor.set(0.5);
      region.position.set(x, y);
      region.alpha = 0.6;
      this.#world.addChild(region);
    }

    const npc = new Container();
    npc.position.set(QUEST_NPC.x, QUEST_NPC.y);
    npc.addChild(new Graphics().ellipse(16, 31, 18, 7).fill({ color: 0x000000, alpha: 0.38 }));
    npc.addChild(new Graphics().circle(16, 15, 27).fill({ color: COLORS.npc, alpha: 0.08 }));
    const keeper = createSprite(this.art.keeper, 34, 34);
    keeper.anchor.set(0.5, 1);
    keeper.position.set(16, 35);
    npc.addChild(keeper);
    const questMark = new Text({
      text: "*",
      style: {
        fontFamily: "Georgia, serif",
        fontSize: 20,
        fill: COLORS.npc,
        dropShadow: { color: 0x4a2f00, alpha: 0.9, blur: 5, distance: 0 },
      },
    });
    questMark.name = "questMark";
    questMark.anchor.set(0.5);
    questMark.position.set(16, -25);
    npc.addChild(questMark);
    this.#npcMark = questMark;
    const label = new Text({
      text: `${QUEST_NPC.name}\n${QUEST_NPC.role}`,
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
    npc.addChild(label);
    this.#world.addChild(npc);

    const sanctuaryLabel = new Text({
      text: "HEARTROOT",
      style: {
        fontFamily: "Georgia, serif",
        fontSize: 13,
        fill: 0xb3f2dc,
        letterSpacing: 4,
        dropShadow: { color: 0x000000, alpha: 0.8, blur: 3, distance: 2 },
      },
    });
    sanctuaryLabel.anchor.set(0.5);
    sanctuaryLabel.position.set(SAFE_ZONE.x + SAFE_ZONE.width / 2, SAFE_ZONE.y + 16);
    this.#sanctuaryLabel = sanctuaryLabel;
    this.#world.addChild(sanctuaryLabel);
    this.#world.addChild(this.#overlay);
    this.#world.addChild(this.#effects);
  }

  #createPlayer(player: PlayerSnapshot): EntityView<PlayerSnapshot> {
    const container = new Container();
    const actor = new Container();
    actor.pivot.set(16, 17);
    actor.position.set(16, 17);
    const shadow = new Graphics().ellipse(16, 31, 16, 6).fill({ color: COLORS.shadow, alpha: 0.6 });
    const body = createSprite(this.art.players[player.appearance], 32, 32);
    body.anchor.set(0.5, 1);
    body.position.set(16, 34);
    const selfRing = new Graphics();
    if (player.id === this.#selfId) {
      selfRing.ellipse(16, 31, 18, 7).stroke({ width: 2, color: COLORS.selfRing, alpha: 0.72 });
    }
    const weapon = createSprite(this.art.sword, 14, 28);
    weapon.anchor.set(0.5, 1);
    weapon.position.set(25, 31);
    const flash = new Graphics().roundRect(3, -8, 28, 40, 10).fill({ color: 0xffffff, alpha: 0 });
    actor.addChild(shadow, selfRing, body, weapon, flash);
    container.addChild(actor);
    const hp = new Graphics();
    hp.name = "hp";
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
    label.name = "label";
    label.anchor.set(0.5, 1);
    label.position.set(PLAYER_SIZE / 2, -14);
    container.addChild(label);
    this.#world.addChild(container);
    return {
      container,
      data: player,
      actor,
      weapon,
      flash,
      lastX: player.x,
      lastY: player.y,
      lastHp: player.hp,
      movingUntil: 0,
      attackUntil: 0,
      hitUntil: 0,
      wasDead: player.dead,
      phase: phaseFor(player.id),
    };
  }

  #createMonster(monster: MonsterSnapshot): EntityView<MonsterSnapshot> {
    const container = new Container();
    const actor = new Container();
    actor.pivot.set(18, 20);
    actor.position.set(18, 20);
    const shadow = new Graphics()
      .ellipse(18, 32, 20, 7)
      .fill({ color: COLORS.shadow, alpha: 0.65 });
    const body = createSprite(this.art.slime, 32, 32);
    body.anchor.set(0.5, 1);
    body.position.set(18, 34);
    const flash = new Graphics().ellipse(18, 18, 21, 18).fill({ color: 0xffffff, alpha: 0 });
    actor.addChild(shadow, body, flash);
    container.addChild(actor);
    const hp = new Graphics();
    hp.name = "hp";
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
      text: monster.name,
      style: {
        fontFamily: "Georgia, serif",
        fontSize: 11,
        fill: 0xcff5bf,
        dropShadow: { color: 0x000000, alpha: 0.9, blur: 3, distance: 1 },
      },
    });
    label.name = "label";
    label.anchor.set(0.5, 1);
    label.position.set(18, -11);
    container.addChild(label);
    this.#world.addChild(container);
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
    this.#world.addChild(container);
    return { container, data: loot, flash: glow, phase: phaseFor(loot.id) };
  }

  #drawHp(container: Container, hp: number, maxHp: number): void {
    const child = container.getChildByName("hp");
    if (!(child instanceof Graphics)) return;
    const ratio = maxHp <= 0 ? 0 : Math.max(0, Math.min(1, hp / maxHp));
    const color = ratio > 0.55 ? 0x65d17d : ratio > 0.25 ? 0xf0b85a : COLORS.hp;
    child
      .clear()
      .roundRect(-4, 0, PLAYER_SIZE + 8, 6, 3)
      .fill(COLORS.hpBack)
      .roundRect(-3, 1, (PLAYER_SIZE + 6) * ratio, 4, 2)
      .fill(color);
  }

  #followSelf(players: readonly PlayerSnapshot[]): void {
    const self = players.find((player) => player.id === this.#selfId);
    const target = self ? centerOf(self) : { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    this.#cameraX += (target.x - this.#cameraX) * 0.1;
    this.#cameraY += (target.y - this.#cameraY) * 0.1;
    const scale = Math.max(
      0.84,
      Math.min(1.22, Math.min(this.#app.screen.width / 900, this.#app.screen.height / 620)),
    );
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

  #effectPosition(x?: number, y?: number): { x: number; y: number } {
    if (typeof x === "number" && typeof y === "number") return { x, y };
    const self = this.#selfId ? this.#players.get(this.#selfId)?.data : undefined;
    if (self) return centerOf(self);
    return { x: QUEST_NPC.x + PLAYER_SIZE / 2, y: QUEST_NPC.y };
  }

  #addPulse(x: number, y: number, color: number, radius: number, durationMs: number): void {
    const pulse = new Graphics().circle(0, 0, radius).stroke({ width: 4, color });
    pulse.position.set(x, y);
    this.#effects.addChild(pulse);
    this.#activeEffects.push({
      container: pulse,
      bornAt: performance.now(),
      duration: durationMs,
      rise: 0,
    });
  }

  showWorldEvent(text: string, tone: "info" | "good" | "bad", x?: number, y?: number): void {
    const attacker = text.match(/^You hit /) ? this.#selfId : text.match(/^(.+?) hits /)?.[1];
    if (attacker === this.#selfId || (typeof attacker === "string" && attacker.length > 0)) {
      for (const view of this.#players.values()) {
        if (attacker === this.#selfId ? view.data.id === this.#selfId : view.data.nick === attacker)
          view.attackUntil = performance.now() + 190;
      }
    }
    const position = this.#effectPosition(x, y);
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
    this.#effects.addChild(label);
    this.#activeEffects.push({
      container: label,
      bornAt: performance.now(),
      duration: damage ? 720 : 1_250,
      rise: damage ? 38 : 25,
    });
    if (damage || tone === "bad") this.#burst(position.x, position.y, fill, 7);
  }

  playAttack(playerId: string): void {
    const view = this.#players.get(playerId);
    if (!view) return;
    view.attackUntil = performance.now() + 190;
    const position = centerOf(view.data);
    this.#addPulse(position.x, position.y, COLORS.selfRing, 44, 180);
    this.#burst(position.x + 14, position.y, 0xffe0a0, 5);
  }

  playInteraction(): void {
    const position = this.#effectPosition();
    this.#addPulse(position.x, position.y, COLORS.npc, 34, 220);
  }

  #burst(x: number, y: number, color: number, count: number): void {
    for (let index = 0; index < count; index++) {
      const angle = (index / count) * Math.PI * 2 + seeded(index + count);
      const distance = 7 + seeded(index + 90) * 16;
      const particle = new Graphics()
        .circle(0, 0, 1.5 + seeded(index + 30) * 2)
        .fill({ color, alpha: 0.9 });
      particle.position.set(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance);
      this.#effects.addChild(particle);
      this.#activeEffects.push({
        container: particle,
        bornAt: performance.now(),
        duration: 360,
        rise: 10 + seeded(index + 60) * 16,
      });
    }
  }

  #updateEffects(now: number): void {
    for (let index = this.#activeEffects.length - 1; index >= 0; index--) {
      const effect = this.#activeEffects[index];
      if (!effect) continue;
      const progress = Math.min(1, (now - effect.bornAt) / effect.duration);
      effect.container.alpha = 1 - progress;
      effect.container.y -= (effect.rise / effect.duration) * 16.67;
      effect.container.scale.set(1 + progress * 0.55);
      if (progress < 1) continue;
      effect.container.destroy({ children: true });
      this.#activeEffects.splice(index, 1);
    }
  }

  playAttackMiss(): void {
    const self = this.#selfId ? this.#players.get(this.#selfId)?.data : undefined;
    if (!self) return;
    const position = centerOf(self);
    this.#addPulse(position.x + 18, position.y + 8, 0xffb0a8, 28, 160);
    this.#burst(position.x + 28, position.y + 12, 0xffc8c0, 4);
  }

  #drawOverlay(context: RenderContext): void {
    this.#overlay.clear();
    const { self, now, questStatus, attackCooldownUntil, attackRange } = context;
    if (!self || self.dead) return;

    const center = centerOf(self);
    const onCooldown = attackCooldownUntil > now;
    const rangeAlpha = onCooldown ? 0.14 : 0.22 + Math.sin(now / 320) * 0.05;
    this.#overlay
      .circle(center.x, center.y, attackRange)
      .stroke({ width: 2, color: onCooldown ? 0xffb0a8 : COLORS.selfRing, alpha: rangeAlpha })
      .circle(center.x, center.y, attackRange - 6)
      .stroke({ width: 1, color: 0xffffff, alpha: rangeAlpha * 0.35 });

    if (this.#npcMark) {
      const pulse = questStatus === "ready" ? 1.2 : questStatus === "available" ? 1 : 0.55;
      this.#npcMark.alpha = pulse * (0.65 + Math.sin(now / 260) * 0.35);
      this.#npcMark.scale.set(questStatus === "available" ? 1 + Math.sin(now / 220) * 0.12 : 1);
    }
    if (this.#sanctuaryLabel) {
      this.#sanctuaryLabel.alpha = 0.55 + Math.sin(now / 900) * 0.18;
    }

    if (questStatus === "available" || questStatus === "ready") {
      const npcCenter = { x: QUEST_NPC.x + 16, y: QUEST_NPC.y + 16 };
      const dx = npcCenter.x - center.x;
      const dy = npcCenter.y - center.y;
      const distance = Math.hypot(dx, dy);
      if (distance > INTERACTION_RANGE * 1.4) {
        const ux = dx / distance;
        const uy = dy / distance;
        const tipX = center.x + ux * 42;
        const tipY = center.y + uy * 42;
        this.#overlay
          .moveTo(center.x + ux * 18, center.y + uy * 18)
          .lineTo(tipX, tipY)
          .stroke({ width: 2, color: COLORS.npc, alpha: 0.45 });
        this.#overlay
          .poly([
            tipX,
            tipY,
            tipX - ux * 8 - uy * 5,
            tipY - uy * 8 + ux * 5,
            tipX - ux * 8 + uy * 5,
            tipY - uy * 8 - ux * 5,
          ])
          .fill({ color: COLORS.npc, alpha: 0.55 });
      }
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
    if (nearest) {
      this.#overlay
        .circle(nearest.x + 18, nearest.y + 18, 24)
        .stroke({ width: 2, color: 0xffe08a, alpha: 0.75 });
    }
  }

  render(sample: SceneSample, context: RenderContext): void {
    const now = context.now;
    this.#followSelf(sample.players);
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
        if (player.hp < (view.lastHp ?? player.hp)) {
          view.hitUntil = now + 190;
          this.#burst(player.x + 16, player.y + 16, 0xff8178, 6);
        }
        if (view.wasDead && !player.dead) {
          this.#addPulse(player.x + 16, player.y + 16, 0xa8f2dc, 24, 650);
          this.showWorldEvent("HEARTROOT AWAKENING", "good", player.x, player.y);
        }
        view.container.position.set(player.x, player.y);
        const moving = (view.movingUntil ?? 0) > now && !player.dead;
        const stride = Math.sin(now / 85 + (view.phase ?? 0));
        const idle = Math.sin(now / 480 + (view.phase ?? 0));
        if (view.actor) {
          view.actor.y = 17 + (moving ? -Math.abs(stride) * 2.4 : idle * -0.8);
          view.actor.rotation = player.dead ? 1.35 : moving ? stride * 0.045 : idle * 0.012;
          view.actor.alpha = player.dead ? 0.4 : 1;
          view.actor.scale.y = player.dead ? 0.62 : 1;
        }
        if (view.weapon) {
          const attacking = (view.attackUntil ?? 0) > now;
          view.weapon.rotation = attacking ? -1.35 + ((view.attackUntil ?? now) - now) / 190 : 0;
          view.weapon.position.set(attacking ? 30 : 25, 27);
        }
        if (view.flash) view.flash.alpha = (view.hitUntil ?? 0) > now ? 0.65 : 0;
        view.container.alpha = player.dead ? 0.55 : 1;
        const label = view.container.getChildByName("label");
        if (label instanceof Text) {
          label.text = `${player.nick} - Lv ${player.level}`;
          label.alpha = player.dead ? 0.45 : 1;
        }
        this.#drawHp(view.container, player.hp, player.maxHp);
        view.data = player;
        view.lastX = player.x;
        view.lastY = player.y;
        view.lastHp = player.hp;
        view.wasDead = player.dead;
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
        if (monster.hp < (view.lastHp ?? monster.hp)) {
          view.hitUntil = now + 210;
          this.#burst(monster.x + 18, monster.y + 18, 0xffd078, 7);
        }
        if (!view.wasDead && monster.dead) {
          this.#burst(monster.x + 18, monster.y + 18, 0x93e07e, 12);
        } else if (view.wasDead && !monster.dead) {
          this.#addPulse(monster.x + 18, monster.y + 18, 0x8afa95, 22, 600);
        }
        view.container.position.set(monster.x, monster.y);
        const moving = (view.movingUntil ?? 0) > now && !monster.dead;
        const bounce = Math.sin(now / (moving ? 105 : 360) + (view.phase ?? 0));
        const aggro = Boolean(
          self && !self.dead && !monster.dead && pointDistance(self, monster) < 215,
        );
        if (view.actor) {
          view.actor.y = 20 + bounce * (moving ? -2.3 : -1.1);
          view.actor.scale.set(1 + bounce * 0.045, monster.dead ? 0.28 : 1 - bounce * 0.045);
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
        const label = view.container.getChildByName("label");
        if (label instanceof Text) {
          label.text = aggro ? `!  ${monster.name}` : monster.name;
          label.alpha = monster.dead ? 0.25 : aggro ? 1 : 0.82;
        }
        this.#drawHp(view.container, monster.hp, monster.maxHp);
        const hp = view.container.getChildByName("hp");
        if (hp instanceof Graphics)
          hp.alpha = monster.dead ? 0 : aggro || monster.hp < monster.maxHp ? 1 : 0.42;
        view.data = monster;
        view.lastX = monster.x;
        view.lastY = monster.y;
        view.lastHp = monster.hp;
        view.wasDead = monster.dead;
      },
    );

    reconcile(
      this.#loot,
      sample.loot,
      (loot) => this.#createLoot(loot),
      (view, loot) => {
        view.container.position.set(
          loot.x,
          loot.y - 3 + Math.sin(now / 300 + (view.phase ?? 0)) * 4,
        );
        if (view.flash) view.flash.alpha = 0.6 + Math.sin(now / 260 + (view.phase ?? 0)) * 0.22;
        view.data = loot;
      },
    );
    this.#drawOverlay(context);
    this.#updateEffects(now);
  }

  onFrame(callback: (nowMs: number, deltaSeconds: number) => void): void {
    this.#app.ticker.add((ticker) => callback(performance.now(), ticker.deltaMS / 1000));
  }

  destroy(): void {
    this.#app.destroy(true, { children: true });
  }
}
