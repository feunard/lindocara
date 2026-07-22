/**
 * One authoritative MMO room. Clients send movement/action intent; this Durable Object alone
 * moves entities, applies damage, grants loot/XP, advances quests, and persists player profiles.
 */
import { DurableObject } from "cloudflare:workers";
import {
  type AdventureRegistry,
  type AuthoredQuestProgress,
  activePageIndex,
  authoredQuestTrackers,
  EMPTY_ADVENTURE_STATE,
  EMPTY_REGISTRY,
  type PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import { parseCheatCommand } from "@lindocara/engine/cheats.js";
import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import { flattenColliderIndex } from "@lindocara/engine/collider.js";
import {
  actionForClassSlot,
  LUMEN_STEP_MAX_HOLD_MS,
  MONSTER_ACTIONS,
} from "@lindocara/engine/combat-actions.js";
import {
  CONSUMABLE_COOLDOWN_MS,
  CONSUMABLE_MAX_STACK,
  CONSUMABLES,
  type ConsumableId,
  isConsumableId,
  normalizeConsumables,
} from "@lindocara/engine/consumables.js";
import {
  addThreat,
  isMeaningfulContribution,
  REWARD_DISTANCE,
  recordContribution,
  splitExperience,
  tauntThreat,
  usefulHealingThreat,
} from "@lindocara/engine/cooperation.js";
import {
  CORPSE_RECLAIM_RANGE,
  canAct,
  canBeResurrected,
  RESURRECT_COOLDOWN_MS,
  resurrectHp,
} from "@lindocara/engine/death.js";
import {
  circleIntersectsArc,
  circleIntersectsCapsule,
  firstSegmentImpact,
  frontalArc,
  normalizeDirection,
  strikeCapsule,
  sweptProjectileEntityImpact,
  sweptProjectileTerrainImpact,
} from "@lindocara/engine/directional-combat.js";
import { DIALOGUE_CLOSE_RADIUS, type EventCommand } from "@lindocara/engine/event-commands.js";
import type { StateMutation } from "@lindocara/engine/event-interpreter.js";
import {
  applyDamage,
  applyExperience,
  attackDamageFor,
  CEMETERIES,
  CLASS_STATS,
  clampRestoredPosition,
  hasLineOfSight,
  INTERACTION_RANGE,
  isWalkable,
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
} from "@lindocara/engine/game.js";
import {
  LOCAL_CHAT_RADIUS,
  SPATIAL_CELL_SIZE,
  SPATIAL_EVENT_RADIUS,
} from "@lindocara/engine/interest.js";
import {
  type EventTrigger,
  eventCellCentre,
  exitEvents,
  type MapEvent,
} from "@lindocara/engine/map-events.js";
import { merchantForRuntimeRoom } from "@lindocara/engine/merchant.js";
import {
  type ClientMessage,
  encodeServerMessage,
  type ProjectileSnapshot,
  parseClientMessage,
  type SelfState,
  type ServerMessage,
  type WorldView,
} from "@lindocara/engine/protocol.js";
import type { QuestActor, QuestBusinessEvent } from "@lindocara/engine/quest-runtime.js";
import {
  canSpendResource,
  generateResource,
  skillResourceCost,
  spendResource,
} from "@lindocara/engine/resources.js";
import {
  NETWORK_TICKS_PER_SNAPSHOT,
  NO_INPUT,
  PLAYER_SIZE,
  TICK_MS,
  type Vec2,
} from "@lindocara/engine/simulation.js";
import {
  CLASS_SKILLS,
  isSkillUnlocked,
  SKILL_UNLOCK_LEVEL,
  type SkillDefinition,
  type SkillSlot,
} from "@lindocara/engine/skills.js";
import {
  evolvedTalent,
  skillWithTalents,
  talentEffect,
  talentEffects,
  unlockTalent,
} from "@lindocara/engine/talents.js";
import { emptyLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { encodeTileMap } from "@lindocara/engine/tilemap-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { editorAsset } from "@lindocara/engine/tiny-swords-catalog.js";
import { replaceWorldCache, seedEventCache } from "@lindocara/engine/world-delta.js";
import {
  isKnownZone,
  isValidInstanceId,
  type PortalDefinition,
  resolveZoneLocation,
  type ZoneDefinition,
  type ZoneLocation,
} from "@lindocara/engine/zones.js";
import { eq } from "drizzle-orm";
import { loadAdventure } from "./adventures.js";
import { claimQuestReward, consumeOwnedItem } from "./character-persistence.js";
import { presenceTiming } from "./character-presence.js";
import { createDb, party } from "./db/index.js";
import {
  claimHeroQuestReward,
  consumeHeroOwnedItem,
  loadHeroAuthoredQuestProgress,
} from "./hero-persistence.js";
import { loadHeroProfile, saveHeroProfile } from "./hero-profile.js";
import { HEALTH_POTION_ID } from "./items.js";
import { BUILTIN_MAP, BUILTIN_MAP_ID, loadMap } from "./maps.js";
import { completeParty, loadPartyForRuntime } from "./parties.js";
import { loadProfile, saveProfile } from "./profile.js";
import { executeCheatCommand } from "./world/cheat-command-system.js";
import {
  advanceCombatActions,
  cancelCombatAction,
  finishHeldCombatAction,
  startCombatAction,
} from "./world/combat-action-system.js";
import { guardedDamage, isPlayerInvulnerable } from "./world/combat-system.js";
import { addPlayer, isRateLimited, removePlayer } from "./world/connection-system.js";
import {
  beginRewardAttribution,
  clearMonsterCombat,
  removePlayerCombatState,
} from "./world/contribution-system.js";
import {
  abortRunForEvent,
  abortRunsForHero,
  advanceRun,
  chooseRun,
  closeDistantDialogues,
  createEventRunRuntime,
  type DispatchEffect,
  drainRuns,
  type EventRunRuntime,
  resetEventRunRuntime,
  startRun,
} from "./world/event-run-system.js";
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
import {
  heldMovementDirection,
  movePlayerInDirection,
  nearestChargeTarget,
} from "./world/skill-system.js";
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
  #adventureRegistry: AdventureRegistry = EMPTY_REGISTRY;
  /**
   * The monotone version of `#adventureState` (spec Decision 1). Rooms may receive coordinator
   * pushes out of order, so `installAdventureState` keeps a snapshot only when its version is `>=`
   * this one and drops a stale push. Starts at 0; the first install lands at the coordinator's
   * current version and a hibernation pull carries the version it read.
   */
  #adventureStateVersion = 0;
  /**
   * The events whose active page currently holds, re-derived only on snapshot install and hero
   * join — never per tick. Appearance-only and nothing reads it yet; Task 4 puts it on the wire.
   */
  #activeEvents: readonly ActiveWorldEvent[] = [];
  /** The room's live event runs: the one-run-per-event lock, the budgeted drain and the buffered
   *  dialogue seam (`world/event-run-system.ts`). Cleared when the room empties. */
  #eventRuns: EventRunRuntime = createEventRunRuntime();
  /**
   * A mutation batch whose coordinator push has not completed yet. Simulation keeps ticking while
   * this is set, but event runs pause so their next drain cannot seed its working copy from a stale
   * pre-mutation snapshot and replay non-idempotent `add` operations.
   */
  #eventStateSync: Promise<void> | null = null;
  /** The party this hero room belongs to, learned at admission. `null` for catalogue/character
   *  rooms. Used only to tell the coordinator when the room has emptied. */
  #heroPartyId: string | null = null;
  /**
   * The retained coordinator stub for this room's party. Cloudflare guarantees calls on ONE stub are
   * delivered in the order made (E-order); calls on DIFFERENT stubs to the same object have no
   * ordering guarantee. Mutation batches carry non-commutative ops (`set` vs `add`), so a fresh
   * `getByName` per tick could deliver two ticks' batches out of order and corrupt a variable. Keep a
   * single stub per party and reuse it for every ordered coordinator call.
   */
  #gameSessionStub: ReturnType<Env["GAME_SESSION"]["getByName"]> | null = null;
  /** Cross-map authored teleport handoffs launched this room lifetime — the Fix-3 observable: a
   *  synchronous `transitioning` claim makes back-to-back cross-map teleports launch exactly one. */
  #crossMapTeleports = 0;
  /** (eventId, reason) pairs already logged for a refused authored teleport, so an authored
   *  `loop { teleport <unwalkable> }` warns ONCE per pair per room lifetime rather than every tick
   *  (the observability law forbids per-event tick logging). Reset when the room empties. */
  #teleportRefusalsLogged = new Set<string>();
  /** (eventId, itemId, reason) triples already logged for a refused authored `changeItems`, so an
   *  authored `loop { changeItems <unknown> +1 }` warns ONCE per triple per room lifetime, not every
   *  tick. Reset when the room empties, beside `#teleportRefusalsLogged`. */
  #itemRefusalsLogged = new Set<string>();
  /** (eventId, reason) pairs already logged for a refused authored `changeGold`, mirroring
   *  `#teleportRefusalsLogged`. Currently the only reason is a grant landing mid cross-map handoff.
   *  Reset when the room empties. */
  #goldRefusalsLogged = new Set<string>();
  /** Set once an authored `endAdventure` command has marked the party's save complete, so an author's
   *  `loop { endAdventure }` (or a re-trigger) never hammers `completeParty`/the victory broadcast more
   *  than once per room lifetime. Reset when the room empties, beside `#teleportRefusalsLogged`. */
  #adventureEndDispatched = false;
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
      // Hibernation restore reconstructs the room from its sockets without going through
      // `GameSession.fetch`, so no snapshot push happens on wake. Pull the party's held state from
      // the coordinator — the single writer, whose copy can be newer than D1's debounced row and is
      // never a second storage cache — and re-evaluate the active events against it. `#restoreWebSocket`
      // set `#heroPartyId` via `#addPlayer`; a catalogue/character room has none and keeps the empty state.
      if (this.#heroPartyId !== null && this.#location !== null) {
        const partyId = this.#heroPartyId;
        try {
          const held = await this.env.GAME_SESSION.getByName(partyId).getAdventureState(partyId);
          this.#adventureState = held.state;
          this.#adventureStateVersion = held.version;
          this.#adventureRegistry = held.registry;
          this.#evaluateActiveEvents();
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "world_adventure_state_restore_failed",
              partyId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          this.#recoverEventsAfterFailedStateRestore();
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
    if (identityKind === "hero") {
      profile.authoredQuestProgress = await loadHeroAuthoredQuestProgress(
        createDb(this.env.DB),
        profile.id,
      );
    }
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
    player.consumableCooldownUntil = attachment.consumableCooldownUntil ?? 0;
    player.damageBoostUntil = attachment.damageBoostUntil ?? 0;
    player.forgottenUntil = attachment.forgottenUntil ?? 0;
    player.invisibleUntil = attachment.invisibleUntil ?? 0;
    player.resurrectionAt = attachment.resurrectionAt ?? 0;
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

    // Arrival is a gameplay fact, not a client claim. Reconnects are harmless: reach objectives
    // clamp at one and every accepted progress row deduplicates the server-minted event.
    this.#recordActorQuestEvent(player, ({ id: eventId, mapId, actor }) => ({
      id: eventId,
      mapId,
      actor,
      type: "mapEntered",
    }));

    // Join-time page evaluation: the map's events are only known once the room is configured (the
    // first join), and a snapshot the coordinator pushed before that configuration could not be
    // evaluated yet. Re-derive now against whatever snapshot the room holds. Off the tick loop.
    this.#evaluateActiveEvents();

    const initialView = this.#worldView(player);
    replaceWorldCache(player.network, initialView);
    // Seed this recipient's events baseline to the full active set so its first `world.delta`
    // diffs against what the welcome actually carried, not an empty cache.
    seedEventCache(player.network, this.#activeEvents);
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
        // The other half of baked collision: sub-cell rectangles a tile grid cannot express (a
        // tree's trunk, not its cell). Flattened once here so the client rebuilds its own index
        // from exactly what was baked, rather than re-deriving it from `elements`.
        colliders: flattenColliderIndex(location.definition.terrain.colliders),
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
        // The active page of each authored event, appearance only — evaluated just above at join.
        // A catalogue zone has none; a D1 map's are re-derived against the party's state snapshot.
        events: this.#activeEvents,
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
        merchant: merchantForRuntimeRoom(),
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
  async installAdventureState(
    partyId: string,
    state: PartyAdventureState,
    version: number,
    registry: AdventureRegistry = EMPTY_REGISTRY,
  ): Promise<void> {
    if (this.#heroPartyId !== null && this.#heroPartyId !== partyId) return;
    // The `>=` guard (kept as `version < current -> drop`): rooms may receive pushes out of order,
    // so an older-versioned snapshot is dropped and the newer one held. Never throws — this path
    // gates admission (`GameSession.fetch` awaits it), so a throw would block a hero from joining.
    if (version < this.#adventureStateVersion) return;
    this.#adventureStateVersion = version;
    this.#adventureState = state;
    this.#adventureRegistry = registry;
    // Abort BEFORE re-evaluation: a flip that changes an event's active page must kill that event's
    // run so no zombie context keeps executing the page it was reading (XP's behaviour). Ordering
    // the abort ahead of `#evaluateActiveEvents` is what the zombie test pins.
    this.#abortRunsForStalePages();
    this.#evaluateActiveEvents();
    for (const [socket, player] of this.#players) {
      if (player.identityKind === "hero" && player.partyId === partyId && player.authorized) {
        this.#sendState(socket, player);
      }
    }
  }

  /** Personal quest progress is already epoch-fenced in D1 before this best-effort UI push. */
  async installPersonalQuestProgress(
    partyId: string,
    heroId: string,
    progress: Readonly<Record<string, AuthoredQuestProgress>>,
  ): Promise<void> {
    if (this.#heroPartyId !== null && this.#heroPartyId !== partyId) return;
    const socket = this.#socketByPlayerId.get(heroId);
    const player = socket ? this.#players.get(socket) : undefined;
    if (
      !socket ||
      !player?.authorized ||
      player.identityKind !== "hero" ||
      player.partyId !== partyId
    ) {
      return;
    }
    player.authoredQuestProgress = { ...progress };
    this.#sendState(socket, player);
  }

  /** Kill any run whose event's active page no longer matches the page the run started on (the state
   *  just changed under it). An event that went dormant (no page holds) aborts too. */
  #abortRunsForStalePages(): void {
    const events = this.#location?.definition.events ?? [];
    for (const [eventId, context] of [...this.#eventRuns.contexts]) {
      const event = events.find((candidate) => candidate.id === eventId);
      const active = event ? activePageIndex(event, this.#adventureState) : null;
      if (active !== context.pageIndex) abortRunForEvent(this.#eventRuns, eventId);
    }
  }

  /**
   * The active page of a `normal` event carrying a runnable program under `trigger`, or null. Only a
   * satisfied active page (the exact page `#evaluateActiveEvents` would show) with a non-empty
   * program can fire — a blank appearance-only event is not a script.
   */
  #runnablePage(
    event: MapEvent,
    trigger: EventTrigger,
  ): { pageIndex: number; program: readonly EventCommand[] } | null {
    if (event.kind !== "normal") return null;
    const pageIndex = activePageIndex(event, this.#adventureState);
    if (pageIndex === null) return null;
    const page = event.pages[pageIndex];
    if (page === undefined || page.trigger !== trigger || page.commands.length === 0) return null;
    return { pageIndex, program: page.commands };
  }

  /**
   * The interact-key trigger: the nearest `action` event within `INTERACTION_RANGE` starts a run.
   * Returns true when an action event was FOUND (so `#interact` stops here even if the run was
   * dropped by the one-run lock) — an interact spent on an event is not a fall-through to the quest
   * NPCs. Placement in `#interact`: after the corpse resurrection (a life-critical revive still wins)
   * and before the legacy quest-site/giver dispatch — authored events are the general mechanism, the
   * hardcoded quest keepers are catalogue-zone content that never coexists with authored events.
   */
  #triggerActionEventNearby(player: Player): boolean {
    if (player.identityKind !== "hero") return false;
    const events = this.#location?.definition.events ?? [];
    let best: {
      event: MapEvent;
      pageIndex: number;
      program: readonly EventCommand[];
      distance: number;
    } | null = null;
    for (const event of events) {
      const runnable = this.#runnablePage(event, "action");
      if (runnable === null) continue;
      const distance = pointDistance(player, eventCellCentre(event));
      if (distance > INTERACTION_RANGE) continue;
      if (best === null || distance < best.distance) best = { event, ...runnable, distance };
    }
    if (best === null) return false;
    const started = startRun(this.#eventRuns, {
      event: best.event,
      pageIndex: best.pageIndex,
      program: best.program,
      heroId: player.id,
      runId: crypto.randomUUID(),
    });
    if (started) {
      const graphic = best.event.pages[best.pageIndex]?.graphicAssetId;
      const interaction =
        graphic != null && editorAsset(graphic)?.domain === "character"
          ? "npcTalked"
          : "objectInteracted";
      this.#recordActorQuestEvent(player, ({ id, mapId, actor }) =>
        interaction === "npcTalked"
          ? { id, mapId, actor, type: "npcTalked", targetEventId: best.event.id }
          : { id, mapId, actor, type: "objectInteracted", targetEventId: best.event.id },
      );
    }
    return true;
  }

  /**
   * The Contact-with-hero trigger, evaluated on the movement edge (from `movement-system`'s
   * `onPlayerMoved`), not by a per-tick scan: when a hero's box enters a NEW cell that carries a
   * runnable `player-touch` event, its run starts. Standing still on the cell does not re-fire (no
   * move, no callback); the one-run lock covers a re-entry while the run lives.
   */
  #detectPlayerTouch(player: Player, previous: { x: number; y: number }): void {
    if (player.identityKind !== "hero" || player.life !== "alive" || !player.authorized) return;
    const events = this.#location?.definition.events;
    if (!events || events.length === 0) return;
    const col = Math.floor(player.x / TILE_SIZE);
    const row = Math.floor(player.y / TILE_SIZE);
    if (col === Math.floor(previous.x / TILE_SIZE) && row === Math.floor(previous.y / TILE_SIZE)) {
      return;
    }
    const event = events.find(
      (candidate) => candidate.kind === "normal" && candidate.col === col && candidate.row === row,
    );
    if (event === undefined) return;
    const runnable = this.#runnablePage(event, "player-touch");
    if (runnable === null) return;
    startRun(this.#eventRuns, {
      event,
      pageIndex: runnable.pageIndex,
      program: runnable.program,
      heroId: player.id,
      runId: crypto.randomUUID(),
    });
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
      // Only `normal` events have an appearance. Entry/exit/monster events (UX wave #12) are
      // anchors/spawns consumed elsewhere (heroes/index start, exit detection, `zoneFromMap`
      // monsters); they never become a drawn world event.
      if (event.kind !== "normal") continue;
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

  /**
   * The hibernation-restore recovery when the coordinator pull throws: fall back to the safe EMPTY
   * snapshot and re-derive the active events from it, so always-on events (pages with no conditions)
   * survive a failed pull instead of the room waking with no events at all. Extracted so the test
   * seam below can exercise it — a ticking World cannot be evicted (`evictDurableObject` hangs on its
   * `setInterval`), so the real constructor restore path is not reachable end-to-end in a test.
   */
  #recoverEventsAfterFailedStateRestore(): void {
    this.#adventureState = EMPTY_ADVENTURE_STATE;
    this.#adventureRegistry = EMPTY_REGISTRY;
    this.#evaluateActiveEvents();
  }

  /** Test seam standing in for the unreachable evict/restore: runs the exact recovery the
   *  constructor's failed-pull catch runs. */
  async recoverEventsAfterFailedStateRestoreForTest(): Promise<void> {
    this.#recoverEventsAfterFailedStateRestore();
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
    monsters: {
      id: string;
      species: MonsterSpecies;
      patrolRadius: number;
      threat: { playerId: string; amount: number }[];
    }[];
    projectiles: { id: string; ownerId: string; kind: ProjectileSnapshot["kind"] }[];
    pendingSaves: number;
    tickActive: boolean;
    adventureState: PartyAdventureState;
    adventureStateVersion: number;
    /** Cross-map authored teleport handoffs launched this room lifetime — the Fix-3 observable that a
     *  back-to-back cross-map teleport claims the transition synchronously and launches exactly one. */
    crossMapTeleports: number;
    activeEvents: readonly ActiveWorldEvent[];
    /** The live event runs — the run/lock diagnostics seam. Dialogue itself now rides the wire
     *  (Task 4's `event.say`/`choices`/`close`); tests assert conversations off the client. */
    eventRuns: { eventId: string; runId: string; heroId: string; status: string }[];
  }> {
    return {
      roomKey: this.#location?.roomKey ?? null,
      playerIds: [...this.#players.values()].filter((player) => player.authorized).map((p) => p.id),
      monsters: this.#monsters.map((monster) => ({
        id: monster.id,
        species: monster.species,
        patrolRadius: monster.patrolRadius,
        threat: [...monster.threat.values()].map(({ playerId, amount }) => ({ playerId, amount })),
      })),
      projectiles: this.#projectiles.map((projectile) => ({
        id: projectile.id,
        ownerId: projectile.ownerId,
        kind: projectile.kind,
      })),
      pendingSaves: this.#profileSaves.size,
      tickActive: this.#loop !== null,
      adventureState: this.#adventureState,
      adventureStateVersion: this.#adventureStateVersion,
      crossMapTeleports: this.#crossMapTeleports,
      activeEvents: this.#activeEvents,
      eventRuns: [...this.#eventRuns.contexts.entries()].map(([eventId, context]) => ({
        eventId,
        runId: context.runId,
        heroId: context.heroId,
        status: context.status,
      })),
    };
  }

  /** Task-4 seam: resume a `say`/`choices` run from the dialogue intents (validated hero==triggerer,
   *  choice index re-derived from the command). Exposed now so the run system is complete; the wire
   *  that calls these lands in Task 4. */
  async advanceEventRunForTest(heroId: string, runId: string): Promise<boolean> {
    return advanceRun(this.#eventRuns, heroId, runId);
  }

  async chooseEventRunForTest(heroId: string, runId: string, index: number): Promise<boolean> {
    return chooseRun(this.#eventRuns, heroId, runId, index);
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
    if (message.t === "talent.unlock") {
      const result = unlockTalent(player.class, player.level, player.talents, message.nodeId);
      if (!result.ok) {
        this.#send(ws, {
          t: "event",
          code: "talent.invalid",
          params: { reason: result.reason },
          tone: "bad",
        });
        return;
      }
      player.talents = result.selected;
      if (player.guarding) {
        player.guardReduction = skillWithTalents(player.class, player.talents, 2).reduction ?? 0;
        player.guardActivatedAt = 0;
      }
      player.dirty = true;
      this.#sendState(ws, player);
      this.#send(ws, {
        t: "event",
        code: "talent.unlocked",
        params: { talent: message.nodeId },
        tone: "good",
      });
      return;
    }
    if (message.t === "talent.reset") {
      player.talents = [];
      if (player.guarding) {
        player.guardReduction = skillWithTalents(player.class, player.talents, 2).reduction ?? 0;
        player.guardActivatedAt = 0;
      }
      player.dirty = true;
      this.#sendState(ws, player);
      this.#send(ws, { t: "event", code: "talent.reset", tone: "good" });
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
    if (message.t === "skill.release") {
      this.#finishHeldPlayerAction(ws, player, Date.now(), message.slot);
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
    // The resurrection draught is the only item intentionally usable while lying as a corpse.
    // The server still validates the exact life state and owns the delayed outcome.
    if (message.t === "item.use") {
      await this.#useConsumable(ws, player, message.item);
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
    // The two dialogue intents (cheap intents, the connection window cost class). Both are validated
    // hero==triggerer inside `advanceRun`/`chooseRun`, and `chooseRun` re-derives and range-checks the
    // option from the live pending offer; a stray intent from anyone else, or a wrong index, drops.
    if (message.t === "event.advance") {
      advanceRun(this.#eventRuns, player.id, message.runId);
      return;
    }
    if (message.t === "event.choose") {
      chooseRun(this.#eventRuns, player.id, message.runId, message.index);
      return;
    }
    if (message.t === "use") {
      await this.#useConsumable(ws, player, "health_potion");
      return;
    }
    if (message.t === "merchant.buy") {
      this.#buyConsumable(ws, player, message.item);
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
    const cheatCommand = parseCheatCommand(text);
    if (cheatCommand) {
      this.#handleCheatCommand(ws, player, cheatCommand);
      return;
    }
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

  #handleCheatCommand(
    ws: WebSocket,
    player: Player,
    command: NonNullable<ReturnType<typeof parseCheatCommand>>,
  ): void {
    if (this.env.CHEATS_ENABLED !== "true") {
      this.#send(ws, { t: "event", code: "cheat.disabled", tone: "bad" });
      return;
    }
    const result = executeCheatCommand(player, command);
    if (result.transition === "die") {
      player.hp = 0;
      this.#killPlayer(ws, player);
    } else if (result.transition === "ghost") {
      if (player.life === "alive") {
        player.hp = 0;
        this.#killPlayer(ws, player);
      }
      this.#release(ws, player);
    } else if (result.transition === "revive") {
      this.#cheatRevive(player);
    }
    if (result.stateChanged) this.#sendState(ws, player);
    this.#send(ws, { t: "event", ...result.event, x: player.x, y: player.y });
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

  #finishHeldPlayerAction(ws: WebSocket, player: Player, now: number, slot?: number): boolean {
    const action = player.action;
    if (!finishHeldCombatAction(player, now, slot)) return false;
    if (action?.skillId === "blink") {
      const renewal = talentEffect(player.class, player.talents, "blink_heal", 3);
      if (renewal) {
        this.#healPlayer(
          ws,
          player,
          ws,
          player,
          renewal.value + Math.max(0, player.level - 1),
          action.skillId,
          now,
          true,
        );
      }
    }
    this.#sendState(ws, player);
    return true;
  }

  #startPlayerAction(ws: WebSocket, player: Player, slot: SkillSlot): boolean {
    const skill = skillWithTalents(player.class, player.talents, slot);
    if (!isSkillUnlocked(player.level, slot)) {
      this.#send(ws, {
        t: "event",
        code: "skill.locked",
        params: { level: SKILL_UNLOCK_LEVEL[slot], skill: skill.id },
        tone: "info",
      });
      return false;
    }
    const now = Date.now();
    if (!canAct(player.life)) return false;
    if (player.guarding) {
      if (skill.id !== "iron_guard") return false;
      cancelCombatAction(player);
      player.guarding = false;
      player.guardActivatedAt = 0;
      player.skillCooldowns[slot - 1] = now + skill.cooldownMs;
      player.dirty = true;
      this.#sendState(ws, player);
      return true;
    }
    const resourceCost = skillResourceCost(player.class, slot);
    if (!canSpendResource(player.resource, resourceCost)) {
      this.#send(ws, { t: "event", code: "resource.insufficient", tone: "info" });
      return false;
    }
    if (slot === 1 && now - player.lastAttackAt < skill.cooldownMs) return false;
    if (skill.id === "mend" && now - player.lastHealAt < skill.cooldownMs) return false;
    if (slot !== 1 && (player.skillCooldowns[slot - 1] ?? 0) > now) return false;
    const definition = actionForClassSlot(player.class, slot);
    const heldDirection =
      definition.shape === "teleport" ? heldMovementDirection(player.lastInput) : null;
    const chargeTarget =
      definition.shape === "charge"
        ? nearestChargeTarget(
            player,
            this.#monsterGrid.queryRadius(player, skill.range + PLAYER_SIZE),
            skill.range,
            now,
            (monster) => hasLineOfSight(player, monster, this.#zone().terrain.tiles),
          )
        : null;
    const direction = chargeTarget
      ? normalizeDirection(
          { x: chargeTarget.x - player.x, y: chargeTarget.y - player.y },
          player.facing,
        )
      : (heldDirection ?? player.facing);
    const action = startCombatAction(player, {
      kind: slot === 1 ? "basic" : "skill",
      skillId: skill.id,
      slot,
      direction,
      now,
      anticipationMs: definition.anticipationMs,
      recoveryMs: definition.recoveryMs,
      ...(definition.shape === "teleport"
        ? {
            mobilityDistance: skill.distance ?? 0,
            channelDurationMs: LUMEN_STEP_MAX_HOLD_MS,
          }
        : {}),
    });
    if (!action) return false;

    // Attacking breaks invisibility only once the action has actually been accepted.
    player.invisibleUntil = 0;

    if (slot === 1) player.lastAttackAt = now;
    else if (skill.id !== "iron_guard") player.skillCooldowns[slot - 1] = now + skill.cooldownMs;
    if (skill.id === "mend") player.lastHealAt = now;
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
        actionId: action.id,
        actorKind: "player",
        actorId: player.id,
        action: slot === 1 ? "attack" : "skill",
        skillId: skill.id,
        ...(slot > 1 && talentEffects(player.class, player.talents, slot).length > 0
          ? { talented: true as const }
          : {}),
        ...(slot > 1 && evolvedTalent(player.class, player.talents, slot)
          ? { evolved: true as const }
          : {}),
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
    const skill = skillWithTalents(player.class, player.talents, slot as SkillSlot);
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
      player.guardUntil = 0;
      player.guarding = true;
      player.guardReduction = skill.reduction ?? 0;
      player.guardActivatedAt = now;
      player.dirty = true;
      this.#sendState(socket, player);
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
      // Lumen Step moves through ordinary authoritative input while held. The active frame only
      // completes the fade-out; release (or a server bound) controls rematerialization.
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
    if (definition.shape === "area_taunt") {
      const radius = skill.radius ?? skill.range;
      for (const monster of this.#monsterGrid.queryRadius(center, radius + PLAYER_SIZE)) {
        if (
          monster.deadUntil <= now &&
          withinRange(player, monster, radius) &&
          hasLineOfSight(player, monster, this.#zone().terrain.tiles)
        )
          this.#tauntMonster(player, monster, now);
      }
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
      this.#zone().terrain.colliders,
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
    const extraProjectiles = talentEffect(
      player.class,
      player.talents,
      "extra_projectiles",
      skill.slot,
    );
    const count = Math.max(1, (projectileDefinition.count ?? 1) + (extraProjectiles?.value ?? 0));
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
        ricochetRemaining: talentEffect(player.class, player.talents, "ricochet", skill.slot)
          ? 1
          : 0,
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
    const baseDamage =
      frozenPower ??
      (basic
        ? attackDamageFor(player.class, player.level)
        : skill.power + Math.max(0, player.level - 1) * 2);
    const damage = Math.max(
      1,
      Math.round(
        baseDamage *
          (player.damageBoostUntil > now ? 1 + CONSUMABLES.damage_elixir.effectValue : 1),
      ),
    );
    const actualDamage = Math.min(target.hp, damage);
    const result = applyDamage(target.hp, damage);
    target.hp = result.hp;
    this.#recordDamage(player, target, actualDamage, now);
    if (player.class === "warrior" && skill.id === "shield_bash")
      this.#tauntMonster(player, target, now);
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

  #tauntMonster(player: Player, target: Monster, now: number): void {
    const previous = target.threat.get(player.id)?.amount ?? 0;
    const amount = tauntThreat(target.threat, player.id, now);
    recordContribution(
      target.contributions,
      player.id,
      { relevantThreat: Math.max(0, amount - previous) },
      now,
    );
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
      if (
        this.#healPlayer(
          ws,
          player,
          targetSocket,
          target,
          amount,
          skill.id,
          now,
          target === player,
        ) > 0
      )
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
    skillId: string,
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
          skill: skillId,
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
        skill: skillId,
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
    const killer = this.#questActor(player);
    if (killer && player.partyId !== null && this.#location !== null) {
      const actorsFor = (ids: Iterable<string>): QuestActor[] => {
        const actors: QuestActor[] = [];
        for (const id of ids) {
          const socket = this.#socketByPlayerId.get(id);
          const candidate = socket ? this.#players.get(socket) : undefined;
          if (candidate?.partyId !== player.partyId) continue;
          const actor = this.#questActor(candidate);
          if (actor) actors.push(actor);
        }
        return actors;
      };
      this.#recordQuestEvent(player.partyId, {
        id: crypto.randomUUID(),
        type: "monsterKilled",
        mapId: this.#location.zoneId,
        monsterId: monster.id.startsWith("mon-") ? monster.id.slice(4) : monster.id,
        species: monster.species,
        killer,
        contributors: actorsFor(directlyEligible),
        nearbyParty: actorsFor(eligible),
      });
    }
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
    this.#triggerMonsterDefeatEvent(player, monster);
    clearMonsterCombat(monster);
  }

  /** A monster event's program is its on-defeat hook. Runtime ids are `mon-${event.id}`, so the
   * stable event uuid is already the binding between the authored monster and its quest logic. */
  #triggerMonsterDefeatEvent(player: Player, monster: Monster): void {
    if (player.identityKind !== "hero" || !monster.id.startsWith("mon-")) return;
    const eventId = monster.id.slice(4);
    const event = this.#location?.definition.events?.find(
      (candidate) => candidate.kind === "monster" && candidate.id === eventId,
    );
    const program = event?.pages[0]?.commands;
    if (!event || !program || program.length === 0) return;
    startRun(this.#eventRuns, {
      event,
      pageIndex: 0,
      program,
      heroId: player.id,
      runId: crypto.randomUUID(),
    });
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
    const merchant = merchantForRuntimeRoom();
    if (merchant && pointDistance(player, merchant) <= INTERACTION_RANGE) {
      this.#send(ws, { t: "merchant.open" });
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
    // Authored `action` events sit between the life-critical resurrection above and the legacy
    // quest keepers below (see `#triggerActionEventNearby`).
    if (this.#triggerActionEventNearby(player)) return;
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
        await this.#gameSession(partyId).markPartyCompleted(partyId);
        if (firstCompletion) {
          await this.#gameSession(partyId).broadcast(partyId, {
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
    // Same discipline as the "end" branch above: the whole fallible body is wrapped in try/finally
    // so a thrown D1 read/write error or a stale presence RPC releases the claim instead of
    // stranding it. `authorized` is only restored when this call is the one that cleared it, so a
    // concurrent legitimate deauthorization is never overridden; on the success path the player is
    // fully removed and the socket closed before finally runs, so releasing here is inert.
    let claimedAuthorization = false;
    try {
      if (!authoredAdventure.mapIds.includes(destinationAnchor.mapId)) {
        this.#send(ws, { t: "event", code: "zone.transition_denied", tone: "bad" });
        return;
      }
      const destinationMap = await loadMap(db, destinationAnchor.mapId);
      const entry = destinationMap?.events.find(
        (candidate) => candidate.kind === "entry" && candidate.id === destinationAnchor.entryId,
      );
      if (!destinationMap || !entry) {
        this.#send(ws, { t: "event", code: "zone.transition_failed", tone: "bad" });
        return;
      }
      const destination = locationFromMap(destinationMap, "main");
      const spawn = clampRestoredPosition(
        eventCellCentre(entry),
        player.id,
        destination.definition.terrain,
      );
      const destinationRoomKey = `${partyId}:${destinationMap.id}`;

      claimedAuthorization = true;
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
    } finally {
      player.transitioning = false;
      if (claimedAuthorization) player.authorized = true;
    }
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
    target.resurrectionAt = 0;
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
    const db = createDb(this.env.DB);
    const reward = {
      sessionEpoch: player.sessionEpoch,
      questId: chapter,
      rewardGold: definition.rewardGold,
      rewardPotions: 1,
      resultingLevel: result.level,
      resultingXp: result.xp,
      resultingHp,
    };
    const claimed =
      player.identityKind === "hero"
        ? await claimHeroQuestReward(db, { heroId: player.id, ...reward })
        : await claimQuestReward(db, { characterId: player.id, ...reward });
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

  async #useConsumable(ws: WebSocket, player: Player, item: ConsumableId): Promise<void> {
    const now = Date.now();
    const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
    player.inventory.consumables = counts;
    const resurrection = item === "resurrection_potion";
    if ((resurrection && player.life !== "corpse") || (!resurrection && !canAct(player.life))) {
      this.#send(ws, { t: "event", code: "item.invalid", params: { item }, tone: "info" });
      return;
    }
    if (player.consumableCooldownUntil > now) {
      this.#send(ws, {
        t: "event",
        code: "item.cooldown",
        params: { seconds: Math.ceil((player.consumableCooldownUntil - now) / 1_000) },
        tone: "info",
      });
      return;
    }
    if (counts[item] <= 0) {
      this.#send(ws, { t: "event", code: "item.invalid", params: { item }, tone: "info" });
      return;
    }

    const definition = CONSUMABLES[item];
    if (item === "health_potion") {
      const maxHp = maxHpForLevel(player.level);
      if (player.hp >= maxHp) {
        this.#send(ws, { t: "event", code: "item.invalid", params: { item }, tone: "info" });
        return;
      }
      const remaining = await this.#consumePotion(player, ws);
      if (remaining === null) return;
      player.inventory.potions = remaining;
      counts.health_potion = remaining;
      player.hp = Math.min(maxHp, player.hp + definition.effectValue);
    } else if (item === "mana_potion") {
      if (player.resource?.kind !== "mana" || player.resource.current >= player.resource.max) {
        this.#send(ws, { t: "event", code: "item.invalid", params: { item }, tone: "info" });
        return;
      }
      counts[item] -= 1;
      player.resource.current = Math.min(
        player.resource.max,
        player.resource.current + definition.effectValue,
      );
    } else {
      counts[item] -= 1;
      if (item === "damage_elixir") player.damageBoostUntil = now + definition.durationMs;
      if (item === "oblivion_draught") {
        player.forgottenUntil = now + definition.durationMs;
        this.#forgetPlayer(player);
      }
      if (item === "invisibility_potion") {
        player.invisibleUntil = now + definition.durationMs;
        this.#forgetPlayer(player);
      }
      if (item === "resurrection_potion") player.resurrectionAt = now + definition.durationMs;
    }

    player.consumableCooldownUntil = now + CONSUMABLE_COOLDOWN_MS;
    player.dirty = true;
    this.#recordActorQuestEvent(player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemUsed",
      itemId: item,
      amount: 1,
    }));
    this.#recordActorQuestEvent(player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemRemoved",
      itemId: item,
      amount: 1,
      inventoryQuantity: counts[item],
    }));
    this.#send(ws, { t: "event", code: "item.used", params: { item }, tone: "good" });
    this.#sendState(ws, player);
  }

  #buyConsumable(ws: WebSocket, player: Player, item: ConsumableId): void {
    const merchant = merchantForRuntimeRoom();
    if (!merchant || pointDistance(player, merchant) > INTERACTION_RANGE) {
      this.#send(ws, { t: "event", code: "item.invalid", params: { item }, tone: "bad" });
      return;
    }
    const definition = CONSUMABLES[item];
    if (player.inventory[definition.currency] < definition.price) {
      this.#send(ws, {
        t: "event",
        code: "merchant.insufficient",
        params: { currency: definition.currency },
        tone: "bad",
      });
      return;
    }
    const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
    player.inventory.consumables = counts;
    player.inventory[definition.currency] -= definition.price;
    counts[item] += 1;
    if (item === "health_potion") player.inventory.potions = counts.health_potion;
    player.dirty = true;
    this.#recordActorQuestEvent(player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemAcquired",
      itemId: item,
      amount: 1,
      inventoryQuantity: counts[item],
    }));
    this.#send(ws, { t: "event", code: "merchant.purchased", params: { item }, tone: "good" });
    this.#sendState(ws, player);
  }

  #forgetPlayer(player: Player): void {
    for (const monster of this.#monsters) {
      monster.threat.delete(player.id);
      if (monster.navigation.targetId === player.id) monster.navigation.targetId = null;
    }
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
      const consume = () =>
        player.identityKind === "hero"
          ? consumeHeroOwnedItem(db, player.id, player.sessionEpoch, HEALTH_POTION_ID)
          : consumeOwnedItem(db, player.id, HEALTH_POTION_ID);
      let remaining = await consume();
      // Safety net: an absent or empty row (a save that never landed) still gets one retry.
      if (remaining === null && player.inventory.potions > 0) {
        if (!(await this.#savePlayer(player, ws))) return null;
        remaining = await consume();
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

  async #savePlayerInBackground(player: Player, ws: WebSocket): Promise<boolean> {
    try {
      return await this.#savePlayer(player, ws);
    } catch {
      // The tick has already cleared `dirty` after queueing this save. Put it back so a transient
      // D1 failure is retried at the next bounded save interval, and contain the rejection so an
      // operational database error cannot restart the Durable Object around live sockets.
      if (this.#players.get(ws) === player && player.authorized) player.dirty = true;
      return false;
    }
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

    this.#advanceConsumableEffects(now);

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
      savePlayer: (player, socket) => this.#savePlayerInBackground(player, socket),
      onPlayerMoved: (_socket, player, previous) => this.#detectPlayerTouch(player, previous),
    });
    for (const [socket, player] of this.#players) {
      const action = player.action;
      if (
        action?.channelMaxEndsAt !== undefined &&
        action.channelEndsAt === undefined &&
        (now >= action.channelMaxEndsAt || (action.mobilityDistance ?? 0) <= 0)
      )
        this.#finishHeldPlayerAction(socket, player, now);
    }
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
    // Drain event runs AFTER all authoritative simulation (movement, combat, monsters, loot) and
    // BEFORE the network flush: a run's teleport acts on final positions and rides out THIS tick's
    // snapshot, and the budget guarantees the drain returns so the tick never hangs.
    this.#drainEventRuns(now);
    if (this.#tick % NETWORK_TICKS_PER_SNAPSHOT === 0) {
      this.#sendWorldDeltas();
      const context = this.#partyContext();
      for (const party of this.#parties.values()) broadcastPartyStateIfChanged(context, party);
      this.#broadcastHeroPartyStates();
    }
    this.#flushQueuedResyncs(now);
  }

  #advanceConsumableEffects(now: number): void {
    for (const [socket, player] of this.#players) {
      if (player.resurrectionAt <= 0 || player.resurrectionAt > now) continue;
      player.resurrectionAt = 0;
      if (player.life !== "corpse") continue;
      player.life = "alive";
      player.corpse = null;
      player.hp = resurrectHp(player.level);
      this.#grantReviveGrace(player, now);
      this.#freeze(player);
      this.#send(socket, {
        t: "event",
        code: "item.resurrected",
        tone: "good",
        x: player.x,
        y: player.y,
      });
      this.#sendState(socket, player);
    }
  }

  /**
   * Step every live run its budgeted slice, then dispatch the effects that need this room's
   * authority: state mutations are batched into ONE coordinator RPC (the single writer), a teleport
   * sets an authoritative position, gold/items land on the triggerer's session inventory. Dialogue
   * effects buffer in the run runtime and are flushed to the triggerer's socket at the end of the
   * drain (`#flushDialogue`).
   *
   * Order: close any walked-away dialogue FIRST (it buffers a `closeDialogue` beat and releases the
   * lock), then drain the survivors, then flush every buffered beat — a run's `say`/`choices` and its
   * distance-close all reach the wire in the same tick they were produced.
   */
  #drainEventRuns(now: number): void {
    this.#closeDistantDialogues();
    if (this.#eventStateSync !== null) {
      this.#flushDialogue();
      return;
    }
    if (this.#eventRuns.contexts.size > 0) {
      const { effects } = drainRuns(this.#eventRuns, {
        state: this.#adventureState,
        tick: this.#tick,
      });
      const mutations: StateMutation[] = [];
      for (const dispatch of effects) {
        const effect = dispatch.effect;
        if (effect.kind === "mutateState") {
          mutations.push(effect.op);
        } else if (effect.kind === "teleport") {
          this.#dispatchTeleport(dispatch, effect, now);
        } else if (effect.kind === "endAdventure") {
          this.#dispatchEndAdventure(dispatch);
        } else if (effect.kind === "changeGold") {
          this.#dispatchGold(dispatch, effect);
        } else {
          this.#dispatchItems(dispatch, effect);
        }
      }
      if (mutations.length > 0 && this.#heroPartyId !== null) {
        const partyId = this.#heroPartyId;
        // Same retained stub every tick so consecutive mutation batches keep their E-order.
        const sync = this.#gameSession(partyId).applyStateChanges(partyId, mutations);
        this.#eventStateSync = sync;
        this.ctx.waitUntil(
          sync.then(
            () => {
              if (this.#eventStateSync === sync) this.#eventStateSync = null;
            },
            (error: unknown) => {
              if (this.#eventStateSync === sync) {
                this.#eventStateSync = null;
                // The run has already advanced past mutations that never became authoritative.
                // Continuing would execute its remainder against a lie, so release every lock.
                resetEventRunRuntime(this.#eventRuns);
              }
              console.error(
                JSON.stringify({
                  event: "event_state_sync_failed",
                  partyId,
                  roomKey: this.#location?.roomKey ?? null,
                  error: error instanceof Error ? error.message : String(error),
                }),
              );
            },
          ),
        );
      }
    }
    this.#flushDialogue();
  }

  /**
   * End every run parked on a dialogue whose triggerer has walked beyond `DIALOGUE_CLOSE_RADIUS` of
   * its event cell (spec Decision 4, WoW: the panel closes, the conversation is over). `World` owns
   * the positions, so it supplies the geometry; `closeDistantDialogues` buffers the `closeDialogue`
   * beat and drops the context. A missing triggerer or event is treated as beyond — there is no panel
   * left to hold open. Ending the run is NOT a rollback: mutations already applied stay applied.
   */
  #closeDistantDialogues(): void {
    if (this.#eventRuns.contexts.size === 0) return;
    const events = this.#location?.definition.events ?? [];
    closeDistantDialogues(this.#eventRuns, (context) => {
      const socket = this.#socketByPlayerId.get(context.heroId);
      const player = socket ? this.#players.get(socket) : undefined;
      if (player === undefined) return true;
      const event = events.find((candidate) => candidate.id === context.eventId);
      if (event === undefined) return true;
      return pointDistance(player, eventCellCentre(event)) > DIALOGUE_CLOSE_RADIUS;
    });
  }

  /**
   * Send every buffered dialogue beat to its triggerer's socket, then clear the buffer. `say`/
   * `choices` carry authored prose (the sanctioned data exception, spec Decision 4); `closeDialogue`
   * becomes `event.close`. A beat whose triggerer has no socket (already gone) is dropped silently.
   */
  #flushDialogue(): void {
    const dialogue = this.#eventRuns.dialogue;
    if (dialogue.length === 0) return;
    for (const buffered of dialogue) {
      const socket = this.#socketByPlayerId.get(buffered.heroId);
      if (socket === undefined) continue;
      const message = buffered.message;
      if (message.kind === "say") {
        this.#send(
          socket,
          message.name === null
            ? { t: "event.say", runId: buffered.runId, text: message.text }
            : { t: "event.say", runId: buffered.runId, text: message.text, name: message.name },
        );
      } else if (message.kind === "offerChoices") {
        this.#send(socket, {
          t: "event.choices",
          runId: buffered.runId,
          prompt: message.prompt,
          options: [...message.options],
        });
      } else {
        this.#send(socket, { t: "event.close", runId: buffered.runId });
      }
    }
    dialogue.length = 0;
  }

  /** The party's coordinator stub, retained so every ordered call rides one stub's E-order (see
   *  `#gameSessionStub`). A room serves exactly one party, so the memo never straddles parties. */
  #gameSession(partyId: string): ReturnType<Env["GAME_SESSION"]["getByName"]> {
    if (this.#gameSessionStub === null) {
      this.#gameSessionStub = this.env.GAME_SESSION.getByName(partyId);
    }
    return this.#gameSessionStub;
  }

  #questActor(player: Player | undefined): QuestActor | null {
    if (!player?.authorized || player.identityKind !== "hero" || player.partyId === null) {
      return null;
    }
    return { heroId: player.id, sessionEpoch: player.sessionEpoch, level: player.level };
  }

  /** Queue an authoritative fact on the retained coordinator stub and keep gameplay non-blocking. */
  #recordQuestEvent(partyId: string, event: QuestBusinessEvent): void {
    this.ctx.waitUntil(
      this.#gameSession(partyId)
        .recordQuestEvent(partyId, event)
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              event: "authored_quest_event_failed",
              partyId,
              questEventType: event.type,
              questEventId: event.id,
              roomKey: this.#location?.roomKey ?? null,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }),
    );
  }

  #recordActorQuestEvent(
    player: Player,
    create: (base: { id: string; mapId: string; actor: QuestActor }) => QuestBusinessEvent,
  ): void {
    const actor = this.#questActor(player);
    const mapId = this.#location?.zoneId;
    if (!actor || !mapId || player.partyId === null) return;
    this.#recordQuestEvent(player.partyId, create({ id: crypto.randomUUID(), mapId, actor }));
  }

  /**
   * Warn about a refused authored teleport at most ONCE per (event, reason) per room lifetime. An
   * authored `loop { teleport <unwalkable> }` would otherwise emit up to `EVENT_COMMANDS_PER_TICK`
   * logs every tick forever; the observability law forbids per-event tick logging. The (event,
   * reason) Set is small and bounded (events per map times a few reasons) and resets on room empty.
   */
  #logTeleportRefusedOnce(eventId: string, reason: string, extra: Record<string, unknown>): void {
    const key = `${eventId}:${reason}`;
    if (this.#teleportRefusalsLogged.has(key)) return;
    this.#teleportRefusalsLogged.add(key);
    console.warn(JSON.stringify({ event: "event_teleport_refused", reason, eventId, ...extra }));
  }

  /**
   * A `changeGold` grant lands on the triggerer's session inventory (the same `inventory.gold` the
   * merchant spends and the HUD reads through the self snapshot). The balance clamps at zero — a
   * `changeGold -50` on 10 gold leaves 0, never a debt — and a positive grant tells the hero with
   * `loot.picked` (kind "gold"), the existing personal loot-event the pickup path already uses.
   *
   * A grant landing mid `player.transitioning` (a cross-map teleport claimed earlier in the SAME
   * drain, or one already in flight) is REFUSED with a deduped structured log, exactly like a
   * refused teleport — silently applying it here would land on whichever room wins the handoff race,
   * or vanish if the destination room never re-derives it. A clamped change whose NET effect is zero
   * (this same `-50` on 0 gold) is a no-op: no dirty flag, no reshipped snapshot, no event, since
   * nothing about the hero's state actually changed.
   */
  #dispatchGold(
    dispatch: DispatchEffect,
    effect: Extract<DispatchEffect["effect"], { kind: "changeGold" }>,
  ): void {
    const socket = this.#socketByPlayerId.get(dispatch.heroId);
    const player = socket ? this.#players.get(socket) : undefined;
    if (!socket || !player?.authorized) return;
    if (player.transitioning) {
      this.#logGoldRefusedOnce(dispatch.eventId, "transitioning", { heroId: player.id });
      return;
    }
    const before = player.inventory.gold;
    const after = Math.max(0, before + effect.amount);
    if (after === before) return;
    player.inventory.gold = after;
    player.dirty = true;
    if (effect.amount > 0) {
      this.#send(socket, {
        t: "event",
        code: "loot.picked",
        params: { amount: effect.amount, kind: "gold" },
        tone: "good",
      });
    }
    this.#sendState(socket, player);
  }

  /**
   * Warn about a refused authored `changeGold` at most ONCE per (event, reason) per room lifetime —
   * the same dedupe discipline `#logTeleportRefusedOnce` follows.
   */
  #logGoldRefusedOnce(eventId: string, reason: string, extra: Record<string, unknown>): void {
    const key = `${eventId}:${reason}`;
    if (this.#goldRefusalsLogged.has(key)) return;
    this.#goldRefusalsLogged.add(key);
    console.warn(JSON.stringify({ event: "event_gold_refused", reason, eventId, ...extra }));
  }

  /**
   * A `changeItems` change lands on the triggerer's session consumable bag — the only stackable
   * inventory a party hero owns this slice, and the one the merchant already fills. The runtime is
   * the item-id authority (the Task-1 carry: the parser only shape-checks the slug): an id that is
   * not a grantable consumable is REFUSED with a deduped structured log, never a player message,
   * exactly like a refused teleport. A positive grant respects the per-stack capacity — a stack
   * already at `CONSUMABLE_MAX_STACK` is full, so the grant is dropped and the hero is told with the
   * `item.full` personal code (the loot precedent for a pickup that cannot land); otherwise it adds
   * up to the ceiling and reports what landed with `loot.picked`. A negative change removes, clamped
   * at zero — and if the clamp leaves the NET change at zero (a `-N` grant on an already-empty
   * stack), it is a no-op: no dirty flag, no reshipped snapshot, nothing to sync. Any change that DID
   * land syncs the legacy `potions` mirror and reships the self snapshot.
   *
   * A grant landing mid `player.transitioning` (a cross-map teleport claimed earlier in the SAME
   * drain, or one already in flight) is REFUSED with a deduped structured log — the same treatment as
   * an unknown item id — rather than silently applied into the handoff window.
   */
  #dispatchItems(
    dispatch: DispatchEffect,
    effect: Extract<DispatchEffect["effect"], { kind: "changeItems" }>,
  ): void {
    const socket = this.#socketByPlayerId.get(dispatch.heroId);
    const player = socket ? this.#players.get(socket) : undefined;
    if (!socket || !player?.authorized) return;
    if (player.transitioning) {
      this.#logItemRefusedOnce(dispatch.eventId, effect.itemId, "transitioning", {
        heroId: player.id,
      });
      return;
    }
    if (!isConsumableId(effect.itemId)) {
      this.#logItemRefusedOnce(dispatch.eventId, effect.itemId, "unknown_item", {
        heroId: player.id,
      });
      return;
    }
    const item: ConsumableId = effect.itemId;
    const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
    player.inventory.consumables = counts;
    let landed = 0;
    if (effect.count > 0) {
      if (counts[item] >= CONSUMABLE_MAX_STACK) {
        this.#send(socket, {
          t: "event",
          code: "item.full",
          params: { item },
          tone: "bad",
        });
        return;
      }
      const added = Math.min(effect.count, CONSUMABLE_MAX_STACK - counts[item]);
      counts[item] += added;
      landed = added;
      if (item === "health_potion") player.inventory.potions = counts.health_potion;
      player.dirty = true;
      this.#send(socket, {
        t: "event",
        code: "loot.picked",
        params: { amount: added, kind: item },
        tone: "good",
      });
    } else {
      const before = counts[item];
      const after = Math.max(0, before + effect.count);
      if (after === before) return;
      counts[item] = after;
      landed = after - before;
      if (item === "health_potion") player.inventory.potions = counts.health_potion;
      player.dirty = true;
    }
    if (landed > 0) {
      this.#recordActorQuestEvent(player, ({ id, mapId, actor }) => ({
        id,
        mapId,
        actor,
        type: "itemAcquired",
        itemId: item,
        amount: landed,
        inventoryQuantity: counts[item],
      }));
    } else if (landed < 0) {
      this.#recordActorQuestEvent(player, ({ id, mapId, actor }) => ({
        id,
        mapId,
        actor,
        type: "itemRemoved",
        itemId: item,
        amount: -landed,
        inventoryQuantity: counts[item],
      }));
    }
    this.#sendState(socket, player);
  }

  /**
   * Warn about a refused authored `changeItems` at most ONCE per (event, itemId, reason) per room
   * lifetime — the same dedupe discipline `#logTeleportRefusedOnce` follows, so an authored
   * `loop { changeItems <unknown> +1 }` warns once, not `EVENT_COMMANDS_PER_TICK` times a tick. The
   * (event, itemId, reason) set is small and bounded and resets on room empty beside the teleport set.
   */
  #logItemRefusedOnce(
    eventId: string,
    itemId: string,
    reason: string,
    extra: Record<string, unknown>,
  ): void {
    const key = `${eventId}:${itemId}:${reason}`;
    if (this.#itemRefusalsLogged.has(key)) return;
    this.#itemRefusalsLogged.add(key);
    console.warn(
      JSON.stringify({
        event: "event_item_refused",
        reason,
        eventId,
        itemId,
        ...extra,
      }),
    );
  }

  #dispatchTeleport(
    dispatch: DispatchEffect,
    effect: Extract<DispatchEffect["effect"], { kind: "teleport" }>,
    now: number,
  ): void {
    const socket = this.#socketByPlayerId.get(dispatch.heroId);
    const player = socket ? this.#players.get(socket) : undefined;
    if (!socket || !player?.authorized || player.transitioning) return;
    if (effect.mapId === this.#location?.zoneId) {
      this.#teleportSameMap(player, effect.col, effect.row, dispatch.eventId);
      return;
    }
    // Claim the transition SYNCHRONOUSLY, before the async handoff. The handoff sets `transitioning`
    // too late to stop a second cross-map teleport effect dispatched in the SAME drain, so without
    // this a back-to-back teleport would launch two handoffs (two saves, two closes). A validation
    // failure inside `#teleportCrossMap` clears the claim so a refused teleport never strands the hero.
    player.transitioning = true;
    this.#crossMapTeleports += 1;
    this.ctx.waitUntil(
      this.#teleportCrossMap(
        socket,
        player,
        effect.mapId,
        effect.col,
        effect.row,
        now,
        dispatch.eventId,
      ).catch((error) => {
        console.error(
          JSON.stringify({
            event: "event_teleport_transition_failed",
            roomKey: player.roomKey,
            eventId: dispatch.eventId,
            elapsedMs: Math.max(0, Date.now() - now),
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }),
    );
  }

  /**
   * The authored `endAdventure` effect: mark the party's save complete and broadcast victory, exactly
   * like the graph's `dest: "end"` exit branch, but fired by a scripted event command rather than the
   * exit-anchor graph (D25's optional end-game EVENT). Guarded by `#adventureEndDispatched` so an
   * author's `loop { endAdventure }` or a re-trigger runs `completeParty` at most once per room
   * lifetime. The completion is fire-and-forget via `waitUntil`: the run continues locally regardless,
   * and `completeParty` is idempotent (only the first completion broadcasts).
   */
  #dispatchEndAdventure(dispatch: DispatchEffect): void {
    if (this.#adventureEndDispatched) return;
    const socket = this.#socketByPlayerId.get(dispatch.heroId);
    const player = socket ? this.#players.get(socket) : undefined;
    if (!socket || !player?.authorized || player.identityKind !== "hero") return;
    const partyId = player.partyId;
    if (!partyId) return;
    this.#adventureEndDispatched = true;
    this.ctx.waitUntil(
      (async () => {
        try {
          const db = createDb(this.env.DB);
          const firstCompletion = await completeParty(db, partyId);
          await this.#gameSession(partyId).markPartyCompleted(partyId);
          if (firstCompletion) {
            await this.#gameSession(partyId).broadcast(partyId, {
              t: "event",
              code: "adventure.victory",
              tone: "good",
            });
          }
        } catch (error) {
          // A failed completion frees the guard so a later trigger can retry, mirroring the teleport
          // handoff's release-on-failure discipline.
          this.#adventureEndDispatched = false;
          console.error(
            JSON.stringify({
              event: "event_end_adventure_failed",
              partyId,
              eventId: dispatch.eventId,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      })(),
    );
  }

  /**
   * A same-map authored teleport: refuse an unwalkable/out-of-bounds destination (the Task-1 carry —
   * col/row are runtime-checked against the live map, like an item id) with a structured log while
   * the run continues; otherwise set the authoritative position AND clear the command queue. The
   * queue clear is the death-transition precedent: a stale queue replayed after the snap is the
   * post-teleport sprint bug.
   */
  #teleportSameMap(player: Player, col: number, row: number, eventId: string): void {
    const terrain = this.#zone().terrain;
    const destination = eventCellCentre({ col, row });
    const inBounds =
      destination.x >= 0 &&
      destination.y >= 0 &&
      destination.x < terrain.width &&
      destination.y < terrain.height;
    if (!inBounds || !isWalkable(destination, PLAYER_SIZE, terrain)) {
      this.#logTeleportRefusedOnce(eventId, inBounds ? "unwalkable" : "out_of_bounds", {
        heroId: player.id,
        mapId: this.#location?.zoneId ?? null,
        col,
        row,
      });
      return;
    }
    const previousPosition = { x: player.x, y: player.y };
    player.x = destination.x;
    player.y = destination.y;
    this.#playerGrid.update(player, previousPosition);
    // Clear the movement queue so no buffered command replays past the snap (the sprint bug class).
    player.queue = [];
    player.lastInput = NO_INPUT;
    player.starvedTicks = 0;
    player.dirty = true;
  }

  /**
   * A cross-map authored teleport: validate the destination map belongs to the party's adventure,
   * then ride the exact epoch-fenced handoff `#transitionAdventureExit` uses, with the authored
   * cell as the arrival point. Removing the source player aborts the run (the disconnect/transition
   * abort hook).
   */
  async #teleportCrossMap(
    ws: WebSocket,
    player: Player,
    mapId: string,
    col: number,
    row: number,
    now: number,
    eventId: string,
  ): Promise<void> {
    // `transitioning` is claimed by the SYNCHRONOUS caller (`#dispatchTeleport`), not here, so this
    // never re-checks it — instead the whole fallible body is wrapped in try/finally so every
    // validation failure AND every thrown exception (a D1 read/write error, a stale presence RPC)
    // releases the claim, leaving a refused or failed cross-map teleport free to move and try again.
    // `authorized` is only restored when THIS call is the one that cleared it (`claimedAuthorization`)
    // so a concurrent legitimate deauthorization (e.g. presence invalidation) is never overridden. On
    // the success path the player is fully removed and the socket closed before finally runs, so
    // releasing the claim afterward on the now-orphaned player object is inert.
    const partyId = player.partyId;
    let claimedAuthorization = false;
    try {
      if (player.identityKind !== "hero" || !partyId || player.life !== "alive") return;
      const db = createDb(this.env.DB);
      const storedParty = await loadPartyForRuntime(db, partyId);
      if (!storedParty || !player.authorized) return;
      const authoredAdventure = await loadAdventure(
        db,
        storedParty.hostAccountId,
        storedParty.adventureId,
      );
      if (!authoredAdventure?.mapIds.includes(mapId)) {
        this.#send(ws, { t: "event", code: "zone.transition_denied", tone: "bad" });
        return;
      }
      const destinationMap = await loadMap(db, mapId);
      if (!destinationMap) {
        this.#send(ws, { t: "event", code: "zone.transition_failed", tone: "bad" });
        return;
      }
      const destination = locationFromMap(destinationMap, "main");
      const inBounds =
        col >= 0 &&
        row >= 0 &&
        col < destination.definition.terrain.width / TILE_SIZE &&
        row < destination.definition.terrain.height / TILE_SIZE;
      if (!inBounds) {
        this.#logTeleportRefusedOnce(eventId, "out_of_bounds", { mapId, col, row });
        return;
      }
      const spawn = clampRestoredPosition(
        eventCellCentre({ col, row }),
        player.id,
        destination.definition.terrain,
      );
      const destinationRoomKey = `${partyId}:${destinationMap.id}`;

      player.lastTransitionAt = now;
      player.lastInput = NO_INPUT;
      player.queue = [];
      cancelCombatAction(player);
      removeProjectilesByOwner(this.#projectiles, player.id);
      claimedAuthorization = true;
      player.authorized = false;
      if (!(await this.#checkpointCooldowns(player))) {
        this.#rejectStaleSave(ws, player);
        return;
      }
      if (!(await this.#savePlayer(player, ws, true))) return;
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
        ws.close(WS_CLOSE.ZONE_TRANSITION, "event teleport");
      } catch {
        // The fenced destination is already durable; reconnect resumes there.
      }
      if (this.#players.size === 0) this.#stopLoop();
    } finally {
      player.transitioning = false;
      if (claimedAuthorization) player.authorized = true;
    }
  }

  #detectAdventureExits(now: number): void {
    const exits = exitEvents(this.#zone().events ?? []);
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
      this.ctx.waitUntil(
        this.#transitionAdventureExit(socket, player, exit.id, now).catch((error) => {
          // A failed fenced save is recoverable: the transition's finally block has already
          // reopened movement/action. Contain the rejection here so workerd does not treat an
          // expected D1/RPC failure as an uncaught Durable Object exception and restart the room
          // around the still-open socket.
          console.error(
            JSON.stringify({
              event: "adventure_exit_transition_failed",
              roomKey: player.roomKey,
              elapsedMs: Math.max(0, Date.now() - now),
              authorized: player.authorized,
              transitioning: player.transitioning,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }),
      );
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
    const baseSkill = CLASS_SKILLS[owner.player.class].find(
      (candidate) => candidate.id === projectile.sourceSkillId,
    );
    if (!baseSkill) return;
    const skill = skillWithTalents(owner.player.class, owner.player.talents, baseSkill.slot);
    const execute = talentEffect(owner.player.class, owner.player.talents, "execute", skill.slot);
    const power =
      execute && monster.hp / Math.max(1, monster.maxHp) <= execute.threshold
        ? Math.round(projectile.power * (1 + execute.multiplier))
        : projectile.power;
    this.#damageMonster(owner.socket, owner.player, monster, skill, now, projectile.basic, power);
    const ricochet = talentEffect(owner.player.class, owner.player.talents, "ricochet", skill.slot);
    if (!ricochet || projectile.ricochetRemaining <= 0) return;
    const target = this.#monsterGrid
      .queryRadius(monster, ricochet.range)
      .filter(
        (candidate) =>
          candidate.id !== monster.id &&
          candidate.deadUntil <= now &&
          !projectile.hitEntityIds.has(candidate.id) &&
          hasLineOfSight(monster, candidate, this.#zone().terrain.tiles),
      )
      .sort((a, b) => pointDistance(monster, a) - pointDistance(monster, b))[0];
    const definition = actionForClassSlot(owner.player.class, skill.slot).projectile;
    if (!target || !definition) return;
    const origin = { x: monster.x + PLAYER_SIZE / 2, y: monster.y + PLAYER_SIZE / 2 };
    const direction = normalizeDirection({ x: target.x - monster.x, y: target.y - monster.y });
    spawnProjectile(this.#projectiles, {
      actionId: crypto.randomUUID(),
      owner: owner.player,
      roomKey: owner.player.roomKey,
      origin,
      direction,
      definition: { ...definition, pierce: 0 },
      range: ricochet.range,
      power: Math.max(1, Math.round(projectile.power * ricochet.ratio)),
      targetFilter: "monsters",
      sourceSkillId: skill.id,
      basic: false,
      now,
      ricochetRemaining: projectile.ricochetRemaining - 1,
    });
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
    const restored = this.#healPlayer(
      owner.socket,
      owner.player,
      targetSocket,
      target,
      projectile.power,
      projectile.sourceSkillId,
      now,
      false,
    );
    const baseSkill = CLASS_SKILLS[owner.player.class].find(
      (candidate) => candidate.id === projectile.sourceSkillId,
    );
    const chain = baseSkill
      ? talentEffect(owner.player.class, owner.player.talents, "chain_heal", baseSkill.slot)
      : undefined;
    if (!chain || restored <= 0) return;
    const chained = [...this.#players]
      .filter(
        ([, candidate]) =>
          candidate.id !== target.id &&
          candidate.id !== owner.player.id &&
          candidate.life === "alive" &&
          candidate.hp < maxHpForLevel(candidate.level) &&
          this.#areCombatAllies(owner.player, candidate) &&
          pointDistance(target, candidate) <= chain.range &&
          hasLineOfSight(target, candidate, this.#zone().terrain.tiles),
      )
      .sort(([, a], [, b]) => pointDistance(target, a) - pointDistance(target, b))[0];
    if (chained)
      this.#healPlayer(
        owner.socket,
        owner.player,
        chained[0],
        chained[1],
        Math.max(1, Math.round(projectile.power * chain.ratio)),
        projectile.sourceSkillId,
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
        player.forgottenUntil > now ||
        player.invisibleUntil > now ||
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
    if (isPlayerInvulnerable(player, now)) return;
    const {
      amount: appliedDamage,
      result,
      parried,
      retaliationRatio,
    } = guardedDamage(player, damage, now);
    if (parried) {
      this.#send(ws, {
        t: "event",
        code: "talent.perfect_parry",
        tone: "good",
        x: player.x,
        y: player.y,
      });
      const attacker = this.#monsters.find(
        (monster) => monster.id === monsterId && monster.deadUntil <= now,
      );
      if (attacker && retaliationRatio > 0) {
        const guardSkill = skillWithTalents(player.class, player.talents, 2);
        this.#damageMonster(
          ws,
          player,
          attacker,
          guardSkill,
          now,
          false,
          Math.max(1, Math.round(damage * retaliationRatio)),
        );
      }
      return;
    }
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
    // A life transition aborts the hero's event runs, the same reason it clears the command queue:
    // a run buffered across a death/revive must not resume against a different life state.
    abortRunsForHero(this.#eventRuns, player.id);
    cancelCombatAction(player);
    player.guarding = false;
    player.guardActivatedAt = 0;
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

  #cheatRevive(player: Player): void {
    player.life = "alive";
    player.resurrectionAt = 0;
    player.corpse = null;
    player.hp = maxHpForLevel(player.level);
    this.#grantReviveGrace(player, Date.now());
    this.#freeze(player);
  }

  /** Release is one-way and deliberate. It is what closes the door on a priest saving you. */
  #release(ws: WebSocket, player: Player): void {
    if (player.life !== "corpse" || player.corpse === null) return;
    player.resurrectionAt = 0;
    const cemetery =
      player.identityKind === "hero"
        ? (this.#zone().terrain.spawnPoints[0] ?? nearestCemetery(player.corpse))
        : nearestCemetery(player.corpse);
    const previousPosition = { x: player.x, y: player.y };
    let releasePosition: Vec2 = cemetery;
    // An authored map currently has one spirit anchor: its entry spawn. If the player dies on
    // that exact point, releasing there would reclaim the body on the very next tick. Find the
    // nearest walkable neighbouring tile so the ghost state remains observable and playable.
    if (pointDistance(releasePosition, player.corpse) <= CORPSE_RECLAIM_RANGE) {
      const directions = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 },
        { x: 1, y: -1 },
        { x: -1, y: -1 },
      ];
      for (const radius of [TILE_SIZE, TILE_SIZE * 2, TILE_SIZE * 3]) {
        const candidate = directions
          .map((direction) => ({
            x: cemetery.x + direction.x * radius,
            y: cemetery.y + direction.y * radius,
          }))
          .find(
            (position) =>
              pointDistance(position, player.corpse as Vec2) > CORPSE_RECLAIM_RANGE &&
              isWalkable(position, PLAYER_SIZE, this.#zone().terrain),
          );
        if (candidate) {
          releasePosition = candidate;
          break;
        }
      }
    }
    player.life = "ghost";
    player.x = releasePosition.x;
    player.y = releasePosition.y;
    this.#playerGrid.update(player, previousPosition);
    this.#freeze(player);
    this.#send(ws, { t: "event", code: "death.released", tone: "info", x: player.x, y: player.y });
    this.#sendState(ws, player);
  }

  /** Walking your ghost onto your own body. Automatic within range, like loot. */
  #reclaimCorpse(ws: WebSocket, player: Player): void {
    player.life = "alive";
    player.resurrectionAt = 0;
    player.corpse = null;
    player.hp = resurrectHp(player.level);
    this.#grantReviveGrace(player, Date.now());
    this.#freeze(player);
    this.#send(ws, { t: "event", code: "death.reclaimed", tone: "good", x: player.x, y: player.y });
    this.#sendState(ws, player);
  }

  #collectLoot(ws: WebSocket, player: Player): void {
    const before = normalizeConsumables(
      player.inventory.consumables,
      player.inventory.potions,
    ).health_potion;
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
    const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
    player.inventory.consumables = counts;
    const acquired = counts.health_potion - before;
    if (acquired > 0) {
      this.#recordActorQuestEvent(player, ({ id, mapId, actor }) => ({
        id,
        mapId,
        actor,
        type: "itemAcquired",
        itemId: HEALTH_POTION_ID,
        amount: acquired,
        inventoryQuantity: counts.health_potion,
      }));
    }
  }

  #selfState(player: Player): SelfState {
    const chapter = player.quest.chapter ?? "three_offerings";
    return selfState(
      player,
      this.#questDefinition(chapter)?.target,
      this.#authoredQuestTrackers(player),
    );
  }

  #sendState(ws: WebSocket, player: Player): void {
    const chapter = player.quest.chapter ?? "three_offerings";
    sendState(
      ws,
      player,
      this.#questDefinition(chapter)?.target,
      (socket, message) => this.#send(socket, message),
      this.#authoredQuestTrackers(player),
    );
  }

  #authoredQuestTrackers(player: Player) {
    const definitions = this.#adventureRegistry.quests ?? [];
    const scopeById = new Map(definitions.map((quest) => [quest.id, quest.scope]));
    const scopedProgress = (
      progress: Readonly<Record<string, AuthoredQuestProgress>> | undefined,
      scope: "party" | "personal",
    ): Record<string, AuthoredQuestProgress> =>
      Object.fromEntries(
        Object.entries(progress ?? {}).filter(([, value]) => {
          const resolvedScope = value.definitionSnapshot?.scope;
          return resolvedScope === undefined || resolvedScope === scope;
        }),
      );
    const partyRegistry = {
      ...this.#adventureRegistry,
      quests: definitions.filter((quest) => quest.scope === "party"),
    };
    const personalRegistry = {
      ...this.#adventureRegistry,
      quests: definitions.filter((quest) => quest.scope === "personal"),
    };
    const partyProgress = Object.fromEntries(
      Object.entries(scopedProgress(this.#adventureState.quests, "party")).filter(
        ([questId, value]) =>
          value.definitionSnapshot !== null || scopeById.get(questId) !== "personal",
      ),
    );
    const personalProgress = Object.fromEntries(
      Object.entries(scopedProgress(player.authoredQuestProgress, "personal")).filter(
        ([questId, value]) =>
          value.definitionSnapshot !== null || scopeById.get(questId) !== "party",
      ),
    );
    return [
      ...authoredQuestTrackers(partyRegistry, { ...this.#adventureState, quests: partyProgress }),
      ...authoredQuestTrackers(personalRegistry, {
        ...EMPTY_ADVENTURE_STATE,
        quests: personalProgress,
      }),
    ];
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
      this.#activeEvents,
    );
  }

  #sendWorldResync(ws: WebSocket, player: Player): void {
    sendWorldResync(
      ws,
      player,
      this.#tick,
      (recipient) => this.#worldView(recipient),
      (socket, message) => this.#send(socket, message),
      this.#activeEvents,
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
    // A hero leaving (disconnect or map transition) aborts every run they triggered.
    abortRunsForHero(this.#eventRuns, player.id);
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
    resetEventRunRuntime(this.#eventRuns);
    this.#teleportRefusalsLogged.clear();
    this.#itemRefusalsLogged.clear();
    this.#goldRefusalsLogged.clear();
    this.#adventureEndDispatched = false;
    this.#crossMapTeleports = 0;
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
