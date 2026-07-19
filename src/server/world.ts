/**
 * One authoritative MMO room. Clients send movement/action intent; this Durable Object alone
 * moves entities, applies damage, grants loot/XP, advances quests, and persists player profiles.
 */
import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import {
  activePageIndex,
  EMPTY_ADVENTURE_STATE,
  type PartyAdventureState,
} from "../shared/adventure-state.js";
import { WS_CLOSE } from "../shared/close-codes.js";
import { actionForClassSlot, MONSTER_ACTIONS } from "../shared/combat-actions.js";
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
  circleIntersectsArc,
  circleIntersectsCapsule,
  firstSegmentImpact,
  frontalArc,
  normalizeDirection,
  strikeCapsule,
  sweptProjectileEntityImpact,
  sweptProjectileTerrainImpact,
} from "../shared/directional-combat.js";
import {
  applyDamage,
  applyExperience,
  attackDamageFor,
  CEMETERIES,
  CLASS_STATS,
  clampRestoredPosition,
  hasLineOfSight,
  INTERACTION_RANGE,
  LOOT_EXPIRY_MS,
  MONSTER_AGGRO_RANGE,
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
  type ProjectileSnapshot,
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
  CLASS_SKILLS,
  isSkillUnlocked,
  SKILL_UNLOCK_LEVEL,
  type SkillDefinition,
  type SkillSlot,
  skillFor,
} from "../shared/skills.js";
import { emptyLayer, encodeTileLayer } from "../shared/tile-layer-codec.js";
import { TILE_SIZE } from "../shared/tilemap.js";
import { encodeTileMap } from "../shared/tilemap-codec.js";
import { TINY_SWORDS_TILESET_ID } from "../shared/tilesets/tiny-swords.js";
import { replaceWorldCache } from "../shared/world-delta.js";
import {
  isKnownZone,
  isValidInstanceId,
  type PortalDefinition,
  resolveZoneLocation,
  type ZoneDefinition,
  type ZoneLocation,
} from "../shared/zones.js";
import { loadAdventure } from "./adventures.js";
import { claimQuestReward, consumeOwnedItem } from "./character-persistence.js";
import { presenceTiming } from "./character-presence.js";
import { createDb, party } from "./db/index.js";
import { loadHeroProfile, saveHeroProfile } from "./hero-profile.js";
import { HEALTH_POTION_ID } from "./items.js";
import { BUILTIN_MAP, BUILTIN_MAP_ID, loadMap } from "./maps.js";
import { completeParty, loadPartyForRuntime } from "./parties.js";
import { loadProfile, saveProfile } from "./profile.js";
import {
  advanceCombatActions,
  cancelCombatAction,
  startCombatAction,
} from "./world/combat-action-system.js";
import { guardedDamage } from "./world/combat-system.js";
import { addPlayer, isRateLimited, removePlayer } from "./world/connection-system.js";
import {
  beginRewardAttribution,
  clearMonsterCombat,
  removePlayerCombatState,
} from "./world/contribution-system.js";
import { worldView } from "./world/interest-system.js";
import { collectLoot, processExpiredLoot } from "./world/loot-system.js";
import { locationFromMap } from "./world/map-zone.js";
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
  heroPartyState,
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
import {
  advanceProjectiles,
  projectileOrigin,
  removeProjectilesByOwner,
  spawnProjectile,
} from "./world/projectile-system.js";
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
  type ActiveWorldEvent,
  ATTACHMENT_EVERY_TICKS,
  type Attachment,
  CHAT_MAX_LENGTH,
  type CombatActionRuntime,
  combatCooldownsFromPlayer,
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
  type ProjectileRuntime as Projectile,
  profileFromAttachment,
  RESYNC_COOLDOWN_MS,
  toAttachment,
  toProfile,
} from "./world/world-runtime.js";

export { type Attachment, positionFromAttachment } from "./world/world-runtime.js";

/**
 * The compiled catalogue zones predate layers and carry none — their terrain still comes straight
 * out of `terrain.tiles`, as it always has. A welcome must still emit *something* shaped like the
 * new field, so an absent zone-authored layer set becomes three empty layers sized to that zone's
 * own grid, not a single module-wide constant: catalogue zones are not all the same size (compare
 * `verdant-reach` and `sunken-isles`), so one fixed-size constant would be silently wrong for every
 * zone but the one it was sized for. This is cheap — welcome is sent once per connection, not once
 * per tick — so there is nothing to gain by caching it.
 */
function emptyEncodedLayers(cols: number, rows: number): readonly string[] {
  const layer = encodeTileLayer(emptyLayer(cols, rows));
  return [layer, layer, layer];
}

export class World extends DurableObject<Env> {
  #players = new Map<WebSocket, Player>();
  #socketByPlayerId = new Map<string, WebSocket>();
  #monsters: Monster[] = [];
  #guards: Guard[] = [];
  #location: ZoneLocation | null = null;
  #loot: GroundLoot[] = [];
  #projectiles: Projectile[] = [];
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
  /** Per persistent party, the last hero roster actually sent — the hero half of `lastBroadcast`. */
  #heroPartyBroadcasts = new Map<string, string>();
  #navigation: NavigationRuntime | null = null;
  #observability = createRoomObservability();
  #seenCharacterIds = new Set<string>();
  /**
   * The party's read-only adventure-state snapshot, pushed down by the `GameSession` coordinator
   * (`installAdventureState`) on room start and on change. The room never mutates it: state is
   * single-writer, owned by the coordinator (spec Decision 2). Defaults to empty so an
   * un-pushed-to room — a catalogue zone, or a hero room between hibernation restore and the next
   * push — still evaluates cleanly (everything reads its neutral default).
   */
  #adventureState: PartyAdventureState = EMPTY_ADVENTURE_STATE;
  /**
   * The events whose active page currently holds, re-derived only on snapshot install and hero
   * join — never per tick. Appearance-only and nothing reads it yet; Task 4 puts it on the wire.
   */
  #activeEvents: readonly ActiveWorldEvent[] = [];
  /** The party this hero room belongs to, learned at admission. `null` for catalogue/character
   *  rooms. Used only to tell the coordinator when the room has emptied. */
  #heroPartyId: string | null = null;
  #occupiedExitByPlayerId = new Map<string, string>();
  /** How often this room re-asserts its players' leases. Read once from `Env`, never from a client. */
  readonly #presenceHeartbeatMs: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#presenceHeartbeatMs = presenceTiming(env).heartbeatMs;
    ctx.blockConcurrencyWhile(async () => {
      for (const ws of ctx.getWebSockets()) {
        try {
          await this.#restoreWebSocket(ws);
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "world_socket_restore_failed",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          try {
            ws.close(WS_CLOSE.PRESENCE_LOST, "failed to restore connection");
          } catch {
            // The legacy socket may already be closed or carry an unreadable attachment.
          }
        }
      }
      if (this.#players.size > 0) this.#startLoop();
    });
  }

  #presenceFor(id: string, identityKind: "character" | "hero") {
    return identityKind === "hero"
      ? this.env.HERO_PRESENCE.getByName(id)
      : this.env.CHARACTER_PRESENCE.getByName(id);
  }

  #presence(player: Player) {
    return this.#presenceFor(player.id, player.identityKind);
  }

  #loadProfile(id: string, identityKind: "character" | "hero") {
    const db = createDb(this.env.DB);
    return identityKind === "hero" ? loadHeroProfile(db, id) : loadProfile(db, id);
  }

  #saveProfile(player: Player, profile = toProfile(player)) {
    const db = createDb(this.env.DB);
    return player.identityKind === "hero" ? saveHeroProfile(db, profile) : saveProfile(db, profile);
  }

  async #restoreWebSocket(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) {
      ws.close(WS_CLOSE.PRESENCE_LOST, "missing connection state");
      return;
    }
    // Waking from hibernation: the room loads exactly what it was admitted for — catalogue zone
    // or D1 map by exact id — never a fallback. A missing zone id is a lost connection, not a
    // reason to guess.
    const location = await this.#locateRoom(
      attachment.zoneId ?? null,
      attachment.instanceId ?? "main",
      attachment.partyId ?? null,
    );
    if (!location) {
      ws.close(WS_CLOSE.PRESENCE_LOST, "invalid character location");
      return;
    }
    this.#configure(location);
    const roomKey = attachment.roomKey ?? location.roomKey;
    if (roomKey !== location.roomKey) {
      ws.close(WS_CLOSE.PRESENCE_LOST, "room location mismatch");
      return;
    }
    let connectionId = attachment.connectionId;
    let sessionEpoch = attachment.sessionEpoch;
    const identityKind = attachment.identityKind ?? "character";
    const presence = this.#presenceFor(attachment.id, identityKind);
    if (!connectionId || !sessionEpoch) {
      connectionId = crypto.randomUUID();
      const lease = await presence.acquire({
        characterId: attachment.id,
        connectionId,
        roomKey,
        zoneId: location.zoneId,
        instanceId: location.instanceId,
      });
      sessionEpoch = lease.sessionEpoch;
    } else if (!(await presence.isAuthorized(connectionId, sessionEpoch, roomKey))) {
      ws.close(WS_CLOSE.PRESENCE_LOST, "presence expired");
      return;
    }
    const profile = profileFromAttachment(
      {
        ...attachment,
        connectionId,
        sessionEpoch,
      },
      location.definition.terrain,
    );
    const position = clampRestoredPosition(profile, profile.id, location.definition.terrain);
    profile.x = position.x;
    profile.y = position.y;
    const restoredCooldowns = await presence.readCooldowns(connectionId, sessionEpoch);
    if (restoredCooldowns === null) {
      ws.close(WS_CLOSE.PRESENCE_LOST, "presence expired");
      return;
    }
    const player = newPlayer(
      profile,
      connectionId,
      roomKey,
      attachment.ack ?? 0,
      attachment.lastSeq ?? 0,
      attachment.resource,
      restoredCooldowns,
    );
    player.identityKind = identityKind;
    player.partyId = attachment.partyId ?? null;
    ws.serializeAttachment(toAttachment(player));
    this.#addPlayer(ws, player);
    this.#seenCharacterIds.add(player.id);
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

  /**
   * Exact-id room location. Catalogue zones come from the compiled catalogue; a D1 map id loads
   * THAT map — never `resolveMapFor`. The fallback belongs at the front door: a room that silently
   * re-resolves is a room that can disagree with the lease it was admitted under.
   */
  async #locateRoom(
    zoneId: string | null,
    instanceId: string | null,
    partyId: string | null = null,
  ): Promise<ZoneLocation | null> {
    if (zoneId === null || !isValidInstanceId(instanceId)) return null;
    if (isKnownZone(zoneId)) return resolveZoneLocation(zoneId, instanceId);
    const stored =
      zoneId === BUILTIN_MAP_ID ? BUILTIN_MAP : await loadMap(createDb(this.env.DB), zoneId);
    if (stored === null) return null;
    const location = locationFromMap(stored, instanceId);
    if (!partyId) return location;
    const partyRow = await createDb(this.env.DB)
      .select({ maxPlayers: party.maxPlayers })
      .from(party)
      .where(eq(party.id, partyId))
      .get();
    if (!partyRow) return null;
    return {
      ...location,
      roomKey: `${partyId}:${stored.id}`,
      definition: { ...location.definition, maxPlayers: partyRow.maxPlayers },
    };
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
    const identityKind = request.headers.get("x-identity-kind") === "hero" ? "hero" : "character";
    const id =
      identityKind === "hero"
        ? request.headers.get("x-hero-id")
        : request.headers.get("x-character-id");
    const partyId = identityKind === "hero" ? request.headers.get("x-party-id") : null;
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
    // The room loads its own map rather than trusting the header to describe it. The header only
    // says WHICH map; D1 says what it is. `roomKey` must still match, so a header cannot point a
    // room at a map it was not admitted for.
    const location = await this.#locateRoom(zoneId, instanceId, partyId);
    if (!location || location.roomKey !== roomKey) {
      return this.#closedSocket(WS_CLOSE.INVALID_LOCATION, "room.invalid_location");
    }
    this.#configure(location);

    const presence = this.#presenceFor(id, identityKind);
    if (!(await presence.isAuthorized(connectionId, sessionEpoch, roomKey))) {
      return new Response("presence lost", { status: 409 });
    }

    const profile = await this.#loadProfile(id, identityKind);
    if (!profile) return new Response("unknown character", { status: 404 });
    if (profile.sessionEpoch !== sessionEpoch) {
      return new Response("presence epoch mismatch", { status: 409 });
    }
    if (profile.zoneId !== location.zoneId || profile.instanceId !== location.instanceId) {
      return new Response("character location changed", { status: 409 });
    }
    const restoredCooldowns = await presence.readCooldowns(connectionId, sessionEpoch);
    if (restoredCooldowns === null) return new Response("presence lost", { status: 409 });
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
      const accepted =
        identityKind === "hero"
          ? await saveHeroProfile(createDb(this.env.DB), profile)
          : await saveProfile(createDb(this.env.DB), profile);
      if (!accepted) {
        await presence.release(connectionId, sessionEpoch);
        return new Response("presence epoch mismatch", { status: 409 });
      }
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const player = newPlayer(profile, connectionId, roomKey, 0, 0, undefined, restoredCooldowns);
    player.identityKind = identityKind;
    player.partyId = partyId;
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

    // Join-time page evaluation: the map's events are only known once the room is configured (the
    // first join), and a snapshot the coordinator pushed before that configuration could not be
    // evaluated yet. Re-derive now against whatever snapshot the room holds. Off the tick loop.
    this.#evaluateActiveEvents();

    const initialView = this.#worldView(player);
    replaceWorldCache(player.network, initialView);
    this.#send(server, {
      t: "welcome",
      tick: this.#tick,
      selfId: id,
      world: {
        zoneId: location.zoneId,
        revision: location.definition.revision ?? 0,
        zoneNameKey: location.definition.nameKey,
        // The terrain, baked and shipped. The client collides against exactly these bytes rather
        // than looking the zone up in a table it compiled in — which is what lets a map live in D1
        // at all, and means a client can never disagree with collision it did not compute.
        tiles: encodeTileMap(location.definition.terrain.tiles),
        // Catalogue zones grow their trees out of `forest` cells in the tilemap above, so there is
        // nothing standing on the ground that the ground does not already describe — `elements` is
        // undefined for them. A D1 map's scenery lives here instead.
        elements: location.definition.elements ?? [],
        tilesetId: location.definition.tilesetId ?? TINY_SWORDS_TILESET_ID,
        // Appearance only, exactly like `elements` above — never a second source of collision.
        // Catalogue zones predate layers and have none; ship three empty layers sized to this
        // zone's own grid rather than one wrong-for-most-zones constant (see `emptyEncodedLayers`).
        layers:
          location.definition.layers ??
          emptyEncodedLayers(
            location.definition.terrain.tiles.cols,
            location.definition.terrain.tiles.rows,
          ),
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

  /**
   * The party coordinator's read-only adventure-state snapshot, pushed on room start and on every
   * change. Called only by the party's GameSession — the same coordinator -> World RPC seam as
   * `broadcastParty`, never reachable from a client. Storing it re-derives the room's active-event
   * list; when the room has no map configured yet (install can land before the first join) the
   * derivation no-ops and the join re-runs it.
   */
  async installAdventureState(partyId: string, state: PartyAdventureState): Promise<void> {
    if (this.#heroPartyId !== null && this.#heroPartyId !== partyId) return;
    this.#adventureState = state;
    this.#evaluateActiveEvents();
  }

  /**
   * Select each authored event's active page against the current adventure-state snapshot and
   * project the holders down to their appearance. Called only on snapshot install and hero join —
   * NEVER from the tick loop — so an event carries zero per-tick cost. `activePageIndex` is the
   * exact pure rule `test/adventure-state.test.ts` pins; there is no second copy to drift.
   */
  #evaluateActiveEvents(): void {
    const events = this.#location?.definition.events;
    if (!events || events.length === 0) {
      this.#activeEvents = [];
      return;
    }
    const active: ActiveWorldEvent[] = [];
    for (const event of events) {
      const index = activePageIndex(event, this.#adventureState);
      if (index === null) continue;
      const page = event.pages[index];
      if (page === undefined) continue;
      active.push({
        id: event.id,
        col: event.col,
        row: event.row,
        graphicAssetId: page.graphicAssetId,
        onTop: page.optOnTop,
      });
    }
    this.#activeEvents = active;
  }

  /** Called only by the party's GameSession coordinator. */
  async broadcastParty(partyId: string, message: ServerMessage): Promise<void> {
    for (const [socket, player] of this.#players) {
      if (player.identityKind === "hero" && player.partyId === partyId && player.authorized) {
        this.#send(socket, message);
      }
    }
  }

  /** Internal observability seam for room-isolation and authored-spawn integration tests. */
  async roomDiagnostics(): Promise<{
    roomKey: string | null;
    playerIds: string[];
    monsters: { id: string; species: MonsterSpecies; patrolRadius: number }[];
    projectiles: { id: string; ownerId: string; kind: ProjectileSnapshot["kind"] }[];
    pendingSaves: number;
    tickActive: boolean;
    adventureState: PartyAdventureState;
    activeEvents: readonly ActiveWorldEvent[];
  }> {
    return {
      roomKey: this.#location?.roomKey ?? null,
      playerIds: [...this.#players.values()].filter((player) => player.authorized).map((p) => p.id),
      monsters: this.#monsters.map((monster) => ({
        id: monster.id,
        species: monster.species,
        patrolRadius: monster.patrolRadius,
      })),
      projectiles: this.#projectiles.map((projectile) => ({
        id: projectile.id,
        ownerId: projectile.ownerId,
        kind: projectile.kind,
      })),
      pendingSaves: this.#profileSaves.size,
      tickActive: this.#loop !== null,
      adventureState: this.#adventureState,
      activeEvents: this.#activeEvents,
    };
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
      if (player.identityKind === "hero") {
        this.#send(ws, { t: "event", code: "party.invalid", tone: "bad" });
        return;
      }
      this.#handlePartyMessage(ws, player, message);
      return;
    }
    // The dead act only through the two exits above. Chat is the one thing a spirit keeps.
    if (message.t !== "chat" && !canAct(player.life)) return;
    if (message.t === "attack") {
      if (this.#startPlayerAction(ws, player, 1)) {
        await this.#checkpointCooldownsOrReject(ws, player);
      }
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
    if (message.t === "skill") {
      if (this.#startPlayerAction(ws, player, message.slot)) {
        await this.#checkpointCooldownsOrReject(ws, player);
      }
      return;
    }
    if (message.t !== "chat") return;
    const text = message.text.trim().replaceAll(/\s+/g, " ");
    if (text.length === 0 || text.length > CHAT_MAX_LENGTH) return;
    if (message.channel === "party") {
      if (player.identityKind === "hero" && player.partyId) {
        await this.env.GAME_SESSION.getByName(player.partyId).broadcast(player.partyId, {
          t: "chat",
          channel: "party",
          from: player.nick,
          text,
        });
      } else if (!sendPartyChat(this.#partyContext(), player, text))
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

  #startPlayerAction(ws: WebSocket, player: Player, slot: SkillSlot): boolean {
    const skill = skillFor(player.class, slot);
    if (!isSkillUnlocked(player.level, slot)) {
      this.#send(ws, {
        t: "event",
        code: "skill.locked",
        params: { level: SKILL_UNLOCK_LEVEL[slot], skill: skill.id },
        tone: "info",
      });
      return false;
    }
    const resourceCost = skillResourceCost(player.class, slot);
    if (!canSpendResource(player.resource, resourceCost)) {
      this.#send(ws, { t: "event", code: "resource.insufficient", tone: "info" });
      return false;
    }
    const now = Date.now();
    if (!canAct(player.life)) return false;
    if (slot === 1 && now - player.lastAttackAt < skill.cooldownMs) return false;
    if (skill.id === "mend" && now - player.lastHealAt < skill.cooldownMs) return false;
    if (slot !== 1 && (player.skillCooldowns[slot - 1] ?? 0) > now) return false;
    const definition = actionForClassSlot(player.class, slot);
    const action = startCombatAction(player, {
      kind: slot === 1 ? "basic" : "skill",
      skillId: skill.id,
      slot,
      direction: player.facing,
      now,
      anticipationMs: definition.anticipationMs,
      recoveryMs: definition.recoveryMs,
    });
    if (!action) return false;

    if (slot === 1) player.lastAttackAt = now;
    else player.skillCooldowns[slot - 1] = now + skill.cooldownMs;
    if (skill.id === "mend") player.lastHealAt = now;
    spendResource(player.resource, resourceCost);
    player.dirty = true;
    if (skill.id === "mend") {
      const selfPower = (skill.selfPower ?? skill.power) + Math.max(0, player.level - 1) * 3;
      this.#healPlayer(ws, player, ws, player, selfPower, now, true);
    }
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
        actionId: action.id,
        actorKind: "player",
        actorId: player.id,
        action: slot === 1 ? "attack" : "skill",
        skillId: skill.id,
        direction: { ...action.direction },
        startedAt: action.startedAt,
        impactAt: action.impactAt,
        recoveryEndsAt: action.recoveryEndsAt,
      },
      player,
    );
    return true;
  }

  #resolvePlayerAction(player: Player, action: CombatActionRuntime, now: number): void {
    if (!player.authorized || player.transitioning || !canAct(player.life)) return;
    const socket = this.#socketByPlayerId.get(player.id);
    const slot = action.slot;
    if (!socket || slot === undefined || slot < 1 || slot > 5) return;
    const skill = skillFor(player.class, slot as SkillSlot);
    const definition = actionForClassSlot(player.class, slot);
    const center = { x: player.x + PLAYER_SIZE / 2, y: player.y + PLAYER_SIZE / 2 };

    if (definition.shape === "arc") {
      const arc = frontalArc(
        center,
        action.direction,
        skill.range,
        definition.halfAngleRadians ?? Math.PI / 3,
      );
      for (const monster of this.#monsterGrid.queryRadius(center, skill.range + PLAYER_SIZE)) {
        if (
          monster.deadUntil > now ||
          !circleIntersectsArc(
            {
              center: { x: monster.x + PLAYER_SIZE / 2, y: monster.y + PLAYER_SIZE / 2 },
              radius: PLAYER_SIZE / 2,
            },
            arc,
          ) ||
          !hasLineOfSight(player, monster, this.#zone().terrain.tiles)
        )
          continue;
        this.#damageMonster(socket, player, monster, skill, now, true);
      }
      return;
    }
    if (definition.shape === "charge") {
      this.#resolveShieldBash(socket, player, action, skill, now);
      return;
    }
    if (definition.shape === "guard") {
      player.guardUntil = now + (skill.durationMs ?? 0);
      player.guardReduction = skill.reduction ?? 0;
      return;
    }
    if (definition.shape === "dash") {
      this.#movePlayerInDirection(
        player,
        { x: -action.direction.x, y: -action.direction.y },
        skill.distance ?? 0,
      );
      return;
    }
    if (definition.shape === "teleport") {
      this.#movePlayerInDirection(player, action.direction, skill.distance ?? 0);
      return;
    }
    if (definition.shape === "projectile" || definition.shape === "volley") {
      this.#spawnPlayerProjectiles(player, action, skill, definition, "monsters", now);
      return;
    }
    if (definition.shape === "heal_projectile") {
      this.#spawnPlayerProjectiles(player, action, skill, definition, "wounded_allies", now);
      return;
    }
    if (definition.shape === "area_damage" || definition.shape === "nova") {
      const radius = skill.radius ?? skill.range;
      for (const monster of this.#monsterGrid.queryRadius(center, radius + PLAYER_SIZE)) {
        if (
          monster.deadUntil <= now &&
          withinRange(player, monster, radius) &&
          hasLineOfSight(player, monster, this.#zone().terrain.tiles)
        )
          this.#damageMonster(socket, player, monster, skill, now, false);
      }
    }
    if (definition.shape === "area_heal" || definition.shape === "nova") {
      this.#areaHeal(socket, player, skill, now);
    }
  }

  #resolveShieldBash(
    ws: WebSocket,
    player: Player,
    action: CombatActionRuntime,
    skill: SkillDefinition,
    now: number,
  ): void {
    const distance = skill.distance ?? 0;
    const start = { x: player.x + PLAYER_SIZE / 2, y: player.y + PLAYER_SIZE / 2 };
    const end = {
      x: start.x + action.direction.x * distance,
      y: start.y + action.direction.y * distance,
    };
    const terrainImpact = sweptProjectileTerrainImpact(
      start,
      end,
      PLAYER_SIZE / 2,
      this.#zone().terrain.tiles,
    );
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const monsterImpacts = this.#monsterGrid
      .queryRadius(midpoint, distance / 2 + PLAYER_SIZE)
      .filter((monster) => monster.deadUntil <= now)
      .map((monster) => ({
        monster,
        impact: sweptProjectileEntityImpact(
          start,
          end,
          PLAYER_SIZE / 2,
          {
            center: { x: monster.x + PLAYER_SIZE / 2, y: monster.y + PLAYER_SIZE / 2 },
            radius: PLAYER_SIZE / 2,
          },
          monster.id,
        ),
      }))
      .filter(
        (entry): entry is { monster: Monster; impact: NonNullable<typeof entry.impact> } =>
          entry.impact !== null,
      );
    const first = firstSegmentImpact([
      terrainImpact,
      ...monsterImpacts.map(({ impact }) => impact),
    ]);
    const travel = Math.max(0, distance * (first?.fraction ?? 1) - 1);
    this.#movePlayerInDirection(player, action.direction, travel);
    if (first?.kind === "entity") {
      const target = monsterImpacts.find(({ impact }) => impact.id === first.id)?.monster;
      if (target) this.#damageMonster(ws, player, target, skill, now, false);
    } else if (first?.kind === "terrain") {
      this.#send(ws, {
        t: "event",
        code: "skill.blocked",
        params: { skill: skill.id },
        tone: "info",
        x: first.point.x,
        y: first.point.y,
      });
    }
  }

  #spawnPlayerProjectiles(
    player: Player,
    action: CombatActionRuntime,
    skill: SkillDefinition,
    definition: ReturnType<typeof actionForClassSlot>,
    targetFilter: "monsters" | "wounded_allies",
    now: number,
  ): void {
    const projectileDefinition = definition.projectile;
    if (!projectileDefinition) return;
    const count = Math.max(1, projectileDefinition.count ?? 1);
    const spread = projectileDefinition.spreadRadians ?? 0;
    const activationHitEntityIds = count > 1 ? new Set<string>() : undefined;
    for (let index = 0; index < count; index++) {
      const offset = count === 1 ? 0 : -spread / 2 + (spread * index) / (count - 1);
      const cosine = Math.cos(offset);
      const sine = Math.sin(offset);
      const direction = normalizeDirection({
        x: action.direction.x * cosine - action.direction.y * sine,
        y: action.direction.x * sine + action.direction.y * cosine,
      });
      const power =
        targetFilter === "wounded_allies"
          ? (skill.allyPower ?? skill.power) + Math.max(0, player.level - 1) * 3
          : skill.slot === 1
            ? attackDamageFor(player.class, player.level)
            : skill.power + Math.max(0, player.level - 1) * 2;
      spawnProjectile(this.#projectiles, {
        actionId: action.id,
        owner: player,
        roomKey: player.roomKey,
        origin: projectileOrigin(player, direction, projectileDefinition.radius),
        direction,
        definition: projectileDefinition,
        range: skill.range,
        power,
        targetFilter,
        sourceSkillId: skill.id,
        basic: skill.slot === 1,
        now,
        ...(activationHitEntityIds ? { activationHitEntityIds } : {}),
      });
    }
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

  #damageMonster(
    ws: WebSocket,
    player: Player,
    target: Monster,
    skill: SkillDefinition,
    now: number,
    basic: boolean,
    frozenPower?: number,
  ): void {
    if (target.deadUntil > now) return;
    const damage =
      frozenPower ??
      (basic
        ? attackDamageFor(player.class, player.level)
        : skill.power + Math.max(0, player.level - 1) * 2);
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
    this.#sendSpatialEvent(
      {
        t: "event",
        code: "combat.hit",
        params: {
          species: target.species,
          damage: actualDamage,
          skill: skill.id,
          actorId: player.id,
          ...(basic ? { basic: 1 } : {}),
        },
        tone: "info",
        x: target.x,
        y: target.y,
      },
      target,
    );
    if (result.killed) this.#defeatMonster(ws, player, target, now);
  }

  #areaHeal(ws: WebSocket, player: Player, skill: SkillDefinition, now: number): number {
    let healed = 0;
    for (const [targetSocket, target] of this.#players) {
      if (
        target.life !== "alive" ||
        !this.#areCombatAllies(player, target) ||
        pointDistance(player, target) > (skill.radius ?? skill.range)
      )
        continue;
      if (!hasLineOfSight(player, target, this.#zone().terrain.tiles)) continue;
      const amount = skill.power + Math.max(0, player.level - 1) * 2;
      if (this.#healPlayer(ws, player, targetSocket, target, amount, now, target === player) > 0)
        healed += 1;
    }
    return healed;
  }

  #healPlayer(
    casterSocket: WebSocket,
    caster: Player,
    targetSocket: WebSocket,
    target: Player,
    amount: number,
    now: number,
    selfCast: boolean,
  ): number {
    if (target.life !== "alive" || !this.#areCombatAllies(caster, target)) return 0;
    const maxHp = maxHpForLevel(target.level);
    const actualAmount = Math.min(Math.max(0, amount), Math.max(0, maxHp - target.hp));
    if (actualAmount <= 0) return 0;
    target.hp += actualAmount;
    target.dirty = true;
    this.#recordUsefulHeal(caster, target, actualAmount, now);
    if (targetSocket !== casterSocket) {
      this.#send(casterSocket, {
        t: "event",
        code: "heal.cast",
        params: {
          name: target.nick,
          amount: actualAmount,
          color: caster.appearance.primaryColor,
        },
        tone: "good",
        x: target.x,
        y: target.y,
      });
    }
    this.#send(targetSocket, {
      t: "event",
      code: selfCast && targetSocket === casterSocket ? "heal.cast" : "heal.received",
      params: {
        name: caster.nick,
        amount: actualAmount,
        color: caster.appearance.primaryColor,
      },
      tone: "good",
      x: target.x,
      y: target.y,
    });
    this.#sendState(targetSocket, target);
    return actualAmount;
  }

  #areCombatAllies(a: Player, b: Player): boolean {
    if (a.id === b.id) return true;
    if (a.identityKind === "hero" || b.identityKind === "hero") {
      return (
        a.identityKind === "hero" &&
        b.identityKind === "hero" &&
        a.partyId !== null &&
        a.partyId === b.partyId
      );
    }
    const partyId = this.#partyByPlayerId.get(a.id);
    return partyId !== undefined && partyId === this.#partyByPlayerId.get(b.id);
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

  /**
   * The heroes of one persistent party that this room is currently simulating.
   *
   * A hero room is named `${partyId}:${mapId}` and admission refuses any other room key, so every
   * hero simulated here belongs to the same persistent party by construction. Heroes cannot build
   * an in-room party either — `party.*` is refused for them — so the persistent party is the only
   * membership there is. This is the single answer to "who is in my party" on the hero side:
   * rewards and the roster must never disagree about it. A party spread over several maps has one
   * room per map, and a room only ever knows its own occupants.
   */
  #heroPartyMembers(partyId: string): Player[] {
    return [...this.#players.values()].filter(
      (player) => player.identityKind === "hero" && player.partyId === partyId && player.authorized,
    );
  }

  /**
   * Who counts as "in my party" when a monster pays out. Heroes read the persistent party;
   * characters keep the in-room runtime party they invited each other into.
   */
  #rewardPartyMemberIds(playerId: string): Iterable<string> {
    const socket = this.#socketByPlayerId.get(playerId);
    const player = socket ? this.#players.get(socket) : undefined;
    if (player?.identityKind === "hero") {
      const partyId = player.partyId;
      if (partyId === null) return [];
      return this.#heroPartyMembers(partyId).map((other) => other.id);
    }
    const runtimePartyId = this.#partyByPlayerId.get(playerId);
    const party = runtimePartyId ? this.#parties.get(runtimePartyId) : undefined;
    return party ? party.members : [];
  }

  /**
   * The hero half of `broadcastPartyStateIfChanged`. `#parties` is permanently empty in a hero
   * room, so the tick loop's runtime-party pass sends nothing; this rebuilds the roster from the
   * persistent party instead, and is gated on the last payload actually sent so an idle party
   * costs nothing at 10 Hz.
   */
  #broadcastHeroPartyStates(): void {
    const membersByParty = new Map<string, Player[]>();
    for (const player of this.#players.values()) {
      if (player.identityKind !== "hero" || !player.authorized) continue;
      const partyId = player.partyId;
      if (partyId === null) continue;
      const members = membersByParty.get(partyId);
      if (members) members.push(player);
      else membersByParty.set(partyId, [player]);
    }
    for (const partyId of this.#heroPartyBroadcasts.keys()) {
      if (!membersByParty.has(partyId)) this.#heroPartyBroadcasts.delete(partyId);
    }
    for (const [partyId, members] of membersByParty) {
      const state = heroPartyState(partyId, members);
      const encoded = JSON.stringify(state);
      if (this.#heroPartyBroadcasts.get(partyId) === encoded) continue;
      this.#heroPartyBroadcasts.set(partyId, encoded);
      for (const member of members) {
        const socket = this.#socketByPlayerId.get(member.id);
        if (socket) this.#send(socket, { t: "party.state", party: state });
      }
    }
  }

  #defeatMonster(_ws: WebSocket, player: Player, monster: Monster, now: number): void {
    if (!beginRewardAttribution(monster)) return;
    cancelCombatAction(monster);
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
      for (const memberId of this.#rewardPartyMemberIds(contributorId)) {
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
          expiresAt: now + LOOT_EXPIRY_MS,
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
    const resurrection = this.#resurrectNearbyCorpse(ws, player, now);
    if (resurrection.handled) {
      if (resurrection.cooldownStarted) {
        this.ctx.waitUntil(this.#checkpointCooldownsOrReject(ws, player));
      }
      return;
    }
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
    // A portal only ever names a catalogue zone this session — content pointing at a D1 map is not
    // a thing a portal does today, so this stays the pure lookup `main` uses, no D1 round trip.
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
    cancelCombatAction(player);
    removeProjectilesByOwner(this.#projectiles, player.id);
    player.lastTransitionAt = now;

    if (!(await this.#checkpointCooldowns(player))) {
      this.#rejectStaleSave(ws, player);
      return;
    }
    const saved = await this.#savePlayer(player, ws, true);
    if (!saved) return;
    const next = await this.#presence(player).handoff({
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

  /** Resolve an authored exit from the stored adventure graph; the client supplies no target. */
  async #transitionAdventureExit(
    ws: WebSocket,
    player: Player,
    exitId: string,
    now: number,
  ): Promise<void> {
    const partyId = player.partyId;
    if (
      player.identityKind !== "hero" ||
      !partyId ||
      player.life !== "alive" ||
      player.transitioning
    ) {
      return;
    }
    const db = createDb(this.env.DB);
    const storedParty = await loadPartyForRuntime(db, partyId);
    if (!storedParty || !player.authorized) return;
    const authoredAdventure = await loadAdventure(
      db,
      storedParty.hostAccountId,
      storedParty.adventureId,
    );
    const link = authoredAdventure?.graph.links.find(
      (candidate) => candidate.mapId === this.#location?.zoneId && candidate.exitId === exitId,
    );
    if (!authoredAdventure || !link) {
      this.#send(ws, { t: "event", code: "zone.transition_denied", tone: "bad" });
      return;
    }

    player.transitioning = true;
    player.lastTransitionAt = now;
    player.lastInput = NO_INPUT;
    player.queue = [];
    cancelCombatAction(player);
    removeProjectilesByOwner(this.#projectiles, player.id);

    if (link.dest === "end") {
      try {
        if (!(await this.#checkpointCooldowns(player))) {
          this.#rejectStaleSave(ws, player);
          return;
        }
        if (!(await this.#savePlayer(player, ws, true))) return;
        const firstCompletion = await completeParty(db, partyId);
        if (firstCompletion) {
          await this.env.GAME_SESSION.getByName(partyId).broadcast(partyId, {
            t: "event",
            code: "adventure.victory",
            tone: "good",
          });
        }
      } finally {
        if (player.authorized) player.transitioning = false;
      }
      return;
    }

    const destinationAnchor = link.dest;
    if (!authoredAdventure.mapIds.includes(destinationAnchor.mapId)) {
      player.transitioning = false;
      this.#send(ws, { t: "event", code: "zone.transition_denied", tone: "bad" });
      return;
    }
    const destinationMap = await loadMap(db, destinationAnchor.mapId);
    const entry = destinationMap?.markers?.entries.find(
      (candidate) => candidate.id === destinationAnchor.entryId,
    );
    if (!destinationMap || !entry) {
      player.transitioning = false;
      this.#send(ws, { t: "event", code: "zone.transition_failed", tone: "bad" });
      return;
    }
    const destination = locationFromMap(destinationMap, "main");
    const spawn = clampRestoredPosition(
      {
        x: entry.col * TILE_SIZE + TILE_SIZE / 2,
        y: entry.row * TILE_SIZE + TILE_SIZE / 2,
      },
      player.id,
      destination.definition.terrain,
    );
    const destinationRoomKey = `${partyId}:${destinationMap.id}`;

    player.authorized = false;
    if (!(await this.#checkpointCooldowns(player))) {
      this.#rejectStaleSave(ws, player);
      return;
    }
    const saved = await this.#savePlayer(player, ws, true);
    if (!saved) return;
    const next = await this.#presence(player).handoff({
      characterId: player.id,
      connectionId: player.connectionId,
      sessionEpoch: player.sessionEpoch,
      sourceRoomKey: player.roomKey,
      destinationRoomKey,
      zoneId: destinationMap.id,
      instanceId: "main",
      x: spawn.x,
      y: spawn.y,
    });
    if (!next) {
      this.#rejectStaleSave(ws, player);
      return;
    }
    player.disconnecting = true;
    this.#removePlayer(ws, player);
    this.#observability.transitions += 1;
    this.#send(ws, { t: "event", code: "zone.transition", tone: "good" });
    try {
      ws.close(WS_CLOSE.ZONE_TRANSITION, "adventure map transition");
    } catch {
      // The fenced destination is already durable; reconnect resumes there.
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
  #resurrectNearbyCorpse(
    ws: WebSocket,
    player: Player,
    now: number,
  ): { handled: boolean; cooldownStarted: boolean } {
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
    if (!target || !targetSocket) return { handled: false, cooldownStarted: false };

    // Only now that we know a body is in reach is it worth telling a warrior he cannot help.
    if (!heal) {
      this.#send(ws, { t: "event", code: "resurrect.not_priest", tone: "info" });
      return { handled: true, cooldownStarted: false };
    }
    if (now - player.lastResurrectAt < RESURRECT_COOLDOWN_MS) {
      this.#send(ws, { t: "event", code: "resurrect.nobody", tone: "info" });
      return { handled: true, cooldownStarted: false };
    }

    player.lastResurrectAt = now;
    target.life = "alive";
    target.corpse = null;
    target.hp = resurrectHp(target.level);
    this.#grantReviveGrace(target, now);
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
    return { handled: true, cooldownStarted: true };
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
      // Hero inventory is intentionally session-only in this slice. Core hero stats are still
      // fenced and persisted; inventory will move to its own normalized boundary later.
      if (player.identityKind === "hero") return player.inventory.potions - 1;
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
        try {
          await this.#presence(player).release(player.connectionId, player.sessionEpoch);
        } catch (error) {
          // A completed fenced save is still safe if the best-effort lease release fails: the
          // short lease expires and a later acquisition advances the D1 epoch. Do not turn an RPC
          // teardown/network failure during WebSocket close into an unhandled DO exception.
          console.warn(
            JSON.stringify({
              event: "presence_release_failed",
              identityKind: player.identityKind,
              error: error instanceof Error ? error.message : "unknown",
            }),
          );
        }
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
        loadProfile: (id) => this.#loadProfile(id, player.identityKind),
        saveProfile: (profile) => this.#saveProfile(player, profile),
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

  #checkpointCooldowns(player: Player): Promise<boolean> {
    return this.#presence(player).checkpointCooldowns(
      player.connectionId,
      player.sessionEpoch,
      combatCooldownsFromPlayer(player),
    );
  }

  async #checkpointCooldownsOrReject(ws: WebSocket, player: Player): Promise<boolean> {
    const accepted = await this.#checkpointCooldowns(player);
    if (!accepted) this.#rejectStaleSave(ws, player);
    return accepted;
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
      presenceHeartbeatMs: this.#presenceHeartbeatMs,
      writeAttachment,
      writeD1,
      waitUntil: (promise) => this.ctx.waitUntil(promise),
      renewPresence: (player) => this.#renewPresence(player),
      reclaimCorpse: (socket, player) => this.#reclaimCorpse(socket, player),
      collectLoot: (socket, player) => this.#collectLoot(socket, player),
      savePlayer: (player, socket) => this.#savePlayer(player, socket),
    });
    this.#detectAdventureExits(now);
    advanceCombatActions(this.#players.values(), now, (player, action) =>
      this.#resolvePlayerAction(player, action, now),
    );
    advanceProjectiles(
      {
        projectiles: this.#projectiles,
        terrain: this.#zone().terrain,
        monsters: this.#monsters,
        players: this.#players,
        monsterGrid: this.#monsterGrid,
        playerGrid: this.#playerGrid,
        canHeal: (owner, target) => this.#areCombatAllies(owner, target),
        damageMonster: (projectile, monster, impactAt) =>
          this.#projectileDamage(projectile, monster, impactAt),
        healPlayer: (projectile, socket, target, impactAt) =>
          this.#projectileHeal(projectile, socket, target, impactAt),
        blocked: (projectile, point) => this.#projectileBlocked(projectile, point),
      },
      now,
    );
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
      startAttack: (monster: Monster, target: Player, attackedAt: number) =>
        this.#startMonsterAttack(monster, target, attackedAt),
    };
    advanceMonsters(monsterContext, now);
    advanceCombatActions(this.#monsters, now, (monster, action) =>
      this.#resolveMonsterAction(monster, action, now),
    );
    advanceGuards(monsterContext, now);
    processExpiredLoot(this.#loot, this.#lootGrid, now);
    if (this.#tick % NETWORK_TICKS_PER_SNAPSHOT === 0) {
      this.#sendWorldDeltas();
      const context = this.#partyContext();
      for (const party of this.#parties.values()) broadcastPartyStateIfChanged(context, party);
      this.#broadcastHeroPartyStates();
    }
    this.#flushQueuedResyncs(now);
  }

  #detectAdventureExits(now: number): void {
    const exits = this.#zone().markers?.exits ?? [];
    if (exits.length === 0) return;
    for (const [socket, player] of this.#players) {
      if (
        player.identityKind !== "hero" ||
        player.life !== "alive" ||
        !player.authorized ||
        player.transitioning
      ) {
        this.#occupiedExitByPlayerId.delete(player.id);
        continue;
      }
      const col = Math.floor(player.x / TILE_SIZE);
      const row = Math.floor(player.y / TILE_SIZE);
      const exit = exits.find((candidate) => candidate.col === col && candidate.row === row);
      if (!exit) {
        this.#occupiedExitByPlayerId.delete(player.id);
        continue;
      }
      const key = `${this.#location?.zoneId ?? ""}:${exit.id}`;
      if (
        this.#occupiedExitByPlayerId.get(player.id) === key ||
        now - player.lastTransitionAt < 750
      ) {
        continue;
      }
      this.#occupiedExitByPlayerId.set(player.id, key);
      this.ctx.waitUntil(this.#transitionAdventureExit(socket, player, exit.id, now));
    }
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
    const renewed = await this.#presence(player).renew(player.connectionId, player.sessionEpoch);
    if (renewed || !player.authorized) return;
    await this.invalidatePresence(
      player.id,
      player.connectionId,
      WS_CLOSE.PRESENCE_LOST,
      "presence expired",
    );
  }

  #projectileOwner(projectile: Projectile): { socket: WebSocket; player: Player } | null {
    const socket = this.#socketByPlayerId.get(projectile.ownerId);
    const player = socket ? this.#players.get(socket) : undefined;
    if (
      !socket ||
      !player?.authorized ||
      player.transitioning ||
      player.roomKey !== projectile.roomKey ||
      player.partyId !== projectile.ownerPartyId
    )
      return null;
    return { socket, player };
  }

  #projectileDamage(projectile: Projectile, monster: Monster, now: number): void {
    const owner = this.#projectileOwner(projectile);
    if (!owner || !canAct(owner.player.life)) return;
    const skill = CLASS_SKILLS[owner.player.class].find(
      (candidate) => candidate.id === projectile.sourceSkillId,
    );
    if (!skill) return;
    this.#damageMonster(
      owner.socket,
      owner.player,
      monster,
      skill,
      now,
      projectile.basic,
      projectile.power,
    );
  }

  #projectileHeal(
    projectile: Projectile,
    targetSocket: WebSocket,
    target: Player,
    now: number,
  ): void {
    const owner = this.#projectileOwner(projectile);
    if (!owner || !canAct(owner.player.life) || !this.#areCombatAllies(owner.player, target))
      return;
    this.#healPlayer(
      owner.socket,
      owner.player,
      targetSocket,
      target,
      projectile.power,
      now,
      false,
    );
  }

  #projectileBlocked(projectile: Projectile, point: Vec2): void {
    const owner = this.#projectileOwner(projectile);
    if (!owner) return;
    this.#send(owner.socket, {
      t: "event",
      code: "skill.blocked",
      params: { skill: projectile.sourceSkillId },
      tone: "info",
      x: point.x,
      y: point.y,
    });
  }

  #startMonsterAttack(monster: Monster, target: Player | Guard, now: number): void {
    if (monster.deadUntil > now || monster.action) return;
    const definition = MONSTER_ACTIONS[monster.species];
    const direction = normalizeDirection(
      { x: target.x - monster.x, y: target.y - monster.y },
      monster.facing,
    );
    monster.facing = direction;
    const action = startCombatAction(monster, {
      kind: "monster_attack",
      direction,
      now,
      anticipationMs: definition.anticipationMs,
      recoveryMs: definition.recoveryMs,
    });
    if (!action) return;
    this.#sendSpatialEvent(
      {
        t: "animation",
        actionId: action.id,
        actorKind: "monster",
        actorId: monster.id,
        action: "attack",
        direction: { ...action.direction },
        startedAt: action.startedAt,
        impactAt: action.impactAt,
        recoveryEndsAt: action.recoveryEndsAt,
      },
      monster,
    );
  }

  #resolveMonsterAction(monster: Monster, action: CombatActionRuntime, now: number): void {
    if (monster.deadUntil > now) return;
    const definition = MONSTER_ACTIONS[monster.species];
    const origin = { x: monster.x + PLAYER_SIZE / 2, y: monster.y + PLAYER_SIZE / 2 };
    const hitbox = strikeCapsule(
      origin,
      action.direction,
      definition.range,
      definition.hitboxRadius,
    );
    for (const [socket, player] of this.#players) {
      if (
        !player.authorized ||
        player.life !== "alive" ||
        player.transitioning ||
        !circleIntersectsCapsule(
          {
            center: { x: player.x + PLAYER_SIZE / 2, y: player.y + PLAYER_SIZE / 2 },
            radius: PLAYER_SIZE / 2,
          },
          hitbox,
        ) ||
        !hasLineOfSight(monster, player, this.#zone().terrain.tiles)
      )
        continue;
      this.#damagePlayer(socket, player, monster.damage, monster.species, monster.id, now);
    }
    for (const guard of this.#guards) {
      if (
        !circleIntersectsCapsule(
          {
            center: { x: guard.x + PLAYER_SIZE / 2, y: guard.y + PLAYER_SIZE / 2 },
            radius: PLAYER_SIZE / 2,
          },
          hitbox,
        ) ||
        !hasLineOfSight(monster, guard, this.#zone().terrain.tiles)
      )
        continue;
      // Guards remain service NPCs in V1, so combat may wound but never kill them.
      guard.hp = Math.max(1, guard.hp - monster.damage);
    }
  }

  #damagePlayer(
    ws: WebSocket,
    player: Player,
    damage: number,
    species: MonsterSpecies,
    monsterId: string,
    now: number,
  ): void {
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
    cancelCombatAction(player);
    removeProjectilesByOwner(this.#projectiles, player.id);
    player.dirty = true;
  }

  /** A nearby monster may have an attack ready after waiting over the corpse. Restart that
   * cooldown so the authoritative resurrection state is observable before combat resumes. */
  #grantReviveGrace(player: Player, now: number): void {
    for (const monster of this.#monsters) {
      if (pointDistance(monster, player) <= MONSTER_AGGRO_RANGE) {
        monster.lastAttackAt = Math.max(monster.lastAttackAt, now);
      }
    }
  }

  /** Release is one-way and deliberate. It is what closes the door on a priest saving you. */
  #release(ws: WebSocket, player: Player): void {
    if (player.life !== "corpse" || player.corpse === null) return;
    const cemetery =
      player.identityKind === "hero"
        ? (this.#zone().terrain.spawnPoints[0] ?? nearestCemetery(player.corpse))
        : nearestCemetery(player.corpse);
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
    this.#grantReviveGrace(player, Date.now());
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
        projectiles: this.#projectiles,
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
    // `newPlayer` arms the first heartbeat against the compiled-in default because it is pure and
    // has no `Env`. The room owns the real clock, so re-arm here — the one place both admission
    // and hibernation restore funnel through.
    player.nextPresenceHeartbeatAt = Date.now() + this.#presenceHeartbeatMs;
    if (player.partyId !== null) this.#heroPartyId = player.partyId;
    addPlayer(this.#players, this.#socketByPlayerId, this.#playerGrid, ws, player);
  }

  #removePlayer(ws: WebSocket, player: Player): void {
    this.#occupiedExitByPlayerId.delete(player.id);
    cancelCombatAction(player);
    removeProjectilesByOwner(this.#projectiles, player.id);
    removePlayerFromParties(this.#partyContext(), player.id);
    removePlayerCombatState(this.#monsters, player.id);
    removePlayer(this.#players, this.#socketByPlayerId, this.#playerGrid, ws, player);
    if (this.#players.size === 0) this.#unloadEmptyRoom();
  }

  #unloadEmptyRoom(): void {
    // The party coordinator owns the adventure-state save. Tell it this room emptied so it can
    // flush on party-empty. Fire-and-forget through the same GameSession -> World RPC seam that
    // carries party chat/victory, only in the other direction; a catalogue/character room has no
    // party and nothing to report.
    if (this.#heroPartyId !== null && this.#location !== null) {
      const partyId = this.#heroPartyId;
      const roomKey = this.#location.roomKey;
      this.ctx.waitUntil(this.env.GAME_SESSION.getByName(partyId).roomEmptied(partyId, roomKey));
    }
    this.#stopLoop();
    this.#loot = [];
    this.#projectiles = [];
    this.#lootGrid.clear();
    this.#siteRespawnAt.clear();
    this.#parties.clear();
    this.#partyByPlayerId.clear();
    this.#partyInvites.clear();
    this.#heroPartyBroadcasts.clear();
    this.#monsters = this.#location ? createMonsters(this.#location.definition.monsters) : [];
    this.#guards = this.#location ? createGuards(this.#location.definition.guards) : [];
    this.#monsterGrid.clear();
    for (const monster of this.#monsters) this.#monsterGrid.insert(monster);
    this.#navigation = this.#location
      ? createNavigationRuntime(
          this.#location.definition.terrain,
          this.#location.definition.navigation,
        )
      : null;
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
