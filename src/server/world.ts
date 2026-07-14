/**
 * One authoritative MMO room. Clients send movement/action intent; this Durable Object alone
 * moves entities, applies damage, grants loot/XP, advances quests, and persists player profiles.
 */
import { DurableObject } from "cloudflare:workers";
import { WS_CLOSE } from "../shared/close-codes.js";
import {
  addThreat,
  isMeaningfulContribution,
  REWARD_DISTANCE,
  recordContribution,
  splitExperience,
  tauntThreat,
  usefulHealingThreat,
} from "../shared/cooperation.js";
import { canAct, canBeResurrected, RESURRECT_COOLDOWN_MS, resurrectHp } from "../shared/death.js";
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
  MONSTER_ATTACK_RANGE,
  MONSTER_RESPAWN_MS,
  type MonsterSpecies,
  maxHpForLevel,
  nearestCemetery,
  pointDistance,
  QUEST_RUN_LIMIT_MS,
  QUEST_SITE_RESPAWN_MS,
  type QuestChapter,
  type QuestSite,
  withinRange,
} from "../shared/game.js";
import { LOCAL_CHAT_RADIUS, SPATIAL_CELL_SIZE, SPATIAL_EVENT_RADIUS } from "../shared/interest.js";
import {
  type ClientMessage,
  encodeServerMessage,
  parseClientMessage,
  type SelfState,
  type ServerMessage,
  type WorldView,
} from "../shared/protocol.js";
import {
  canSpendResource,
  generateResource,
  skillResourceCost,
  spendResource,
} from "../shared/resources.js";
import {
  NETWORK_TICKS_PER_SNAPSHOT,
  NO_INPUT,
  PLAYER_SIZE,
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
import { replaceWorldCache } from "../shared/world-delta.js";
import {
  type PortalDefinition,
  resolveZoneLocation,
  type ZoneDefinition,
  type ZoneLocation,
} from "../shared/zones.js";
import { claimQuestReward, consumeOwnedItem } from "./character-persistence.js";
import { createDb } from "./db/index.js";
import { HEALTH_POTION_ID } from "./items.js";
import { loadProfile, saveProfile } from "./profile.js";
import { guardedDamage, resolveAttackTarget } from "./world/combat-system.js";
import { addPlayer, isRateLimited, removePlayer } from "./world/connection-system.js";
import {
  beginRewardAttribution,
  clearMonsterCombat,
  removePlayerCombatState,
} from "./world/contribution-system.js";
import { worldView } from "./world/interest-system.js";
import { collectLoot, processExpiredLoot } from "./world/loot-system.js";
import { advanceGuards, advanceMonsters } from "./world/monster-system.js";
import { advancePlayers } from "./world/movement-system.js";
import { createNavigationRuntime, type NavigationRuntime } from "./world/navigation-system.js";
import {
  createRoomObservability,
  OBSERVABILITY_INTERVAL_TICKS,
  observeSend,
  observeTick,
  snapshotRoomObservability,
} from "./world/observability-system.js";
import {
  answerPartyInvite,
  broadcastPartyStateIfChanged,
  createParty,
  dissolveParty,
  inviteToParty,
  kickPartyMember,
  leaveParty,
  type PartyInviteRuntime,
  type PartyResult,
  type PartyRuntime,
  type PartySystemContext,
  removePlayerFromParties,
  sendPartyChat,
} from "./world/party-system.js";
import { persistPlayer } from "./world/persistence-system.js";
import { nextQuestChapter, questDefinition } from "./world/quest-system.js";
import { movePlayerInDirection } from "./world/skill-system.js";
import {
  broadcastNetworkUpdates,
  selfState,
  sendState,
  sendWorldResync,
} from "./world/snapshot-system.js";
import { SpatialGrid } from "./world/spatial-grid.js";
import {
  ATTACHMENT_EVERY_TICKS,
  type Attachment,
  CHAT_MAX_LENGTH,
  createGuards,
  createMonsters,
  D1_SAVE_EVERY_TICKS,
  type GroundLoot,
  type GuardRuntime as Guard,
  MAX_FRAME_BYTES,
  MAX_MALFORMED,
  MAX_QUEUED_COMMANDS,
  type MonsterRuntime as Monster,
  newPlayer,
  type PlayerRuntime as Player,
  profileFromAttachment,
  RESYNC_COOLDOWN_MS,
  toAttachment,
} from "./world/world-runtime.js";

export { type Attachment, positionFromAttachment } from "./world/world-runtime.js";

export class World extends DurableObject<Env> {
  #players = new Map<WebSocket, Player>();
  #socketByPlayerId = new Map<string, WebSocket>();
  #monsters: Monster[] = [];
  #guards: Guard[] = [];
  #location: ZoneLocation | null = null;
  #loot: GroundLoot[] = [];
  #siteRespawnAt = new Map<string, number>();
  #profileSaves = new Map<string, Promise<boolean>>();
  #itemMutations = new Map<string, Promise<number | null>>();
  #loop: ReturnType<typeof setInterval> | null = null;
  #tick = 0;
  #playerGrid = new SpatialGrid<Player>(SPATIAL_CELL_SIZE);
  #monsterGrid = new SpatialGrid<Monster>(SPATIAL_CELL_SIZE);
  #lootGrid = new SpatialGrid<GroundLoot>(SPATIAL_CELL_SIZE);
  #parties = new Map<string, PartyRuntime>();
  #partyByPlayerId = new Map<string, string>();
  #partyInvites = new Map<string, PartyInviteRuntime>();
  #navigation: NavigationRuntime | null = null;
  #observability = createRoomObservability();
  #seenCharacterIds = new Set<string>();

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
          attachment.resource,
        );
        ws.serializeAttachment(toAttachment(player));
        this.#addPlayer(ws, player);
        this.#seenCharacterIds.add(player.id);
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
    this.#navigation = createNavigationRuntime(
      location.definition.terrain,
      location.definition.navigation,
    );
    this.#monsters = createMonsters(location.definition.monsters);
    this.#guards = createGuards(location.definition.guards);
    this.#monsterGrid.clear();
    for (const monster of this.#monsters) this.#monsterGrid.insert(monster);
  }

  #zone(): ZoneDefinition {
    if (!this.#location) throw new Error("world was not initialized with a zone");
    return this.#location.definition;
  }

  #navigationRuntime(): NavigationRuntime {
    if (!this.#navigation) throw new Error("world navigation was not initialized");
    return this.#navigation;
  }

  #closedSocket(code: number, eventCode: "room.full" | "room.invalid_location"): Response {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.#send(server, { t: "event", code: eventCode, tone: "bad" });
    server.close(code, eventCode);
    return new Response(null, { status: 101, webSocket: client });
  }

  #questDefinition(chapter: QuestChapter) {
    return questDefinition(this.#zone(), chapter);
  }

  #nextQuestChapter(chapter: QuestChapter): QuestChapter | null {
    return nextQuestChapter(this.#zone(), chapter);
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
    // A route changed out of band (repair tooling or a future interrupted handoff) may leave
    // coordinates that only made sense in the previous zone. Persist the corrected spawn before
    // admission, rather than waiting for the five-second dirty flush and exposing a stale D1 row
    // to another room.
    if (positionChanged || wardRunExpired) {
      if (!(await saveProfile(createDb(this.env.DB), profile))) {
        await presence.release(connectionId, sessionEpoch);
        return new Response("presence epoch mismatch", { status: 409 });
      }
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const player = newPlayer(profile, connectionId, roomKey);
    player.dirty = false;
    server.serializeAttachment(toAttachment(player));
    if (this.#seenCharacterIds.has(player.id)) this.#observability.reconnections += 1;
    this.#seenCharacterIds.add(player.id);
    this.#addPlayer(server, player);

    // Close the acquire/admit race: once the socket is in the map, a later replacement can find
    // it; before returning the upgrade, verify no newer acquisition already won.
    if (!(await presence.isAuthorized(connectionId, sessionEpoch, roomKey))) {
      this.#removePlayer(server, player);
      player.authorized = false;
      server.close(WS_CLOSE.PRESENCE_LOST, "presence lost during admission");
      return new Response("presence lost", { status: 409 });
    }

    const initialView = this.#worldView(player);
    replaceWorldCache(player.network, initialView);
    this.#send(server, {
      t: "welcome",
      tick: this.#tick,
      selfId: id,
      world: {
        zoneId: location.zoneId,
        zoneNameKey: location.definition.nameKey,
        width: location.definition.terrain.width,
        height: location.definition.terrain.height,
        playerSize: PLAYER_SIZE,
        obstacles: [...location.definition.terrain.obstacles],
        safeZone: location.definition.terrain.safeZone,
        questNpc: location.definition.quests[0]?.giver ?? { id: "none", x: 0, y: 0 },
        questNpcs: location.definition.quests.map((quest) => quest.giver),
        questSites: [...location.definition.questSites],
        cemeteries: [...CEMETERIES],
        portals: location.definition.portals.map((portal) => ({
          id: portal.id,
          nameKey: portal.nameKey,
          x: portal.x,
          y: portal.y,
        })),
      },
      ...initialView,
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
      this.#observability.oversizedFrames += 1;
      this.#kick(ws, 1009, "frame too large");
      return;
    }
    if (this.#rateLimited(player)) {
      this.#observability.rateLimitedConnections += 1;
      this.#kick(ws, 1008, "message rate exceeded");
      return;
    }

    const message = parseClientMessage(raw);
    if (!message) {
      this.#observability.malformedFrames += 1;
      player.malformedCount += 1;
      if (player.malformedCount >= MAX_MALFORMED) this.#kick(ws, 1008, "too many invalid frames");
      return;
    }
    player.malformedCount = 0;
    await this.#handleMessage(ws, player, message);
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
    this.#removePlayer(ws, player);

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

  async #handleMessage(ws: WebSocket, player: Player, message: ClientMessage): Promise<void> {
    if (message.t === "navigation.debug") {
      if (this.env.NAVIGATION_DEBUG === "true") player.navigationDebug = message.enabled;
      return;
    }
    if (message.t === "world.resync") {
      const now = Date.now();
      // A throttled request is owed, not dropped: the client latches until a resync arrives and
      // would otherwise stop applying deltas forever. The tick loop pays the debt once the
      // cooldown lifts, so the rate limit still holds at one resync per player per second.
      if (now - player.lastResyncAt < RESYNC_COOLDOWN_MS) {
        this.#observability.throttledResyncs += 1;
        player.resyncQueued = true;
        return;
      }
      player.resyncQueued = false;
      player.lastResyncAt = now;
      this.#sendWorldResync(ws, player);
      return;
    }
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
      if (player.queue.length >= MAX_QUEUED_COMMANDS) {
        this.#observability.saturatedCommandQueues += 1;
        return;
      }
      player.queue.push({ seq: message.seq, input: message.input });
      return;
    }
    if (message.t === "release") {
      this.#release(ws, player);
      return;
    }
    if (message.t.startsWith("party.")) {
      this.#handlePartyMessage(ws, player, message);
      return;
    }
    // The dead act only through the two exits above. Chat is the one thing a spirit keeps.
    if (message.t !== "chat" && !canAct(player.life)) return;
    if (message.t === "attack") {
      this.#attack(ws, player, message.targetId);
      return;
    }
    if (message.t === "interact") {
      await this.#interact(ws, player);
      return;
    }
    if (message.t === "use") {
      await this.#usePotion(ws, player);
      return;
    }
    if (message.t === "heal") {
      this.#heal(ws, player, message.targetId);
      return;
    }
    if (message.t === "skill") {
      this.#castSkill(ws, player, message.slot, message.targetId);
      return;
    }
    if (message.t !== "chat") return;
    const text = message.text.trim().replaceAll(/\s+/g, " ");
    if (text.length === 0 || text.length > CHAT_MAX_LENGTH) return;
    if (message.channel === "party") {
      if (!sendPartyChat(this.#partyContext(), player, text))
        this.#send(ws, { t: "event", code: "party.invalid", tone: "bad" });
    } else this.#sendLocalChat(player, text);
  }

  #handlePartyMessage(ws: WebSocket, player: Player, message: ClientMessage): void {
    const context = this.#partyContext();
    let result: PartyResult;
    if (message.t === "party.create") result = createParty(context, player.id);
    else if (message.t === "party.invite")
      result = inviteToParty(context, player.id, message.playerId);
    else if (message.t === "party.accept")
      result = answerPartyInvite(context, player.id, message.inviteId, true);
    else if (message.t === "party.refuse")
      result = answerPartyInvite(context, player.id, message.inviteId, false);
    else if (message.t === "party.leave") result = leaveParty(context, player.id);
    else if (message.t === "party.kick")
      result = kickPartyMember(context, player.id, message.playerId);
    else if (message.t === "party.dissolve") result = dissolveParty(context, player.id);
    else return;
    const bad = result === "invalid" || result === "forbidden" || result === "full";
    this.#send(ws, { t: "event", code: `party.${result}`, tone: bad ? "bad" : "good" });
  }

  #partyContext(): PartySystemContext {
    return {
      parties: this.#parties,
      partyByPlayerId: this.#partyByPlayerId,
      invites: this.#partyInvites,
      playersById: new Map([...this.#players.values()].map((player) => [player.id, player])),
      socketByPlayerId: this.#socketByPlayerId,
      send: (socket, message) => this.#send(socket, message),
      now: Date.now,
    };
  }

  #attack(ws: WebSocket, player: Player, targetId: string): void {
    const now = Date.now();
    if (!canAct(player.life) || now - player.lastAttackAt < ATTACK_COOLDOWN_MS) return;
    player.lastAttackAt = now;

    const stats = CLASS_STATS[player.class];
    const { target, blockedInRange } = resolveAttackTarget(
      player,
      this.#monsters,
      targetId,
      stats.attackRange,
      now,
      this.#zone().terrain,
    );
    this.#sendSpatialEvent(
      {
        t: "animation",
        actorKind: "player",
        actorId: player.id,
        action: "attack",
        x: player.x,
        y: player.y,
        ...(target ? { targetX: target.x, targetY: target.y } : {}),
      },
      player,
    );
    if (!target) {
      this.#send(ws, {
        t: "event",
        code: blockedInRange ? "combat.blocked" : "combat.too_far",
        tone: "info",
      });
      return;
    }

    const damage = attackDamageFor(player.class, player.level);
    const actualDamage = Math.min(target.hp, damage);
    const result = applyDamage(target.hp, damage);
    target.hp = result.hp;
    this.#recordDamage(player, target, actualDamage, now);
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

  #castSkill(ws: WebSocket, player: Player, slot: SkillSlot, targetId?: string): void {
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
    const resourceCost = skillResourceCost(player.class, slot);
    if (!canSpendResource(player.resource, resourceCost)) {
      this.#send(ws, { t: "event", code: "resource.insufficient", tone: "info" });
      return;
    }
    if (skill.effect === "attack") {
      if (targetId) this.#attack(ws, player, targetId);
      else
        this.#send(ws, {
          t: "event",
          code: "skill.no_target",
          params: { skill: skill.id },
          tone: "info",
        });
      return;
    }
    if (skill.effect === "single_heal") {
      if (targetId) this.#heal(ws, player, targetId, resourceCost);
      else
        this.#send(ws, {
          t: "event",
          code: "skill.no_target",
          params: { skill: skill.id },
          tone: "info",
        });
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
      const selection = targetId
        ? resolveAttackTarget(
            player,
            this.#monsters,
            targetId,
            skill.range,
            now,
            this.#zone().terrain,
          )
        : { target: undefined, blockedInRange: false };
      const { target } = selection;
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
      } else if (selection.blockedInRange) {
        this.#send(ws, {
          t: "event",
          code: "skill.blocked",
          params: { skill: skill.id },
          tone: "info",
        });
        return;
      }
    } else if (skill.effect === "guard") {
      player.guardUntil = now + (skill.durationMs ?? 0);
      player.guardReduction = skill.reduction ?? 0;
      cast = true;
    } else if (skill.effect === "single_damage") {
      const selection = targetId
        ? resolveAttackTarget(
            player,
            this.#monsters,
            targetId,
            skill.range,
            now,
            this.#zone().terrain,
          )
        : { target: undefined, blockedInRange: false };
      const { target } = selection;
      if (target) {
        this.#skillDamage(ws, player, target, skill, now);
        cast = true;
      } else if (selection.blockedInRange) {
        this.#send(ws, {
          t: "event",
          code: "skill.blocked",
          params: { skill: skill.id },
          tone: "info",
        });
        return;
      }
    } else if (skill.effect === "area_damage") {
      const targets = this.#monsters.filter(
        (monster) =>
          monster.deadUntil <= now &&
          withinRange(player, monster, skill.radius ?? skill.range) &&
          hasLineOfSight(player, monster, this.#zone().terrain.tiles),
      );
      for (const target of targets) this.#skillDamage(ws, player, target, skill, now);
      cast = true;
    } else if (skill.effect === "area_heal") {
      this.#areaHeal(ws, player, skill);
      cast = true;
    } else if (skill.effect === "nova") {
      const targets = this.#monsters.filter(
        (monster) =>
          monster.deadUntil <= now &&
          withinRange(player, monster, skill.radius ?? skill.range) &&
          hasLineOfSight(player, monster, this.#zone().terrain.tiles),
      );
      for (const target of targets) this.#skillDamage(ws, player, target, skill, now);
      this.#areaHeal(ws, player, skill);
      cast = true;
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
    spendResource(player.resource, resourceCost);
    player.dirty = true;
    this.#sendState(ws, player);
    this.#send(ws, {
      t: "event",
      code: "skill.cast",
      params: { skill: skill.id, slot },
      tone: "good",
      x: player.x,
      y: player.y,
    });
    this.#sendSpatialEvent(
      {
        t: "animation",
        actorKind: "player",
        actorId: player.id,
        action: "skill",
        skillId: skill.id,
        x: player.x,
        y: player.y,
      },
      player,
    );
  }

  #movePlayerInDirection(player: Player, direction: Vec2, distance: number): boolean {
    return movePlayerInDirection(
      player,
      direction,
      distance,
      this.#zone().terrain,
      this.#playerGrid,
    );
  }

  #skillDamage(
    ws: WebSocket,
    player: Player,
    target: Monster,
    skill: SkillDefinition,
    now: number,
  ): void {
    const damage = skill.power + Math.max(0, player.level - 1) * 2;
    const actualDamage = Math.min(target.hp, damage);
    const result = applyDamage(target.hp, damage);
    target.hp = result.hp;
    this.#recordDamage(player, target, actualDamage, now);
    if (player.class === "warrior" && skill.id === "shield_bash") {
      const previous = target.threat.get(player.id)?.amount ?? 0;
      const amount = tauntThreat(target.threat, player.id, now);
      recordContribution(
        target.contributions,
        player.id,
        { relevantThreat: Math.max(0, amount - previous) },
        now,
      );
    }
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
      if (!hasLineOfSight(player, target, this.#zone().terrain.tiles)) continue;
      const maxHp = maxHpForLevel(target.level);
      if (target.hp >= maxHp) continue;
      const amount = skill.power + Math.max(0, player.level - 1) * 2;
      const actualAmount = Math.min(amount, maxHp - target.hp);
      target.hp = Math.min(maxHp, target.hp + amount);
      target.dirty = true;
      healed += 1;
      this.#recordUsefulHeal(player, target, actualAmount, Date.now());
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

  #recordDamage(player: Player, monster: Monster, amount: number, now: number): void {
    if (amount <= 0 || monster.rewardsGranted) return;
    addThreat(monster.threat, player.id, amount, now);
    recordContribution(
      monster.contributions,
      player.id,
      { damage: amount, relevantThreat: amount },
      now,
    );
    generateResource(player.class, player.resource, "damage_dealt", amount);
  }

  #recordUsefulHeal(healer: Player, target: Player, amount: number, now: number): void {
    if (amount <= 0) return;
    generateResource(healer.class, healer.resource, "useful_healing", amount);
    const threat = usefulHealingThreat(amount);
    for (const monster of this.#monsters) {
      if (
        monster.deadUntil > now ||
        (!monster.threat.has(target.id) && !monster.contributions.has(target.id))
      )
        continue;
      addThreat(monster.threat, healer.id, threat, now);
      recordContribution(
        monster.contributions,
        healer.id,
        { usefulHealing: amount, relevantThreat: threat },
        now,
      );
    }
  }

  #defeatMonster(_ws: WebSocket, player: Player, monster: Monster, now: number): void {
    if (!beginRewardAttribution(monster)) return;
    monster.deadUntil = now + MONSTER_RESPAWN_MS;
    const directlyEligible = [...monster.contributions.values()]
      .filter((contribution) => {
        const socket = this.#socketByPlayerId.get(contribution.playerId);
        const candidate = socket ? this.#players.get(socket) : undefined;
        return (
          candidate?.authorized === true &&
          candidate.life === "alive" &&
          pointDistance(candidate, monster) <= REWARD_DISTANCE &&
          isMeaningfulContribution(contribution)
        );
      })
      .map((entry) => entry.playerId);
    if (
      !directlyEligible.includes(player.id) &&
      player.authorized &&
      pointDistance(player, monster) <= REWARD_DISTANCE
    )
      directlyEligible.push(player.id);

    const eligible = new Set(directlyEligible);
    for (const contributorId of directlyEligible) {
      const partyId = this.#partyByPlayerId.get(contributorId);
      const party = partyId ? this.#parties.get(partyId) : undefined;
      if (!party) continue;
      for (const memberId of party.members) {
        const socket = this.#socketByPlayerId.get(memberId);
        const member = socket ? this.#players.get(socket) : undefined;
        if (
          member?.authorized &&
          member.life === "alive" &&
          pointDistance(member, monster) <= REWARD_DISTANCE
        )
          eligible.add(memberId);
      }
    }

    // Experience is *split*, so sharing it with the party inflates nothing — that is the whole
    // point of grouping. Loot and quest credit are different: each is minted per recipient, so
    // handing them to a party member who did nothing multiplies the item economy and quest
    // progress by party size. Park four alts at REWARD_DISTANCE and every kill pays five times.
    // Fight for your loot; stand near your friends for your XP.
    const contributors = new Set(directlyEligible);
    const shares = splitExperience(monster.xp, [...eligible]);
    for (const [playerId, xp] of shares) {
      const socket = this.#socketByPlayerId.get(playerId);
      const recipient = socket ? this.#players.get(socket) : undefined;
      if (!socket || !recipient) continue;
      const result = applyExperience(recipient.level, recipient.xp, xp);
      recipient.level = result.level;
      recipient.xp = result.xp;
      if (result.levelsGained > 0) recipient.hp = maxHpForLevel(recipient.level);
      const earned = contributors.has(playerId);
      if (earned) this.#creditUndeadQuest(socket, recipient, monster);

      if (earned) {
        const kind = this.#tick % 4 === 0 ? "potion" : this.#tick % 2 === 0 ? "crystal" : "gold";
        const droppedLoot: GroundLoot = {
          id: crypto.randomUUID(),
          kind,
          amount: kind === "gold" ? 4 : 1,
          x: monster.x + 8,
          y: monster.y + 8,
          expiresAt: now + 30_000,
          ownerId: recipient.id,
        };
        this.#loot.push(droppedLoot);
        this.#lootGrid.insert(droppedLoot);
      }
      this.#send(
        socket,
        result.levelsGained > 0
          ? { t: "event", code: "level_up", params: { level: recipient.level }, tone: "good" }
          : {
              t: "event",
              code: "monster.defeated",
              params: { species: monster.species, xp },
              tone: "good",
            },
      );
      this.#sendState(socket, recipient);
      recipient.dirty = true;
    }
    clearMonsterCombat(monster);
  }

  #creditUndeadQuest(ws: WebSocket, player: Player, monster: Monster): void {
    if (
      player.quest.chapter !== "bone_choir" ||
      player.quest.status !== "active" ||
      monster.kind !== "skull"
    )
      return;
    const target = this.#questDefinition("bone_choir")?.target;
    if (target === undefined) return;
    player.quest.progress = Math.min(target, player.quest.progress + 1);
    if (player.quest.progress >= target) {
      player.quest.status = "ready";
      this.#send(ws, { t: "event", code: "quest.chapter_ready", tone: "good" });
    } else
      this.#send(ws, {
        t: "event",
        code: "quest.site_progress",
        params: { progress: player.quest.progress, target },
        tone: "good",
      });
  }

  #heal(
    ws: WebSocket,
    player: Player,
    targetId: string,
    resourceCost = skillResourceCost("priest", 2),
  ): boolean {
    const heal = CLASS_STATS[player.class].heal;
    if (!heal) return false;
    if (!canSpendResource(player.resource, resourceCost)) {
      this.#send(ws, { t: "event", code: "resource.insufficient", tone: "info" });
      return false;
    }
    const now = Date.now();
    if (!canAct(player.life) || now - player.lastHealAt < heal.cooldownMs) return false;

    const targetSocket = this.#socketByPlayerId.get(targetId);
    const target = targetSocket ? this.#players.get(targetSocket) : undefined;
    const inRange = Boolean(
      target && target.life === "alive" && pointDistance(player, target) <= heal.range,
    );
    const blocked = Boolean(
      target && inRange && !hasLineOfSight(player, target, this.#zone().terrain.tiles),
    );
    const healable = Boolean(
      target && target.hp < maxHpForLevel(target.level) && inRange && !blocked,
    );
    if (!target || !targetSocket || !healable) {
      // No cooldown consumed on a whiff — pressing F at full health must not punish.
      this.#send(ws, {
        t: "event",
        code: blocked ? "heal.blocked" : "heal.nobody",
        tone: "info",
      });
      return false;
    }

    player.lastHealAt = now;
    spendResource(player.resource, resourceCost);
    const amount = healAmountFor(player.level);
    const actualAmount = Math.min(amount, maxHpForLevel(target.level) - target.hp);
    target.hp = Math.min(maxHpForLevel(target.level), target.hp + amount);
    this.#recordUsefulHeal(player, target, actualAmount, now);
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
    this.#sendSpatialEvent(
      {
        t: "animation",
        actorKind: "player",
        actorId: player.id,
        action: "skill",
        skillId: "mend",
        x: target.x,
        y: target.y,
      },
      player,
    );
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
    return true;
  }

  async #interact(ws: WebSocket, player: Player): Promise<void> {
    const now = Date.now();
    if (!canAct(player.life)) return;
    const portal = this.#zone().portals.find(
      (candidate) => pointDistance(player, candidate) <= INTERACTION_RANGE,
    );
    if (portal) {
      await this.#transition(ws, player, portal, now);
      return;
    }
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
      await this.#completeQuestChapter(ws, player, chapter);
    } else {
      this.#send(ws, { t: "event", code: "quest.blessing", tone: "good" });
    }
    player.dirty = true;
    this.#sendState(ws, player);
  }

  async #transition(
    ws: WebSocket,
    player: Player,
    portal: PortalDefinition,
    now: number,
  ): Promise<void> {
    const destination = resolveZoneLocation(
      portal.destination.zoneId,
      portal.destination.instanceId,
    );
    if (!destination || player.transitioning) {
      this.#send(ws, { t: "event", code: "zone.transition_denied", tone: "bad" });
      return;
    }
    if (now - player.lastTransitionAt < 1_000) {
      this.#send(ws, { t: "event", code: "zone.transition_cooldown", tone: "info" });
      return;
    }
    const spawn = clampRestoredPosition(
      portal.destination.spawn,
      player.id,
      destination.definition.terrain,
    );

    // No new simulation/action may run while the final source save and epoch handoff are in
    // flight. The forced save remains fenced by the source epoch.
    player.transitioning = true;
    player.authorized = false;
    player.lastInput = NO_INPUT;
    player.queue = [];
    player.lastTransitionAt = now;

    const saved = await this.#savePlayer(player, ws, true);
    if (!saved) return;
    const next = await this.env.CHARACTER_PRESENCE.getByName(player.id).handoff({
      characterId: player.id,
      connectionId: player.connectionId,
      sessionEpoch: player.sessionEpoch,
      sourceRoomKey: player.roomKey,
      destinationRoomKey: destination.roomKey,
      zoneId: destination.zoneId,
      instanceId: destination.instanceId,
      x: spawn.x,
      y: spawn.y,
    });
    if (!next) {
      this.#rejectStaleSave(ws, player);
      return;
    }

    // The epoch is already N+1 in D1. Removing before close guarantees the old room cannot
    // run another tick for this character; a late persistence attempt is fenced by D1 anyway.
    player.disconnecting = true;
    this.#removePlayer(ws, player);
    this.#observability.transitions += 1;
    this.#send(ws, { t: "event", code: "zone.transition", tone: "good" });
    try {
      ws.close(WS_CLOSE.ZONE_TRANSITION, "zone transition");
    } catch {
      // A network interruption still leaves the destination persisted and recoverable.
    }
    if (this.#players.size === 0) this.#stopLoop();
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
      this.#sendSpatialEvent(
        {
          t: "event",
          code: "quest.site_harvested",
          params: { site: site.id, seconds: QUEST_SITE_RESPAWN_MS / 1_000 },
          tone: "good",
          x: site.x,
          y: site.y,
        },
        site,
      );
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

  async #completeQuestChapter(ws: WebSocket, player: Player, chapter: QuestChapter): Promise<void> {
    const definition = this.#questDefinition(chapter);
    if (!definition) return;
    const result = applyExperience(player.level, player.xp, definition.rewardXp);
    const resultingHp = maxHpForLevel(result.level);
    if (!(await this.#savePlayer(player, ws))) return;
    const claimed = await claimQuestReward(createDb(this.env.DB), {
      characterId: player.id,
      sessionEpoch: player.sessionEpoch,
      questId: chapter,
      rewardGold: definition.rewardGold,
      rewardPotions: 1,
      resultingLevel: result.level,
      resultingXp: result.xp,
      resultingHp,
    });
    if (!claimed) {
      this.#send(ws, { t: "event", code: "quest.blessing", tone: "good" });
      return;
    }
    player.inventory.potions += 1;
    player.inventory.gold += definition.rewardGold;
    player.level = result.level;
    player.xp = result.xp;
    player.hp = resultingHp;
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
    player.dirty = true;
    await this.#savePlayer(player, ws);
  }

  async #usePotion(ws: WebSocket, player: Player): Promise<void> {
    const maxHp = maxHpForLevel(player.level);
    if (!canAct(player.life) || player.inventory.potions <= 0 || player.hp >= maxHp) return;
    const remaining = await this.#consumePotion(player, ws);
    if (remaining === null) return;
    player.inventory.potions = remaining;
    player.hp = Math.min(maxHp, player.hp + 45);
    player.dirty = true;
    this.#send(ws, { t: "event", code: "potion.used", params: { heal: 45 }, tone: "good" });
    this.#sendState(ws, player);
  }

  #consumePotion(player: Player, ws: WebSocket): Promise<number | null> {
    const previous = this.#itemMutations.get(player.id) ?? Promise.resolve(null);
    const run = async () => {
      if (!player.authorized || player.inventory.potions <= 0) return null;
      const db = createDb(this.env.DB);
      // The room holds the truth: potions looted since the last periodic flush exist only in
      // memory. Decrementing a stale D1 row would return a quantity below what the player
      // actually holds, and #usePotion would then adopt it — destroying every potion picked up
      // inside the flush window. Push the room's count down first, so the quantity that comes
      // back is the truth rather than a five-second-old guess.
      //
      // Unconditional, not gated on `dirty`: the tick loop clears that flag when it *schedules*
      // a save, not when the save lands. #savePlayer queues behind any in-flight save for this
      // character, so awaiting it also awaits that one.
      if (!(await this.#savePlayer(player, ws))) return null;
      let remaining = await consumeOwnedItem(db, player.id, HEALTH_POTION_ID);
      // Safety net: an absent or empty row (a save that never landed) still gets one retry.
      if (remaining === null && player.inventory.potions > 0) {
        if (!(await this.#savePlayer(player, ws))) return null;
        remaining = await consumeOwnedItem(db, player.id, HEALTH_POTION_ID);
      }
      return remaining;
    };
    const mutation = previous.then(run, run);
    this.#itemMutations.set(player.id, mutation);
    void mutation.then(
      () => {
        if (this.#itemMutations.get(player.id) === mutation) this.#itemMutations.delete(player.id);
      },
      () => {
        if (this.#itemMutations.get(player.id) === mutation) this.#itemMutations.delete(player.id);
      },
    );
    return mutation;
  }

  #rateLimited(player: Player): boolean {
    return isRateLimited(player);
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
      if (this.#players.get(ws) === player) this.#removePlayer(ws, player);
      if (this.#players.size === 0) this.#stopLoop();
    }
  }

  #savePlayer(player: Player, ws: WebSocket, force = false): Promise<boolean> {
    const save = persistPlayer(
      {
        db: createDb(this.env.DB),
        pendingSaves: this.#profileSaves,
        rejectStaleSave: (socket, stalePlayer) => this.#rejectStaleSave(socket, stalePlayer),
      },
      player,
      ws,
      force,
    );
    return save.then(
      (accepted) => {
        if (accepted) this.#observability.d1Saves += 1;
        return accepted;
      },
      (error: unknown) => {
        this.#observability.d1Errors += 1;
        throw error;
      },
    );
  }

  #rejectStaleSave(ws: WebSocket, player: Player): void {
    player.authorized = false;
    player.lastInput = NO_INPUT;
    player.queue = [];
    if (this.#players.get(ws) === player) this.#removePlayer(ws, player);
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
    const startedAt = performance.now();
    try {
      this.#advanceTick();
    } catch (error) {
      this.#observability.tickErrors += 1;
      console.error(
        JSON.stringify({
          event: "world_tick_failed",
          roomKey: this.#location?.roomKey ?? "unconfigured",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      observeTick(this.#observability, performance.now() - startedAt);
      if (this.#tick > 0 && this.#tick % OBSERVABILITY_INTERVAL_TICKS === 0) {
        const navigation = this.#navigation;
        console.log(
          JSON.stringify(
            snapshotRoomObservability(this.#observability, {
              now: Date.now(),
              roomKey: this.#location?.roomKey ?? "unconfigured",
              players: this.#players.size,
              monsters: this.#monsters.length,
              loot: this.#loot.length,
              navigationPaths: navigation?.metrics.pathsCalculated ?? 0,
              navigationNodes: navigation?.metrics.totalExpanded ?? 0,
            }),
          ),
        );
      }
    }
  }

  #advanceTick(): void {
    if (this.#players.size === 0) {
      this.#stopLoop();
      return;
    }
    this.#tick += 1;
    const now = Date.now();
    const writeAttachment = this.#tick % ATTACHMENT_EVERY_TICKS === 0;
    const writeD1 = this.#tick % D1_SAVE_EVERY_TICKS === 0;

    advancePlayers({
      players: this.#players,
      playerGrid: this.#playerGrid,
      zone: this.#zone(),
      now,
      writeAttachment,
      writeD1,
      waitUntil: (promise) => this.ctx.waitUntil(promise),
      renewPresence: (player) => this.#renewPresence(player),
      reclaimCorpse: (socket, player) => this.#reclaimCorpse(socket, player),
      collectLoot: (socket, player) => this.#collectLoot(socket, player),
      savePlayer: (player, socket) => this.#savePlayer(player, socket),
    });
    if (writeAttachment) {
      for (const [socket, player] of this.#players) {
        if (player.authorized && player.resource) this.#sendState(socket, player);
      }
    }

    const monsterContext = {
      players: this.#players,
      monsters: this.#monsters,
      guards: this.#guards,
      monsterGrid: this.#monsterGrid,
      zone: this.#zone(),
      tick: this.#tick,
      navigation: this.#navigationRuntime(),
      damagePlayer: (
        socket: WebSocket,
        player: Player,
        damage: number,
        species: MonsterSpecies,
        monsterId: string,
        attackedAt: number,
      ) => this.#damagePlayer(socket, player, damage, species, monsterId, attackedAt),
    };
    advanceMonsters(monsterContext, now);
    advanceGuards(monsterContext, now);
    processExpiredLoot(this.#loot, this.#lootGrid, now);
    if (this.#tick % NETWORK_TICKS_PER_SNAPSHOT === 0) {
      this.#sendWorldDeltas();
      const context = this.#partyContext();
      for (const party of this.#parties.values()) broadcastPartyStateIfChanged(context, party);
    }
    this.#flushQueuedResyncs(now);
  }

  /**
   * Pays back the resyncs the cooldown deferred. A client that asks for a resync stops applying
   * deltas until one arrives, so a silently dropped request freezes its world until it reconnects.
   * The cooldown still holds — at most one resync per player per second — it is only honoured late.
   */
  #flushQueuedResyncs(now: number): void {
    for (const [socket, player] of this.#players) {
      if (!player.resyncQueued || !player.authorized) continue;
      if (now - player.lastResyncAt < RESYNC_COOLDOWN_MS) continue;
      player.resyncQueued = false;
      player.lastResyncAt = now;
      this.#sendWorldResync(socket, player);
    }
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

  #damagePlayer(
    ws: WebSocket,
    player: Player,
    damage: number,
    species: MonsterSpecies,
    monsterId: string,
    now: number,
  ): void {
    const attacker = this.#monsters.find((monster) => monster.id === monsterId);
    this.#sendSpatialEvent(
      {
        t: "animation",
        actorKind: "monster",
        actorId: monsterId,
        action: "attack",
        x: attacker?.x ?? player.x,
        y: attacker?.y ?? player.y,
      },
      attacker ?? player,
    );
    const { amount: appliedDamage, result } = guardedDamage(player, damage, now);
    player.hp = result.hp;
    generateResource(player.class, player.resource, "damage_taken", appliedDamage);
    player.dirty = true;
    this.#send(ws, {
      t: "event",
      code: "combat.hurt",
      // Keep the damage event tied to the same authoritative attacker as the spatial animation.
      params: { species, damage: appliedDamage, monsterId },
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
    for (const monster of this.#monsters) monster.threat.delete(player.id);
    this.#freeze(player);
    this.#sendSpatialEvent(
      {
        t: "event",
        code: "player.down",
        params: { name: player.nick },
        tone: "bad",
        x: player.x,
        y: player.y,
      },
      player,
    );
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
    const previousPosition = { x: player.x, y: player.y };
    player.life = "ghost";
    player.x = cemetery.x;
    player.y = cemetery.y;
    this.#playerGrid.update(player, previousPosition);
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
    collectLoot(
      {
        loot: this.#loot,
        lootGrid: this.#lootGrid,
        send: (socket, message) => this.#send(socket, message),
        sendState: (socket, target) => this.#sendState(socket, target),
      },
      ws,
      player,
    );
  }

  #selfState(player: Player): SelfState {
    const chapter = player.quest.chapter ?? "three_offerings";
    return selfState(player, this.#questDefinition(chapter)?.target);
  }

  #sendState(ws: WebSocket, player: Player): void {
    const chapter = player.quest.chapter ?? "three_offerings";
    sendState(ws, player, this.#questDefinition(chapter)?.target, (socket, message) =>
      this.#send(socket, message),
    );
  }

  #worldView(player: Player): WorldView {
    return worldView(
      {
        players: this.#players,
        monsters: this.#monsters,
        guards: this.#guards,
        loot: this.#loot,
        playerGrid: this.#playerGrid,
        monsterGrid: this.#monsterGrid,
        lootGrid: this.#lootGrid,
        navigationDebugAvailable: this.env.NAVIGATION_DEBUG === "true",
        now: Date.now,
      },
      player,
    );
  }

  #sendWorldDeltas(): void {
    broadcastNetworkUpdates(
      this.#players,
      this.#tick,
      (player) => this.#worldView(player),
      (socket, message) => this.#send(socket, message),
    );
  }

  #sendWorldResync(ws: WebSocket, player: Player): void {
    sendWorldResync(
      ws,
      player,
      this.#tick,
      (recipient) => this.#worldView(recipient),
      (socket, message) => this.#send(socket, message),
    );
  }

  #addPlayer(ws: WebSocket, player: Player): void {
    addPlayer(this.#players, this.#socketByPlayerId, this.#playerGrid, ws, player);
  }

  #removePlayer(ws: WebSocket, player: Player): void {
    removePlayerFromParties(this.#partyContext(), player.id);
    removePlayerCombatState(this.#monsters, player.id);
    removePlayer(this.#players, this.#socketByPlayerId, this.#playerGrid, ws, player);
  }

  #sendLocalChat(sender: Player, text: string): void {
    const message: ServerMessage = {
      t: "chat",
      channel: "local",
      from: sender.nick,
      text,
    };
    for (const recipient of this.#playerGrid.queryRadius(sender, LOCAL_CHAT_RADIUS)) {
      if (!recipient.authorized) continue;
      const socket = this.#socketByPlayerId.get(recipient.id);
      if (socket) this.#send(socket, message);
    }
  }

  #sendSpatialEvent(message: ServerMessage, position: Vec2): void {
    for (const recipient of this.#playerGrid.queryRadius(position, SPATIAL_EVENT_RADIUS)) {
      if (!recipient.authorized) continue;
      const socket = this.#socketByPlayerId.get(recipient.id);
      if (socket) this.#send(socket, message);
    }
  }

  #send(ws: WebSocket, message: ServerMessage): void {
    try {
      const encoded = encodeServerMessage(message);
      observeSend(
        this.#observability,
        new TextEncoder().encode(encoded).byteLength,
        message.t === "world.delta",
      );
      ws.send(encoded);
    } catch {
      this.ctx.waitUntil(this.#drop(ws));
    }
  }
}
