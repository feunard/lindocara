import type { ConsumableId } from "@lindocara/engine/consumables.js";
import { canMove, speedForLife } from "@lindocara/engine/death.js";
import type { GroundVector, WorldPosition } from "@lindocara/engine/ground.js";
import type { HeroEvent } from "@lindocara/engine/hd2d/hero-state.js";
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import {
  defaultMapHeroSettings,
  type MapHeroSettings,
  mapHeroClassSettings,
} from "@lindocara/engine/map-hero-settings.js";
import {
  type ClientMessage,
  type CombatAnimation,
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
  type PriestLumenTrailVisual,
  type PriestPolarityOrbVisual,
  type ProjectileSnapshot,
  parseServerMessage,
  type RogueShadowDanceSequence,
  type SelfState,
  type ServerMessage,
  type WorldEventSnapshot,
  type WorldInfo,
} from "@lindocara/engine/protocol.js";
import { type Input, NETWORK_TICKS_PER_SNAPSHOT, TICK_MS } from "@lindocara/engine/simulation.js";
import type { SkillSlot } from "@lindocara/engine/skills.js";
import { type ZoneTerrain, zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import {
  applyEventDelta,
  applyWorldDelta,
  createWorldCache,
  interpolateSnapshots,
  replaceWorldCache,
  seedEventCache,
  type WorldCache,
} from "@lindocara/engine/world-delta.js";
import { resolveJoin } from "../api.js";
import { createHeroController, type HeroController } from "./hero-controller.js";

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
  skill(slot: SkillSlot, direction?: GroundVector): void;
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
  onLumenTrail(trail: PriestLumenTrailVisual): void;
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
  /** `x`/`z` — the GROUND point the event is anchored at, when it has one. */
  onEvent(
    code: EventCode,
    params: EventParams | undefined,
    tone: EventTone,
    x?: number,
    z?: number,
  ): void;
  onClose(code: number, reason: string): void;
}

/**
 * How often the hero reports where it is, in milliseconds.
 *
 * **This is a client concern, and it is load-bearing.** The room drops a connection above
 * `RATE_MAX_MESSAGES` (35) frames per `RATE_WINDOW_MS` (1 s) — nothing in `MoveMessage` states a
 * cadence, so a controller reporting once per animation frame (60 Hz) trips that window and has its
 * socket closed with 1008. One report per simulation tick is exactly the rate the retired
 * `{t:"input"}` command stream ran at, so it is already proven to sit inside the window with room
 * for chat, actions and resyncs beside it.
 *
 * The hero still STEPS every animation frame — only the report is throttled. Between two reports
 * every other client draws it interpolated, which is what `INTERPOLATION_DELAY_MS` has always been
 * for.
 */
const MOVE_REPORT_MS = TICK_MS;

/**
 * A frame can be arbitrarily long — a backgrounded tab resumes with a multi-second delta. Feeding
 * that to `stepHero` in one call would advance the hero by seconds of travel in a single step,
 * straight through any collision its stride jumped over. Five ticks' worth, the ceiling client
 * prediction used for the same reason.
 */
const MAX_FRAME_SECONDS = 5 * (TICK_MS / 1_000);

/**
 * How many reported positions are remembered when deciding whether an authoritative position is the
 * server echoing us back or the server MOVING us (`#adoptServerPosition`). Two seconds at the
 * cadence above — comfortably more than any round trip, and the buffer only advances while the hero
 * is actually reporting, so an idle hero's last report never ages out from under it.
 */
const REPORT_HISTORY = 40;

/** Half the quantum the server rounds a snapshot position to (1/6400 of a tile, `interest-system`),
 *  so an echo compares equal despite the rounding and a real displacement never does. */
const ECHO_EPSILON = 1 / 3_200;

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

  #selfId: string | null = null;
  #selfSnapshot: PlayerSnapshot | null = null;
  #corpses: CorpseSnapshot[] = [];
  /** The room's active events, maintained from welcome/delta/resync with the same validation rigor
   * as every other collection. Kept off the interpolation buffer: the renderer presents each
   * authoritative NPC step locally. */
  #events: readonly WorldEventSnapshot[] = [];
  /**
   * The hero itself. It owns its own `HeroState` and runs `stepHero` — the client is the authority
   * on where this one body is (the S3 spec, decision 4), and the server stores what it reports.
   * `null` until the first welcome has given it a terrain to collide against.
   */
  #hero: HeroController | null = null;
  /**
   * The terrain the hero collides against: the room's own, baked from the welcome's heightfield
   * with `zoneTerrainFromHeightfield` — the very function the server called on the very same
   * string. One bake, one geometry, no drift between what the client walks on and what the server
   * resolves monsters and projectiles against.
   *
   * `null` until the first welcome. The hero simply does not step rather than stepping against a
   * stand-in geometry.
   */
  #terrain: ZoneTerrain | null = null;
  #heroSettings: MapHeroSettings = defaultMapHeroSettings();

  /** Positions already reported, newest last — see `REPORT_HISTORY`. */
  #reported: WorldPosition[] = [];
  #reportedAt = 0;
  /** The exact frame last put on the wire, so an unchanged hero reports nothing at all. */
  #lastReport: string | null = null;

  /** Presentation lock matching the server-owned Shadow Dance sequence: the hero keeps stepping
   *  (gravity, water and thin ice do not pause) but is fed no input for its duration. */
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
      skill: (slot, direction) =>
        this.#send({ t: "skill", slot, ...(direction === undefined ? {} : { direction }) }),
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

  /**
   * One animation frame of the hero: run its movement rule, then report where it ended up if the
   * cadence allows. Returns what the step CAUSED, so a caller can play footsteps, splashes and the
   * canopy — nothing consumes them yet.
   *
   * The step runs every frame; only the report is throttled (see `MOVE_REPORT_MS`).
   */
  update(input: Input, dt: number): HeroEvent[] {
    const hero = this.#hero;
    if (!hero) return [];
    const life = this.#selfSnapshot?.life ?? "alive";
    const playerClass = this.#selfSnapshot?.class ?? "warrior";
    // A corpse is frozen over its body; a ghost walks, and faster than the living. The rule reads
    // one speed, so the life state is folded into it rather than branched on twice.
    hero.setSpeed(
      speedForLife(
        life,
        playerClass,
        mapHeroClassSettings(this.#heroSettings, playerClass).stats.movementSpeed,
      ),
    );

    // A corpse does not move at all, and a server-owned Shadow Dance sequence owns the body for its
    // duration — both feed the rule no input rather than skipping the step, so gravity, the water
    // and the thin ice keep running underneath.
    const frozen = !canMove(life) || performance.now() < this.#shadowDanceMovementBlockedUntil;
    const events = hero.step(
      {
        x: frozen ? 0 : Number(input.right) - Number(input.left),
        z: frozen ? 0 : Number(input.down) - Number(input.up),
        jump: !frozen && (input.jump ?? false),
      },
      Math.min(Math.max(dt, 0), MAX_FRAME_SECONDS),
    );
    this.#report();
    return events;
  }

  /**
   * Puts the hero's position on the wire, at most once per `MOVE_REPORT_MS` and only when something
   * about it actually changed. An idle hero reports nothing: the last frame the server received is
   * still true, and re-sending it 20 times a second would spend the rate window on saying nothing.
   */
  #report(): void {
    const hero = this.#hero;
    if (!hero) return;
    const now = performance.now();
    if (now - this.#reportedAt < MOVE_REPORT_MS) return;
    const { state } = hero;
    // All three axes: `x`/`z` are the ground and `y` is ELEVATION. `facing` comes from the
    // controller, which guarantees unit length — `isDirection` drops the whole frame otherwise.
    const message: ClientMessage = {
      t: "move",
      x: state.x,
      y: state.y,
      z: state.z,
      facing: { x: hero.facing.x, z: hero.facing.z },
      airborne: state.airborne,
      swimming: state.swimming,
      gliding: state.gliding,
    };
    const encoded = JSON.stringify(message);
    if (encoded === this.#lastReport) return;
    this.#reportedAt = now;
    this.#lastReport = encoded;
    this.#rememberReported({ x: state.x, y: state.y, z: state.z });
    this.#send(message);
  }

  #rememberReported(position: WorldPosition): void {
    this.#reported.push(position);
    if (this.#reported.length > REPORT_HISTORY) this.#reported.shift();
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
    const self = this.#sampleSelf();
    if (!self) return interpolated;
    return {
      ...interpolated,
      players: [...interpolated.players.filter((player) => player.id !== self.id), self],
    };
  }

  /**
   * The terrain the server actually sent, as the geometry the hero collides against.
   *
   * The SAME function the server ran on the SAME string (`zoneTerrainFromHeightfield`), which is
   * what keeps the ground the client walks on identical to the one the server resolves monsters,
   * projectiles and authored teleports against. There is nothing here for the client to have an
   * opinion about: no spawn list (only the server picks where anyone appears), and no collider bake
   * of its own — the heightfield's `colliders` are the rectangles the server indexed, and
   * re-deriving them from `elements` would be a second, disagreeing bake.
   *
   * `null` when the welcome's heightfield does not decode. `parseServerMessage` has already refused
   * such a frame, so this is unreachable from a real socket; no hero at all is still the honest
   * answer to a map this build cannot read.
   */
  static terrainFrom(world: WorldInfo): ZoneTerrain | null {
    const map = decodeMap(world.heightfield);
    return map === null ? null : zoneTerrainFromHeightfield(map);
  }

  #handle(message: ServerMessage, handlers: ConnectionHandlers): void {
    if (message.t === "welcome") {
      this.#selfId = message.selfId;
      this.#corpses = message.corpses;
      // Collide against the terrain the server sent, not a copy this build happens to have
      // compiled in. `parseServerMessage` has already checked it decodes, so these are the exact
      // bytes the authority baked — the client cannot disagree with a map it did not compute.
      this.#terrain = WorldClient.terrainFrom(message.world);
      this.#heroSettings = message.world.heroSettings ?? defaultMapHeroSettings();
      replaceWorldCache(this.#worldCache, message);
      // Events ride inside `world`, not the top-level view; seed their baseline from there.
      seedEventCache(this.#worldCache, message.world.events);
      this.#events = message.world.events;
      this.#lastWorldTick = message.tick;
      this.#receivedDelta = false;
      this.#resyncPending = false;
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
        // A welcome is a new room: a fresh hero on the new map's terrain, seeded at the position
        // and heading the server admitted it with. `facing` came off the wire already unit-length
        // (`isDirection`), and the controller normalises it again anyway.
        this.#hero = this.#terrain
          ? createHeroController({
              terrain: this.#terrain,
              spawn: { x: self.x, y: self.y, z: self.z },
              speed: speedForLife(
                self.life,
                self.class,
                mapHeroClassSettings(this.#heroSettings, self.class).stats.movementSpeed,
              ),
              facing: self.facing,
            })
          : null;
        // Seeded, not empty: until the hero has reported anything of its own, the position the
        // server keeps relaying IS this one, and an empty history would read it as a server-authored
        // displacement and re-snap the hero on every snapshot.
        this.#reported = [{ x: self.x, y: self.y, z: self.z }];
        this.#lastReport = null;
        this.#reportedAt = 0;
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
        // The sequence carries a GROUND landing; the controller resolves the elevation from the
        // terrain under it rather than inventing one here.
        this.#hero?.teleport({
          x: message.finalPosition.x,
          y: this.#hero.state.y,
          z: message.finalPosition.z,
        });
        this.#rememberReportedFromHero();
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
    if (message.t === "priest.lumen_trail") {
      handlers.onLumenTrail(message);
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
    handlers.onEvent(message.code, message.params, message.tone, message.x, message.z);
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

  /**
   * Reads the authoritative self snapshot for everything the server still owns — life, health,
   * class, equipment, the combat action — and, when the position in it is one this client never
   * reported, adopts it.
   *
   * The hero's position is the client's (the S3 spec, decision 4), so the server normally echoes
   * back what it was told and there is nothing to do: no replay, no correction smearing, no pending
   * queue. But the server DOES still move a hero on its own — an authored teleport, a resurrection,
   * a Pas de Lumen landing — and a client that ignored that would walk straight back out of it.
   * Comparing against what was actually reported is what tells the two apart; a stale echo is still
   * an echo, which is why a window of recent reports is kept rather than only the newest.
   */
  #reconcile(players: PlayerSnapshot[], _now: number): void {
    if (this.#selfId === null) return;

    const authoritative = players.find((player) => player.id === this.#selfId);
    if (!authoritative) return;
    this.#selfSnapshot = authoritative;
    this.#adoptServerPosition(authoritative);
  }

  #adoptServerPosition(authoritative: PlayerSnapshot): void {
    const hero = this.#hero;
    if (!hero) return;
    const echoed = this.#reported.some(
      (reported) =>
        Math.abs(reported.x - authoritative.x) <= ECHO_EPSILON &&
        Math.abs(reported.y - authoritative.y) <= ECHO_EPSILON &&
        Math.abs(reported.z - authoritative.z) <= ECHO_EPSILON,
    );
    if (echoed) return;
    // All three axes, and momentum cut: a hero the server moved did not walk there.
    hero.teleport({ x: authoritative.x, y: authoritative.y, z: authoritative.z });
    this.#reported = [];
    this.#rememberReportedFromHero();
    // The next frame must actually report the adopted position, even if the encoded frame happens
    // to match the one before the snap.
    this.#lastReport = null;
    this.#reportedAt = 0;
  }

  #rememberReportedFromHero(): void {
    const hero = this.#hero;
    if (!hero) return;
    this.#rememberReported({ x: hero.state.x, y: hero.state.y, z: hero.state.z });
  }

  /**
   * The self entry of a scene sample: the server's own snapshot with this client's position, its
   * three locomotion flags and its heading written over it. Your own hero is drawn in the present —
   * it always was; what changed is that the present is now a fact rather than a prediction, so
   * there is no correction left to smear.
   */
  #sampleSelf(): PlayerSnapshot | null {
    const hero = this.#hero;
    if (!this.#selfSnapshot || !hero) return null;
    const { state } = hero;
    return {
      ...this.#selfSnapshot,
      x: state.x,
      y: state.y,
      z: state.z,
      airborne: state.airborne,
      swimming: state.swimming,
      gliding: state.gliding,
      // The client's own heading, not the round-trip-stale one in the snapshot: the sprite must
      // flip the frame a direction is pressed. The server stays authoritative for COMBAT facing,
      // which is frozen at wind-up and lives on `action`, not here.
      facing: { x: hero.facing.x, z: hero.facing.z },
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
