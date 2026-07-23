import type { PrimaryColor } from "@lindocara/engine/character.js";
import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import type { ConsumableId } from "@lindocara/engine/consumables.js";
import { isSpirit } from "@lindocara/engine/death.js";
import { INTERACTION_RANGE, isMonsterSpecies, pointDistance } from "@lindocara/engine/game.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import type { MerchantDefinition } from "@lindocara/engine/merchant.js";
import type {
  CombatAnimation,
  EventCode,
  EventParams,
  PlayerSnapshot,
  QuestState,
  SelfState,
} from "@lindocara/engine/protocol.js";
import { NO_INPUT, type Vec2 } from "@lindocara/engine/simulation.js";
import type { SkillSlot } from "@lindocara/engine/skills.js";
import { decodeTileMap } from "@lindocara/engine/tilemap-codec.js";
import {
  DEFAULT_ZONE_ID,
  isKnownZone,
  type ZoneId,
  zoneDefinition,
} from "@lindocara/engine/zones.js";
import { getDisplaySettings } from "@lindocara/renderer/display-settings.js";
import { healingEffectColor, shouldFloatEvent } from "@lindocara/renderer/feedback.js";
import { trackActions, trackInput } from "@lindocara/renderer/input.js";
import { type InteriorDoor, nearestInterior } from "@lindocara/renderer/interiors.js";
import { MapSurface } from "@lindocara/renderer/minimap-surface.js";
import { type RenderContext, Renderer } from "@lindocara/renderer/renderer.js";
import { ServerClock } from "@lindocara/renderer/server-clock.js";
import { type CharacterSummary, logout, type PartyListing, type StoredHero } from "../api.js";
import { t } from "../i18n.js";
import { type LocalizedText, useUiStore } from "../store.js";
import { clientCooldownDeadlines } from "./cooldown-sync.js";
import { type Connection, type ConnectionHandlers, WorldClient } from "./net.js";
import { type PartyTargetResolution, resolvePartyTarget } from "./party.js";
import { GameSound } from "./sound.js";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`index.html is missing ${selector}`);
  return element;
}

const sound = new GameSound();
let activeLaunchId = 0;
let stopActiveSession: (() => void) | null = null;

function stopCurrentSession(): void {
  stopActiveSession?.();
}

/** The store is the single source of truth for whether the interior panel is open;
 *  InteriorOverlay renders it from `interiorDoorId`. */
function interiorOpen(): boolean {
  return useUiStore.getState().interiorDoorId !== null;
}

function settingsOpen(): boolean {
  return useUiStore.getState().settingsOpen;
}

function talentsOpen(): boolean {
  return useUiStore.getState().talentsOpen;
}

function gameplayPaused(): boolean {
  const store = useUiStore.getState();
  return (
    interiorOpen() ||
    settingsOpen() ||
    talentsOpen() ||
    store.inventoryOpen ||
    store.merchantOpen ||
    store.heroLoading !== null
  );
}

function heroLoadingColor(
  identity: CharacterSummary | StoredHero,
  persistentParty: PartyListing | null,
): PrimaryColor {
  if ("appearance" in identity) return identity.appearance.primaryColor;
  switch (persistentParty?.myColor) {
    case "red":
      return "ember";
    case "yellow":
      return "moss";
    case "purple":
      return "violet";
    default:
      return "azure";
  }
}

function setStatus(key: MessageKey, params?: Record<string, string | number>): void {
  const status: LocalizedText = params === undefined ? { key } : { key, params };
  useUiStore.getState().setStatus(status);
}

function renderState(state: SelfState): void {
  useUiStore.getState().setSelfState(state);
  useUiStore.getState().setQuestStatus(state.quest.status);
}

function openInterior(door: InteriorDoor): void {
  useUiStore.getState().setInteriorDoorId(door.id);
}

function closeInterior(): void {
  useUiStore.getState().setInteriorDoorId(null);
}

function renderPlayer(player: PlayerSnapshot | undefined, corpse: Vec2 | null): void {
  useUiStore.getState().setSelf(
    player
      ? {
          id: player.id,
          nick: player.nick,
          level: player.level,
          hp: player.hp,
          maxHp: player.maxHp,
          life: player.life,
          // Rounded, so a walking ghost does not re-render the HUD every frame.
          corpseDistance:
            player.life === "ghost" && corpse ? Math.round(pointDistance(player, corpse)) : null,
          class: player.class,
          appearance: { ...player.appearance },
          equipment: { ...player.equipment },
          guarding: player.guarding === true,
        }
      : null,
  );
}

/** Resolve species/kind params to localized names, then apply the event template. */
function eventText(
  code: EventCode,
  params: EventParams = {},
  playerClass?: PlayerSnapshot["class"],
): string {
  const resolved: EventParams = { ...params };
  if (typeof resolved.species === "string") {
    resolved.species = t(`monster.${resolved.species}` as MessageKey);
  }
  if (typeof resolved.kind === "string") {
    resolved.kind = t(`item.${resolved.kind}` as MessageKey);
  }
  if (typeof resolved.item === "string") {
    resolved.item = t(`consumable.${resolved.item}.name` as MessageKey);
  }
  if (typeof resolved.currency === "string") {
    resolved.currency = t(
      `item.${resolved.currency === "crystals" ? "crystal" : resolved.currency}` as MessageKey,
    );
  }
  if (typeof resolved.skill === "string" && playerClass) {
    resolved.skill = t(`skill.${playerClass}.${resolved.skill}.name` as MessageKey);
  }
  if (typeof resolved.chapter === "string") {
    resolved.chapter = t(`quest.${resolved.chapter}.name` as MessageKey);
  }
  if (typeof resolved.site === "string") {
    resolved.site = t(`quest.site.${resolved.site}` as MessageKey);
  }
  if (typeof resolved.nameKey === "string") {
    resolved.name = t(resolved.nameKey as MessageKey);
  }
  return t(`event.${code}` as MessageKey, resolved);
}

/** Your own hits spam the combat log; everything else is worth a line. */
function shouldLogEvent(code: EventCode): boolean {
  return code !== "combat.hit" && code !== "quest.site_harvested";
}

function healingSkillId(value: unknown): "mend" | "prayer" | "divine_nova" {
  return value === "prayer" || value === "divine_nova" ? value : "mend";
}

function updatePrompt(
  self: PlayerSnapshot | undefined,
  quest: QuestState,
  interiorDoor: InteriorDoor | undefined,
  zoneId: ZoneId,
  merchant: MerchantDefinition | null,
): void {
  let result: LocalizedText | null = null;
  // Prompt.tsx hides the floating prompt whenever the interior panel is open, so a
  // "close_interior" key here would never render - don't bother computing one. A D1 map has no
  // catalogue quests or interiors either, so `zoneDefinition`'s fallback-to-Verdant must not be
  // allowed to conjure a phantom quest prompt over a user map.
  if (interiorOpen() || !self || isSpirit(self.life)) {
    result = null;
  } else if (merchant && pointDistance(self, merchant) <= INTERACTION_RANGE) {
    result = { key: "prompt.merchant" };
  } else if (!isKnownZone(zoneId)) {
    result = null;
  } else {
    const chapter = quest.chapter ?? "three_offerings";
    const zone = zoneDefinition(zoneId);
    const definition = zone.quests.find((candidate) => candidate.id === chapter);
    if (!definition) {
      useUiStore.getState().setPrompt(null);
      return;
    }
    const giver = definition.giver;
    const nearNpc = pointDistance(self, giver) <= INTERACTION_RANGE;
    const site = zone.questSites.find(
      (candidate) =>
        candidate.chapter === chapter && pointDistance(self, candidate) <= INTERACTION_RANGE,
    );
    if (interiorDoor && !nearNpc) {
      result = { key: "prompt.look_inside", params: { name: t(interiorDoor.nameKey) } };
    } else if (
      nearNpc &&
      (quest.status === "available" || quest.status === "ready" || quest.status === "completed")
    ) {
      result = {
        key:
          quest.status === "available"
            ? "prompt.swear"
            : quest.status === "ready"
              ? "prompt.claim"
              : "prompt.speak",
      };
    } else if (quest.status === "active" && site) {
      result = {
        key: "prompt.quest_site" as MessageKey,
        params: { name: t(`quest.site.${site.id}` as MessageKey) },
      };
    } else if (quest.status === "active") {
      // "Go hunt outside the walls" only means something where there are walls. A world with no
      // safe zone has no hub to be standing in, so the prompt never applies.
      const safeZone = zone.terrain.safeZone;
      const inHub =
        safeZone !== null &&
        self.x >= safeZone.x &&
        self.x <= safeZone.x + safeZone.width &&
        self.y >= safeZone.y &&
        self.y <= safeZone.y + safeZone.height;
      result = nearNpc || !inHub ? null : { key: "prompt.hunt" };
    } else if (quest.status === "available") {
      result = pointDistance(self, giver) > 420 ? null : { key: "prompt.approach" };
    }
  }
  useUiStore.getState().setPrompt(result);
}

function partyTargetError(
  reason: Extract<PartyTargetResolution, { ok: false }>["reason"],
): MessageKey {
  return reason === "self" ? "party.error.self" : "party.error.unknown_player";
}

function addEvent(text: string, tone: "info" | "good" | "bad"): void {
  useUiStore.getState().addEvent(text, tone);
}

async function startGameIdentity(
  identity: CharacterSummary | StoredHero,
  persistentParty: PartyListing | null,
  launchId: number,
): Promise<void> {
  const loadingStartedAt = performance.now();
  const initialStore = useUiStore.getState();
  initialStore.setAdventureVictory(false);
  initialStore.setHeroLoading({
    name: identity.name,
    class: identity.class,
    color: heroLoadingColor(identity, persistentParty),
    phase: "preparing",
    progress: 8,
  });
  setStatus("status.connecting", { name: identity.name });
  const canvas = required<HTMLCanvasElement>("#stage");
  const serverClock = new ServerClock();
  const renderer = await Renderer.create(canvas, serverClock);
  // Renderer creation is asynchronous. If another hero was launched while assets were loading,
  // this result no longer owns the page and must not install listeners or a WebSocket session.
  if (launchId !== activeLaunchId) {
    renderer.destroy();
    return;
  }
  useUiStore.getState().setHeroLoading({
    name: identity.name,
    class: identity.class,
    color: heroLoadingColor(identity, persistentParty),
    phase: "preparing",
    progress: 32,
  });
  let client = new WorldClient();
  let connection: Connection | null = null;
  let reconnectTimer: number | null = null;
  let loadingTimer: number | null = null;
  let loadingCompletionScheduled = false;
  let reconnectAttempts = 0;
  let reconnectCancelled = false;
  let intentionallyClosed = false;
  let ended = false;
  const input = trackInput();
  let stopActions: (() => void) | null = null;
  let questState: QuestState = {
    chapter: "three_offerings",
    status: "available",
    progress: 0,
    target: 3,
  };
  let welcomed = false;
  let currentSelf: PlayerSnapshot | undefined;
  let selfCorpse: Vec2 | null = null;
  let mapSurface: MapSurface | null = null;
  let activeZoneId: ZoneId = DEFAULT_ZONE_ID;
  let currentMerchant: MerchantDefinition | null = null;
  // Remembered so a reconnect can re-attach them to a fresh surface: React mounted its canvases
  // once, and it will not re-run its effect just because the socket dropped.
  let minimapCanvas: HTMLCanvasElement | null = null;
  let worldMapCanvas: HTMLCanvasElement | null = null;

  const applyAuthoritativeState = (state: SelfState) => {
    const receivedAt = performance.now();
    if (typeof state.serverNow === "number") serverClock.sample(state.serverNow, receivedAt);
    renderState(state);
    renderer.setAuthoredQuestMarkers(state.authoredQuestMarkers ?? []);
    const deadlines = clientCooldownDeadlines(state.cooldowns, serverClock);
    const store = useUiStore.getState();
    store.setAttackCooldownUntil(deadlines.attackUntil);
    store.setHealCooldownUntil(deadlines.healUntil);
    for (const slot of [1, 2, 3, 4, 5] as const) {
      store.setSkillCooldown(slot, deadlines.skills[slot]);
    }
  };
  const playerClass = () => currentSelf?.class ?? identity.class;

  const unlockAudio = () => sound.unlock();
  window.addEventListener("pointerdown", unlockAudio);
  window.addEventListener("keydown", unlockAudio);

  const handlers: Omit<ConnectionHandlers, "onClose"> = {
    onWelcome: (selfId, world, state) => {
      reconnectAttempts = 0;
      useUiStore.getState().setReconnect(null);
      // A reconnect lands a fresh welcome and the server aborted any run this hero triggered on the
      // disconnect, so no run is left to answer the panel — clear it rather than strand a dead panel.
      useUiStore.getState().setEventDialogue(null);
      useUiStore.getState().setQuestDialogue(null);
      if (!welcomed) {
        useUiStore.getState().setHeroLoading({
          name: identity.name,
          class: identity.class,
          color: heroLoadingColor(identity, persistentParty),
          phase: "world",
          progress: 68,
        });
      }
      renderer.setSelfId(selfId);
      // A known id resolves to the compiled catalogue (terrain, furniture and all); anything else
      // is a D1 map, so its baked terrain and authored props travel in the welcome and are drawn
      // from there. Same hybrid-routing rule the server used to pick this room.
      if (isKnownZone(world.zoneId)) {
        renderer.configureZone(world.zoneId);
      } else {
        renderer.configureMapTerrain(
          world.zoneId,
          decodeTileMap(world.tiles),
          world.elements,
          world.revision,
          { tilesetId: world.tilesetId, layers: world.layers },
        );
      }
      activeZoneId = world.zoneId;
      currentMerchant = world.merchant;
      renderer.configureMerchant(world.merchant);
      // The welcome carries the whole zone: dimensions, obstacles, safe zone, quest sites. Baking
      // the texture measures 126-138ms warm — expensive enough that a reconnect landing back in
      // the same zone must reuse the existing bake rather than repaint an identical one. Only a
      // genuine zone change (mapSurface.matches(world) false) pays for a fresh bake; either way
      // the canvases are re-attached below, so a reconnect never leaves the map blank.
      if (!mapSurface?.matches(world)) {
        mapSurface = new MapSurface(world);
      }
      mapSurface.attachMinimap(minimapCanvas);
      mapSurface.attachWorldMap(worldMapCanvas);
      questState = state.quest;
      selfCorpse = state.corpse;
      applyAuthoritativeState(state);
      useUiStore.getState().setZoneNameKey(world.zoneNameKey as MessageKey);
      useUiStore.getState().setWorldSize({ width: world.width, height: world.height });
      setStatus("status.connected_zone", { zone: t(world.zoneNameKey as MessageKey) });
      if (!welcomed) {
        welcomed = true;
        useUiStore.getState().setHeroLoading({
          name: identity.name,
          class: identity.class,
          color: heroLoadingColor(identity, persistentParty),
          phase: "world",
          progress: 90,
        });
        addEvent(t("status.welcome_hint"), "info");
      }
    },
    onState: (state) => {
      questState = state.quest;
      selfCorpse = state.corpse;
      applyAuthoritativeState(state);
    },
    onChat: (from, text, channel) => {
      useUiStore.getState().addChat(from, text, channel);
      sound.chat();
    },
    onPartyInvite: (inviteId, fromId, from, expiresAt) => {
      useUiStore.getState().setPartyInvite({ inviteId, fromId, from, expiresAt });
      addEvent(t("party.invite_received", { name: from }), "info");
    },
    onPartyState: (party) => useUiStore.getState().setParty(party),
    onMerchantOpen: () => {
      const store = useUiStore.getState();
      store.setMapOpen(false);
      store.setTalentsOpen(false);
      store.setSettingsOpen(false);
      store.setInventoryOpen(false);
      store.setMerchantOpen(true);
      input.reset();
    },
    onAnimation: (animation: CombatAnimation) => {
      renderer.playCombatAnimation(animation);
      if (animation.actorKind === "monster") sound.monsterAttack();
      else if (animation.skillId) sound.skillCast(animation.skillId);
    },
    // The dialogue panel (spec Decision 4): the server pushes beats to THIS player, the store holds
    // the open panel, EventDialoguePanel renders it. Prose is authored data rendered verbatim; the
    // panel's own chrome stays i18n. `event.close` only clears if it names the run currently shown —
    // a late close for an already-superseded run must not blank a fresh one.
    onEventSay: (runId, text, name) => {
      sound.interact();
      useUiStore
        .getState()
        .setEventDialogue(
          name === undefined ? { kind: "say", runId, text } : { kind: "say", runId, text, name },
        );
    },
    onEventChoices: (runId, prompt, options) => {
      useUiStore.getState().setEventDialogue({ kind: "choices", runId, prompt, options });
    },
    onEventClose: (runId) => {
      const store = useUiStore.getState();
      if (store.eventDialogue?.runId === runId) store.setEventDialogue(null);
    },
    onQuestOpen: (conversationId, entries) => {
      sound.interact();
      const store = useUiStore.getState();
      store.setEventDialogue(null);
      store.setQuestDialogue({ kind: "open", conversationId, entries });
    },
    onQuestResult: (conversationId, questId, title, text, outcome) => {
      const store = useUiStore.getState();
      if (store.questDialogue?.conversationId !== conversationId) return;
      store.setQuestDialogue({
        kind: "result",
        conversationId,
        questId,
        title,
        text,
        outcome,
      });
      if (outcome === "accepted" || outcome === "completed") sound.loot();
    },
    onQuestClose: (conversationId) => {
      const store = useUiStore.getState();
      if (store.questDialogue?.conversationId === conversationId) store.setQuestDialogue(null);
    },
    onEvent: (code, params, tone, x, y) => {
      const text = eventText(code, params, currentSelf?.class ?? identity.class);
      if (shouldLogEvent(code)) addEvent(text, tone);
      if (code === "adventure.victory") {
        const store = useUiStore.getState();
        store.setAdventureVictory(true);
        if (store.activeParty) store.setActiveParty({ ...store.activeParty, status: "completed" });
      }
      if (shouldFloatEvent(code)) {
        const compact =
          code === "combat.hit" || code === "combat.hurt"
            ? `-${String(params?.damage ?? "")}`
            : code === "heal.cast" || code === "heal.received"
              ? `+${String(params?.amount ?? "")}`
              : text;
        renderer.showWorldEvent(compact, tone, x, y);
      }
      if (code === "quest.site_harvested" && typeof params?.site === "string") {
        renderer.hideQuestSite(params.site, 15_000);
      }
      // `skill.cast` remains visible through the event log and CombatAnimation owns its sound/art.
      // It intentionally has no switch branch: only SelfState may update cooldown deadlines.
      switch (code) {
        case "level_up":
        case "quest.fulfilled":
          sound.levelUp();
          break;
        case "heal.cast":
          renderer.playHealingImpact(
            healingEffectColor(params?.color),
            healingSkillId(params?.skill),
            x,
            y,
          );
          break;
        case "loot.picked":
        case "quest.accepted":
        case "quest.site_harvested":
        case "item.used":
          sound.loot();
          break;
        case "heal.received":
          sound.healReceived();
          renderer.playHealingImpact(
            healingEffectColor(params?.color),
            healingSkillId(params?.skill),
            x,
            y,
          );
          break;
        case "player.down":
        case "death.fallen":
        case "death.released":
          sound.death();
          break;
        case "death.reclaimed":
        case "death.resurrected":
          sound.levelUp();
          break;
        case "resurrect.cast":
          sound.healReceived();
          break;
        case "combat.hit":
          if (typeof params?.skill === "string" && typeof x === "number" && typeof y === "number") {
            const actorId = typeof params.actorId === "string" ? params.actorId : client.selfId;
            const impactClass = actorId
              ? renderer.playCombatImpact(actorId, params.skill, x, y)
              : undefined;
            sound.combatImpact(impactClass ?? playerClass());
          }
          break;
        case "skill.blocked":
          if (typeof params?.skill === "string" && typeof x === "number" && typeof y === "number")
            if (client.selfId) renderer.playCombatImpact(client.selfId, params.skill, x, y);
          break;
        case "combat.hurt":
          sound.hit();
          if (typeof params?.species === "string" && isMonsterSpecies(params.species)) {
            renderer.playMonsterImpact(params.species, x, y);
          }
          break;
        default:
          break;
      }
    },
  };

  const beforeUnload = () => {
    intentionallyClosed = true;
    connection?.close();
  };
  let stopSession: () => void;
  const endGame = (key: MessageKey) => {
    if (ended) return;
    ended = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    if (loadingTimer !== null) window.clearTimeout(loadingTimer);
    reconnectTimer = null;
    loadingTimer = null;
    input.stop();
    stopActions?.();
    window.removeEventListener("pointerdown", unlockAudio);
    window.removeEventListener("keydown", unlockAudio);
    window.removeEventListener("beforeunload", beforeUnload);
    sound.stopAmbient();
    renderer.destroy();
    if (stopActiveSession === stopSession) stopActiveSession = null;
    // Also clears mapOpen and settingsOpen: without that, either overlay survives a terminal
    // disconnect and reappears full-screen the instant the next character's world loads, over a
    // world that has not sent it a welcome yet.
    if (persistentParty) useUiStore.getState().resetToParty();
    else useUiStore.getState().resetToCharacterSelect();
    setStatus("status.disconnected", { reason: t(key) });
  };
  stopSession = () => {
    intentionallyClosed = true;
    connection?.close();
    endGame("status.close.generic");
  };
  stopActiveSession = stopSession;

  const cancelReconnect = () => {
    reconnectCancelled = true;
    endGame("status.close.generic");
  };

  const openConnection = () => {
    client = new WorldClient();
    let closed = false;
    connection = client.connect(
      {
        ...handlers,
        onClose: (code, reason) => {
          if (closed) return;
          closed = true;
          if (intentionallyClosed || reconnectCancelled) return;
          // The raw wire reason is English server prose; never render it directly.
          console.debug("connection closed", code, reason);
          if (code === WS_CLOSE.ZONE_TRANSITION) {
            reconnectAttempts = 0;
            useUiStore.getState().setReconnect({ kind: "transition", attempt: 0, cancelReconnect });
            scheduleReconnect(120);
            return;
          }
          const terminal: MessageKey | null =
            code === WS_CLOSE.CHARACTER_REPLACED
              ? "status.close.elsewhere"
              : code === WS_CLOSE.CHARACTER_DELETED
                ? "status.close.deleted"
                : code === WS_CLOSE.SESSION_EXPIRED
                  ? "status.close.session_expired"
                  : code === WS_CLOSE.PRESENCE_LOST || code === WS_CLOSE.PRESENCE_ERROR
                    ? "status.close.presence"
                    : code === WS_CLOSE.ROOM_FULL
                      ? "status.close.room_full"
                      : code === WS_CLOSE.INVALID_LOCATION
                        ? "status.close.invalid_location"
                        : code === 1008 || code === 1009
                          ? "status.close.policy"
                          : null;
          if (terminal) {
            endGame(terminal);
            return;
          }
          if (reconnectAttempts >= 4) {
            endGame("status.close.generic");
            return;
          }
          reconnectAttempts += 1;
          useUiStore
            .getState()
            .setReconnect({ kind: "network", attempt: reconnectAttempts, cancelReconnect });
          scheduleReconnect(250 * 2 ** (reconnectAttempts - 1));
        },
      },
      identity.id,
      persistentParty?.id,
    );
  };

  const scheduleReconnect = (delayMs: number) => {
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      if (!reconnectCancelled) openConnection();
    }, delayMs);
  };

  useUiStore.getState().setHeroLoading({
    name: identity.name,
    class: identity.class,
    color: heroLoadingColor(identity, persistentParty),
    phase: "connecting",
    progress: 48,
  });
  openConnection();

  const attack = (): boolean => {
    if (interiorOpen()) return false;
    sound.unlock();
    connection?.attack();
    return true;
  };
  const interact = () => {
    sound.unlock();
    // Mid-dialogue, the interact key (the RPG convention) ADVANCES the say page rather than
    // re-triggering the event — the server's one-run lock would drop a re-trigger anyway, but routing
    // here keeps the interact key meaning "continue" while a panel is open. A choices panel swallows
    // interact (a pick needs an explicit option), so it never falls through to re-trigger either.
    const dialogue = useUiStore.getState().eventDialogue;
    if (dialogue) {
      if (dialogue.kind === "say") connection?.eventAdvance(dialogue.runId);
      input.reset();
      return;
    }
    if (useUiStore.getState().questDialogue) {
      input.reset();
      return;
    }
    if (interiorOpen()) {
      closeInterior();
      input.reset();
      return;
    }
    const door = nearestInterior(currentSelf, activeZoneId);
    const chapter = questState.chapter ?? "three_offerings";
    // Only a catalogue zone has quests; on a D1 map `zoneDefinition` would fall back to Verdant and
    // hand back its quest giver, making the player "near" a keeper who is not on this map.
    const giver = isKnownZone(activeZoneId)
      ? zoneDefinition(activeZoneId).quests.find((candidate) => candidate.id === chapter)?.giver
      : undefined;
    const nearNpc = currentSelf && giver && pointDistance(currentSelf, giver) <= INTERACTION_RANGE;
    if (door && !nearNpc) {
      sound.interact();
      input.reset();
      openInterior(door);
      return;
    }
    sound.interact();
    renderer.playInteraction();
    connection?.interact();
  };
  const usePotion = () => {
    if (interiorOpen()) return;
    sound.unlock();
    sound.loot();
    connection?.usePotion();
  };
  const useItem = (item: ConsumableId) => {
    if (interiorOpen()) return;
    sound.unlock();
    sound.loot();
    connection?.useItem(item);
  };
  const release = () => {
    if (interiorOpen()) return;
    sound.unlock();
    connection?.release();
  };
  const castSkill = (slot: SkillSlot) => {
    if (interiorOpen()) return;
    const store = useUiStore.getState();
    const cooldownUntil =
      slot === 1 ? store.attackCooldownUntil : (store.skillCooldowns[slot] ?? 0);
    if (cooldownUntil > performance.now()) return;
    if (slot === 1) {
      attack();
      return;
    }
    sound.unlock();
    connection?.skill(slot);
  };
  const releaseSkill = (slot: SkillSlot) => {
    connection?.releaseSkill(slot);
  };
  const switchCharacter = () => {
    if (persistentParty) stopSession();
    else window.location.reload();
  };
  const logoutAndReload = () => {
    stopSession();
    void logout();
  };
  const toggleSettings = () => {
    if (interiorOpen()) {
      closeInterior();
      input.reset();
      return;
    }
    if (useUiStore.getState().mapOpen) {
      useUiStore.getState().setMapOpen(false);
      input.reset();
      return;
    }
    if (talentsOpen()) {
      useUiStore.getState().setTalentsOpen(false);
      input.reset();
      return;
    }
    const overlayStore = useUiStore.getState();
    if (overlayStore.inventoryOpen || overlayStore.merchantOpen) {
      overlayStore.setInventoryOpen(false);
      overlayStore.setMerchantOpen(false);
      input.reset();
      return;
    }
    const nextOpen = !settingsOpen();
    useUiStore.getState().setSettingsOpen(nextOpen);
    if (nextOpen) input.reset();
  };

  stopActions = trackActions(
    {
      attack,
      interact,
      usePotion,
      useQuickItem: (index) => {
        const item = useUiStore.getState().quickItems[index];
        if (item) useItem(item);
      },
      release,
      castSkill,
      releaseSkill,
      focusChat: () => {
        input.reset();
        useUiStore.getState().requestChatFocus();
      },
      toggleMap: () => {
        const store = useUiStore.getState();
        store.setTalentsOpen(false);
        store.setInventoryOpen(false);
        store.setMerchantOpen(false);
        store.setMapOpen(!store.mapOpen);
      },
      toggleTalents: () => {
        const store = useUiStore.getState();
        store.setMapOpen(false);
        store.setSettingsOpen(false);
        store.setInventoryOpen(false);
        store.setMerchantOpen(false);
        store.setTalentsOpen(!store.talentsOpen);
        input.reset();
      },
      toggleInventory: () => {
        const store = useUiStore.getState();
        store.setMapOpen(false);
        store.setTalentsOpen(false);
        store.setSettingsOpen(false);
        store.setMerchantOpen(false);
        store.setInventoryOpen(!store.inventoryOpen);
        input.reset();
      },
      toggleSettings,
    },
    () => !gameplayPaused(),
  );

  useUiStore.getState().setGame({
    attack,
    interact,
    usePotion,
    useItem,
    buyItem: (item) => connection?.buyItem(item),
    release,
    castSkill,
    releaseSkill,
    unlockTalent: (nodeId) => connection?.unlockTalent(nodeId),
    resetTalents: () => connection?.resetTalents(),
    setMovement: (movement) => input.setVirtual(movement),
    sendChat: (text, channel) => connection?.sendChat(text, channel),
    partyCreate: () => connection?.partyCreate(),
    partyInvite: (query) => {
      const target = resolvePartyTarget(
        client.sample(performance.now()).players,
        query,
        client.selfId,
      );
      if (!target.ok) return addEvent(t(partyTargetError(target.reason)), "bad");
      connection?.partyInvite(target.playerId);
    },
    partyAccept: (inviteId) => {
      connection?.partyAccept(inviteId);
      useUiStore.getState().setPartyInvite(null);
    },
    partyRefuse: (inviteId) => {
      connection?.partyRefuse(inviteId);
      useUiStore.getState().setPartyInvite(null);
    },
    partyLeave: () => connection?.partyLeave(),
    partyKick: (query) => {
      const target = resolvePartyTarget(
        client.sample(performance.now()).players,
        query,
        client.selfId,
      );
      if (!target.ok) return addEvent(t(partyTargetError(target.reason)), "bad");
      connection?.partyKick(target.playerId);
    },
    partyDissolve: () => connection?.partyDissolve(),
    eventAdvance: (runId) => connection?.eventAdvance(runId),
    eventChoose: (runId, index) => connection?.eventChoose(runId, index),
    questAction: (conversationId, action, questId, rewardChoiceId) =>
      connection?.questAction(conversationId, action, questId, rewardChoiceId),
    switchCharacter,
    logout: logoutAndReload,
    attachMinimap: (canvas) => {
      minimapCanvas = canvas;
      mapSurface?.attachMinimap(canvas);
    },
    attachWorldMap: (canvas) => {
      worldMapCanvas = canvas;
      mapSurface?.attachWorldMap(canvas);
    },
  });

  renderer.onFrame((now, dt) => {
    client.update(gameplayPaused() ? NO_INPUT : input.current(), dt);
    const sample = client.sample(now);
    const self = sample.players.find((player) => player.id === client.selfId);
    currentSelf = self;
    if (welcomed && self && !loadingCompletionScheduled) {
      loadingCompletionScheduled = true;
      useUiStore.getState().setHeroLoading({
        name: identity.name,
        class: identity.class,
        color: heroLoadingColor(identity, persistentParty),
        phase: "ready",
        progress: 100,
      });
      const remainingMs = Math.max(180, 850 - (performance.now() - loadingStartedAt));
      loadingTimer = window.setTimeout(() => {
        loadingTimer = null;
        useUiStore.getState().setHeroLoading(null);
      }, remainingMs);
    }
    const door = nearestInterior(self, activeZoneId);
    const context: RenderContext = {
      quest: questState,
      now,
      healthBars: getDisplaySettings().healthBars,
      grid: getDisplaySettings().grid,
      ...(self ? { self } : {}),
    };
    renderer.render(sample, context);
    mapSurface?.draw(sample, self, selfCorpse);
    renderPlayer(self, selfCorpse);
    updatePrompt(self, questState, door, activeZoneId, currentMerchant);
  });
  window.addEventListener("beforeunload", beforeUnload);

  // A handle for measuring input latency and interpolation from the outside. Dev builds only.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__lindocara = {
      all: () => client.sample(performance.now()),
      self: () => client.sample(performance.now()).players.find((p) => p.id === client.selfId),
      attack: () => attack(),
      renderStats: () => renderer.diagnostics(),
    };
  }
}

async function launchGameIdentity(
  identity: CharacterSummary | StoredHero,
  persistentParty: PartyListing | null,
): Promise<void> {
  const launchId = ++activeLaunchId;
  stopCurrentSession();
  stopActiveSession = null;
  useUiStore.getState().setScreen("game");
  try {
    await startGameIdentity(identity, persistentParty, launchId);
  } catch (error) {
    if (launchId === activeLaunchId) {
      stopCurrentSession();
      stopActiveSession = null;
      if (persistentParty) useUiStore.getState().resetToParty();
      else useUiStore.getState().resetToCharacterSelect();
    }
    throw error;
  }
}

/** Rollback-only legacy entrypoint. The post-login UI no longer calls it. */
export function startGame(character: CharacterSummary): Promise<void> {
  return launchGameIdentity(character, null);
}

export function startGameAsHero(hero: StoredHero, party: PartyListing): Promise<void> {
  return launchGameIdentity(hero, party);
}
