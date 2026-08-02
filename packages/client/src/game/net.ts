import { colliderIndexFrom } from "@lindocara/engine/collider.js";
import type { ConsumableId } from "@lindocara/engine/consumables.js";
import { canMove, type LifeState, speedForLife } from "@lindocara/engine/death.js";
import { facingFromInput } from "@lindocara/engine/directional-combat.js";
import {
  movementSpeedAt,
  type Rect,
  resolveTerrain,
  type TerrainGeometry,
} from "@lindocara/engine/game.js";
import {
  defaultMapHeroSettings,
  type MapHeroSettings,
  mapHeroClassSettings,
} from "@lindocara/engine/map-hero-settings.js";
import {
  CORRECTION_SMOOTHING_MS,
  MAX_ACCUMULATED_SECONDS,
  MAX_PENDING_COMMANDS,
  predictStep,
  prunePending,
  reconcile,
  SNAP_THRESHOLD_PX,
} from "@lindocara/engine/prediction.js";
import {
  type ClientMessage,
  type CombatAnimation,
  type Command,
  type CorpseSnapshot,
  type EventCode,
  type EventParams,
  type EventTone,
  type GuardSnapshot,
  type LootSnapshot,
  type MonsterSnapshot,
  type MonsterSpecialImpact,
  type PartyState,
  type PeasantBombImpactVisual,
  type PeasantCampBankVisual,
  type PeasantCampRemovedVisual,
  type PeasantCampVisual,
  type PlayerSnapshot,
  type PriestLumenPortalVisual,
  type PriestPolarityOrbVisual,
  type ProjectileSnapshot,
  parseServerMessage,
  parseWorldColliders,
  type RogueShadowDanceSequence,
  type SelfState,
  type ServerMessage,
  type WorldEventSnapshot,
  type WorldInfo,
} from "@lindocara/engine/protocol.js";
import {
  type Input,
  NETWORK_TICKS_PER_SNAPSHOT,
  NO_INPUT,
  step,
  TICK_DT,
  type Vec2,
} from "@lindocara/engine/simulation.js";
import type { SkillSlot } from "@lindocara/engine/skills.js";
import { decodeTileMap } from "@lindocara/engine/tilemap-codec.js";
import {
  applyEventDelta,
  applyWorldDelta,
  createWorldCache,
  interpolateSnapshots,
  replaceWorldCache,
  seedEventCache,
  type WorldCache,
} from "@lindocara/engine/world-delta.js";
import { DEFAULT_ZONE_ID, zoneDefinition } from "@lindocara/engine/zones.js";
import { resolveJoin } from "../api.js";

// A slightly deeper buffer covers short workerd/browser scheduling bursts, so AI movement stays
// between two authoritative snapshots rather than briefly snapping to the newest one.
const INTERPOLATION_DELAY_MS = 150;
const BUFFER_MS = 1_000;

/**
 * The key the Alepha room stamps on every server->client frame
 * (`WebSocketChannelConnection.ROOM_MARKER`, `.vendor/alepha/src/websocket/services/
 * WebSocketClient.ts`) so a client subscribed to several rooms on one channel socket can tell
 * them apart. This client only ever dials one room per socket, so the marker is pure transport
 * noise here — strip it before the frame reaches `parseServerMessage`, the engine's single
 * wire-parsing authority, so that parser never has to learn about a transport-level key.
 */
const ALEPHA_ROOM_MARKER = "__alephaRoom";

function stripAlephaRoomMarker(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw; // Not valid JSON; parseServerMessage's own JSON.parse rejects it uniformly.
  }
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    ALEPHA_ROOM_MARKER in parsed
  ) {
    delete (parsed as Record<string, unknown>)[ALEPHA_ROOM_MARKER];
    return JSON.stringify(parsed);
  }
  return raw;
}

interface BufferedSnapshot {
  receivedAt: number;
  players: PlayerSnapshot[];
  monsters: MonsterSnapshot[];
  guards: GuardSnapshot[];
  loot: LootSnapshot[];
  projectiles: ProjectileSnapshot[];
}

// SceneSample now lives in the renderer package (both the renderer and the minimap consume it,
// and it is built from engine snapshot types). Imported for internal use and re-exported so
// existing `from "./net"` importers are unaffected; the package edge is client -> renderer.
import type { SceneSample } from "@lindocara/renderer/scene-sample.js";

export type { SceneSample };

export interface Connection {
  attack(): void;
  interact(): void;
  campGold(id: string, operation: "deposit" | "withdraw", amount: number): void;
  usePotion(): void;
  useItem(item: ConsumableId): void;
  buyItem(item: ConsumableId): void;
  release(): void;
  skill(slot: SkillSlot): void;
  releaseSkill(slot: SkillSlot): void;
  unlockTalent(nodeId: string): void;
  resetTalents(): void;
  sendChat(text: string, channel?: "local" | "party"): void;
  partyCreate(): void;
  partyInvite(playerId: string): void;
  partyAccept(inviteId: string): void;
  partyRefuse(inviteId: string): void;
  partyLeave(): void;
  partyKick(playerId: string): void;
  partyDissolve(): void;
  /** Turn the current say page — the two dialogue intents (spec Decision 4). */
  eventAdvance(runId: string): void;
  eventChoose(runId: string, index: number): void;
  questAction(
    conversationId: string,
    action: "accept" | "refuse" | "turn-in" | "close",
    questId?: string,
    rewardChoiceId?: string,
  ): void;
  abandonQuest(questId: string): void;
  close(): void;
}

export interface ConnectionHandlers {
  onWelcome(selfId: string, world: WorldInfo, state: SelfState): void;
  onState(state: SelfState): void;
  onChat(from: string, text: string, channel: "local" | "party"): void;
  onPartyInvite(inviteId: string, fromId: string, from: string, expiresAt: number): void;
  onPartyState(party: PartyState | null): void;
  onMerchantOpen(): void;
  onAnimation(animation: CombatAnimation): void;
  onMonsterSpecialImpact(impact: MonsterSpecialImpact): void;
  onShadowDance(sequence: RogueShadowDanceSequence): void;
  onLumenPortal(portal: PriestLumenPortalVisual): void;
  onPolarityOrb(orb: PriestPolarityOrbVisual): void;
  onPeasantCamp(camp: PeasantCampVisual): void;
  onPeasantCampBank(bank: PeasantCampBankVisual): void;
  onPeasantCampRemoved(camp: PeasantCampRemovedVisual): void;
  onPeasantBombImpact(impact: PeasantBombImpactVisual): void;
  /** A dialogue beat for THIS player's panel (spec Decision 4): a say page, a choices offer, or the
   *  close that ends the run. `text`/`name`/`prompt`/`options` are authored prose, not i18n codes. */
  onEventSay(runId: string, text: string, name?: string): void;
  onEventChoices(runId: string, prompt: string, options: string[]): void;
  onEventClose(runId: string): void;
  onQuestOpen(
    conversationId: string,
    entries: import("@lindocara/engine/protocol.js").QuestDialogueEntry[],
  ): void;
  onQuestResult(
    conversationId: string,
    questId: string,
    speakerName: string,
    title: string,
    text: string,
    outcome: "accepted" | "refused" | "completed" | "failed",
  ): void;
  onQuestClose(conversationId: string): void;
  onEvent(
    code: EventCode,
    params: EventParams | undefined,
    tone: EventTone,
    x?: number,
    y?: number,
  ): void;
  onClose(code: number, reason: string): void;
}

function predictPartial(
  position: Vec2,
  input: Input,
  dt: number,
  geometry: TerrainGeometry,
  speed: number,
): Vec2 {
  return resolveTerrain(
    position,
    step(position, input, dt, movementSpeedAt(position, speed, geometry), geometry),
    geometry,
  );
}

/** Dynamic collision received as gameplay data; visual ids are deliberately never inspected. */
export function harvestEventColliderRects(events: readonly WorldEventSnapshot[]): Rect[] {
  return events.flatMap((event) => {
    const collider = event.harvest?.collider;
    return collider
      ? [{ x: collider[0], y: collider[1], width: collider[2], height: collider[3] }]
      : [];
  });
}

export function terrainWithHarvestEventColliders(
  terrain: TerrainGeometry,
  staticColliders: readonly Rect[],
  events: readonly WorldEventSnapshot[],
): TerrainGeometry {
  return {
    ...terrain,
    colliders: colliderIndexFrom(
      [...staticColliders, ...harvestEventColliderRects(events)],
      terrain.tiles.cols,
      terrain.tiles.rows,
    ),
  };
}

export class WorldClient {
  #socket: WebSocket | null = null;
  /** Set once `connect()`'s `resolveJoin` lands; `null` only before that resolves. `#send` reads
   *  it every send rather than being captured once, so it always reflects the CURRENT socket. */
  #roomId: string | null = null;
  #buffer: BufferedSnapshot[] = [];
  #worldCache: WorldCache = createWorldCache();
  #lastWorldTick: number | null = null;
  #receivedDelta = false;
  #resyncPending = false;
  #predictionBlocked = false;

  #selfId: string | null = null;
  #selfSnapshot: PlayerSnapshot | null = null;
  #life: LifeState = "alive";
  #corpses: CorpseSnapshot[] = [];
  /** The room's active events, maintained from welcome/delta/resync with the same validation rigor
   * as every other collection. Kept off the interpolation buffer: the renderer presents each
   * authoritative NPC step locally. */
  #events: readonly WorldEventSnapshot[] = [];
  #staticColliders: readonly Rect[] = [];
  #predicted: Vec2 | null = null;
  #pending: Command[] = [];
  #seq = 0;
  #ack = 0;
  // Defaults to Verdant Reach only so prediction has *something* to collide against before the
  // first welcome lands. A welcome's `world.zoneId` overwrites this with the zone the player is
  // actually in — without that, every zone but Verdant Reach would predict against its tilemap.
  #geometry: TerrainGeometry = zoneDefinition(DEFAULT_ZONE_ID).terrain;
  #heroSettings: MapHeroSettings = defaultMapHeroSettings();

  #accumulator = 0;
  #input: Input = NO_INPUT;
  #error: Vec2 = { x: 0, y: 0 };
  #errorAt = 0;
  /** Presentation lock matching the server-owned Shadow Dance sequence; inputs still carry seqs. */
  #shadowDanceMovementBlockedUntil = 0;

  get selfId(): string | null {
    return this.#selfId;
  }

  connect(handlers: ConnectionHandlers, identityId: string, partyId: string): Connection {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let closeReported = false;
    const reportClose = (code: number, reason: string) => {
      if (closeReported) return;
      closeReported = true;
      if (this.#socket === socket) this.#socket = null;
      handlers.onClose(code, reason);
    };

    const attachSocket = (url: URL, roomId: string | null) => {
      // `close()` may already have been called while `resolveJoin` was still in flight; opening a
      // socket at this point would leak a connection nothing is going to close.
      if (cancelled) return;
      this.#roomId = roomId;
      const ws = new WebSocket(url);
      socket = ws;
      this.#socket = ws;

      if (
        import.meta.env.DEV &&
        new URLSearchParams(window.location.search).get("navdebug") === "1"
      ) {
        ws.addEventListener("open", () => this.#send({ t: "navigation.debug", enabled: true }));
      }

      ws.addEventListener("message", (event) => {
        const message =
          typeof event.data === "string"
            ? parseServerMessage(stripAlephaRoomMarker(event.data))
            : null;
        if (message) {
          this.#handle(message, handlers);
          return;
        }
        // There is no baseline to resynchronise before welcome. Closing with the WebSocket
        // protocol error code makes the normal reconnect path start a fresh handshake instead of
        // leaving the loading screen behind a resync request the server cannot satisfy for this
        // client state.
        if (this.#selfId === null) ws.close(1002, "invalid welcome");
        else this.#requestResync();
      });

      ws.addEventListener("close", (event) => {
        reportClose(event.code, event.reason);
      });
      ws.addEventListener("error", () => reportClose(1006, "connection error"));
    };

    // Alepha ships its own `WebSocketClient`/`WebSocketChannelConnection`
    // (`.vendor/alepha/src/websocket/services/WebSocketClient.ts`), but it swallows the close
    // event's code and reason and reconnects on a fixed timer of its own. `session.ts`'s
    // reconnect table needs the exact 4001-4008 vocabulary to tell a zone transition from a
    // lost presence lease from a terminal kick, so we open the raw WebSocket ourselves and
    // replicate only the wire envelope. Filed as an upstream feature request: surface the close
    // code/reason on the channel connection and let the caller own retry policy.
    resolveJoin(partyId, identityId)
      .then((join) => {
        const url = new URL(join.channelPath, window.location.href);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("roomId", join.roomId);
        url.searchParams.set("party", partyId);
        url.searchParams.set("hero", identityId);
        attachSocket(url, join.roomId);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("resolveJoin failed", error);
        // No room to dial. 1011 ("internal error") is neither a WS_CLOSE terminal code nor
        // 1008/1009, so `session.ts`'s table treats it as a retryable network condition —
        // bounded reconnect attempts, then the generic disconnect message.
        reportClose(1011, "join resolution failed");
      });

    return {
      attack: () => this.#send({ t: "attack" }),
      interact: () => this.#send({ t: "interact" }),
      campGold: (id, operation, amount) =>
        this.#send({ t: "peasant.camp_gold", id, operation, amount }),
      usePotion: () => this.#send({ t: "use", item: "potion" }),
      useItem: (item) => this.#send({ t: "item.use", item }),
      buyItem: (item) => this.#send({ t: "merchant.buy", item }),
      release: () => this.#send({ t: "release" }),
      skill: (slot) => this.#send({ t: "skill", slot }),
      releaseSkill: (slot) => this.#send({ t: "skill.release", slot }),
      unlockTalent: (nodeId) => this.#send({ t: "talent.unlock", nodeId }),
      resetTalents: () => this.#send({ t: "talent.reset" }),
      sendChat: (text, channel = "local") => this.#send({ t: "chat", channel, text }),
      partyCreate: () => this.#send({ t: "party.create" }),
      partyInvite: (playerId) => this.#send({ t: "party.invite", playerId }),
      partyAccept: (inviteId) => this.#send({ t: "party.accept", inviteId }),
      partyRefuse: (inviteId) => this.#send({ t: "party.refuse", inviteId }),
      partyLeave: () => this.#send({ t: "party.leave" }),
      partyKick: (playerId) => this.#send({ t: "party.kick", playerId }),
      partyDissolve: () => this.#send({ t: "party.dissolve" }),
      eventAdvance: (runId) => this.#send({ t: "event.advance", runId }),
      eventChoose: (runId, index) => this.#send({ t: "event.choose", runId, index }),
      questAction: (conversationId, action, questId, rewardChoiceId) =>
        this.#send({
          t: "quest.action",
          conversationId,
          action,
          ...(questId === undefined ? {} : { questId }),
          ...(rewardChoiceId === undefined ? {} : { rewardChoiceId }),
        }),
      abandonQuest: (questId) => this.#send({ t: "quest.abandon", questId }),
      close: () => {
        // Cancels a still-in-flight resolveJoin too, so it can never attach a socket after the
        // caller has already walked away.
        cancelled = true;
        socket?.close(1000, "client left");
      },
    };
  }

  update(input: Input, dt: number): void {
    if (this.#predicted === null) return;
    this.#input = input;
    // A corpse is frozen over its body; a ghost walks, and faster than the living.
    if (this.#selfSnapshot && !canMove(this.#selfSnapshot.life)) return;
    const speed = speedForLife(
      this.#selfSnapshot?.life ?? "alive",
      this.#selfSnapshot?.class ?? "warrior",
      mapHeroClassSettings(this.#heroSettings, this.#selfSnapshot?.class ?? "warrior").stats
        .movementSpeed,
    );

    this.#accumulator = Math.min(this.#accumulator + dt, MAX_ACCUMULATED_SECONDS);
    while (this.#accumulator >= TICK_DT) {
      if (this.#predictionBlocked || this.#pending.length >= MAX_PENDING_COMMANDS) {
        this.#predictionBlocked = true;
        this.#accumulator = 0;
        this.#requestResync();
        return;
      }
      this.#accumulator -= TICK_DT;

      const seq = ++this.#seq;
      const command = { seq, input };
      this.#pending.push(command);
      if (performance.now() >= this.#shadowDanceMovementBlockedUntil)
        this.#predicted = predictStep(this.#predicted, command, this.#geometry, speed);
      this.#send({ t: "input", seq, input });
    }
  }

  sample(now: number): SceneSample {
    const newest = this.#buffer[this.#buffer.length - 1];
    if (!newest)
      return {
        players: [],
        monsters: [],
        guards: [],
        loot: [],
        corpses: [],
        projectiles: [],
        events: this.#events,
      };

    const interpolated = {
      ...this.#sampleInterpolated(now, newest),
      corpses: this.#corpses,
      events: this.#events,
    };
    const self = this.#sampleSelf(now);
    if (!self) return interpolated;
    return {
      ...interpolated,
      players: [...interpolated.players.filter((player) => player.id !== self.id), self],
    };
  }

  /**
   * The terrain the server actually sent, as the geometry prediction collides against.
   *
   * `spawnPoints` is empty on purpose: only the server picks where anyone appears, and a client
   * that carried a list of spawns would be carrying an opinion it is not entitled to have.
   *
   * The collider index is rebuilt from `world.colliders` — the flat rects the server already
   * baked — never re-derived from `world.elements`. `elements` is appearance only; a client that
   * baked its own colliders from it would be a second, disagreeing bake of the same rectangles.
   */
  static geometryFrom(world: WorldInfo): TerrainGeometry {
    const tiles = decodeTileMap(world.tiles);
    const staticColliders = parseWorldColliders(world.colliders) ?? [];
    return terrainWithHarvestEventColliders(
      {
        width: world.width,
        height: world.height,
        obstacles: world.obstacles,
        spawnPoints: [],
        safeZone: world.safeZone,
        tiles,
        colliders: colliderIndexFrom(staticColliders, tiles.cols, tiles.rows),
      },
      staticColliders,
      world.events,
    );
  }

  #installEventColliders(events: readonly WorldEventSnapshot[]): void {
    this.#geometry = terrainWithHarvestEventColliders(
      this.#geometry,
      this.#staticColliders,
      events,
    );
  }

  #handle(message: ServerMessage, handlers: ConnectionHandlers): void {
    if (message.t === "welcome") {
      this.#selfId = message.selfId;
      this.#corpses = message.corpses;
      // Collide against the terrain the server sent, not a copy this build happens to have
      // compiled in. `parseServerMessage` has already checked it decodes, so these are the exact
      // bytes the authority baked — the client cannot disagree with a map it did not compute.
      this.#staticColliders = parseWorldColliders(message.world.colliders) ?? [];
      this.#geometry = WorldClient.geometryFrom(message.world);
      this.#heroSettings = message.world.heroSettings ?? defaultMapHeroSettings();
      replaceWorldCache(this.#worldCache, message);
      // Events ride inside `world`, not the top-level view; seed their baseline from there.
      seedEventCache(this.#worldCache, message.world.events);
      this.#events = message.world.events;
      this.#lastWorldTick = message.tick;
      this.#receivedDelta = false;
      this.#resyncPending = false;
      this.#predictionBlocked = false;
      this.#shadowDanceMovementBlockedUntil = 0;
      this.#push(
        message.players,
        message.monsters,
        message.guards,
        message.loot,
        message.projectiles,
      );
      const self = message.players.find((player) => player.id === message.selfId);
      if (self) {
        this.#selfSnapshot = self;
        this.#predicted = { x: self.x, y: self.y };
        this.#ack = self.ack;
      }
      handlers.onWelcome(message.selfId, message.world, message.self);
      return;
    }
    if (message.t === "world.delta") {
      const tickGap = this.#lastWorldTick === null ? 0 : message.tick - this.#lastWorldTick;
      if (tickGap <= 0 || (this.#receivedDelta && tickGap !== NETWORK_TICKS_PER_SNAPSHOT)) {
        this.#requestResync();
        return;
      }
      const view = applyWorldDelta(this.#worldCache, message);
      if (!view) {
        this.#requestResync();
        return;
      }
      // Events are validated with the same rigor: an unknown removal or duplicate upsert yields
      // null and one bounded resync, exactly like a malformed positional delta.
      const events = applyEventDelta(this.#worldCache, message.events);
      if (!events) {
        this.#requestResync();
        return;
      }
      this.#events = events;
      this.#installEventColliders(events);
      this.#lastWorldTick = message.tick;
      this.#receivedDelta = true;
      this.#corpses = view.corpses;
      const receivedAt = this.#push(
        view.players,
        view.monsters,
        view.guards,
        view.loot,
        view.projectiles,
      );
      this.#reconcile(view.players, receivedAt);
      return;
    }
    if (message.t === "world.resync") {
      replaceWorldCache(this.#worldCache, message);
      seedEventCache(this.#worldCache, message.events);
      this.#events = message.events;
      this.#installEventColliders(message.events);
      this.#lastWorldTick = message.tick;
      this.#receivedDelta = false;
      this.#resyncPending = false;
      this.#corpses = message.corpses;
      this.#buffer = [];
      const receivedAt = this.#push(
        message.players,
        message.monsters,
        message.guards,
        message.loot,
        message.projectiles,
      );
      this.#reconcile(message.players, receivedAt);
      this.#predictionBlocked = false;
      return;
    }
    if (message.t === "world.resync_required") {
      this.#requestResync();
      return;
    }
    if (message.t === "state") {
      handlers.onState(message.self);
      return;
    }
    if (message.t === "chat") {
      handlers.onChat(message.from, message.text, message.channel === "party" ? "party" : "local");
      return;
    }
    if (message.t === "party.invite") {
      handlers.onPartyInvite(message.inviteId, message.fromId, message.from, message.expiresAt);
      return;
    }
    if (message.t === "party.state") {
      handlers.onPartyState(message.party);
      return;
    }
    if (message.t === "merchant.open") {
      handlers.onMerchantOpen();
      return;
    }
    if (message.t === "animation") {
      handlers.onAnimation(message);
      return;
    }
    if (message.t === "monster.special_impact") {
      handlers.onMonsterSpecialImpact(message);
      return;
    }
    if (message.t === "rogue.shadow_dance") {
      if (message.actorId === this.#selfId) {
        this.#predicted = { ...message.finalPosition };
        this.#error = { x: 0, y: 0 };
        this.#shadowDanceMovementBlockedUntil =
          performance.now() + Math.max(0, message.endsAt - message.startedAt);
      }
      handlers.onShadowDance(message);
      return;
    }
    if (message.t === "priest.lumen_portal") {
      handlers.onLumenPortal(message);
      return;
    }
    if (message.t === "priest.polarity_orb") {
      handlers.onPolarityOrb(message);
      return;
    }
    if (message.t === "peasant.camp") {
      handlers.onPeasantCamp(message);
      return;
    }
    if (message.t === "peasant.camp_bank") {
      handlers.onPeasantCampBank(message);
      return;
    }
    if (message.t === "peasant.camp_removed") {
      handlers.onPeasantCampRemoved(message);
      return;
    }
    if (message.t === "peasant.bomb_impact") {
      handlers.onPeasantBombImpact(message);
      return;
    }
    if (message.t === "event.say") {
      handlers.onEventSay(message.runId, message.text, message.name);
      return;
    }
    if (message.t === "event.choices") {
      handlers.onEventChoices(message.runId, message.prompt, message.options);
      return;
    }
    if (message.t === "event.close") {
      handlers.onEventClose(message.runId);
      return;
    }
    if (message.t === "quest.open") {
      handlers.onQuestOpen(message.conversationId, message.entries);
      return;
    }
    if (message.t === "quest.result") {
      handlers.onQuestResult(
        message.conversationId,
        message.questId,
        message.speakerName,
        message.title,
        message.text,
        message.outcome,
      );
      return;
    }
    if (message.t === "quest.close") {
      handlers.onQuestClose(message.conversationId);
      return;
    }
    handlers.onEvent(message.code, message.params, message.tone, message.x, message.y);
  }

  #push(
    players: PlayerSnapshot[],
    monsters: MonsterSnapshot[],
    guards: GuardSnapshot[],
    loot: LootSnapshot[],
    projectiles: ProjectileSnapshot[],
  ): number {
    const receivedAt = performance.now();
    this.#buffer.push({ receivedAt, players, monsters, guards, loot, projectiles });
    const cutoff = receivedAt - BUFFER_MS;
    while (this.#buffer.length > 2 && (this.#buffer[0]?.receivedAt ?? 0) < cutoff) {
      this.#buffer.shift();
    }
    return receivedAt;
  }

  #reconcile(players: PlayerSnapshot[], now: number): void {
    if (this.#selfId === null || this.#predicted === null) return;

    const authoritative = players.find((player) => player.id === this.#selfId);
    if (!authoritative) return;
    this.#selfSnapshot = authoritative;

    const drawnBefore = this.#samplePredictedPosition();
    const previousLife = this.#life;
    this.#life = authoritative.life;
    this.#ack = authoritative.ack;
    this.#pending = prunePending(this.#pending, authoritative.ack);

    // Every life transition is a teleport or a freeze, and the server drops its queue across
    // one. Replaying commands buffered under the old life state — at the old speed, from the
    // old place — is exactly the desync this whole mechanism exists to prevent. Snap instead.
    const transitioned = previousLife !== authoritative.life;
    if (
      transitioned ||
      authoritative.life === "corpse" ||
      this.#pending.length > MAX_PENDING_COMMANDS
    ) {
      this.#pending = [];
      this.#predicted = { x: authoritative.x, y: authoritative.y };
      this.#error = { x: 0, y: 0 };
      return;
    }

    this.#predicted = reconcile(
      { x: authoritative.x, y: authoritative.y },
      this.#pending,
      this.#geometry,
      authoritative.life,
      authoritative.class,
      mapHeroClassSettings(this.#heroSettings, authoritative.class).stats.movementSpeed,
    );

    const drawnAfter = this.#samplePredictedPosition();
    const error = { x: drawnBefore.x - drawnAfter.x, y: drawnBefore.y - drawnAfter.y };

    if (Math.hypot(error.x, error.y) > SNAP_THRESHOLD_PX) {
      this.#error = { x: 0, y: 0 };
      return;
    }

    this.#error = error;
    this.#errorAt = now;
  }

  #samplePredictedPosition(): Vec2 {
    const life = this.#selfSnapshot?.life ?? "alive";
    if (this.#predicted === null || !canMove(life)) {
      return this.#predicted ?? { x: 0, y: 0 };
    }
    return predictPartial(
      this.#predicted,
      this.#input,
      this.#accumulator,
      this.#geometry,
      speedForLife(
        life,
        this.#selfSnapshot?.class ?? "warrior",
        mapHeroClassSettings(this.#heroSettings, this.#selfSnapshot?.class ?? "warrior").stats
          .movementSpeed,
      ),
    );
  }

  #sampleSelf(now: number): PlayerSnapshot | null {
    if (!this.#selfSnapshot || this.#predicted === null) return null;
    const position = this.#samplePredictedPosition();
    const elapsed = now - this.#errorAt;
    const decay = Math.max(0, 1 - elapsed / CORRECTION_SMOOTHING_MS);

    // Predict facing from the held input, exactly as the server derives it from a dequeued command,
    // so your own sprite flips the frame you press a direction instead of waiting a round trip for
    // the server's facing to come back in a snapshot. Standing still keeps the last facing; a frozen
    // corpse never turns. The server stays authoritative for combat facing (frozen at wind-up).
    const facing = canMove(this.#selfSnapshot.life)
      ? facingFromInput(this.#input, this.#selfSnapshot.facing)
      : this.#selfSnapshot.facing;

    return {
      ...this.#selfSnapshot,
      x: position.x + this.#error.x * decay,
      y: position.y + this.#error.y * decay,
      ack: this.#ack,
      facing,
    };
  }

  #sampleInterpolated(
    now: number,
    newest: BufferedSnapshot,
  ): Omit<SceneSample, "corpses" | "events"> {
    if (this.#buffer.length === 1) {
      return {
        players: newest.players.filter((player) => player.id !== this.#selfId),
        monsters: newest.monsters,
        guards: newest.guards,
        loot: newest.loot,
        projectiles: newest.projectiles,
      };
    }

    const renderAt = now - INTERPOLATION_DELAY_MS;
    if (renderAt >= newest.receivedAt) {
      return {
        players: newest.players.filter((player) => player.id !== this.#selfId),
        monsters: newest.monsters,
        guards: newest.guards,
        loot: newest.loot,
        projectiles: newest.projectiles,
      };
    }

    let older = this.#buffer[0];
    let newer = newest;
    for (let i = 0; i < this.#buffer.length - 1; i++) {
      const a = this.#buffer[i];
      const b = this.#buffer[i + 1];
      if (a && b && a.receivedAt <= renderAt && renderAt <= b.receivedAt) {
        older = a;
        newer = b;
        break;
      }
    }
    if (!older) {
      return {
        players: newest.players.filter((player) => player.id !== this.#selfId),
        monsters: newest.monsters,
        guards: newest.guards,
        loot: newest.loot,
        projectiles: newest.projectiles,
      };
    }
    const span = newer.receivedAt - older.receivedAt;
    const alpha = span <= 0 ? 1 : Math.max(0, Math.min(1, (renderAt - older.receivedAt) / span));
    return {
      players: interpolateSnapshots(older.players, newer.players, alpha).filter(
        (player) => player.id !== this.#selfId,
      ),
      monsters: interpolateSnapshots(older.monsters, newer.monsters, alpha),
      guards: interpolateSnapshots(older.guards, newer.guards, alpha),
      loot: newer.loot,
      projectiles: interpolateSnapshots(older.projectiles, newer.projectiles, alpha),
    };
  }

  #send(message: ClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    // The room-scoped envelope (`{roomId, message}`, matching Alepha's own
    // `WebSocketChannelConnection.send`). `#roomId` is only `null` in the brief window before
    // `connect()`'s `resolveJoin` has landed; the socket isn't open yet either, so the branch
    // above already returns before this matters in practice.
    const frame: unknown = this.#roomId === null ? message : { roomId: this.#roomId, message };
    this.#socket.send(JSON.stringify(frame));
  }

  #requestResync(): void {
    if (this.#resyncPending) return;
    this.#resyncPending = true;
    this.#send({ t: "world.resync" });
  }
}
