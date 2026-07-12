/**
 * One authoritative MMO room. Clients send movement/action intent; this Durable Object alone
 * moves entities, applies damage, grants loot/XP, advances quests, and persists player profiles.
 */
import { DurableObject } from "cloudflare:workers";
import {
  normalizeAppearance,
  normalizeEquipment,
  starterEquipmentFor,
} from "../shared/character.js";
import { WS_CLOSE } from "../shared/close-codes.js";
import {
  canAct,
  canBeResurrected,
  canReclaim,
  type LifeState,
  RESURRECT_COOLDOWN_MS,
  resurrectHp,
  speedForLife,
} from "../shared/death.js";
import {
  ATTACK_COOLDOWN_MS,
  applyDamage,
  applyExperience,
  attackDamageFor,
  CEMETERIES,
  CLASS_STATS,
  clampRestoredPosition,
  hasLineOfSight,
  healAmountFor,
  INTERACTION_RANGE,
  inRect,
  LOOT_PICKUP_RANGE,
  MONSTER_AGGRO_RANGE,
  MONSTER_ATTACK_COOLDOWN_MS,
  MONSTER_ATTACK_RANGE,
  MONSTER_RESPAWN_MS,
  MONSTER_STATS,
  type MonsterKind,
  type MonsterSpawn,
  type MonsterSpecies,
  maxHpForLevel,
  nearestCemetery,
  pointDistance,
  QUEST_RUN_LIMIT_MS,
  QUEST_SITE_RESPAWN_MS,
  type QuestChapter,
  type QuestSite,
  resolveTerrain,
  spawnPosition,
  withinRange,
  xpForNextLevel,
} from "../shared/game.js";
import {
  type ClientMessage,
  type Command,
  type CorpseSnapshot,
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
} from "../shared/simulation.js";
import {
  isSkillUnlocked,
  SKILL_UNLOCK_LEVEL,
  type SkillDefinition,
  type SkillSlot,
  skillFor,
} from "../shared/skills.js";
import { resolveZoneLocation, type ZoneDefinition, type ZoneLocation } from "../shared/zones.js";
import { PRESENCE_HEARTBEAT_MS } from "./character-presence.js";
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
  class?: PlayerProfile["class"];
  equipment?: PlayerProfile["equipment"];
  inventory?: PlayerProfile["inventory"];
  quest?: PlayerProfile["quest"];
  life?: PlayerProfile["life"];
  corpse?: PlayerProfile["corpse"];
  ack?: number;
  lastSeq?: number;
  connectionId?: string;
  roomKey?: string;
  sessionEpoch?: number;
  zoneId?: string;
  instanceId?: string;
  wardRunExpiresAt?: number | null;
}

interface Player extends PlayerProfile {
  queue: Command[];
  lastInput: Input;
  ack: number;
  lastSeq: number;
  starvedTicks: number;
  dirty: boolean;
  lastAttackAt: number;
  lastHealAt: number;
  skillCooldowns: number[];
  guardUntil: number;
  guardReduction: number;
  lastResurrectAt: number;
  messageTimes: number[];
  malformedCount: number;
  facing: Vec2;
  connectionId: string;
  roomKey: string;
  authorized: boolean;
  disconnecting: boolean;
  nextPresenceHeartbeatAt: number;
}

interface Monster extends Vec2 {
  id: string;
  kind: MonsterKind;
  species: MonsterSpecies;
  spawnX: number;
  spawnY: number;
  patrolRadius: number;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  xp: number;
  lastAttackAt: number;
  deadUntil: number;
  vx: number;
  vy: number;
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
    class: player.class,
    equipment: { ...player.equipment },
    inventory: { ...player.inventory },
    quest: { ...player.quest },
    zoneId: player.zoneId,
    instanceId: player.instanceId,
    sessionEpoch: player.sessionEpoch,
    wardRunExpiresAt: player.wardRunExpiresAt,
    life: player.life,
    corpse: player.corpse === null ? null : { ...player.corpse },
  };
}

function toAttachment(player: Player): Attachment {
  return {
    ...toProfile(player),
    ack: player.ack,
    lastSeq: player.lastSeq,
    connectionId: player.connectionId,
    roomKey: player.roomKey,
  };
}

function newPlayer(
  profile: PlayerProfile,
  connectionId: string,
  roomKey: string,
  ack = 0,
  lastSeq = 0,
): Player {
  return {
    ...profile,
    appearance: { ...profile.appearance },
    equipment: { ...profile.equipment },
    corpse: profile.corpse === null ? null : { ...profile.corpse },
    inventory: { ...profile.inventory },
    quest: { ...profile.quest },
    queue: [],
    lastInput: NO_INPUT,
    ack,
    lastSeq,
    starvedTicks: 0,
    dirty: false,
    lastAttackAt: 0,
    lastHealAt: 0,
    skillCooldowns: [0, 0, 0, 0, 0],
    guardUntil: 0,
    guardReduction: 0,
    lastResurrectAt: 0,
    messageTimes: [],
    malformedCount: 0,
    facing: { x: 1, y: 0 },
    connectionId,
    roomKey,
    authorized: true,
    disconnecting: false,
    nextPresenceHeartbeatAt: Date.now() + PRESENCE_HEARTBEAT_MS,
  };
}

function profileFromAttachment(attachment: Attachment): PlayerProfile {
  const level = attachment.level ?? 1;
  const playerClass = attachment.class ?? "warrior";
  return {
    id: attachment.id,
    nick: attachment.nick,
    ...clampRestoredPosition(attachment, attachment.id),
    level,
    xp: attachment.xp ?? 0,
    appearance: normalizeAppearance(attachment.appearance),
    class: playerClass,
    equipment: attachment.equipment
      ? normalizeEquipment(playerClass, attachment.equipment.mainHand, attachment.equipment.offHand)
      : starterEquipmentFor(playerClass),
    inventory: {
      potions: attachment.inventory?.potions ?? 2,
      gold: attachment.inventory?.gold ?? 0,
      crystals: attachment.inventory?.crystals ?? 0,
    },
    quest: {
      chapter: attachment.quest?.chapter ?? "three_offerings",
      status: attachment.quest?.status ?? "available",
      progress: attachment.quest?.progress ?? 0,
      target: attachment.quest?.target ?? 3,
    },
    hp: Math.min(maxHpForLevel(level), Math.max(1, attachment.hp ?? maxHpForLevel(level))),
    zoneId: attachment.zoneId ?? "verdant-reach",
    instanceId: attachment.instanceId ?? "main",
    sessionEpoch: attachment.sessionEpoch ?? 0,
    wardRunExpiresAt: attachment.wardRunExpiresAt ?? null,
    ...lifeFromAttachment(attachment),
  };
}

/** A dead attachment must carry a body; if it does not, repair to alive rather than strand it. */
function lifeFromAttachment(attachment: Attachment): {
  life: LifeState;
  corpse: Vec2 | null;
} {
  const life = attachment.life ?? "alive";
  const corpse = attachment.corpse ?? null;
  if (life === "alive" || corpse === null) return { life: "alive", corpse: null };
  return { life, corpse: { ...corpse } };
}

/** Kept exported because rebuilding a ticking DO cannot be simulated safely in the test pool. */
export function positionFromAttachment(attachment: Attachment | null): Vec2 {
  return attachment === null ? spawnPosition() : clampRestoredPosition(attachment, attachment.id);
}

function createMonsters(spawns: readonly MonsterSpawn[]): Monster[] {
  return spawns.map((spawn) => {
    const stats = MONSTER_STATS[spawn.kind];
    return {
      ...spawn,
      spawnX: spawn.x,
      spawnY: spawn.y,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      damage: stats.damage,
      speed: stats.speed,
      xp: stats.xp,
      lastAttackAt: 0,
      deadUntil: 0,
      vx: 0,
      vy: 0,
    };
  });
}

export class World extends DurableObject<Env> {
  #players = new Map<WebSocket, Player>();
  #monsters: Monster[] = [];
  #location: ZoneLocation | null = null;
  #loot: GroundLoot[] = [];
  #siteRespawnAt = new Map<string, number>();
  #profileSaves = new Map<string, Promise<boolean>>();
  #loop: ReturnType<typeof setInterval> | null = null;
  #tick = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      for (const ws of ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as Attachment | null;
        if (!attachment) continue;
        const location =
          resolveZoneLocation(
            attachment.zoneId ?? "verdant-reach",
            attachment.instanceId ?? "main",
          ) ?? null;
        if (!location) {
          ws.close(WS_CLOSE.PRESENCE_LOST, "invalid character location");
          continue;
        }
        this.#configure(location);
        const roomKey = attachment.roomKey ?? location.roomKey;
        if (roomKey !== location.roomKey) {
          ws.close(WS_CLOSE.PRESENCE_LOST, "room location mismatch");
          continue;
        }
        let connectionId = attachment.connectionId;
        let sessionEpoch = attachment.sessionEpoch;
        if (!connectionId || !sessionEpoch) {
          connectionId = crypto.randomUUID();
          const lease = await this.env.CHARACTER_PRESENCE.getByName(attachment.id).acquire({
            characterId: attachment.id,
            connectionId,
            roomKey,
            zoneId: attachment.zoneId ?? "verdant-reach",
            instanceId: attachment.instanceId ?? "main",
          });
          sessionEpoch = lease.sessionEpoch;
        } else if (
          !(await this.env.CHARACTER_PRESENCE.getByName(attachment.id).isAuthorized(
            connectionId,
            sessionEpoch,
            roomKey,
          ))
        ) {
          ws.close(WS_CLOSE.PRESENCE_LOST, "presence expired");
          continue;
        }
        const profile = profileFromAttachment({
          ...attachment,
          connectionId,
          sessionEpoch,
        });
        const position = clampRestoredPosition(profile, profile.id, location.definition.terrain);
        profile.x = position.x;
        profile.y = position.y;
        const player = newPlayer(
          profile,
          connectionId,
          roomKey,
          attachment.ack ?? 0,
          attachment.lastSeq ?? 0,
        );
        ws.serializeAttachment(toAttachment(player));
        this.#players.set(ws, player);
      }
      if (this.#players.size > 0) this.#startLoop();
    });
  }

  #configure(location: ZoneLocation): void {
    if (this.#location && this.#location.roomKey !== location.roomKey) {
      throw new Error("world room key mismatch");
    }
    if (this.#location) return;
    this.#location = location;
    this.#monsters = createMonsters(location.definition.monsters);
  }

  #zone(): ZoneDefinition {
    if (!this.#location) throw new Error("world was not initialized with a zone");
    return this.#location.definition;
  }

  #closedSocket(code: number, eventCode: "room.full" | "room.invalid_location"): Response {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.#send(server, { t: "event", code: eventCode, tone: "bad" });
    server.close(code, eventCode);
    return new Response(null, { status: 101, webSocket: client });
  }

  #questDefinition(chapter: QuestChapter) {
    return this.#zone().quests.find((quest) => quest.id === chapter);
  }

  #nextQuestChapter(chapter: QuestChapter): QuestChapter | null {
    const chapters = this.#zone().quests.map((quest) => quest.id);
    const index = chapters.indexOf(chapter);
    return chapters[index + 1] ?? null;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      // Internal kick: fired by index.ts after a character delete. The Durable Object is not
      // publicly reachable — only the Worker can address it by name — so trusting this header
      // matches the existing x-character-id trust model used for join.
      const kickId = request.method === "POST" ? request.headers.get("x-kick-character-id") : null;
      if (kickId !== null) {
        for (const existing of this.#players.values()) {
          if (existing.id === kickId) {
            await this.invalidatePresence(
              existing.id,
              existing.connectionId,
              WS_CLOSE.CHARACTER_DELETED,
              "character deleted",
            );
          }
        }
        return new Response(null, { status: 204 });
      }
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const id = request.headers.get("x-character-id");
    const connectionId = request.headers.get("x-connection-id");
    const roomKey = request.headers.get("x-room-key");
    const zoneId = request.headers.get("x-zone-id");
    const instanceId = request.headers.get("x-instance-id");
    const epochRaw = request.headers.get("x-session-epoch");
    const sessionEpoch = epochRaw === null ? Number.NaN : Number(epochRaw);
    if (
      !id ||
      !connectionId ||
      !roomKey ||
      !Number.isSafeInteger(sessionEpoch) ||
      sessionEpoch < 1
    ) {
      return new Response("unauthorized", { status: 401 });
    }
    const location = resolveZoneLocation(zoneId, instanceId);
    if (!location || location.roomKey !== roomKey) {
      return this.#closedSocket(WS_CLOSE.INVALID_LOCATION, "room.invalid_location");
    }
    this.#configure(location);

    const presence = this.env.CHARACTER_PRESENCE.getByName(id);
    if (!(await presence.isAuthorized(connectionId, sessionEpoch, roomKey))) {
      return new Response("presence lost", { status: 409 });
    }

    const profile = await loadProfile(createDb(this.env.DB), id);
    if (!profile) return new Response("unknown character", { status: 404 });
    if (profile.sessionEpoch !== sessionEpoch) {
      return new Response("presence epoch mismatch", { status: 409 });
    }
    if (profile.zoneId !== location.zoneId || profile.instanceId !== location.instanceId) {
      return new Response("character location changed", { status: 409 });
    }
    const restoredPosition = clampRestoredPosition(
      profile,
      profile.id,
      location.definition.terrain,
    );
    const positionChanged = restoredPosition.x !== profile.x || restoredPosition.y !== profile.y;
    profile.x = restoredPosition.x;
    profile.y = restoredPosition.y;
    const activePlayers = Array.from(this.#players.values()).filter(
      (player) => player.authorized,
    ).length;
    if (activePlayers >= location.definition.maxPlayers) {
      await presence.release(connectionId, sessionEpoch);
      return this.#closedSocket(WS_CLOSE.ROOM_FULL, "room.full");
    }
    let wardRunExpired = false;
    if (
      profile.quest.chapter === "ward_run" &&
      profile.quest.status === "active" &&
      profile.wardRunExpiresAt !== null &&
      profile.wardRunExpiresAt <= Date.now()
    ) {
      profile.quest.progress = 0;
      profile.wardRunExpiresAt = null;
      wardRunExpired = true;
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const player = newPlayer(profile, connectionId, roomKey);
    player.dirty = wardRunExpired || positionChanged;
    server.serializeAttachment(toAttachment(player));
    this.#players.set(server, player);

    // Close the acquire/admit race: once the socket is in the map, a later replacement can find
    // it; before returning the upgrade, verify no newer acquisition already won.
    if (!(await presence.isAuthorized(connectionId, sessionEpoch, roomKey))) {
      this.#players.delete(server);
      player.authorized = false;
      server.close(WS_CLOSE.PRESENCE_LOST, "presence lost during admission");
      return new Response("presence lost", { status: 409 });
    }

    this.#send(server, {
      t: "welcome",
      selfId: id,
      world: {
        width: location.definition.terrain.width,
        height: location.definition.terrain.height,
        playerSize: PLAYER_SIZE,
        obstacles: [...location.definition.terrain.obstacles],
        safeZone: location.definition.terrain.safeZone,
        questNpc: location.definition.quests[0]?.giver ?? { id: "none", x: 0, y: 0 },
        questNpcs: location.definition.quests.map((quest) => quest.giver),
        questSites: [...location.definition.questSites],
        cemeteries: [...CEMETERIES],
      },
      players: this.#playerSnapshots(),
      monsters: this.#monsterSnapshots(),
      loot: this.#lootSnapshots(),
      corpses: this.#corpseSnapshots(),
      self: this.#selfState(player),
    });
    this.#send(server, { t: "event", code: "wake", tone: "info" });
    this.#startLoop();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const player = this.#players.get(ws);
    if (!player?.authorized) return;
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
    await this.#drop(ws);
    try {
      ws.close(code === 1006 ? 1000 : code, reason);
    } catch {
      // The peer already completed the closing handshake.
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.#drop(ws);
  }

  /** Called only by the per-character presence coordinator. */
  async invalidatePresence(
    characterId: string,
    connectionId: string,
    closeCode: number,
    reason: string,
  ): Promise<boolean> {
    const entry = Array.from(this.#players.entries()).find(
      ([, player]) => player.id === characterId && player.connectionId === connectionId,
    );
    if (!entry) return false;
    const [ws, player] = entry;
    player.authorized = false;
    player.disconnecting = true;
    player.lastInput = NO_INPUT;
    player.queue = [];
    this.#players.delete(ws);

    try {
      if (closeCode === WS_CLOSE.CHARACTER_REPLACED) {
        this.#send(ws, { t: "event", code: "presence.replaced", tone: "bad" });
        await this.#savePlayer(player, ws, true);
      }
    } finally {
      try {
        ws.close(closeCode, reason);
      } catch {
        // Already closed.
      }
      if (this.#players.size === 0) this.#stopLoop();
    }
    return true;
  }

  /** Internal persistence hook used by coordinators and workerd concurrency tests. */
  async persistCharacter(characterId: string): Promise<boolean | null> {
    const entry = Array.from(this.#players.entries()).find(
      ([, player]) => player.id === characterId,
    );
    if (!entry) return null;
    return this.#savePlayer(entry[1], entry[0]);
  }

  #handleMessage(ws: WebSocket, player: Player, message: ClientMessage): void {
    if (message.t === "input") {
      if (message.seq <= player.lastSeq) return;
      player.lastSeq = message.seq;
      // A corpse does not move. A ghost does — that is the whole point of the walk home.
      if (player.life === "corpse") {
        player.ack = message.seq;
        player.lastInput = NO_INPUT;
        player.queue = [];
        return;
      }
      if (player.queue.length >= MAX_QUEUED_COMMANDS) return;
      player.queue.push({ seq: message.seq, input: message.input });
      return;
    }
    if (message.t === "release") {
      this.#release(ws, player);
      return;
    }
    // The dead act only through the two exits above. Chat is the one thing a spirit keeps.
    if (message.t !== "chat" && !canAct(player.life)) return;
    if (message.t === "attack") {
      this.#attack(ws, player);
      return;
    }
    if (message.t === "interact") {
      this.#interact(ws, player);
      return;
    }
    if (message.t === "use") {
      this.#usePotion(ws, player);
      return;
    }
    if (message.t === "heal") {
      this.#heal(ws, player);
      return;
    }
    if (message.t === "skill") {
      this.#castSkill(ws, player, message.slot);
      return;
    }
    const text = message.text.trim().replaceAll(/\s+/g, " ");
    if (text.length === 0 || text.length > CHAT_MAX_LENGTH) return;
    this.#broadcast({ t: "chat", from: player.nick, text });
  }

  #attack(ws: WebSocket, player: Player): void {
    const now = Date.now();
    if (!canAct(player.life) || now - player.lastAttackAt < ATTACK_COOLDOWN_MS) return;
    player.lastAttackAt = now;

    const stats = CLASS_STATS[player.class];
    let target: Monster | undefined;
    let distance = stats.attackRange;
    let blockedInRange = false;
    for (const monster of this.#monsters) {
      if (monster.deadUntil > now) continue;
      const candidate = pointDistance(player, monster);
      if (!withinRange(player, monster, stats.attackRange)) continue;
      if (!hasLineOfSight(player, monster, this.#zone().terrain.obstacles)) {
        blockedInRange = true;
        continue;
      }
      if (candidate <= distance) {
        target = monster;
        distance = candidate;
      }
    }
    if (!target) {
      this.#send(ws, {
        t: "event",
        code: blockedInRange ? "combat.blocked" : "combat.too_far",
        tone: "info",
      });
      return;
    }

    const damage = attackDamageFor(player.class, player.level);
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

  #castSkill(ws: WebSocket, player: Player, slot: SkillSlot): void {
    const skill = skillFor(player.class, slot);
    if (!isSkillUnlocked(player.level, slot)) {
      this.#send(ws, {
        t: "event",
        code: "skill.locked",
        params: { level: SKILL_UNLOCK_LEVEL[slot], skill: skill.id },
        tone: "info",
      });
      return;
    }
    if (skill.effect === "attack") {
      this.#attack(ws, player);
      return;
    }
    if (skill.effect === "single_heal") {
      this.#heal(ws, player);
      return;
    }

    const now = Date.now();
    if (!canAct(player.life) || (player.skillCooldowns[slot - 1] ?? 0) > now) return;

    let cast = false;
    if (skill.effect === "teleport") {
      cast = this.#movePlayerInDirection(player, player.facing, skill.distance ?? 0);
    } else if (skill.effect === "dash") {
      cast = this.#movePlayerInDirection(
        player,
        { x: -player.facing.x, y: -player.facing.y },
        skill.distance ?? 0,
      );
    } else if (skill.effect === "charge") {
      const target = this.#nearestMonster(player, skill.range, now);
      if (target) {
        const distance = Math.max(0, pointDistance(player, target) - MONSTER_ATTACK_RANGE + 8);
        this.#movePlayerInDirection(
          player,
          {
            x: target.x - player.x,
            y: target.y - player.y,
          },
          Math.min(skill.distance ?? 0, distance),
        );
        this.#skillDamage(ws, player, target, skill, now);
        cast = true;
      }
    } else if (skill.effect === "guard") {
      player.guardUntil = now + (skill.durationMs ?? 0);
      player.guardReduction = skill.reduction ?? 0;
      cast = true;
    } else if (skill.effect === "single_damage") {
      const target = this.#nearestMonster(player, skill.range, now);
      if (target) {
        this.#skillDamage(ws, player, target, skill, now);
        cast = true;
      }
    } else if (skill.effect === "area_damage") {
      const targets = this.#monsters.filter(
        (monster) =>
          monster.deadUntil <= now &&
          withinRange(player, monster, skill.radius ?? skill.range) &&
          hasLineOfSight(player, monster, this.#zone().terrain.obstacles),
      );
      for (const target of targets) this.#skillDamage(ws, player, target, skill, now);
      cast = targets.length > 0;
    } else if (skill.effect === "area_heal") {
      cast = this.#areaHeal(ws, player, skill) > 0;
    } else if (skill.effect === "nova") {
      const targets = this.#monsters.filter(
        (monster) =>
          monster.deadUntil <= now &&
          withinRange(player, monster, skill.radius ?? skill.range) &&
          hasLineOfSight(player, monster, this.#zone().terrain.obstacles),
      );
      for (const target of targets) this.#skillDamage(ws, player, target, skill, now);
      cast = targets.length > 0 || this.#areaHeal(ws, player, skill) > 0;
    }

    if (!cast) {
      this.#send(ws, {
        t: "event",
        code: "skill.no_target",
        params: { skill: skill.id },
        tone: "info",
      });
      return;
    }
    player.skillCooldowns[slot - 1] = now + skill.cooldownMs;
    this.#send(ws, {
      t: "event",
      code: "skill.cast",
      params: { skill: skill.id, slot },
      tone: "good",
      x: player.x,
      y: player.y,
    });
  }

  #nearestMonster(player: Player, range: number, now: number): Monster | undefined {
    let target: Monster | undefined;
    let distance = range;
    for (const monster of this.#monsters) {
      if (monster.deadUntil > now || !withinRange(player, monster, range)) continue;
      if (!hasLineOfSight(player, monster, this.#zone().terrain.obstacles)) continue;
      const candidate = pointDistance(player, monster);
      if (candidate <= distance) {
        target = monster;
        distance = candidate;
      }
    }
    return target;
  }

  /** Move in short collision-resolved segments so mobility skills can never phase through walls. */
  #movePlayerInDirection(player: Player, direction: Vec2, distance: number): boolean {
    const length = Math.hypot(direction.x, direction.y);
    if (length === 0 || distance <= 0) return false;
    const unit = { x: direction.x / length, y: direction.y / length };
    let remaining = distance;
    let movedAny = false;
    while (remaining > 0) {
      const stepDistance = Math.min(12, remaining);
      const moved = resolveTerrain(
        player,
        {
          x: player.x + unit.x * stepDistance,
          y: player.y + unit.y * stepDistance,
        },
        this.#zone().terrain,
      );
      if (moved.x === player.x && moved.y === player.y) break;
      player.x = moved.x;
      player.y = moved.y;
      movedAny = true;
      remaining -= stepDistance;
    }
    if (movedAny) player.dirty = true;
    return movedAny;
  }

  #skillDamage(
    ws: WebSocket,
    player: Player,
    target: Monster,
    skill: SkillDefinition,
    now: number,
  ): void {
    const damage = skill.power + Math.max(0, player.level - 1) * 2;
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

  #areaHeal(ws: WebSocket, player: Player, skill: SkillDefinition): number {
    let healed = 0;
    for (const [targetSocket, target] of this.#players) {
      if (target.life !== "alive" || pointDistance(player, target) > (skill.radius ?? skill.range))
        continue;
      if (!hasLineOfSight(player, target, this.#zone().terrain.obstacles)) continue;
      const maxHp = maxHpForLevel(target.level);
      if (target.hp >= maxHp) continue;
      const amount = skill.power + Math.max(0, player.level - 1) * 2;
      target.hp = Math.min(maxHp, target.hp + amount);
      target.dirty = true;
      healed += 1;
      this.#send(targetSocket, {
        t: "event",
        code: targetSocket === ws ? "heal.cast" : "heal.received",
        params: { name: player.nick, amount },
        tone: "good",
        x: target.x,
        y: target.y,
      });
      this.#sendState(targetSocket, target);
    }
    return healed;
  }

  #defeatMonster(ws: WebSocket, player: Player, monster: Monster, now: number): void {
    monster.deadUntil = now + MONSTER_RESPAWN_MS;
    const result = applyExperience(player.level, player.xp, monster.xp);
    player.level = result.level;
    player.xp = result.xp;
    if (result.levelsGained > 0) player.hp = maxHpForLevel(player.level);

    if (
      player.quest.chapter === "bone_choir" &&
      player.quest.status === "active" &&
      monster.kind === "skeleton"
    ) {
      const target = this.#questDefinition("bone_choir")?.target;
      if (target === undefined) return;
      player.quest.progress = Math.min(target, player.quest.progress + 1);
      if (player.quest.progress >= target) {
        player.quest.status = "ready";
        this.#send(ws, { t: "event", code: "quest.chapter_ready", tone: "good" });
      } else {
        this.#send(ws, {
          t: "event",
          code: "quest.site_progress",
          params: { progress: player.quest.progress, target },
          tone: "good",
        });
      }
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
            params: { species: monster.species, xp: monster.xp },
            tone: "good",
          },
    );
    this.#sendState(ws, player);
    player.dirty = true;
  }

  #heal(ws: WebSocket, player: Player): void {
    const heal = CLASS_STATS[player.class].heal;
    if (!heal) return; // not a priest — intent silently ignored
    const now = Date.now();
    if (!canAct(player.life) || now - player.lastHealAt < heal.cooldownMs) return;

    let target: Player | undefined;
    let targetSocket: WebSocket | undefined;
    let worstRatio = 1;
    let blockedInRange = false;
    for (const [socket, candidate] of this.#players) {
      if (candidate.life !== "alive") continue;
      if (pointDistance(player, candidate) > heal.range) continue;
      const ratio = candidate.hp / maxHpForLevel(candidate.level);
      if (ratio >= 1) continue;
      if (!hasLineOfSight(player, candidate, this.#zone().terrain.obstacles)) {
        blockedInRange = true;
        continue;
      }
      if (ratio < worstRatio) {
        worstRatio = ratio;
        target = candidate;
        targetSocket = socket;
      }
    }
    if (!target || !targetSocket) {
      // No cooldown consumed on a whiff — pressing F at full health must not punish.
      this.#send(ws, {
        t: "event",
        code: blockedInRange ? "heal.blocked" : "heal.nobody",
        tone: "info",
      });
      return;
    }

    player.lastHealAt = now;
    const amount = healAmountFor(player.level);
    target.hp = Math.min(maxHpForLevel(target.level), target.hp + amount);
    target.dirty = true;
    player.dirty = true;
    this.#send(ws, {
      t: "event",
      code: "heal.cast",
      params: { name: target.nick, amount },
      tone: "good",
      x: target.x,
      y: target.y,
    });
    if (targetSocket !== ws) {
      this.#send(targetSocket, {
        t: "event",
        code: "heal.received",
        params: { name: player.nick, amount },
        tone: "good",
      });
    }
    this.#sendState(ws, player);
    if (targetSocket !== ws) this.#sendState(targetSocket, target);
  }

  #interact(ws: WebSocket, player: Player): void {
    const now = Date.now();
    if (!canAct(player.life)) return;
    // A corpse is just one more thing you can be standing next to. The skill bar is full and
    // this codebase resolves every action as "the nearest valid thing in range"; so does this.
    if (this.#resurrectNearbyCorpse(ws, player, now)) return;
    const chapter = player.quest.chapter ?? "three_offerings";
    player.quest.chapter = chapter;

    const site = this.#zone().questSites.find(
      (candidate) =>
        candidate.chapter === chapter && pointDistance(player, candidate) <= INTERACTION_RANGE,
    );
    if (site && player.quest.status === "active") {
      if (site.kind === "resource" && (this.#siteRespawnAt.get(site.id) ?? 0) > now) {
        this.#send(ws, { t: "event", code: "interact.nothing", tone: "info" });
        return;
      }
      this.#interactQuestSite(ws, player, chapter, site, now);
      return;
    }

    const definition = this.#questDefinition(chapter);
    if (!definition) {
      this.#send(ws, { t: "event", code: "interact.nothing", tone: "info" });
      return;
    }
    if (pointDistance(player, definition.giver) > INTERACTION_RANGE) {
      this.#send(ws, { t: "event", code: "interact.nothing", tone: "info" });
      return;
    }

    if (player.quest.status === "available") {
      player.quest.status = "active";
      player.quest.progress = 0;
      player.quest.target = definition.target;
      player.wardRunExpiresAt = null;
      this.#send(ws, {
        t: "event",
        code: "quest.accepted",
        params: { chapter, target: definition.target },
        tone: "good",
      });
    } else if (player.quest.status === "active") {
      this.#send(ws, {
        t: "event",
        code: "quest.progress",
        params: { chapter, progress: player.quest.progress, target: definition.target },
        tone: "info",
      });
    } else if (player.quest.status === "ready") {
      this.#completeQuestChapter(ws, player, chapter);
    } else {
      this.#send(ws, { t: "event", code: "quest.blessing", tone: "good" });
    }
    player.dirty = true;
    this.#sendState(ws, player);
  }

  /**
   * A priest standing over a body calls its owner back where they lie. Returns true when the
   * interact was spent on a corpse, so it does not fall through to the quest dispatch.
   *
   * A ghost is not a candidate: releasing shuts this door, which is what makes releasing a
   * decision rather than a formality.
   */
  #resurrectNearbyCorpse(ws: WebSocket, player: Player, now: number): boolean {
    const heal = CLASS_STATS[player.class].heal;
    let target: Player | undefined;
    let targetSocket: WebSocket | undefined;
    let distance = heal?.range ?? INTERACTION_RANGE;

    for (const [socket, candidate] of this.#players) {
      if (socket === ws || !canBeResurrected(candidate.life) || candidate.corpse === null) continue;
      const candidateDistance = pointDistance(player, candidate.corpse);
      if (candidateDistance > distance) continue;
      target = candidate;
      targetSocket = socket;
      distance = candidateDistance;
    }
    if (!target || !targetSocket) return false;

    // Only now that we know a body is in reach is it worth telling a warrior he cannot help.
    if (!heal) {
      this.#send(ws, { t: "event", code: "resurrect.not_priest", tone: "info" });
      return true;
    }
    if (now - player.lastResurrectAt < RESURRECT_COOLDOWN_MS) {
      this.#send(ws, { t: "event", code: "resurrect.nobody", tone: "info" });
      return true;
    }

    player.lastResurrectAt = now;
    target.life = "alive";
    target.corpse = null;
    target.hp = resurrectHp(target.level);
    this.#freeze(target);

    this.#send(ws, {
      t: "event",
      code: "resurrect.cast",
      params: { name: target.nick },
      tone: "good",
      x: target.x,
      y: target.y,
    });
    this.#send(targetSocket, {
      t: "event",
      code: "death.resurrected",
      params: { name: player.nick },
      tone: "good",
      x: target.x,
      y: target.y,
    });
    this.#sendState(targetSocket, target);
    return true;
  }

  #interactQuestSite(
    ws: WebSocket,
    player: Player,
    chapter: QuestChapter,
    site: QuestSite,
    now: number,
  ): void {
    const definition = this.#questDefinition(chapter);
    if (!definition) return;
    const { order } = site;
    if (chapter === "ward_run") {
      if (player.wardRunExpiresAt !== null && player.wardRunExpiresAt <= now) {
        player.quest.progress = 0;
        player.wardRunExpiresAt = null;
        this.#send(ws, { t: "event", code: "quest.run_expired", tone: "bad" });
        this.#sendState(ws, player);
        player.dirty = true;
        return;
      }
      if (order === 0 && player.quest.progress === 0) {
        player.wardRunExpiresAt = now + QUEST_RUN_LIMIT_MS;
        this.#send(ws, {
          t: "event",
          code: "quest.run_started",
          params: { seconds: QUEST_RUN_LIMIT_MS / 1_000 },
          tone: "good",
        });
      }
    }

    if (order !== player.quest.progress) {
      if (chapter === "mire_runes" || chapter === "ward_run") {
        player.quest.progress = 0;
        player.wardRunExpiresAt = null;
      }
      this.#send(ws, { t: "event", code: "quest.site_wrong", tone: "bad" });
      this.#sendState(ws, player);
      player.dirty = true;
      return;
    }

    if (site.kind === "resource") {
      this.#siteRespawnAt.set(site.id, now + QUEST_SITE_RESPAWN_MS);
      this.#broadcast({
        t: "event",
        code: "quest.site_harvested",
        params: { site: site.id, seconds: QUEST_SITE_RESPAWN_MS / 1_000 },
        tone: "good",
        x: site.x,
        y: site.y,
      });
    }
    player.quest.progress += 1;
    if (player.quest.progress >= definition.target) {
      player.quest.status = "ready";
      player.wardRunExpiresAt = null;
      this.#send(ws, { t: "event", code: "quest.chapter_ready", tone: "good" });
    } else {
      this.#send(ws, {
        t: "event",
        code: "quest.site_progress",
        params: { progress: player.quest.progress, target: definition.target },
        tone: "good",
      });
    }
    player.dirty = true;
    this.#sendState(ws, player);
  }

  #completeQuestChapter(ws: WebSocket, player: Player, chapter: QuestChapter): void {
    const definition = this.#questDefinition(chapter);
    if (!definition) return;
    player.inventory.potions += 1;
    player.inventory.gold += definition.rewardGold;
    const result = applyExperience(player.level, player.xp, definition.rewardXp);
    player.level = result.level;
    player.xp = result.xp;
    player.hp = maxHpForLevel(player.level);
    player.wardRunExpiresAt = null;

    const next = this.#nextQuestChapter(chapter);
    if (next) {
      player.quest = {
        chapter: next,
        status: "available",
        progress: 0,
        target: this.#questDefinition(next)?.target ?? 0,
      };
    } else {
      player.quest.status = "completed";
    }
    this.#send(ws, {
      t: "event",
      code: "quest.fulfilled",
      params: { chapter, xp: definition.rewardXp, gold: definition.rewardGold },
      tone: "good",
    });
  }

  #usePotion(ws: WebSocket, player: Player): void {
    const maxHp = maxHpForLevel(player.level);
    if (!canAct(player.life) || player.inventory.potions <= 0 || player.hp >= maxHp) return;
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

  async #drop(ws: WebSocket): Promise<void> {
    const player = this.#players.get(ws);
    if (!player || player.disconnecting) return;
    player.disconnecting = true;
    player.authorized = false;
    player.lastInput = NO_INPUT;
    player.queue = [];

    try {
      const saved = await this.#savePlayer(player, ws, true);
      if (saved) {
        await this.env.CHARACTER_PRESENCE.getByName(player.id).release(
          player.connectionId,
          player.sessionEpoch,
        );
      }
    } finally {
      if (this.#players.get(ws) === player) this.#players.delete(ws);
      if (this.#players.size === 0) this.#stopLoop();
    }
  }

  #savePlayer(player: Player, ws: WebSocket, force = false): Promise<boolean> {
    if (!player.authorized && !force) return Promise.resolve(false);
    const profile = toProfile(player);
    const previous = this.#profileSaves.get(profile.id);
    const start = previous
      ? previous.then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    const save = start.then(async () => {
      const profile = toProfile(player);
      if (force) {
        const latest = await loadProfile(createDb(this.env.DB), profile.id);
        if (latest) {
          profile.zoneId = latest.zoneId;
          profile.instanceId = latest.instanceId;
        }
      }
      const accepted = await saveProfile(createDb(this.env.DB), profile);
      if (!accepted) this.#rejectStaleSave(ws, player);
      return accepted;
    });
    this.#profileSaves.set(profile.id, save);
    void save.then(
      () => {
        if (this.#profileSaves.get(profile.id) === save) this.#profileSaves.delete(profile.id);
      },
      () => {
        if (this.#profileSaves.get(profile.id) === save) this.#profileSaves.delete(profile.id);
      },
    );
    return save;
  }

  #rejectStaleSave(ws: WebSocket, player: Player): void {
    player.authorized = false;
    player.lastInput = NO_INPUT;
    player.queue = [];
    if (this.#players.get(ws) === player) this.#players.delete(ws);
    console.warn(
      JSON.stringify({
        event: "stale_character_save_rejected",
        characterId: player.id,
        connectionId: player.connectionId,
        sessionEpoch: player.sessionEpoch,
        roomKey: player.roomKey,
      }),
    );
    this.#send(ws, { t: "event", code: "presence.lost", tone: "bad" });
    try {
      ws.close(WS_CLOSE.PRESENCE_LOST, "presence epoch is stale");
    } catch {
      // Already closed.
    }
  }

  #kick(ws: WebSocket, code: number, reason: string): void {
    this.ctx.waitUntil(this.#drop(ws));
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
      if (!player.authorized) continue;
      if (now >= player.nextPresenceHeartbeatAt) {
        player.nextPresenceHeartbeatAt = now + PRESENCE_HEARTBEAT_MS;
        this.ctx.waitUntil(this.#renewPresence(player));
      }
      if (player.life !== "corpse") {
        const command = player.queue.shift();
        if (command) {
          player.lastInput = command.input;
          const facingX = Number(command.input.right) - Number(command.input.left);
          const facingY = Number(command.input.down) - Number(command.input.up);
          if (facingX !== 0 || facingY !== 0) {
            const length = Math.hypot(facingX, facingY);
            player.facing = { x: facingX / length, y: facingY / length };
          }
          player.ack = command.seq;
          player.starvedTicks = 0;
        } else if (++player.starvedTicks > MAX_STARVED_TICKS) {
          player.lastInput = NO_INPUT;
        }

        const desired = step(
          player,
          player.lastInput,
          TICK_DT,
          speedForLife(player.life),
          this.#zone().terrain,
        );
        const moved = resolveTerrain(player, desired, this.#zone().terrain);
        if (moved.x !== player.x || moved.y !== player.y) {
          player.x = moved.x;
          player.y = moved.y;
          player.dirty = true;
        }
      }

      if (canReclaim(player.life, player, player.corpse)) this.#reclaimCorpse(ws, player);
      this.#collectLoot(ws, player);
      if (writeAttachment && player.dirty) ws.serializeAttachment(toAttachment(player));
      if (writeD1 && player.dirty) {
        this.ctx.waitUntil(this.#savePlayer(player, ws));
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
      corpses: this.#corpseSnapshots(),
    });
  }

  async #renewPresence(player: Player): Promise<void> {
    if (!player.authorized) return;
    const renewed = await this.env.CHARACTER_PRESENCE.getByName(player.id).renew(
      player.connectionId,
      player.sessionEpoch,
    );
    if (renewed || !player.authorized) return;
    await this.invalidatePresence(
      player.id,
      player.connectionId,
      WS_CLOSE.PRESENCE_LOST,
      "presence expired",
    );
  }

  #advanceMonsters(now: number): void {
    // Monsters do not see spirits. Without this the corpse run is unwinnable: you would die
    // on the way to your own body, over and over.
    const players = Array.from(this.#players.entries()).filter(
      ([, player]) => player.authorized && player.life === "alive",
    );
    for (let index = 0; index < this.#monsters.length; index++) {
      const monster = this.#monsters[index];
      if (!monster) continue;
      if (monster.deadUntil > now) continue;
      if (monster.deadUntil > 0) {
        monster.deadUntil = 0;
        monster.hp = monster.maxHp;
        monster.x = monster.spawnX;
        monster.y = monster.spawnY;
        monster.vx = 0;
        monster.vy = 0;
      }

      let target: [WebSocket, Player] | undefined;
      let targetDistance = MONSTER_AGGRO_RANGE;
      for (const candidate of players) {
        const player = candidate[1];
        if (inRect(player, this.#zone().terrain.safeZone)) continue;
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
            this.#damagePlayer(socket, player, monster.damage, monster.species, now);
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
    if (length < 2) {
      monster.vx *= 0.6;
      monster.vy *= 0.6;
      return;
    }
    const targetVx = (dx / length) * monster.speed;
    const targetVy = (dy / length) * monster.speed;
    // Inertia removes direction flicker when the nearest player changes position between ticks.
    monster.vx += (targetVx - monster.vx) * 0.28;
    monster.vy += (targetVy - monster.vy) * 0.28;
    const desired = {
      x: monster.x + monster.vx * TICK_DT,
      y: monster.y + monster.vy * TICK_DT,
    };
    const moved = resolveTerrain(monster, desired, this.#zone().terrain);
    if (moved.x === monster.x) monster.vx = 0;
    if (moved.y === monster.y) monster.vy = 0;
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
    const guardedDamage =
      player.guardUntil > now
        ? Math.max(1, Math.ceil(damage * (1 - player.guardReduction)))
        : damage;
    const result = applyDamage(player.hp, guardedDamage);
    player.hp = result.hp;
    player.dirty = true;
    this.#send(ws, {
      t: "event",
      code: "combat.hurt",
      params: { species, damage: guardedDamage },
      tone: "bad",
      x: player.x,
      y: player.y,
    });
    if (result.killed) this.#killPlayer(ws, player);
    this.#sendState(ws, player);
  }

  /** Dying does not move you. Your body stays exactly where it fell, and you wait over it. */
  #killPlayer(ws: WebSocket, player: Player): void {
    player.life = "corpse";
    player.corpse = { x: player.x, y: player.y };
    this.#freeze(player);
    this.#broadcast({
      t: "event",
      code: "player.down",
      params: { name: player.nick },
      tone: "bad",
    });
    this.#send(ws, { t: "event", code: "death.fallen", tone: "bad", x: player.x, y: player.y });
  }

  /**
   * Every life transition is a teleport or a freeze, so the queue must go with it: replaying
   * commands buffered as one life state across another is exactly the desync prediction exists
   * to catch. The client prunes on the `ack` that rides along with the next snapshot.
   */
  #freeze(player: Player): void {
    player.lastInput = NO_INPUT;
    player.queue = [];
    player.starvedTicks = 0;
    player.dirty = true;
  }

  /** Release is one-way and deliberate. It is what closes the door on a priest saving you. */
  #release(ws: WebSocket, player: Player): void {
    if (player.life !== "corpse" || player.corpse === null) return;
    const cemetery = nearestCemetery(player.corpse);
    player.life = "ghost";
    player.x = cemetery.x;
    player.y = cemetery.y;
    this.#freeze(player);
    this.#send(ws, { t: "event", code: "death.released", tone: "info", x: player.x, y: player.y });
    this.#sendState(ws, player);
  }

  /** Walking your ghost onto your own body. Automatic within range, like loot. */
  #reclaimCorpse(ws: WebSocket, player: Player): void {
    player.life = "alive";
    player.corpse = null;
    player.hp = resurrectHp(player.level);
    this.#freeze(player);
    this.#send(ws, { t: "event", code: "death.reclaimed", tone: "good", x: player.x, y: player.y });
    this.#sendState(ws, player);
  }

  #collectLoot(ws: WebSocket, player: Player): void {
    if (!canAct(player.life)) return;
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
    const chapter = player.quest.chapter ?? "three_offerings";
    const timerEndsAt =
      chapter === "ward_run" && player.quest.status === "active" && player.wardRunExpiresAt !== null
        ? player.wardRunExpiresAt
        : undefined;
    return {
      xp: player.xp,
      xpToNext: xpForNextLevel(player.level),
      inventory: { ...player.inventory },
      quest: {
        ...player.quest,
        chapter,
        target: this.#questDefinition(chapter)?.target ?? player.quest.target,
        ...(timerEndsAt === undefined ? {} : { timerEndsAt }),
      },
      life: player.life,
      corpse: player.corpse === null ? null : { ...player.corpse },
    };
  }

  #sendState(ws: WebSocket, player: Player): void {
    this.#send(ws, { t: "state", self: this.#selfState(player) });
  }

  #playerSnapshots(): PlayerSnapshot[] {
    return Array.from(this.#players.values())
      .filter((player) => player.authorized)
      .map((player) => ({
        id: player.id,
        nick: player.nick,
        x: Math.round(player.x * 100) / 100,
        y: Math.round(player.y * 100) / 100,
        ack: player.ack,
        hp: player.hp,
        maxHp: maxHpForLevel(player.level),
        level: player.level,
        appearance: player.appearance,
        class: player.class,
        equipment: { ...player.equipment },
        life: player.life,
      }));
  }

  /**
   * A body exists for as long as its owner has one — while they lie over it *and* while their
   * ghost is walking back to it. Emitting only the former would make your corpse vanish at the
   * exact moment you released, which is the moment you start needing to find it.
   */
  #corpseSnapshots(): CorpseSnapshot[] {
    const corpses: CorpseSnapshot[] = [];
    for (const player of this.#players.values()) {
      if (player.corpse === null) continue;
      corpses.push({
        id: player.id,
        nick: player.nick,
        class: player.class,
        appearance: player.appearance,
        x: player.corpse.x,
        y: player.corpse.y,
      });
    }
    return corpses;
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
      maxHp: monster.maxHp,
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
      this.ctx.waitUntil(this.#drop(ws));
    }
  }

  #broadcast(message: ServerMessage): void {
    const payload = encodeServerMessage(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        this.ctx.waitUntil(this.#drop(ws));
      }
    }
  }
}
