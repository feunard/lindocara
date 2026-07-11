import {
  ATTACK_COOLDOWN_MS,
  CLASS_STATS,
  INTERACTION_RANGE,
  pointDistance,
  QUEST_NPC,
  SAFE_ZONE,
} from "../../shared/game.js";
import type { MessageKey } from "../../shared/i18n/index.js";
import type {
  EventCode,
  EventParams,
  PlayerSnapshot,
  QuestStatus,
  SelfState,
} from "../../shared/protocol.js";
import { NO_INPUT } from "../../shared/simulation.js";
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

/** The store is the single source of truth for whether the interior panel is open;
 *  InteriorOverlay renders it from `interiorDoorId`. */
function interiorOpen(): boolean {
  return useUiStore.getState().interiorDoorId !== null;
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

function renderPlayer(player: PlayerSnapshot | undefined): void {
  useUiStore.getState().setSelf(
    player
      ? {
          nick: player.nick,
          level: player.level,
          hp: player.hp,
          maxHp: player.maxHp,
          dead: player.dead,
        }
      : null,
  );
}

/** Resolve species/kind params to localized names, then apply the event template. */
function eventText(code: EventCode, params: EventParams = {}): string {
  const resolved: EventParams = { ...params };
  if (typeof resolved.species === "string") {
    resolved.species = t(`monster.${resolved.species}` as MessageKey);
  }
  if (typeof resolved.kind === "string") {
    resolved.kind = t(`item.${resolved.kind}` as MessageKey);
  }
  return t(`event.${code}` as MessageKey, resolved);
}

/** Your own hits spam the combat log; everything else is worth a line. */
function shouldLogEvent(code: EventCode): boolean {
  return code !== "combat.hit";
}

function updatePrompt(
  self: PlayerSnapshot | undefined,
  questStatus: QuestStatus,
  interiorDoor: InteriorDoor | undefined,
): void {
  let result: LocalizedText | null = null;
  // Prompt.tsx hides the floating prompt whenever the interior panel is open, so a
  // "close_interior" key here would never render - don't bother computing one.
  if (interiorOpen() || !self || self.dead) {
    result = null;
  } else {
    const nearNpc = pointDistance(self, QUEST_NPC) <= INTERACTION_RANGE;
    if (interiorDoor && !nearNpc) {
      result = { key: "prompt.look_inside", params: { name: t(interiorDoor.nameKey) } };
    } else if (
      nearNpc &&
      (questStatus === "available" || questStatus === "ready" || questStatus === "completed")
    ) {
      result = {
        key:
          questStatus === "available"
            ? "prompt.swear"
            : questStatus === "ready"
              ? "prompt.claim"
              : "prompt.speak",
      };
    } else if (questStatus === "active") {
      const inHub =
        self.x >= SAFE_ZONE.x &&
        self.x <= SAFE_ZONE.x + SAFE_ZONE.width &&
        self.y >= SAFE_ZONE.y &&
        self.y <= SAFE_ZONE.y + SAFE_ZONE.height;
      result = nearNpc || !inHub ? null : { key: "prompt.hunt" };
    } else if (questStatus === "available") {
      result = pointDistance(self, QUEST_NPC) > 420 ? null : { key: "prompt.approach" };
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
  let questStatus: QuestStatus = "available";
  let attackCooldownUntil = 0;
  let welcomed = false;
  let currentSelf: PlayerSnapshot | undefined;

  const connection = client.connect(
    {
      onWelcome: (selfId, _world, state) => {
        renderer.setSelfId(selfId);
        questStatus = state.quest.status;
        renderState(state);
        setStatus("status.connected");
        if (!welcomed) {
          welcomed = true;
          addEvent(t("status.welcome_hint"), "info");
        }
      },
      onState: (state) => {
        questStatus = state.quest.status;
        renderState(state);
      },
      onChat: (from, text) => {
        addChat(from, text);
        sound.chat();
      },
      onEvent: (code, params, tone, x, y) => {
        const text = eventText(code, params);
        if (shouldLogEvent(code)) addEvent(text, tone);
        renderer.showWorldEvent(text, tone, x, y);
        switch (code) {
          case "combat.too_far":
            sound.attack();
            renderer.playAttackMiss();
            break;
          case "level_up":
          case "quest.fulfilled":
            sound.levelUp();
            break;
          case "loot.picked":
          case "quest.accepted":
          case "potion.used":
            sound.loot();
            break;
          case "player.down":
          case "respawn":
            sound.death();
            break;
          case "combat.hit":
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
        // The raw wire reason is English server prose; never render it directly.
        console.debug("connection closed", code, reason);
        const key: MessageKey =
          code === 4001
            ? "status.close.elsewhere"
            : code === 4002
              ? "status.close.deleted"
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
    sound.attack();
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
    const nearNpc = currentSelf && pointDistance(currentSelf, QUEST_NPC) <= INTERACTION_RANGE;
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
    focusChat: () => {
      input.reset();
      useUiStore.getState().requestChatFocus();
    },
  });

  useUiStore.getState().setGame({
    attack,
    interact,
    usePotion,
    sendChat: connection.sendChat,
    switchCharacter,
    logout: logoutAndReload,
  });

  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || !interiorOpen()) return;
    closeInterior();
    input.reset();
    event.preventDefault();
  });

  renderer.onFrame((now, dt) => {
    client.update(interiorOpen() ? NO_INPUT : input.current(), dt);
    const sample = client.sample(now);
    const self = sample.players.find((player) => player.id === client.selfId);
    currentSelf = self;
    const door = nearestInterior(self);
    const context: RenderContext = {
      questStatus,
      attackCooldownUntil,
      attackRange: currentSelf ? CLASS_STATS[currentSelf.class].attackRange : 0,
      now,
      ...(self ? { self } : {}),
    };
    renderer.render(sample, context);
    renderPlayer(self);
    updatePrompt(self, questStatus, door);
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
