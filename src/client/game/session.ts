import { WS_CLOSE } from "../../shared/close-codes.js";
import { isSpirit } from "../../shared/death.js";
import {
  ATTACK_COOLDOWN_MS,
  CLASS_STATS,
  INTERACTION_RANGE,
  pointDistance,
} from "../../shared/game.js";
import type { MessageKey } from "../../shared/i18n/index.js";
import type {
  CombatAnimation,
  EventCode,
  EventParams,
  GuardSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  QuestState,
  SelfState,
} from "../../shared/protocol.js";
import { NO_INPUT, type Vec2 } from "../../shared/simulation.js";
import { type SkillSlot, skillFor } from "../../shared/skills.js";
import { decodeTileMap } from "../../shared/tilemap-codec.js";
import { DEFAULT_ZONE_ID, isKnownZone, type ZoneId, zoneDefinition } from "../../shared/zones.js";
import { type CharacterSummary, logout, type PartyListing, type StoredHero } from "../api.js";
import { t } from "../i18n.js";
import { type LocalizedText, useUiStore } from "../store.js";
import { clientCooldownDeadlines } from "./cooldown-sync.js";
import { getDisplaySettings } from "./display-settings.js";
import { isAcceptedBasicAttack, shouldFloatEvent } from "./feedback.js";
import { trackActions, trackInput } from "./input.js";
import { type InteriorDoor, nearestInterior } from "./interiors.js";
import { MapSurface } from "./minimap-surface.js";
import { type Connection, type ConnectionHandlers, WorldClient } from "./net.js";
import { type PartyTargetResolution, resolvePartyTarget } from "./party.js";
import { guardPortrait, monsterPortrait, playerPortrait } from "./portrait-art.js";
import { type RenderContext, Renderer } from "./renderer.js";
import { GameSound } from "./sound.js";
import {
  type CombatTarget,
  cycleMonsterTarget,
  offensiveTarget,
  resolveBasicAttackTarget,
  resolveSkillTarget,
  targetExists,
} from "./targeting.js";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`index.html is missing ${selector}`);
  return element;
}

const sound = new GameSound();

const PRIEST_HEAL = CLASS_STATS.priest.heal;
if (!PRIEST_HEAL) throw new Error("priest heal stats missing");
const PRIEST_HEAL_COOLDOWN_MS = PRIEST_HEAL.cooldownMs;

/** The store is the single source of truth for whether the interior panel is open;
 *  InteriorOverlay renders it from `interiorDoorId`. */
function interiorOpen(): boolean {
  return useUiStore.getState().interiorDoorId !== null;
}

function settingsOpen(): boolean {
  return useUiStore.getState().settingsOpen;
}

function gameplayPaused(): boolean {
  return interiorOpen() || settingsOpen();
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
      const safeZone = zone.terrain.safeZone;
      const inHub =
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
  useUiStore.getState().setAdventureVictory(false);
  setStatus("status.connecting", { name: identity.name });
  const canvas = required<HTMLCanvasElement>("#stage");
  const renderer = await Renderer.create(canvas);
  let client = new WorldClient();
  let connection: Connection | null = null;
  let reconnectTimer: number | null = null;
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
  let attackCooldownUntil = 0;
  let welcomed = false;
  let currentSelf: PlayerSnapshot | undefined;
  let selfCorpse: Vec2 | null = null;
  let mapSurface: MapSurface | null = null;
  let activeZoneId: ZoneId = DEFAULT_ZONE_ID;
  let combatTarget: CombatTarget | null = null;
  // Remembered so a reconnect can re-attach them to a fresh surface: React mounted its canvases
  // once, and it will not re-run its effect just because the socket dropped.
  let minimapCanvas: HTMLCanvasElement | null = null;
  let worldMapCanvas: HTMLCanvasElement | null = null;

  const applyAuthoritativeState = (state: SelfState) => {
    renderState(state);
    const deadlines = clientCooldownDeadlines(
      state.cooldowns,
      state.serverNow ?? Date.now(),
      performance.now(),
    );
    attackCooldownUntil = deadlines.attackUntil;
    const store = useUiStore.getState();
    store.setAttackCooldownUntil(deadlines.attackUntil);
    store.setHealCooldownUntil(deadlines.healUntil);
    for (const slot of [1, 2, 3, 4, 5] as const) {
      store.setSkillCooldown(slot, deadlines.skills[slot]);
    }
  };
  const playerClass = () => currentSelf?.class ?? identity.class;

  const clearTarget = () => {
    combatTarget = null;
    renderer.setTarget(null);
    useUiStore.getState().setCombatTarget(null);
  };
  const selectTarget = (target: CombatTarget) => {
    combatTarget = target;
    renderer.setTarget(target);
  };
  renderer.setTargetHandler(selectTarget);

  const updateTargetHud = (
    players: readonly PlayerSnapshot[],
    monsters: readonly MonsterSnapshot[],
    guards: readonly GuardSnapshot[],
  ) => {
    if (!combatTarget) return;
    if (!targetExists(combatTarget, players, monsters, guards)) {
      clearTarget();
      return;
    }
    if (combatTarget.kind === "monster") {
      const monster = monsters.find((candidate) => candidate.id === combatTarget?.id);
      if (!monster) return;
      useUiStore.getState().setCombatTarget({
        id: monster.id,
        kind: "monster",
        name: t(`monster.${monster.species}` as MessageKey),
        hp: monster.hp,
        maxHp: monster.maxHp,
        portrait: monsterPortrait(monster.species),
      });
      return;
    }
    if (combatTarget.kind === "guard") {
      const guard = guards.find((candidate) => candidate.id === combatTarget?.id);
      if (!guard) return;
      useUiStore.getState().setCombatTarget({
        id: guard.id,
        kind: "guard",
        name: t("npc.city_guard.name"),
        hp: guard.hp,
        maxHp: guard.maxHp,
        portrait: guardPortrait(),
      });
      return;
    }
    const player = players.find((candidate) => candidate.id === combatTarget?.id);
    if (!player) return;
    useUiStore.getState().setCombatTarget({
      id: player.id,
      kind: "player",
      name: player.nick,
      hp: player.hp,
      maxHp: player.maxHp,
      portrait: playerPortrait(player.class, player.appearance),
    });
  };

  const unlockAudio = () => sound.unlock();
  window.addEventListener("pointerdown", unlockAudio);
  window.addEventListener("keydown", unlockAudio);

  const handlers: Omit<ConnectionHandlers, "onClose"> = {
    onWelcome: (selfId, world, state) => {
      clearTarget();
      reconnectAttempts = 0;
      useUiStore.getState().setReconnect(null);
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
      if (animation.actorKind === "player") {
        if (animation.action === "attack") {
          renderer.playAttack(animation.actorId);
          if (animation.actorId === client.selfId) {
            sound.basicAttack(playerClass());
            return;
          }
          const actor = client
            .sample(performance.now())
            .players.find((player) => player.id === animation.actorId);
          if (actor && animation.targetX !== undefined && animation.targetY !== undefined) {
            renderer.playRangedHit(
              animation.actorId,
              animation.targetX,
              animation.targetY,
              actor.class,
            );
          }
        } else {
          if (animation.actorId === client.selfId) return;
          renderer.playPlayerSkill(animation.actorId, animation.x, animation.y);
        }
        return;
      }
      renderer.playMonsterAttack(animation.actorId);
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
      if (code === "combat.hit" && x !== undefined && y !== undefined && client.selfId) {
        renderer.playRangedHit(client.selfId, x, y, currentSelf?.class ?? identity.class);
      }
      if (isAcceptedBasicAttack(code, params)) {
        attackCooldownUntil = performance.now() + ATTACK_COOLDOWN_MS;
        const store = useUiStore.getState();
        store.setAttackCooldownUntil(attackCooldownUntil);
        store.setSkillCooldown(1, performance.now() + skillFor(playerClass(), 1).cooldownMs);
      }
      switch (code) {
        case "combat.too_far":
          sound.attackMiss(playerClass());
          renderer.playAttackMiss();
          break;
        case "level_up":
        case "quest.fulfilled":
          sound.levelUp();
          break;
        case "heal.cast":
          // The server never consumes the cooldown on a whiff (heal.nobody), so arm the UI
          // bar only once a cast actually lands. Only priests ever receive heal.cast.
          useUiStore.getState().setHealCooldownUntil(performance.now() + PRIEST_HEAL_COOLDOWN_MS);
          if ((currentSelf?.class ?? identity.class) === "priest") {
            useUiStore.getState().setSkillCooldown(2, performance.now() + PRIEST_HEAL_COOLDOWN_MS);
          }
          sound.healCast();
          renderer.playSkillEffect("priest", x, y);
          break;
        case "skill.cast": {
          const slot = params?.slot;
          if (typeof slot === "number" && slot >= 1 && slot <= 5) {
            const skillSlot = slot as SkillSlot;
            const skill = skillFor(currentSelf?.class ?? identity.class, skillSlot);
            useUiStore.getState().setSkillCooldown(skillSlot, performance.now() + skill.cooldownMs);
          }
          if (typeof params?.skill === "string") sound.skillCast(params.skill);
          renderer.playSkillEffect(currentSelf?.class ?? identity.class, x, y);
          break;
        }
        case "loot.picked":
        case "quest.accepted":
        case "quest.site_harvested":
        case "potion.used":
          sound.loot();
          break;
        case "heal.received":
          sound.healReceived();
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
          sound.combatImpact(playerClass());
          break;
        case "combat.hurt":
          sound.hit();
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
    reconnectTimer = null;
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

  openConnection();

  const hostileTarget = (): Extract<CombatTarget, { kind: "monster" }> | null => {
    const sample = client.sample(performance.now());
    const self = sample.players.find((player) => player.id === client.selfId) ?? currentSelf;
    const nearest = offensiveTarget(sample.monsters, self, combatTarget);
    if (!nearest) return null;
    selectTarget(nearest);
    return nearest;
  };

  const attack = (): boolean => {
    if (interiorOpen()) return false;
    const sample = client.sample(performance.now());
    const self = sample.players.find((player) => player.id === client.selfId) ?? currentSelf;
    const target = resolveBasicAttackTarget(
      sample.monsters,
      self,
      combatTarget,
      CLASS_STATS[playerClass()].attackRange,
    );
    if (!target.ok) {
      if (target.reason === "out_of_range") {
        addEvent(t("event.combat.too_far"), "info");
        return false;
      }
      addEvent(t("target.need_hostile"), "info");
      return false;
    }
    sound.unlock();
    connection?.attack(target.target.id);
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
  const heal = () => {
    if (interiorOpen()) return;
    if (combatTarget?.kind !== "player" && combatTarget?.kind !== "guard") {
      addEvent(t("target.need_friendly"), "info");
      return;
    }
    sound.unlock();
    connection?.heal(combatTarget.id);
  };
  const release = () => {
    if (interiorOpen()) return;
    sound.unlock();
    connection?.release();
  };
  const castSkill = (slot: SkillSlot) => {
    if (interiorOpen()) return;
    const playerClass = currentSelf?.class ?? identity.class;
    const skill = skillFor(playerClass, slot);
    if ((useUiStore.getState().skillCooldowns[slot] ?? 0) > performance.now()) return;
    if (slot === 1) {
      attack();
      return;
    }
    let selectedTarget = combatTarget;
    const initialResolution = resolveSkillTarget(skill.effect, selectedTarget);
    if (!initialResolution.ok && initialResolution.required === "hostile") {
      selectedTarget = hostileTarget();
    }
    const target = resolveSkillTarget(skill.effect, selectedTarget);
    if (!target.ok) {
      addEvent(
        t(target.required === "hostile" ? "target.need_hostile" : "target.need_friendly"),
        "info",
      );
      return;
    }
    if (playerClass === "priest" && slot === 2) {
      heal();
      return;
    }
    sound.unlock();
    connection?.skill(slot, target.targetId);
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
    if (combatTarget) {
      clearTarget();
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
      heal,
      release,
      castSkill,
      switchTarget: (reverse) => {
        const sample = client.sample(performance.now());
        const self = sample.players.find((player) => player.id === client.selfId);
        const next = cycleMonsterTarget(
          sample.monsters,
          self,
          combatTarget?.kind === "monster" ? combatTarget.id : undefined,
          reverse,
        );
        if (next) selectTarget(next);
        else clearTarget();
      },
      focusChat: () => {
        input.reset();
        useUiStore.getState().requestChatFocus();
      },
      toggleMap: () => {
        const store = useUiStore.getState();
        store.setMapOpen(!store.mapOpen);
      },
      toggleSettings,
    },
    () => !gameplayPaused(),
  );

  useUiStore.getState().setGame({
    attack,
    interact,
    usePotion,
    heal,
    release,
    castSkill,
    setMovement: (movement) => input.setVirtual(movement),
    clearTarget,
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
    const door = nearestInterior(self, activeZoneId);
    const context: RenderContext = {
      quest: questState,
      attackCooldownUntil,
      attackRange: currentSelf ? CLASS_STATS[currentSelf.class].attackRange : 0,
      now,
      healthBars: getDisplaySettings().healthBars,
      grid: getDisplaySettings().grid,
      ...(self ? { self } : {}),
    };
    renderer.render(sample, context);
    if (self && isSpirit(self.life) && combatTarget) clearTarget();
    else updateTargetHud(sample.players, sample.monsters, sample.guards);
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
      targetNearest: () => {
        const sample = client.sample(performance.now());
        const self = sample.players.find((player) => player.id === client.selfId);
        const target = cycleMonsterTarget(sample.monsters, self, undefined);
        if (target) selectTarget(target);
        return target;
      },
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
