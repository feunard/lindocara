import type { PrimaryColor } from "../../shared/character.js";
import { WS_CLOSE } from "../../shared/close-codes.js";
import { isSpirit } from "../../shared/death.js";
import { INTERACTION_RANGE, isMonsterSpecies, pointDistance } from "../../shared/game.js";
import type { MessageKey } from "../../shared/i18n/index.js";
import type {
  CombatAnimation,
  EventCode,
  EventParams,
  PlayerSnapshot,
  QuestState,
  SelfState,
} from "../../shared/protocol.js";
import { NO_INPUT, type Vec2 } from "../../shared/simulation.js";
import type { SkillSlot } from "../../shared/skills.js";
import { decodeTileMap } from "../../shared/tilemap-codec.js";
import { DEFAULT_ZONE_ID, isKnownZone, type ZoneId, zoneDefinition } from "../../shared/zones.js";
import { type CharacterSummary, logout, type PartyListing, type StoredHero } from "../api.js";
import { t } from "../i18n.js";
import { type LocalizedText, useUiStore } from "../store.js";
import { clientCooldownDeadlines } from "./cooldown-sync.js";
import { getDisplaySettings } from "./display-settings.js";
import { healingEffectColor, shouldFloatEvent } from "./feedback.js";
import { trackActions, trackInput } from "./input.js";
import { type InteriorDoor, nearestInterior } from "./interiors.js";
import { MapSurface } from "./minimap-surface.js";
import { type Connection, type ConnectionHandlers, WorldClient } from "./net.js";
import { type PartyTargetResolution, resolvePartyTarget } from "./party.js";
import { type RenderContext, Renderer } from "./renderer.js";
import { ServerClock } from "./server-clock.js";
import { GameSound } from "./sound.js";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`index.html is missing ${selector}`);
  return element;
}

const sound = new GameSound();

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
  return (
    interiorOpen() || settingsOpen() || talentsOpen() || useUiStore.getState().heroLoading !== null
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
): void {
  let result: LocalizedText | null = null;
  // Prompt.tsx hides the floating prompt whenever the interior panel is open, so a
  // "close_interior" key here would never render - don't bother computing one. A D1 map has no
  // catalogue quests or interiors either, so `zoneDefinition`'s fallback-to-Verdant must not be
  // allowed to conjure a phantom quest prompt over a user map.
  if (interiorOpen() || !self || isSpirit(self.life) || !isKnownZone(zoneId)) {
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

// Assumes it runs at most once per page life: the keydown/beforeunload listeners it
// registers are never removed, and switchCharacter/logout tear the session down by
// reloading the page rather than unwinding this function.
async function startGameIdentity(
  identity: CharacterSummary | StoredHero,
  persistentParty: PartyListing | null,
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
  // Remembered so a reconnect can re-attach them to a fresh surface: React mounted its canvases
  // once, and it will not re-run its effect just because the socket dropped.
  let minimapCanvas: HTMLCanvasElement | null = null;
  let worldMapCanvas: HTMLCanvasElement | null = null;

  const applyAuthoritativeState = (state: SelfState) => {
    const receivedAt = performance.now();
    if (typeof state.serverNow === "number") serverClock.sample(state.serverNow, receivedAt);
    renderState(state);
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
    onAnimation: (animation: CombatAnimation) => {
      renderer.playCombatAnimation(animation);
      if (animation.actorKind === "monster") sound.monsterAttack();
      else if (animation.skillId) sound.skillCast(animation.skillId);
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
        case "potion.used":
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
    sound.stopAmbient();
    renderer.destroy();
    setStatus("status.disconnected", { reason: t(key) });
    // Also clears mapOpen and settingsOpen: without that, either overlay survives a terminal
    // disconnect and reappears full-screen the instant the next character's world loads, over a
    // world that has not sent it a welcome yet.
    if (persistentParty) useUiStore.getState().resetToParty();
    else useUiStore.getState().resetToCharacterSelect();
  };

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
    intentionallyClosed = true;
    connection?.close();
    if (persistentParty) endGame("status.close.generic");
    else window.location.reload();
  };
  const logoutAndReload = () => {
    intentionallyClosed = true;
    connection?.close();
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
    const nextOpen = !settingsOpen();
    useUiStore.getState().setSettingsOpen(nextOpen);
    if (nextOpen) input.reset();
  };

  stopActions = trackActions(
    {
      attack,
      interact,
      usePotion,
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
        store.setMapOpen(!store.mapOpen);
      },
      toggleTalents: () => {
        const store = useUiStore.getState();
        store.setMapOpen(false);
        store.setSettingsOpen(false);
        store.setTalentsOpen(!store.talentsOpen);
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
    updatePrompt(self, questState, door, activeZoneId);
  });
  window.addEventListener("beforeunload", () => {
    intentionallyClosed = true;
    connection?.close();
  });

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

/** Rollback-only legacy entrypoint. The post-login UI no longer calls it. */
export function startGame(character: CharacterSummary): Promise<void> {
  return startGameIdentity(character, null);
}

export function startGameAsHero(hero: StoredHero, party: PartyListing): Promise<void> {
  return startGameIdentity(hero, party);
}
