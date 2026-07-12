import { WS_CLOSE } from "../../shared/close-codes.js";
import { isSpirit } from "../../shared/death.js";
import {
  ATTACK_COOLDOWN_MS,
  CLASS_STATS,
  INTERACTION_RANGE,
  pointDistance,
  QUEST_SITES,
  questDefinition,
  SAFE_ZONE,
} from "../../shared/game.js";
import type { MessageKey } from "../../shared/i18n/index.js";
import type {
  EventCode,
  EventParams,
  PlayerSnapshot,
  QuestState,
  SelfState,
} from "../../shared/protocol.js";
import { NO_INPUT, type Vec2 } from "../../shared/simulation.js";
import { type SkillSlot, skillFor } from "../../shared/skills.js";
import { type CharacterSummary, logout } from "../api.js";
import { t } from "../i18n.js";
import { type LocalizedText, useUiStore } from "../store.js";
import { trackActions, trackInput } from "./input.js";
import { type InteriorDoor, nearestInterior } from "./interiors.js";
import { WorldClient } from "./net.js";
import { type RenderContext, Renderer } from "./renderer.js";
import { GameSound } from "./sound.js";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`index.html is missing ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>("#stage");
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
          nick: player.nick,
          level: player.level,
          hp: player.hp,
          maxHp: player.maxHp,
          life: player.life,
          // Rounded, so a walking ghost does not re-render the HUD every frame.
          corpseDistance:
            player.life === "ghost" && corpse ? Math.round(pointDistance(player, corpse)) : null,
          class: player.class,
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
): void {
  let result: LocalizedText | null = null;
  // Prompt.tsx hides the floating prompt whenever the interior panel is open, so a
  // "close_interior" key here would never render - don't bother computing one.
  if (interiorOpen() || !self || isSpirit(self.life)) {
    result = null;
  } else {
    const chapter = quest.chapter ?? "three_offerings";
    const giver = questDefinition(chapter).giver;
    const nearNpc = pointDistance(self, giver) <= INTERACTION_RANGE;
    const site = QUEST_SITES.find(
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
      const inHub =
        self.x >= SAFE_ZONE.x &&
        self.x <= SAFE_ZONE.x + SAFE_ZONE.width &&
        self.y >= SAFE_ZONE.y &&
        self.y <= SAFE_ZONE.y + SAFE_ZONE.height;
      result = nearNpc || !inHub ? null : { key: "prompt.hunt" };
    } else if (quest.status === "available") {
      result = pointDistance(self, giver) > 420 ? null : { key: "prompt.approach" };
    }
  }
  useUiStore.getState().setPrompt(result);
}

function addEvent(text: string, tone: "info" | "good" | "bad"): void {
  useUiStore.getState().addEvent(text, tone);
}

function addChat(from: string, text: string): void {
  useUiStore.getState().addChat(from, text);
}

// Assumes it runs at most once per page life: the keydown/beforeunload listeners it
// registers are never removed, and switchCharacter/logout tear the session down by
// reloading the page rather than unwinding this function.
export async function startGame(character: CharacterSummary): Promise<void> {
  setStatus("status.connecting", { name: character.name });
  const renderer = await Renderer.create(canvas);
  const client = new WorldClient();
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
  const playerClass = () => currentSelf?.class ?? character.class;

  const unlockAudio = () => sound.unlock();
  window.addEventListener("pointerdown", unlockAudio);
  window.addEventListener("keydown", unlockAudio);

  const connection = client.connect(
    {
      onWelcome: (selfId, _world, state) => {
        renderer.setSelfId(selfId);
        questState = state.quest;
        selfCorpse = state.corpse;
        renderState(state);
        setStatus("status.connected");
        if (!welcomed) {
          welcomed = true;
          addEvent(t("status.welcome_hint"), "info");
        }
      },
      onState: (state) => {
        questState = state.quest;
        selfCorpse = state.corpse;
        renderState(state);
      },
      onChat: (from, text) => {
        addChat(from, text);
        sound.chat();
      },
      onEvent: (code, params, tone, x, y) => {
        const text = eventText(code, params, currentSelf?.class ?? character.class);
        if (shouldLogEvent(code)) addEvent(text, tone);
        renderer.showWorldEvent(text, tone, x, y);
        if (code === "quest.site_harvested" && typeof params?.site === "string") {
          renderer.hideQuestSite(params.site, 15_000);
        }
        if (code === "combat.hit" && x !== undefined && y !== undefined && client.selfId) {
          renderer.playRangedHit(client.selfId, x, y, currentSelf?.class ?? character.class);
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
            if ((currentSelf?.class ?? character.class) === "priest") {
              useUiStore
                .getState()
                .setSkillCooldown(2, performance.now() + PRIEST_HEAL_COOLDOWN_MS);
            }
            sound.healCast();
            break;
          case "skill.cast": {
            const slot = params?.slot;
            if (typeof slot === "number" && slot >= 1 && slot <= 5) {
              const skillSlot = slot as SkillSlot;
              const skill = skillFor(currentSelf?.class ?? character.class, skillSlot);
              useUiStore
                .getState()
                .setSkillCooldown(skillSlot, performance.now() + skill.cooldownMs);
            }
            if (typeof params?.skill === "string") sound.skillCast(params.skill);
            renderer.playSkillEffect(currentSelf?.class ?? character.class, x, y);
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
      onClose: (code, reason) => {
        input.stop();
        stopActions?.();
        window.removeEventListener("pointerdown", unlockAudio);
        window.removeEventListener("keydown", unlockAudio);
        sound.stopAmbient();
        // The raw wire reason is English server prose; never render it directly.
        console.debug("connection closed", code, reason);
        const key: MessageKey =
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
                        : "status.close.generic";
        setStatus("status.disconnected", { reason: t(key) });
        addEvent(t("status.connection_lost"), "bad");
        useUiStore.getState().setGame(null);
      },
    },
    character.id,
  );

  const attack = () => {
    if (interiorOpen()) return;
    sound.unlock();
    sound.basicAttack(playerClass());
    attackCooldownUntil = performance.now() + ATTACK_COOLDOWN_MS;
    useUiStore.getState().setAttackCooldownUntil(attackCooldownUntil);
    if (client.selfId) renderer.playAttack(client.selfId);
    connection.attack();
  };
  const interact = () => {
    sound.unlock();
    if (interiorOpen()) {
      closeInterior();
      input.reset();
      return;
    }
    const door = nearestInterior(currentSelf);
    const giver = questDefinition(questState.chapter ?? "three_offerings").giver;
    const nearNpc = currentSelf && pointDistance(currentSelf, giver) <= INTERACTION_RANGE;
    if (door && !nearNpc) {
      sound.interact();
      input.reset();
      openInterior(door);
      return;
    }
    sound.interact();
    renderer.playInteraction();
    connection.interact();
  };
  const usePotion = () => {
    if (interiorOpen()) return;
    sound.unlock();
    sound.loot();
    connection.usePotion();
  };
  const heal = () => {
    if (interiorOpen()) return;
    sound.unlock();
    connection.heal();
  };
  const release = () => {
    if (interiorOpen()) return;
    sound.unlock();
    connection.release();
  };
  const castSkill = (slot: SkillSlot) => {
    if (interiorOpen()) return;
    const playerClass = currentSelf?.class ?? character.class;
    const skill = skillFor(playerClass, slot);
    if ((useUiStore.getState().skillCooldowns[slot] ?? 0) > performance.now()) return;
    if (slot === 1) {
      useUiStore.getState().setSkillCooldown(slot, performance.now() + skill.cooldownMs);
      attack();
      return;
    }
    if (playerClass === "priest" && slot === 2) {
      heal();
      return;
    }
    sound.unlock();
    connection.skill(slot);
  };
  const switchCharacter = () => {
    connection.close();
    window.location.reload();
  };
  const logoutAndReload = () => {
    connection.close();
    void logout();
  };

  stopActions = trackActions({
    attack,
    interact,
    usePotion,
    heal,
    release,
    castSkill,
    focusChat: () => {
      input.reset();
      useUiStore.getState().requestChatFocus();
    },
  });

  useUiStore.getState().setGame({
    attack,
    interact,
    usePotion,
    heal,
    release,
    castSkill,
    sendChat: connection.sendChat,
    switchCharacter,
    logout: logoutAndReload,
  });

  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape") return;
    if (event.target instanceof HTMLInputElement) {
      event.target.blur();
      event.preventDefault();
      return;
    }
    if (interiorOpen()) {
      closeInterior();
      input.reset();
      event.preventDefault();
      return;
    }
    const nextOpen = !settingsOpen();
    useUiStore.getState().setSettingsOpen(nextOpen);
    if (nextOpen) input.reset();
    event.preventDefault();
  });

  renderer.onFrame((now, dt) => {
    client.update(gameplayPaused() ? NO_INPUT : input.current(), dt);
    const sample = client.sample(now);
    const self = sample.players.find((player) => player.id === client.selfId);
    currentSelf = self;
    const door = nearestInterior(self);
    const context: RenderContext = {
      quest: questState,
      attackCooldownUntil,
      attackRange: currentSelf ? CLASS_STATS[currentSelf.class].attackRange : 0,
      now,
      ...(self ? { self } : {}),
    };
    renderer.render(sample, context);
    renderPlayer(self, selfCorpse);
    updatePrompt(self, questState, door);
  });
  window.addEventListener("beforeunload", () => connection.close());

  // A handle for measuring input latency and interpolation from the outside. Dev builds only.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__lindocara = {
      all: () => client.sample(performance.now()),
      self: () => client.sample(performance.now()).players.find((p) => p.id === client.selfId),
      renderStats: () => renderer.diagnostics(),
    };
  }
}
