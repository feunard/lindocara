import { Application, Container, Graphics, Text } from "pixi.js";
import { OBSTACLES, pointDistance, QUEST_NPC, SAFE_ZONE } from "../shared/game.js";
import type { LootSnapshot, MonsterSnapshot, PlayerSnapshot } from "../shared/protocol.js";
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

const APPEARANCE_COLORS = {
  azure: 0x67b7ff,
  ember: 0xff8668,
  moss: 0x78d47f,
  violet: 0xb891ff,
} as const;

interface EntityView<T extends { id: string }> {
  container: Container;
  data: T;
  actor?: Container;
  flash?: Graphics;
  weapon?: Graphics;
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
  #players = new Map<string, EntityView<PlayerSnapshot>>();
  #monsters = new Map<string, EntityView<MonsterSnapshot>>();
  #loot = new Map<string, EntityView<LootSnapshot>>();
  #activeEffects: Effect[] = [];
  #selfId: string | null = null;
  #cameraX = WORLD_WIDTH / 2;
  #cameraY = WORLD_HEIGHT / 2;

  private constructor(app: Application) {
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

    const renderer = new Renderer(app);
    renderer.#buildWorld();
    return renderer;
  }

  setSelfId(id: string): void {
    this.#selfId = id;
  }

  #buildWorld(): void {
    this.#app.stage.addChild(this.#world);

    const ground = new Graphics()
      .rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
      .fill(COLORS.grass)
      .ellipse(190, 130, 350, 230)
      .fill({ color: 0x2c6448, alpha: 0.18 })
      .ellipse(1390, 760, 390, 250)
      .fill({ color: 0x0d2c27, alpha: 0.32 })
      .roundRect(-40, 403, WORLD_WIDTH + 80, 94, 38)
      .fill({ color: COLORS.path, alpha: 0.9 })
      .roundRect(754, -40, 92, WORLD_HEIGHT + 80, 38)
      .fill({ color: COLORS.path, alpha: 0.9 });

    for (let index = 0; index < 165; index++) {
      const x = seeded(index) * WORLD_WIDTH;
      const y = seeded(index + 280) * WORLD_HEIGHT;
      const onPath = (y > 399 && y < 501) || (x > 750 && x < 850);
      if (onPath) {
        ground.circle(x, y, 1 + seeded(index + 40) * 2.5).fill({
          color: 0xb89a6d,
          alpha: 0.3,
        });
      } else {
        const color = index % 11 === 0 ? 0xd9abcb : index % 7 === 0 ? 0xe1cc71 : 0x4f8557;
        ground
          .moveTo(x - 3, y + 4)
          .lineTo(x, y - 4)
          .lineTo(x + 3, y + 4)
          .stroke({ width: 1.4, color, alpha: 0.48 });
      }
    }
    ground
      .roundRect(SAFE_ZONE.x, SAFE_ZONE.y, SAFE_ZONE.width, SAFE_ZONE.height, 42)
      .fill({ color: COLORS.safe, alpha: 0.88 })
      .stroke({ width: 3, color: 0x72d5cb, alpha: 0.72 });
    for (let inset = 14; inset < 58; inset += 14) {
      ground
        .roundRect(
          SAFE_ZONE.x + inset,
          SAFE_ZONE.y + inset,
          SAFE_ZONE.width - inset * 2,
          SAFE_ZONE.height - inset * 2,
          28,
        )
        .stroke({ width: 1.2, color: 0xb3f2dc, alpha: 0.15 });
    }
    this.#world.addChild(ground);

    for (const [obstacleIndex, obstacle] of OBSTACLES.entries()) {
      const ruin = new Container();
      ruin.position.set(obstacle.x, obstacle.y);
      const stone = new Graphics()
        .roundRect(7, 10, obstacle.width, obstacle.height, 18)
        .fill({ color: 0x05130e, alpha: 0.48 })
        .roundRect(0, 0, obstacle.width, obstacle.height, 14)
        .fill(COLORS.wall)
        .stroke({ width: 4, color: COLORS.wallEdge })
        .roundRect(12, 12, obstacle.width - 24, obstacle.height - 24, 9)
        .fill({ color: 0x173128, alpha: 0.92 });
      for (let tree = 0; tree < 7; tree++) {
        const x = 17 + seeded(obstacleIndex * 20 + tree) * (obstacle.width - 34);
        const y = 19 + seeded(obstacleIndex * 20 + tree + 8) * (obstacle.height - 38);
        const radius = 15 + seeded(tree + obstacleIndex * 7) * 9;
        stone
          .circle(x + 3, y + 6, radius)
          .fill({ color: 0x04120d, alpha: 0.58 })
          .circle(x, y, radius)
          .fill(tree % 2 === 0 ? 0x285f3e : 0x1d4c35)
          .circle(x - radius * 0.25, y - radius * 0.25, radius * 0.56)
          .fill({ color: 0x568956, alpha: 0.48 });
      }
      ruin.addChild(stone);
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
    npc.addChild(
      new Graphics()
        .circle(16, 15, 24)
        .fill({ color: COLORS.npc, alpha: 0.08 })
        .circle(16, 15, 24)
        .stroke({ width: 1.5, color: COLORS.npc, alpha: 0.35 })
        .poly([5, 30, 10, 8, 22, 8, 28, 30])
        .fill(0x315b68)
        .stroke({ width: 2, color: 0xa9d1c9 })
        .circle(16, 6, 8)
        .fill(0xe7c49b)
        .poly([9, 6, 12, -3, 22, 1, 23, 8])
        .fill(0xd7d2c4),
    );
    const questMark = new Text({
      text: "◆",
      style: {
        fontFamily: "Georgia, serif",
        fontSize: 20,
        fill: COLORS.npc,
        dropShadow: { color: 0x4a2f00, alpha: 0.9, blur: 5, distance: 0 },
      },
    });
    questMark.anchor.set(0.5);
    questMark.position.set(16, -25);
    npc.addChild(questMark);
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
    this.#world.addChild(this.#effects);
  }

  #createPlayer(player: PlayerSnapshot): EntityView<PlayerSnapshot> {
    const container = new Container();
    const actor = new Container();
    actor.pivot.set(16, 17);
    actor.position.set(16, 17);
    const body = new Graphics()
      .ellipse(16, 31, 15, 6)
      .fill({ color: COLORS.shadow, alpha: 0.6 })
      .poly([6, 29, 9, 13, 23, 13, 27, 29])
      .fill({ color: 0x17232c, alpha: 0.9 })
      .roundRect(7, 11, 18, 17, 7)
      .fill(APPEARANCE_COLORS[player.appearance])
      .stroke({
        width: player.id === this.#selfId ? 2.5 : 1.5,
        color: player.id === this.#selfId ? 0xe9fff1 : 0xb9cec1,
      })
      .circle(16, 8, 8)
      .fill(0xe9bf91)
      .poly([8, 7, 11, -1, 22, 0, 24, 8, 20, 5, 14, 5])
      .fill(0x2a2528)
      .circle(13, 8, 1.3)
      .fill(0x17232c)
      .circle(19, 8, 1.3)
      .fill(0x17232c);
    const weapon = new Graphics()
      .roundRect(25, 12, 3, 19, 1)
      .fill(0xddd8c8)
      .rect(22, 26, 9, 3)
      .fill(COLORS.selfRing);
    const flash = new Graphics().roundRect(7, 2, 18, 26, 8).fill({ color: 0xffffff, alpha: 0 });
    actor.addChild(body, weapon, flash);
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
    const body = new Graphics()
      .ellipse(18, 32, 20, 7)
      .fill({ color: COLORS.shadow, alpha: 0.65 })
      .ellipse(18, 22, 21, 16)
      .fill(0x247048)
      .ellipse(18, 18, 19, 16)
      .fill(COLORS.slime)
      .ellipse(13, 13, 8, 5)
      .fill({ color: 0xc4f1a5, alpha: 0.48 })
      .circle(12, 18, 2.5)
      .fill(0x102d20)
      .circle(24, 18, 2.5)
      .fill(0x102d20)
      .moveTo(13, 25)
      .quadraticCurveTo(18, 28, 23, 25)
      .stroke({ width: 1.5, color: 0x17452c });
    const flash = new Graphics().ellipse(18, 18, 20, 17).fill({ color: 0xffffff, alpha: 0 });
    actor.addChild(body, flash);
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
    container.addChild(
      glow,
      new Graphics()
        .poly([8, 0, 16, 7, 13, 16, 3, 16, 0, 7])
        .fill(color)
        .stroke({ width: 1.5, color: COLORS.label }),
    );
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
    const attacker = text.match(/^(.+?) hits /)?.[1];
    if (attacker) {
      for (const view of this.#players.values()) {
        if (view.data.nick === attacker) view.attackUntil = performance.now() + 190;
      }
      for (const view of this.#monsters.values()) {
        if (view.data.name === attacker) view.attackUntil = performance.now() + 240;
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

  render(sample: SceneSample, now: number = performance.now()): void {
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
          view.weapon.rotation =
            (view.attackUntil ?? 0) > now ? -1.35 + ((view.attackUntil ?? now) - now) / 190 : 0;
          view.weapon.position.set((view.attackUntil ?? 0) > now ? 5 : 0, -4);
        }
        if (view.flash) view.flash.alpha = (view.hitUntil ?? 0) > now ? 0.65 : 0;
        view.container.alpha = player.dead ? 0.55 : 1;
        const label = view.container.getChildByName("label");
        if (label instanceof Text) {
          label.text = `${player.nick}  ·  Lv ${player.level}`;
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
    this.#updateEffects(now);
  }

  onFrame(callback: (nowMs: number, deltaSeconds: number) => void): void {
    this.#app.ticker.add((ticker) => callback(performance.now(), ticker.deltaMS / 1000));
  }

  destroy(): void {
    this.#app.destroy(true, { children: true });
  }
}
