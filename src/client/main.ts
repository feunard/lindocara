import {
  ATTACK_COOLDOWN_MS,
  ATTACK_RANGE,
  INTERACTION_RANGE,
  pointDistance,
  QUEST_NPC,
} from "../shared/game.js";
import type { PlayerSnapshot, QuestStatus, SelfState } from "../shared/protocol.js";
import { trackActions, trackInput } from "./input.js";
import { WorldClient } from "./net.js";
import { type RenderContext, Renderer } from "./renderer.js";
import { GameSound } from "./sound.js";
import "./style.css";

interface Me {
  id: string;
  nick: string;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`index.html is missing ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>("#stage");
const loginPanel = required<HTMLDivElement>("#login");
const loginForm = required<HTMLFormElement>("#login-form");
const nicknameField = required<HTMLInputElement>("#nickname");
const loginError = required<HTMLParagraphElement>("#login-error");
const statusBar = required<HTMLDivElement>("#status");
const hud = required<HTMLElement>("#hud");
const playerName = required<HTMLElement>("#player-name");
const playerLevel = required<HTMLElement>("#player-level");
const hpBar = required<HTMLProgressElement>("#hp-bar");
const hpText = required<HTMLElement>("#hp-text");
const xpBar = required<HTMLProgressElement>("#xp-bar");
const xpText = required<HTMLElement>("#xp-text");
const inventoryText = required<HTMLElement>("#inventory-text");
const questText = required<HTMLElement>("#quest-text");
const questProgress = required<HTMLProgressElement>("#quest-progress");
const attackCooldown = required<HTMLProgressElement>("#attack-cooldown");
const combatPanel = required<HTMLElement>(".combat");
const prompt = required<HTMLDivElement>("#prompt");
const interior = required<HTMLElement>("#interior");
const interiorTitle = required<HTMLElement>("#interior-title");
const interiorCopy = required<HTMLElement>("#interior-copy");
const interiorClose = required<HTMLButtonElement>("#interior-close");
const eventLog = required<HTMLElement>("#event-log");
const chat = required<HTMLElement>("#chat");
const chatMessages = required<HTMLElement>("#chat-messages");
const chatForm = required<HTMLFormElement>("#chat-form");
const chatInput = required<HTMLInputElement>("#chat-input");
const help = required<HTMLElement>("#help");
const sound = new GameSound();

interface InteriorDoor {
  id: string;
  name: string;
  x: number;
  y: number;
  copy: string;
}

const INTERIOR_RANGE = 54;
const INTERIORS: readonly InteriorDoor[] = [
  {
    id: "hearth",
    name: "Heartroot Hearth",
    x: 620,
    y: 205,
    copy: "A low fire, drying herbs, a cedar chest, and a quiet keeper sorting charms.",
  },
  {
    id: "farm",
    name: "Old Root Farm",
    x: 608,
    y: 426,
    copy: "Weathered tools, sacks of seed, a workbench, and a map of paths swallowed by moss.",
  },
  {
    id: "watch",
    name: "Mosswatch House",
    x: 1038,
    y: 168,
    copy: "Warm coals, patched shutters, and a chest marked with the old village seal.",
  },
  {
    id: "marsh",
    name: "Marsh Door",
    x: 1018,
    y: 552,
    copy: "Damp stone, blue lanternlight, and a stairwell descending below the reeds.",
  },
] as const;

function setStatus(text: string): void {
  statusBar.textContent = text;
}

type ItemIcon = "potion" | "gold" | "crystal" | "sword";

function itemChip(icon: ItemIcon, label: string, value: string, hotkey?: string): HTMLElement {
  const chip = document.createElement("div");
  chip.className = "item-chip";
  chip.title = hotkey ? `${label} [${hotkey}]` : label;
  chip.setAttribute("aria-label", `${label}: ${value}`);
  const symbol = document.createElement("span");
  symbol.className = `item-icon item-icon--${icon}`;
  symbol.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  copy.className = "item-copy";
  const name = document.createElement("small");
  name.textContent = label;
  const amount = document.createElement("strong");
  amount.textContent = value;
  copy.append(name, amount);
  chip.append(symbol, copy);
  if (hotkey) {
    const key = document.createElement("kbd");
    key.textContent = hotkey;
    chip.append(key);
  }
  return chip;
}

async function fetchMe(): Promise<Me | null> {
  const response = await fetch("/api/me");
  if (!response.ok) return null;
  return (await response.json()) as Me;
}

async function login(nickname: string): Promise<Me> {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  const body = (await response.json()) as Me | { error: string };
  if (!response.ok) throw new Error("error" in body ? body.error : "login failed");
  return body as Me;
}

function renderState(state: SelfState): void {
  xpBar.max = state.xpToNext;
  xpBar.value = state.xp;
  xpText.textContent = `${state.xp}/${state.xpToNext}`;
  const { potions, gold, crystals, weapon } = state.inventory;
  inventoryText.replaceChildren(
    itemChip("potion", "Heartroot tonic", String(potions), "Q"),
    itemChip("gold", "Sunmarks", String(gold)),
    itemChip("crystal", "Gloam shards", String(crystals)),
    itemChip("sword", "Weathered blade", weapon === "rusty_sword" ? "On" : "?"),
  );
  if (state.quest.status === "available") {
    questText.textContent = "Keeper Elowen waits beside the Heartroot.";
    questProgress.hidden = true;
  } else if (state.quest.status === "active") {
    questText.textContent = `Quiet gloam creatures in the woods (${state.quest.progress}/${state.quest.target})`;
    questProgress.hidden = false;
    questProgress.max = state.quest.target;
    questProgress.value = state.quest.progress;
  } else if (state.quest.status === "ready") {
    questText.textContent = "Return to Elowen at the Heartroot.";
    questProgress.hidden = false;
    questProgress.max = state.quest.target;
    questProgress.value = state.quest.target;
  } else {
    questText.textContent = "The Gloamcap Oath is fulfilled.";
    questProgress.hidden = true;
  }
  pulse(questText.closest(".panel"));
}

function nearestInterior(self: PlayerSnapshot | undefined): InteriorDoor | undefined {
  if (!self) return undefined;
  let nearest: InteriorDoor | undefined;
  let nearestDistance = INTERIOR_RANGE;
  for (const door of INTERIORS) {
    const distance = pointDistance(self, door);
    if (distance > nearestDistance) continue;
    nearest = door;
    nearestDistance = distance;
  }
  return nearest;
}

function openInterior(door: InteriorDoor): void {
  interiorTitle.textContent = door.name;
  interiorCopy.textContent = door.copy;
  interior.dataset.room = door.id;
  interior.hidden = false;
  interior.classList.add("open");
}

function closeInterior(): void {
  interior.classList.remove("open");
  interior.hidden = true;
}

function renderPlayer(player: PlayerSnapshot | undefined): void {
  if (!player) return;
  playerName.textContent = player.nick;
  playerLevel.textContent = `Level ${player.level}`;
  hpBar.max = player.maxHp;
  hpBar.value = player.hp;
  hpText.textContent = `${player.hp}/${player.maxHp}`;
}

function pulse(element: Element | null): void {
  if (!(element instanceof HTMLElement)) return;
  element.classList.remove("pulse");
  void element.offsetWidth;
  element.classList.add("pulse");
}

function shouldLogEvent(text: string): boolean {
  if (/^You hit /i.test(text)) return false;
  if (/ hits you for /i.test(text)) return true;
  if (/too far|nothing close/i.test(text)) return true;
  if (/knocked out|heartroot|oath|level up|defeated|picked up|tonic|awaken|still stir/i.test(text))
    return true;
  return text.length < 80;
}

function updatePrompt(
  self: PlayerSnapshot | undefined,
  questStatus: QuestStatus,
  interiorDoor: InteriorDoor | undefined,
): void {
  if (!interior.hidden) {
    prompt.textContent = "[E] Leave";
    prompt.hidden = false;
    return;
  }
  if (!self || self.dead) {
    prompt.hidden = true;
    return;
  }
  const nearNpc = pointDistance(self, QUEST_NPC) <= INTERACTION_RANGE;
  if (interiorDoor && !nearNpc) {
    prompt.textContent = `[E] Enter ${interiorDoor.name}`;
    prompt.hidden = false;
    return;
  }
  if (
    nearNpc &&
    (questStatus === "available" || questStatus === "ready" || questStatus === "completed")
  ) {
    prompt.textContent =
      questStatus === "available"
        ? "[E] Swear the Gloamcap Oath"
        : questStatus === "ready"
          ? "[E] Claim your reward"
          : "[E] Speak with Elowen";
    prompt.hidden = false;
    return;
  }
  if (questStatus === "active") {
    prompt.textContent = "Leave the Heartroot - hunt gloam creatures [Space]";
    prompt.hidden = nearNpc;
    return;
  }
  if (questStatus === "available") {
    prompt.textContent = "Approach the golden marker - Keeper Elowen [E]";
    prompt.hidden = false;
    return;
  }
  prompt.hidden = true;
}

function updateAttackCooldown(now: number, until: number): void {
  const remaining = Math.max(0, until - now);
  attackCooldown.max = ATTACK_COOLDOWN_MS;
  attackCooldown.value = ATTACK_COOLDOWN_MS - remaining;
  combatPanel.hidden = remaining <= 0;
}

function addEvent(text: string, tone: "info" | "good" | "bad"): void {
  const line = document.createElement("div");
  line.className = `event ${tone}`;
  const marker = tone === "good" ? "+ " : tone === "bad" ? "! " : "* ";
  line.textContent = `${marker}${text}`;
  eventLog.prepend(line);
  while (eventLog.children.length > 6) eventLog.lastElementChild?.remove();
  window.setTimeout(() => line.remove(), 6_000);
}

function addChat(from: string, text: string): void {
  const line = document.createElement("div");
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = `${from}: `;
  line.append(name, document.createTextNode(text));
  chatMessages.append(line);
  while (chatMessages.children.length > 8) chatMessages.firstElementChild?.remove();
  chat.classList.add("has-chat");
}

async function play(me: Me): Promise<void> {
  loginPanel.hidden = true;
  setStatus(`connecting as ${me.nick}...`);
  const renderer = await Renderer.create(canvas);
  const client = new WorldClient();
  const input = trackInput();
  let stopActions: (() => void) | null = null;
  let questStatus: QuestStatus = "available";
  let attackCooldownUntil = 0;
  let welcomed = false;
  let currentSelf: PlayerSnapshot | undefined;

  const connection = client.connect({
    onWelcome: (selfId, _world, state) => {
      renderer.setSelfId(selfId);
      questStatus = state.quest.status;
      renderState(state);
      hud.hidden = false;
      chat.hidden = false;
      help.hidden = false;
      setStatus("connected - Everwild Hollow");
      if (!welcomed) {
        welcomed = true;
        addEvent("Elowen stands beside the golden marker. Press [E] to begin.", "info");
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
    onEvent: (text, tone, x, y) => {
      if (shouldLogEvent(text)) addEvent(text, tone);
      renderer.showWorldEvent(text, tone, x, y);
      if (/swing hits only air|too far/i.test(text)) {
        sound.attack();
        renderer.playAttackMiss();
      } else if (/level up|oath is fulfilled/i.test(text)) sound.levelUp();
      else if (/picked up|oath sworn|heartroot tonic/i.test(text)) sound.loot();
      else if (/knocked out|awaken/i.test(text)) sound.death();
      else if (/You hit|hits you for/i.test(text)) sound.hit();
    },
    onClose: (reason) => {
      input.stop();
      stopActions?.();
      setStatus(`disconnected - ${reason}`);
      addEvent("Connection lost. Reload to rejoin.", "bad");
    },
  });

  stopActions = trackActions({
    attack: () => {
      sound.unlock();
      sound.attack();
      attackCooldownUntil = performance.now() + ATTACK_COOLDOWN_MS;
      if (client.selfId) renderer.playAttack(client.selfId);
      connection.attack();
    },
    interact: () => {
      sound.unlock();
      if (!interior.hidden) {
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
    },
    usePotion: () => {
      sound.unlock();
      sound.loot();
      connection.usePotion();
    },
    focusChat: () => {
      input.reset();
      chat.classList.add("chat-open");
      chatInput.focus();
    },
  });

  chatInput.addEventListener("focus", () => {
    chat.classList.add("chat-open");
  });
  chatInput.addEventListener("blur", () => {
    chat.classList.remove("chat-open");
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (text) connection.sendChat(text);
    chatInput.value = "";
    chatInput.blur();
  });
  interiorClose.addEventListener("click", closeInterior);
  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || interior.hidden) return;
    closeInterior();
    input.reset();
    event.preventDefault();
  });

  renderer.onFrame((now, dt) => {
    client.update(input.current(), dt);
    const sample = client.sample(now);
    const self = sample.players.find((player) => player.id === client.selfId);
    currentSelf = self;
    const door = nearestInterior(self);
    const context: RenderContext = {
      questStatus,
      attackCooldownUntil,
      attackRange: ATTACK_RANGE,
      now,
      ...(self ? { self } : {}),
    };
    renderer.render(sample, context);
    renderPlayer(self);
    updatePrompt(self, questStatus, door);
    updateAttackCooldown(now, attackCooldownUntil);
  });
  window.addEventListener("beforeunload", () => connection.close());

  // A handle for measuring input latency and interpolation from the outside. Dev builds only.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__lindocara = {
      all: () => client.sample(performance.now()),
      self: () => client.sample(performance.now()).players.find((p) => p.id === client.selfId),
    };
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  sound.unlock();
  loginError.textContent = "";
  const submit = loginForm.querySelector("button");
  if (submit) submit.disabled = true;
  try {
    await play(await login(nicknameField.value.trim()));
  } catch (error) {
    loginError.textContent = error instanceof Error ? error.message : "login failed";
    if (submit) submit.disabled = false;
  }
});

const existing = await fetchMe();
if (existing) await play(existing);
else {
  loginPanel.hidden = false;
  nicknameField.focus();
}
