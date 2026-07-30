/**
 * The socketed world room — tranche α of the legacy `World` Durable Object on an Alepha `$room`
 * (`roomId = partyId:mapId`, tickHz 20). This task ports admission (`onJoin`, the 13-step
 * `handleJoinHero` + `World.fetch` sequence), the message boundary caps, one-command-per-tick
 * movement and the 10Hz snapshot/resync flush; combat, monsters, loot, events and fenced saves
 * land in Tasks 5-7. The world systems under `../../world/` are reused as-is, keyed by Alepha
 * connection-id string instead of a workerd `WebSocket` (their `TSocket` generic).
 *
 * ## Identity on the wire
 *
 * The browser connects with `/ws/world?roomId=<partyId:mapId>&hero=<heroId>`. Alepha's room
 * transport extracts only `roomId`; the extra `hero` parameter reaches `onJoin` through the
 * vendor-patched `conn.query` (see `RoomInterfaces.RoomSocket.query`). BOTH are untrusted hints:
 * `onJoin` re-derives membership, ownership, the adventure and the hero's authoritative map from
 * D1 (`AdmissionService`, the same reads `GET /api/join` runs) and refuses with
 * `WS_CLOSE.INVALID_LOCATION` on any mismatch. A client cannot select a map or a position; it can
 * only name which of its own heroes is connecting, and the roomId the server already told it.
 *
 * ## Replacement semantics (α)
 *
 * A second join of the same hero bumps the D1 epoch (`PresenceRoom.acquire`), which fences every
 * later write from the old connection. If the old socket sits in THIS room it is closed
 * immediately with `WS_CLOSE.CHARACTER_REPLACED` (4001), the legacy code. An old socket in a
 * DIFFERENT room (no cross-room revoke seam exists yet) dies on its next presence-renew beat —
 * within `PRESENCE_HEARTBEAT_MS` — with `WS_CLOSE.PRESENCE_LOST` (4003), the degradation the task
 * brief sanctions for α.
 */

import type { PartyAdventureState } from "@lindocara/engine/adventure-state.js";
import {
  type AdventureAudioConfig,
  DEFAULT_ADVENTURE_AUDIO,
} from "@lindocara/engine/audio-catalog.js";
import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import { flattenColliderIndex } from "@lindocara/engine/collider.js";
import type { CombatCooldownState } from "@lindocara/engine/cooldowns.js";
import { facingFromInput } from "@lindocara/engine/directional-combat.js";
import { CEMETERIES } from "@lindocara/engine/game.js";
import { merchantForRuntimeRoom } from "@lindocara/engine/merchant.js";
import {
  type ClientMessage,
  parseClientMessage,
  type ServerMessage,
  type WorldEventSnapshot,
  type WorldInfo,
} from "@lindocara/engine/protocol.js";
import {
  NETWORK_TICKS_PER_SNAPSHOT,
  NO_INPUT,
  PLAYER_SIZE,
  TICK_HZ,
} from "@lindocara/engine/simulation.js";
import { encodeTileMap } from "@lindocara/engine/tilemap-codec.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { replaceWorldCache, seedEventCache } from "@lindocara/engine/world-delta.js";
import type { ZoneLocation } from "@lindocara/engine/zones.js";
import { $hook, $inject } from "alepha";
import { $repository } from "alepha/orm";
import {
  $room,
  type ChannelPrimitive,
  type RoomConnection,
  type RoomContext,
  type RoomPrimitiveOptions,
} from "alepha/websocket";
import { addPlayer, isRateLimited, removePlayer } from "../../world/connection-system.js";
import type { InterestSystemContext } from "../../world/interest-system.js";
import { worldView } from "../../world/interest-system.js";
import { advancePlayers } from "../../world/movement-system.js";
import {
  broadcastNetworkUpdates,
  selfState,
  sendWorldResync,
} from "../../world/snapshot-system.js";
import {
  D1_SAVE_EVERY_TICKS,
  MAX_FRAME_BYTES,
  MAX_MALFORMED,
  MAX_QUEUED_COMMANDS,
  newPlayer,
  type PlayerRuntime,
  RESYNC_COOLDOWN_MS,
} from "../../world/world-runtime.js";
import { adventures } from "../entities/adventures.ts";
import { parties } from "../entities/parties.ts";
import { decodeAdventureAudio } from "../services/adventureAuthoring.ts";
import { HeroEpochService } from "../services/HeroEpochService.ts";
import { MapService } from "../services/MapService.ts";
import { AdmissionService } from "./AdmissionService.ts";
import { RealtimeChannels } from "./channels.ts";
import { PartyRoom } from "./PartyRoom.ts";
import { PresenceRoom } from "./PresenceRoom.ts";
import { frameByteLength } from "./wire.ts";
import {
  createWorldRoomState,
  locationFromMapPayload,
  parseWorldRoomId,
  type WorldRoomState,
} from "./worldState.ts";

/** Copied from legacy `character-presence.ts`'s `PRESENCE_HEARTBEAT_MS` (that module defines a
 *  Durable Object and cannot load under Node) — how often the room re-asserts every player's
 *  lease, and the beat on which it re-registers itself in the party directory. */
export const PRESENCE_HEARTBEAT_MS = 10_000;

/** Task 7 evaluates authored event pages; until then a room's active-event set is always empty. */
const NO_EVENTS: readonly WorldEventSnapshot[] = [];

type WorldSchemas =
  RealtimeChannels["worldChannel"] extends ChannelPrimitive<infer TIn, infer TOut>
    ? { in: TIn; out: TOut }
    : never;
type WorldRoomHandle = RoomContext<WorldSchemas["in"], WorldRoomState>;
type WorldRoomOptions = RoomPrimitiveOptions<
  WorldSchemas["in"],
  WorldSchemas["out"],
  WorldRoomState
>;

export class WorldRoom {
  realtimeChannels = $inject(RealtimeChannels);
  presenceRoom = $inject(PresenceRoom);
  partyRoom = $inject(PartyRoom);
  admissionService = $inject(AdmissionService);
  heroEpochService = $inject(HeroEpochService);
  mapService = $inject(MapService);

  parties = $repository(parties);
  adventures = $repository(adventures);

  /**
   * The exact option bag the `$room` below runs, exposed as a public field so the FakeClock test
   * (`world-room-movement.test.ts`) can host it in a bare `RoomEngine` on a virtual clock — the
   * `RoomEngine.spec` idiom. Production only ever reaches it through `this.room`.
   */
  roomOptions: WorldRoomOptions = {
    channel: this.realtimeChannels.worldChannel,
    tickHz: TICK_HZ,
    state: ({ roomId }) => this.createState(roomId),
    onJoin: (room, conn) => this.handleJoin(room, conn),
    onMessage: (room, conn, message) => this.handleMessage(room, conn, message),
    onTick: (room) => this.handleTick(room),
    onLeave: (room, conn) => this.handleLeave(room, conn),
    onEmpty: (room) => this.handleEmpty(room),
    methods: {
      installAdventureState: (room, state: PartyAdventureState, version: number) =>
        this.installAdventureState(room.state, state, version),
    },
  };

  room = $room(this.roomOptions);

  /**
   * Wires `PartyRoom`'s cross-room seams (see its docblock: they default to inert no-ops because
   * `WorldRoom` did not exist when Task 3 shipped). `pushToRoom` becomes the coordinator's state
   * push into a live room; `sendToRoom` its party-wide chat/victory fan-out.
   */
  protected readonly wirePartySeams = $hook({
    on: "start",
    handler: () => {
      this.partyRoom.pushToRoom = async (roomKey, state, version) => {
        await this.room.call(roomKey, "installAdventureState", state, version);
      };
      this.partyRoom.sendToRoom = async (roomKey, message) => {
        await this.room.broadcast(roomKey, message);
      };
    },
  });

  // -----------------------------------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------------------------------

  /** Loads the room's map from D1 and bakes its geometry. A malformed roomId or unloadable map
   *  yields a `location: null` state whose every join is refused 4007 — never a throw, which would
   *  close the socket 1011 without the close-code vocabulary the client reconnects on. */
  protected async createState(roomId: string): Promise<WorldRoomState> {
    const parsed = parseWorldRoomId(roomId);
    let location: ZoneLocation | null = null;
    if (parsed) {
      try {
        const [payload, audio] = await Promise.all([
          this.mapService.getMap(parsed.mapId),
          this.adventureAudioForParty(parsed.partyId),
        ]);
        location = locationFromMapPayload(payload, roomId, audio);
      } catch (error) {
        this.logError("world_room_map_load_failed", error, { roomId });
      }
    }
    return createWorldRoomState(roomId, parsed, location);
  }

  protected async adventureAudioForParty(partyId: string): Promise<AdventureAudioConfig> {
    const party = await this.parties.findById(partyId);
    const adventureRow = party ? await this.adventures.findById(party.adventureId) : null;
    return adventureRow ? decodeAdventureAudio(adventureRow.audio) : { ...DEFAULT_ADVENTURE_AUDIO };
  }

  // -----------------------------------------------------------------------------------------------
  // Admission
  // -----------------------------------------------------------------------------------------------

  protected async handleJoin(room: WorldRoomHandle, conn: RoomConnection): Promise<void> {
    const state = room.state;
    if (!conn.userId) {
      room.close(conn.id, WS_CLOSE.SESSION_EXPIRED, "session expired");
      return;
    }
    if (state.location === null || state.partyId === "") {
      this.refuseLocation(room, conn.id, "room not admissible");
      return;
    }
    const heroId = conn.query?.hero ?? null;
    const resolution = await this.admissionService.resolveAdmission(
      conn.userId,
      state.partyId,
      heroId,
    );
    if (!resolution.ok) {
      this.refuseLocation(room, conn.id, resolution.error);
      return;
    }
    const join = resolution.join;
    // The wrong-map case AND the fallback-relocation-to-another-map case: this room only ever
    // admits heroes whose authoritative map is its own. The client must reconnect at the roomId
    // `resolveJoin` now reports.
    if (join.mapId !== state.mapId) {
      this.refuseLocation(room, conn.id, "hero is on another map");
      return;
    }

    // Presence FIRST: the epoch bump is what fences the previous holder's writes out.
    let acquired: { sessionEpoch: number } | null = null;
    try {
      acquired = (await this.presenceRoom.room.call(join.heroId, "acquire", {
        connectionId: conn.id,
        roomKey: state.roomKey,
        zoneId: state.mapId,
        instanceId: "main",
      })) as { sessionEpoch: number } | null;
    } catch (error) {
      this.logError("hero_presence_acquisition_failed", error, { heroId: join.heroId });
    }
    if (!acquired) {
      room.close(conn.id, WS_CLOSE.PRESENCE_ERROR, "presence acquisition failed");
      return;
    }

    // Same-room replacement: the acquire above already invalidated the old lease; now the old
    // socket is told why, with the legacy code (see this class's docblock).
    const previousConnectionId = state.connectionIdByHeroId.get(join.heroId);
    if (previousConnectionId !== undefined && previousConnectionId !== conn.id) {
      const previous = state.players.get(previousConnectionId);
      if (previous) {
        this.removeRuntimePlayer(state, previousConnectionId, previous);
        room.close(previousConnectionId, WS_CLOSE.CHARACTER_REPLACED, "character replaced");
      }
    }

    if (join.fallback) {
      const moved = await this.heroEpochService.relocate({
        heroId: join.heroId,
        sessionEpoch: acquired.sessionEpoch,
        mapId: join.mapId,
        x: join.fallback.x,
        y: join.fallback.y,
      });
      if (!moved) {
        room.close(conn.id, WS_CLOSE.PRESENCE_ERROR, "relocation lost the lease");
        return;
      }
    }

    // Reload under the acquired epoch: a profile that moved on (a racing second acquire, a
    // handoff) refuses admission rather than admitting a stale copy.
    const profile = await this.admissionService.loadHeroProfile(
      join.heroId,
      state.location.definition.terrain,
    );
    if (
      !profile ||
      profile.sessionEpoch !== acquired.sessionEpoch ||
      profile.zoneId !== state.mapId
    ) {
      room.close(conn.id, WS_CLOSE.PRESENCE_ERROR, "hero profile changed during admission");
      return;
    }
    const restoredCooldowns = (await this.presenceRoom.room.call(
      join.heroId,
      "readCooldowns",
      conn.id,
      acquired.sessionEpoch,
    )) as CombatCooldownState | null;
    if (restoredCooldowns === null) {
      room.close(conn.id, WS_CLOSE.PRESENCE_ERROR, "presence lost");
      return;
    }

    const activePlayers = [...state.players.values()].filter((player) => player.authorized).length;
    if (activePlayers >= state.location.definition.maxPlayers) {
      try {
        await this.presenceRoom.room.call(join.heroId, "release", conn.id, acquired.sessionEpoch);
      } catch {
        // The short lease expires on its own; refusal stands either way.
      }
      this.send(room, conn.id, { t: "event", code: "room.full", tone: "bad" });
      room.close(conn.id, WS_CLOSE.ROOM_FULL, "room.full");
      return;
    }

    // Legacy resets an expired ward run at admission. The corrected profile persists at the next
    // fenced save (Task 6); in-memory truth is what this room simulates on either way.
    if (
      profile.quest.chapter === "ward_run" &&
      profile.quest.status === "active" &&
      profile.wardRunExpiresAt !== null &&
      profile.wardRunExpiresAt <= Date.now()
    ) {
      profile.quest.progress = 0;
      profile.wardRunExpiresAt = null;
    }

    const player = newPlayer(profile, conn.id, state.roomKey, 0, 0, undefined, restoredCooldowns);
    player.identityKind = "hero";
    player.partyId = state.partyId;
    player.dirty = false;
    player.nextPresenceHeartbeatAt = Date.now() + PRESENCE_HEARTBEAT_MS;
    addPlayer(state.players, state.connectionIdByHeroId, state.playerGrid, conn.id, player);

    // Close the acquire/admit race: once the player is in the maps, a later replacement can find
    // it; before welcoming, verify no newer acquisition already won.
    let stillAuthorized: unknown = false;
    try {
      stillAuthorized = await this.presenceRoom.room.call(
        join.heroId,
        "isAuthorized",
        conn.id,
        acquired.sessionEpoch,
        state.roomKey,
      );
    } catch {
      stillAuthorized = false;
    }
    if (stillAuthorized !== true) {
      this.removeRuntimePlayer(state, conn.id, player);
      room.close(conn.id, WS_CLOSE.PRESENCE_LOST, "presence lost during admission");
      return;
    }

    // Register in the party directory (fire-and-forget; the renew beat self-heals a lost entry).
    void this.partyRoom.room
      .call(state.partyId, "registerRoom", state.roomKey)
      .catch((error) =>
        this.logError("party_room_register_failed", error, { roomId: room.roomId }),
      );

    const view = worldView(this.interestContext(state), player);
    replaceWorldCache(player.network, view);
    seedEventCache(player.network, [...NO_EVENTS]);
    this.send(room, conn.id, {
      t: "welcome",
      tick: state.tick,
      selfId: join.heroId,
      world: this.worldInfo(state.location),
      ...view,
      self: selfState(player),
    });
    this.send(room, conn.id, { t: "event", code: "wake", tone: "info" });
  }

  /** Legacy `#closedSocket`: one machine-code event so the client can print why, then the close. */
  protected refuseLocation(room: WorldRoomHandle, connectionId: string, reason: string): void {
    this.send(room, connectionId, { t: "event", code: "room.invalid_location", tone: "bad" });
    room.close(connectionId, WS_CLOSE.INVALID_LOCATION, reason);
  }

  // -----------------------------------------------------------------------------------------------
  // Messages
  // -----------------------------------------------------------------------------------------------

  protected handleMessage(room: WorldRoomHandle, conn: RoomConnection, message: unknown): void {
    const state = room.state;
    const player = state.players.get(conn.id);
    if (!player?.authorized) return;
    // Alepha already unwrapped the `{roomId, message}` envelope and JSON-parsed the frame, so the
    // app-level caps re-serialize once: byte-accurate size against the engine's cap, then the
    // engine's single parser on exactly those bytes (the single-parser doctrine — the loose
    // channel schema validated nothing). ~35 msg/s cap makes the extra stringify negligible.
    const raw = JSON.stringify(message);
    if (frameByteLength(raw) > MAX_FRAME_BYTES) {
      this.kick(room, state, conn.id, player, 1009, "frame too large");
      return;
    }
    if (isRateLimited(player)) {
      this.kick(room, state, conn.id, player, 1008, "message rate exceeded");
      return;
    }
    const parsed = parseClientMessage(raw);
    if (!parsed) {
      player.malformedCount += 1;
      if (player.malformedCount >= MAX_MALFORMED) {
        this.kick(room, state, conn.id, player, 1008, "too many invalid frames");
      }
      return;
    }
    player.malformedCount = 0;
    this.dispatch(room, state, conn.id, player, parsed);
  }

  /** Tranche α dispatches movement intent and the resync request; every other intent lands with
   *  its system in Tasks 5-7 and is deliberately ignored (never an error) until then. */
  protected dispatch(
    room: WorldRoomHandle,
    state: WorldRoomState,
    connectionId: string,
    player: PlayerRuntime,
    message: ClientMessage,
  ): void {
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
      player.facing = facingFromInput(message.input, player.facing);
      if (player.queue.length >= MAX_QUEUED_COMMANDS) return;
      player.queue.push({ seq: message.seq, input: message.input });
      return;
    }
    if (message.t === "world.resync") {
      const now = Date.now();
      // A throttled request is owed, not dropped: the client latches until a resync arrives. The
      // tick loop pays the debt once the cooldown lifts (`flushQueuedResyncs`).
      if (now - player.lastResyncAt < RESYNC_COOLDOWN_MS) {
        player.resyncQueued = true;
        return;
      }
      player.resyncQueued = false;
      player.lastResyncAt = now;
      this.sendResync(room, state, connectionId, player);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------------------------------

  /** SYNCHRONOUS by contract: an async onTick slower than its 50ms period silently skips beats
   *  (RoomEngine's reentrancy guard). Async work (presence renews, future saves) is fired through
   *  `waitUntil`-style detached promises, never awaited here. */
  protected handleTick(room: WorldRoomHandle): void {
    const state = room.state;
    if (state.players.size === 0 || state.location === null) return;
    state.tick += 1;
    const now = Date.now();
    advancePlayers<string>({
      players: state.players,
      playerGrid: state.playerGrid,
      zone: state.location.definition,
      now,
      presenceHeartbeatMs: PRESENCE_HEARTBEAT_MS,
      writeAttachment: false,
      // The cadence is wired now so Task 6 only swaps the stub for the fenced save.
      writeD1: state.tick % D1_SAVE_EVERY_TICKS === 0,
      waitUntil: (promise) => {
        void promise.catch((error) => this.logError("world_tick_async_failed", error));
      },
      renewPresence: (player) => this.renewPresence(room, state, player),
      reclaimCorpse: () => {}, // Task 5 (death flows).
      collectLoot: () => {}, // Task 5 (loot system).
      savePlayer: async () => true, // Task 6 (fenced persistence).
    });
    if (state.tick % NETWORK_TICKS_PER_SNAPSHOT === 0) {
      broadcastNetworkUpdates(
        state.players,
        state.tick,
        (player) => worldView(this.interestContext(state), player),
        (connectionId, message) => this.send(room, connectionId, message),
        NO_EVENTS,
      );
    }
    this.flushQueuedResyncs(room, state, now);
  }

  /** Port of legacy `#renewPresence` + the party-directory re-registration the task brief pins to
   *  the same 10s beat. A refused renew is a lost lease: the player is dropped with 4003. */
  protected async renewPresence(
    room: WorldRoomHandle,
    state: WorldRoomState,
    player: PlayerRuntime,
  ): Promise<void> {
    if (!player.authorized) return;
    void this.partyRoom.room
      .call(state.partyId, "registerRoom", state.roomKey)
      .catch((error) => this.logError("party_room_register_failed", error));
    let renewed: unknown = false;
    try {
      renewed = await this.presenceRoom.room.call(
        player.id,
        "renew",
        player.connectionId,
        player.sessionEpoch,
      );
    } catch (error) {
      this.logError("hero_presence_renew_failed", error, { heroId: player.id });
    }
    if (renewed === true || !player.authorized) return;
    const connectionId = state.connectionIdByHeroId.get(player.id);
    if (connectionId === undefined || state.players.get(connectionId) !== player) return;
    this.removeRuntimePlayer(state, connectionId, player);
    this.send(room, connectionId, { t: "event", code: "presence.lost", tone: "bad" });
    room.close(connectionId, WS_CLOSE.PRESENCE_LOST, "presence expired");
  }

  /** Pays back the resyncs the cooldown deferred — the rate limit holds, only honoured late. */
  protected flushQueuedResyncs(room: WorldRoomHandle, state: WorldRoomState, now: number): void {
    for (const [connectionId, player] of state.players) {
      if (!player.resyncQueued || !player.authorized) continue;
      if (now - player.lastResyncAt < RESYNC_COOLDOWN_MS) continue;
      player.resyncQueued = false;
      player.lastResyncAt = now;
      this.sendResync(room, state, connectionId, player);
    }
  }

  protected sendResync(
    room: WorldRoomHandle,
    state: WorldRoomState,
    connectionId: string,
    player: PlayerRuntime,
  ): void {
    sendWorldResync(
      connectionId,
      player,
      state.tick,
      (recipient) => worldView(this.interestContext(state), recipient),
      (recipientId, message) => this.send(room, recipientId, message),
      NO_EVENTS,
    );
  }

  // -----------------------------------------------------------------------------------------------
  // Leave / empty
  // -----------------------------------------------------------------------------------------------

  protected async handleLeave(room: WorldRoomHandle, conn: RoomConnection): Promise<void> {
    const state = room.state;
    const player = state.players.get(conn.id);
    if (!player) return;
    this.removeRuntimePlayer(state, conn.id, player);
    // The fenced disconnect save arrives with Task 6; the release is best-effort exactly like
    // legacy `#drop`'s — an expired lease self-heals, a mismatched one no-ops.
    try {
      await this.presenceRoom.room.call(
        player.id,
        "release",
        player.connectionId,
        player.sessionEpoch,
      );
    } catch (error) {
      this.logError("presence_release_failed", error, { heroId: player.id });
    }
  }

  protected async handleEmpty(room: WorldRoomHandle): Promise<void> {
    const state = room.state;
    if (state.partyId === "") return;
    try {
      await this.partyRoom.room.call(state.partyId, "roomEmptied", state.roomKey);
    } catch (error) {
      this.logError("party_room_empty_report_failed", error, { roomId: room.roomId });
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Coordinator seam (stub — Task 7 evaluates pages against it)
  // -----------------------------------------------------------------------------------------------

  /**
   * The party coordinator's read-only adventure-state push. MUST never throw — `PartyRoom` awaits
   * the push ahead of its own commit fan-out — and keeps the `>=` version guard so out-of-order
   * pushes keep the newer snapshot. Task 7 adds page evaluation on top of the stored snapshot.
   */
  protected installAdventureState(
    state: WorldRoomState,
    adventureState: PartyAdventureState,
    version: number,
  ): void {
    if (typeof version !== "number" || !Number.isFinite(version)) return;
    if (version < state.adventureState.version) return;
    state.adventureState = { state: adventureState, version };
  }

  // -----------------------------------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------------------------------

  protected interestContext(state: WorldRoomState): InterestSystemContext<string> {
    return {
      players: state.players,
      monsters: state.monsters,
      guards: state.guards,
      loot: state.loot,
      projectiles: state.projectiles,
      playerGrid: state.playerGrid,
      monsterGrid: state.monsterGrid,
      lootGrid: state.lootGrid,
      navigationDebugAvailable: false,
      now: Date.now,
    };
  }

  /** Port of the legacy welcome's `world` assembly (`world.ts:869-919`) for an authored D1 map. */
  protected worldInfo(location: ZoneLocation): WorldInfo {
    const definition = location.definition;
    return {
      zoneId: location.zoneId,
      revision: definition.revision ?? 0,
      zoneNameKey: definition.nameKey,
      // Baked collision truth: the tile grid and the sub-cell colliders. The client collides
      // against exactly these bytes; `layers`/`elements`/`events` below stay appearance-only.
      tiles: encodeTileMap(definition.terrain.tiles),
      colliders: flattenColliderIndex(definition.terrain.colliders),
      elements: definition.elements ?? [],
      tilesetId: definition.tilesetId ?? TINY_SWORDS_TILESET_ID,
      layers: definition.layers ?? [],
      events: [...NO_EVENTS],
      ...(definition.audio === undefined ? {} : { audio: definition.audio }),
      width: definition.terrain.width,
      height: definition.terrain.height,
      playerSize: PLAYER_SIZE,
      obstacles: [...definition.terrain.obstacles],
      safeZone: definition.terrain.safeZone,
      questNpc: definition.quests[0]?.giver ?? { id: "none", x: 0, y: 0 },
      questNpcs: definition.quests.map((quest) => quest.giver),
      questSites: [...definition.questSites],
      cemeteries: [...CEMETERIES],
      portals: definition.portals.map((portal) => ({
        id: portal.id,
        nameKey: portal.nameKey,
        x: portal.x,
        y: portal.y,
      })),
      merchant: merchantForRuntimeRoom(),
    };
  }

  /** Legacy `#kick`: unregister the runtime player, then close with the boundary's code. The
   *  provider's close event still fires `onLeave`, which finds nothing and no-ops. */
  protected kick(
    room: WorldRoomHandle,
    state: WorldRoomState,
    connectionId: string,
    player: PlayerRuntime,
    code: number,
    reason: string,
  ): void {
    this.removeRuntimePlayer(state, connectionId, player);
    room.close(connectionId, code, reason);
  }

  /** Legacy `#drop`'s synchronous half: quiesce and unregister (the queue-clear on every removal
   *  is the same invariant life transitions rely on — no half-applied command batches). */
  protected removeRuntimePlayer(
    state: WorldRoomState,
    connectionId: string,
    player: PlayerRuntime,
  ): void {
    player.authorized = false;
    player.disconnecting = true;
    player.lastInput = NO_INPUT;
    player.queue = [];
    removePlayer(state.players, state.connectionIdByHeroId, state.playerGrid, connectionId, player);
  }

  protected send(room: WorldRoomHandle, connectionId: string, message: ServerMessage): void {
    // The channel schema is deliberately loose (single-parser doctrine — see `channels.ts`), so
    // its Static type is a bare index signature. Interface-typed ServerMessage members
    // (CombatAnimation & co) carry no implicit index signature, hence the one contained cast.
    room.send(connectionId, message as unknown as { [key: string]: unknown });
  }

  protected logError(event: string, error: unknown, extra: Record<string, string> = {}): void {
    console.error(
      JSON.stringify({
        event,
        ...extra,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
