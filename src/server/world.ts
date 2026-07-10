/**
 * One authoritative MMO room. Clients send movement/action intent; this Durable Object alone
 * moves entities, applies damage, grants loot/XP, advances quests, and persists player profiles.
 */
import { DurableObject } from "cloudflare:workers";
import {
  ATTACK_COOLDOWN_MS,
  ATTACK_RANGE,
  applyDamage,
  applyExperience,
  attackDamageForLevel,
  clampRestoredPosition,
  INTERACTION_RANGE,
  inRect,
  LOOT_PICKUP_RANGE,
  MONSTER_AGGRO_RANGE,
  MONSTER_ATTACK_COOLDOWN_MS,
  MONSTER_ATTACK_RANGE,
  MONSTER_DAMAGE,
  MONSTER_MAX_HP,
  MONSTER_RESPAWN_MS,
  MONSTER_SPAWNS,
  MONSTER_SPEED,
  MONSTER_XP,
  type MonsterSpecies,
  maxHpForLevel,
  OBSTACLES,
  PLAYER_RESPAWN_MS,
  pointDistance,
  QUEST_KILL_TARGET,
  QUEST_NPC,
  resolveTerrain,
  SAFE_ZONE,
  spawnPosition,
  withinRange,
  xpForNextLevel,
} from "../shared/game.js";
import {
  type ClientMessage,
  type Command,
  encodeServerMessage,
  type LootSnapshot,
  type MonsterSnapshot,
  type PlayerSnapshot,
  parseClientMessage,
  type SelfState,
  type ServerMessage,
} from "../shared/protocol.js";
import {
  type Input,
  NO_INPUT,
  PLAYER_SIZE,
  step,
  TICK_DT,
  TICK_HZ,
  TICK_MS,
  type Vec2,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../shared/simulation.js";
import { createDb } from "./db/index.js";
import { loadProfile, type PlayerProfile, type SaveableProfile, saveProfile } from "./profile.js";

const ATTACHMENT_EVERY_TICKS = TICK_HZ;
const D1_SAVE_EVERY_TICKS = TICK_HZ * 5;
const MAX_FRAME_BYTES = 2_048;
const RATE_WINDOW_MS = 1_000;
const RATE_MAX_MESSAGES = 35;
const MAX_MALFORMED = 5;
const CHAT_MAX_LENGTH = 160;
const MAX_QUEUED_COMMANDS = 12;
const MAX_STARVED_TICKS = 5;

export interface Attachment extends Vec2 {
  id: string;
  nick: string;
  level?: number;
  xp?: number;
  hp?: number;
  appearance?: PlayerProfile["appearance"];
  inventory?: PlayerProfile["inventory"];
  quest?: PlayerProfile["quest"];
  ack?: number;
  lastSeq?: number;
}

interface Player extends PlayerProfile {
  queue: Command[];
  lastInput: Input;
  ack: number;
  lastSeq: number;
  starvedTicks: number;
  dirty: boolean;
  lastAttackAt: number;
  deadUntil: number;
  messageTimes: number[];
  malformedCount: number;
}

interface Monster extends Vec2 {
  id: string;
  kind: "slime";
  species: MonsterSpecies;
  spawnX: number;
  spawnY: number;
  patrolRadius: number;
  hp: number;
  lastAttackAt: number;
  deadUntil: number;
}

interface GroundLoot extends LootSnapshot {
  expiresAt: number;
}

function toProfile(player: Player): SaveableProfile {
  return {
    id: player.id,
    nick: player.nick,
    x: player.x,
    y: player.y,
    level: player.level,
    xp: player.xp,
    hp: player.hp,
    appearance: player.appearance,
    inventory: { ...player.inventory },
    quest: { ...player.quest },
  };
}

function toAttachment(player: Player): Attachment {
  return { ...toProfile(player), ack: player.ack, lastSeq: player.lastSeq };
}

function newPlayer(profile: PlayerProfile, ack = 0, lastSeq = 0): Player {
  return {
    ...profile,
    inventory: { ...profile.inventory },
    quest: { ...profile.quest },
    queue: [],
    lastInput: NO_INPUT,
    ack,
    lastSeq,
    starvedTicks: 0,
    dirty: false,
    lastAttackAt: 0,
    deadUntil: 0,
    messageTimes: [],
    malformedCount: 0,
  };
}

function profileFromAttachment(attachment: Attachment): PlayerProfile {
  const level = attachment.level ?? 1;
  return {
    id: attachment.id,
    nick: attachment.nick,
    ...clampRestoredPosition(attachment, attachment.id),
    level,
    xp: attachment.xp ?? 0,
    appearance: attachment.appearance ?? "azure",
    inventory: {
      potions: attachment.inventory?.potions ?? 2,
      gold: attachment.inventory?.gold ?? 0,
      crystals: attachment.inventory?.crystals ?? 0,
      weapon: "rusty_sword",
    },
    quest: {
      status: attachment.quest?.status ?? "available",
      progress: attachment.quest?.progress ?? 0,
      target: QUEST_KILL_TARGET,
    },
    hp: Math.min(maxHpForLevel(level), Math.max(1, attachment.hp ?? maxHpForLevel(level))),
  };
}

/** Kept exported because rebuilding a ticking DO cannot be simulated safely in the test pool. */
export function positionFromAttachment(attachment: Attachment | null): Vec2 {
  return attachment === null ? spawnPosition() : clampRestoredPosition(attachment, attachment.id);
}

function createMonsters(): Monster[] {
  return MONSTER_SPAWNS.map((spawn) => ({
    ...spawn,
    spawnX: spawn.x,
    spawnY: spawn.y,
    hp: MONSTER_MAX_HP,
    lastAttackAt: 0,
    deadUntil: 0,
  }));
}

export class World extends DurableObject<Env> {
  #players = new Map<WebSocket, Player>();
  #monsters: Monster[] = createMonsters();
  #loot: GroundLoot[] = [];
  #loop: ReturnType<typeof setInterval> | null = null;
  #tick = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const ws of ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (!attachment) continue;
      this.#players.set(
        ws,
        newPlayer(profileFromAttachment(attachment), attachment.ack ?? 0, attachment.lastSeq ?? 0),
      );
    }
    if (this.#players.size > 0) this.#startLoop();
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      // Internal kick: fired by index.ts after a character delete. The Durable Object is not
      // publicly reachable — only the Worker can address it by name — so trusting this header
      // matches the existing x-character-id trust model used for join.
      const kickId = request.method === "POST" ? request.headers.get("x-kick-character-id") : null;
      if (kickId !== null) {
        for (const [socket, existing] of this.#players) {
          if (existing.id === kickId) this.#kick(socket, 4002, "character deleted");
        }
        return new Response(null, { status: 204 });
      }
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const id = request.headers.get("x-character-id");
    if (!id) return new Response("unauthorized", { status: 401 });

    // Same character connected elsewhere: the newer socket wins, the older one is kicked.
    for (const [socket, existing] of this.#players) {
      if (existing.id === id) this.#kick(socket, 4001, "same character connected elsewhere");
    }

    const profile = await loadProfile(createDb(this.env.DB), id);
    if (!profile) return new Response("unknown character", { status: 404 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const player = newPlayer(profile);
    server.serializeAttachment(toAttachment(player));
    this.#players.set(server, player);

    this.#send(server, {
      t: "welcome",
      selfId: id,
      world: {
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        playerSize: PLAYER_SIZE,
        obstacles: [...OBSTACLES],
        safeZone: SAFE_ZONE,
        questNpc: QUEST_NPC,
      },
      players: this.#playerSnapshots(),
      monsters: this.#monsterSnapshots(),
      loot: this.#lootSnapshots(),
      self: this.#selfState(player),
    });
    this.#send(server, { t: "event", code: "wake", tone: "info" });
    this.#startLoop();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const player = this.#players.get(ws);
    if (!player) return;
    const bytes =
      typeof raw === "string" ? new TextEncoder().encode(raw).byteLength : raw.byteLength;
    if (bytes > MAX_FRAME_BYTES) {
      this.#kick(ws, 1009, "frame too large");
      return;
    }
    if (this.#rateLimited(player)) {
      this.#kick(ws, 1008, "message rate exceeded");
      return;
    }

    const message = parseClientMessage(raw);
    if (!message) {
      player.malformedCount += 1;
      if (player.malformedCount >= MAX_MALFORMED) this.#kick(ws, 1008, "too many invalid frames");
      return;
    }
    player.malformedCount = 0;
    this.#handleMessage(ws, player, message);
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.#drop(ws);
    try {
      ws.close(code === 1006 ? 1000 : code, reason);
    } catch {
      // The peer already completed the closing handshake.
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.#drop(ws);
  }

  #handleMessage(ws: WebSocket, player: Player, message: ClientMessage): void {
    if (message.t === "input") {
      if (message.seq <= player.lastSeq) return;
      player.lastSeq = message.seq;
      if (player.deadUntil > Date.now()) {
        player.ack = message.seq;
        player.lastInput = NO_INPUT;
        player.queue = [];
        return;
      }
      if (player.queue.length >= MAX_QUEUED_COMMANDS) return;
      player.queue.push({ seq: message.seq, input: message.input });
      return;
    }
    if (message.t === "attack") {
      this.#attack(ws, player);
      return;
    }
    if (message.t === "interact") {
      this.#interact(ws, player);
      return;
    }
    if (message.t === "use") {
      // biome-ignore lint/correctness/useHookAtTopLevel: usePotion is a server action handler, not a React hook.
      this.#usePotion(ws, player);
      return;
    }
    const text = message.text.trim().replaceAll(/\s+/g, " ");
    if (text.length === 0 || text.length > CHAT_MAX_LENGTH) return;
    this.#broadcast({ t: "chat", from: player.nick, text });
  }

  #attack(ws: WebSocket, player: Player): void {
    const now = Date.now();
    if (player.deadUntil > now || now - player.lastAttackAt < ATTACK_COOLDOWN_MS) return;
    player.lastAttackAt = now;

    let target: Monster | undefined;
    let distance = ATTACK_RANGE;
    for (const monster of this.#monsters) {
      if (monster.deadUntil > now) continue;
      const candidate = pointDistance(player, monster);
      if (withinRange(player, monster, distance)) {
        target = monster;
        distance = candidate;
      }
    }
    if (!target) {
      this.#send(ws, { t: "event", code: "combat.too_far", tone: "info" });
      return;
    }

    const damage = attackDamageForLevel(player.level);
    const result = applyDamage(target.hp, damage);
    target.hp = result.hp;
    this.#send(ws, {
      t: "event",
      code: "combat.hit",
      params: { species: target.species, damage },
      tone: "info",
      x: target.x,
      y: target.y,
    });
    if (result.killed) this.#defeatMonster(ws, player, target, now);
  }

  #defeatMonster(ws: WebSocket, player: Player, monster: Monster, now: number): void {
    monster.deadUntil = now + MONSTER_RESPAWN_MS;
    const result = applyExperience(player.level, player.xp, MONSTER_XP);
    player.level = result.level;
    player.xp = result.xp;
    if (result.levelsGained > 0) player.hp = maxHpForLevel(player.level);

    if (player.quest.status === "active") {
      player.quest.progress = Math.min(QUEST_KILL_TARGET, player.quest.progress + 1);
      if (player.quest.progress >= QUEST_KILL_TARGET) player.quest.status = "ready";
    }

    const kind = this.#tick % 4 === 0 ? "potion" : this.#tick % 2 === 0 ? "crystal" : "gold";
    this.#loot.push({
      id: crypto.randomUUID(),
      kind,
      amount: kind === "gold" ? 4 : 1,
      x: monster.x + 8,
      y: monster.y + 8,
      expiresAt: now + 30_000,
    });
    this.#send(
      ws,
      result.levelsGained > 0
        ? { t: "event", code: "level_up", params: { level: player.level }, tone: "good" }
        : {
            t: "event",
            code: "monster.defeated",
            params: { species: monster.species, xp: MONSTER_XP },
            tone: "good",
          },
    );
    this.#sendState(ws, player);
    player.dirty = true;
  }

  #interact(ws: WebSocket, player: Player): void {
    if (player.deadUntil > Date.now() || pointDistance(player, QUEST_NPC) > INTERACTION_RANGE) {
      this.#send(ws, { t: "event", code: "interact.nothing", tone: "info" });
      return;
    }
    if (player.quest.status === "available") {
      player.quest.status = "active";
      player.quest.progress = 0;
      this.#send(ws, {
        t: "event",
        code: "quest.accepted",
        params: { target: QUEST_KILL_TARGET },
        tone: "good",
      });
    } else if (player.quest.status === "active") {
      this.#send(ws, {
        t: "event",
        code: "quest.progress",
        params: { progress: player.quest.progress, target: QUEST_KILL_TARGET },
        tone: "info",
      });
    } else if (player.quest.status === "ready") {
      player.quest.status = "completed";
      player.inventory.potions += 2;
      player.inventory.gold += 20;
      const result = applyExperience(player.level, player.xp, 100);
      player.level = result.level;
      player.xp = result.xp;
      player.hp = maxHpForLevel(player.level);
      this.#send(ws, { t: "event", code: "quest.fulfilled", tone: "good" });
    } else {
      this.#send(ws, { t: "event", code: "quest.blessing", tone: "good" });
    }
    player.dirty = true;
    this.#sendState(ws, player);
  }

  #usePotion(ws: WebSocket, player: Player): void {
    const maxHp = maxHpForLevel(player.level);
    if (player.deadUntil > Date.now() || player.inventory.potions <= 0 || player.hp >= maxHp)
      return;
    player.inventory.potions -= 1;
    player.hp = Math.min(maxHp, player.hp + 45);
    player.dirty = true;
    this.#send(ws, { t: "event", code: "potion.used", params: { heal: 45 }, tone: "good" });
    this.#sendState(ws, player);
  }

  #rateLimited(player: Player): boolean {
    const now = Date.now();
    player.messageTimes = player.messageTimes.filter((time) => now - time < RATE_WINDOW_MS);
    player.messageTimes.push(now);
    return player.messageTimes.length > RATE_MAX_MESSAGES;
  }

  #drop(ws: WebSocket): void {
    const player = this.#players.get(ws);
    if (player) this.ctx.waitUntil(saveProfile(createDb(this.env.DB), toProfile(player)));
    this.#players.delete(ws);
    if (this.#players.size === 0) this.#stopLoop();
  }

  #kick(ws: WebSocket, code: number, reason: string): void {
    this.#drop(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  #startLoop(): void {
    if (this.#loop !== null) return;
    this.#loop = setInterval(() => this.#advance(), TICK_MS);
  }

  #stopLoop(): void {
    if (this.#loop === null) return;
    clearInterval(this.#loop);
    this.#loop = null;
  }

  #advance(): void {
    if (this.#players.size === 0) {
      this.#stopLoop();
      return;
    }
    this.#tick += 1;
    const now = Date.now();
    const writeAttachment = this.#tick % ATTACHMENT_EVERY_TICKS === 0;
    const writeD1 = this.#tick % D1_SAVE_EVERY_TICKS === 0;

    for (const [ws, player] of this.#players) {
      if (player.deadUntil > 0 && player.deadUntil <= now) this.#respawnPlayer(ws, player);

      if (player.deadUntil <= now) {
        const command = player.queue.shift();
        if (command) {
          player.lastInput = command.input;
          player.ack = command.seq;
          player.starvedTicks = 0;
        } else if (++player.starvedTicks > MAX_STARVED_TICKS) {
          player.lastInput = NO_INPUT;
        }

        const desired = step(player, player.lastInput, TICK_DT);
        const moved = resolveTerrain(player, desired);
        if (moved.x !== player.x || moved.y !== player.y) {
          player.x = moved.x;
          player.y = moved.y;
          player.dirty = true;
        }
      }

      this.#collectLoot(ws, player, now);
      if (writeAttachment && player.dirty) ws.serializeAttachment(toAttachment(player));
      if (writeD1 && player.dirty) {
        this.ctx.waitUntil(saveProfile(createDb(this.env.DB), toProfile(player)));
        player.dirty = false;
      }
    }

    this.#advanceMonsters(now);
    this.#loot = this.#loot.filter((item) => item.expiresAt > now);
    this.#broadcast({
      t: "snapshot",
      tick: this.#tick,
      players: this.#playerSnapshots(),
      monsters: this.#monsterSnapshots(),
      loot: this.#lootSnapshots(),
    });
  }

  #advanceMonsters(now: number): void {
    const players = Array.from(this.#players.entries()).filter(
      ([, player]) => player.deadUntil <= now,
    );
    for (let index = 0; index < this.#monsters.length; index++) {
      const monster = this.#monsters[index];
      if (!monster) continue;
      if (monster.deadUntil > now) continue;
      if (monster.deadUntil > 0) {
        monster.deadUntil = 0;
        monster.hp = MONSTER_MAX_HP;
        monster.x = monster.spawnX;
        monster.y = monster.spawnY;
      }

      let target: [WebSocket, Player] | undefined;
      let targetDistance = MONSTER_AGGRO_RANGE;
      for (const candidate of players) {
        const player = candidate[1];
        if (inRect(player, SAFE_ZONE)) continue;
        const distance = pointDistance(monster, player);
        if (distance < targetDistance) {
          target = candidate;
          targetDistance = distance;
        }
      }

      if (target) {
        const [socket, player] = target;
        if (targetDistance <= MONSTER_ATTACK_RANGE) {
          if (now - monster.lastAttackAt >= MONSTER_ATTACK_COOLDOWN_MS) {
            monster.lastAttackAt = now;
            this.#damagePlayer(socket, player, MONSTER_DAMAGE, monster.species, now);
          }
          continue;
        }
        this.#moveMonsterToward(monster, player);
      } else {
        const angle = this.#tick / 90 + index * 1.7;
        this.#moveMonsterToward(monster, {
          x: monster.spawnX + Math.cos(angle) * monster.patrolRadius,
          y: monster.spawnY + Math.sin(angle) * monster.patrolRadius,
        });
      }
    }
  }

  #moveMonsterToward(monster: Monster, target: Vec2): void {
    const dx = target.x - monster.x;
    const dy = target.y - monster.y;
    const length = Math.hypot(dx, dy);
    if (length < 2) return;
    const distance = MONSTER_SPEED * TICK_DT;
    const desired = {
      x: monster.x + (dx / length) * distance,
      y: monster.y + (dy / length) * distance,
    };
    const moved = resolveTerrain(monster, desired);
    monster.x = moved.x;
    monster.y = moved.y;
  }

  #damagePlayer(
    ws: WebSocket,
    player: Player,
    damage: number,
    species: MonsterSpecies,
    now: number,
  ): void {
    const result = applyDamage(player.hp, damage);
    player.hp = result.hp;
    player.dirty = true;
    this.#send(ws, {
      t: "event",
      code: "combat.hurt",
      params: { species, damage },
      tone: "bad",
      x: player.x,
      y: player.y,
    });
    if (result.killed) {
      player.deadUntil = now + PLAYER_RESPAWN_MS;
      player.lastInput = NO_INPUT;
      player.queue = [];
      this.#broadcast({
        t: "event",
        code: "player.down",
        params: { name: player.nick },
        tone: "bad",
      });
    }
    this.#sendState(ws, player);
  }

  #respawnPlayer(ws: WebSocket, player: Player): void {
    const position = spawnPosition(player.id);
    player.x = position.x;
    player.y = position.y;
    player.hp = maxHpForLevel(player.level);
    player.deadUntil = 0;
    player.lastInput = NO_INPUT;
    player.queue = [];
    player.dirty = true;
    this.#send(ws, { t: "event", code: "respawn", tone: "info" });
    this.#sendState(ws, player);
  }

  #collectLoot(ws: WebSocket, player: Player, now: number): void {
    if (player.deadUntil > now) return;
    for (let i = this.#loot.length - 1; i >= 0; i--) {
      const item = this.#loot[i];
      if (!item || pointDistance(player, item) > LOOT_PICKUP_RANGE) continue;
      if (item.kind === "potion") player.inventory.potions += item.amount;
      if (item.kind === "gold") player.inventory.gold += item.amount;
      if (item.kind === "crystal") player.inventory.crystals += item.amount;
      this.#loot.splice(i, 1);
      player.dirty = true;
      this.#send(ws, {
        t: "event",
        code: "loot.picked",
        params: { amount: item.amount, kind: item.kind },
        tone: "good",
      });
      this.#sendState(ws, player);
    }
  }

  #selfState(player: Player): SelfState {
    return {
      xp: player.xp,
      xpToNext: xpForNextLevel(player.level),
      inventory: { ...player.inventory },
      quest: { ...player.quest, target: QUEST_KILL_TARGET },
    };
  }

  #sendState(ws: WebSocket, player: Player): void {
    this.#send(ws, { t: "state", self: this.#selfState(player) });
  }

  #playerSnapshots(): PlayerSnapshot[] {
    const now = Date.now();
    return Array.from(this.#players.values(), (player) => ({
      id: player.id,
      nick: player.nick,
      x: Math.round(player.x * 100) / 100,
      y: Math.round(player.y * 100) / 100,
      ack: player.ack,
      hp: player.hp,
      maxHp: maxHpForLevel(player.level),
      level: player.level,
      appearance: player.appearance,
      dead: player.deadUntil > now,
    }));
  }

  #monsterSnapshots(): MonsterSnapshot[] {
    const now = Date.now();
    return this.#monsters.map((monster) => ({
      id: monster.id,
      kind: monster.kind,
      species: monster.species,
      x: Math.round(monster.x * 100) / 100,
      y: Math.round(monster.y * 100) / 100,
      hp: monster.hp,
      maxHp: MONSTER_MAX_HP,
      dead: monster.deadUntil > now,
    }));
  }

  #lootSnapshots(): LootSnapshot[] {
    return this.#loot.map(({ id, kind, amount, x, y }) => ({ id, kind, amount, x, y }));
  }

  #send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(encodeServerMessage(message));
    } catch {
      this.#drop(ws);
    }
  }

  #broadcast(message: ServerMessage): void {
    const payload = encodeServerMessage(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        this.#drop(ws);
      }
    }
  }
}
