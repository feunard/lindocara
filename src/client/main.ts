import {
  ATTACK_COOLDOWN_MS,
  ATTACK_RANGE,
  INTERACTION_RANGE,
  pointDistance,
  QUEST_NPC,
  SAFE_ZONE,
} from "../shared/game.js";
import type { MessageKey } from "../shared/i18n/index.js";
import type { PlayerSnapshot, QuestStatus, SelfState } from "../shared/protocol.js";
import { NO_INPUT } from "../shared/simulation.js";
import { initLocale, onLocaleChange, t } from "./i18n.js";
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
  nameKey: MessageKey;
  x: number;
  y: number;
  copyKey: MessageKey;
}

const INTERIOR_RANGE = 54;
const INTERIORS: readonly InteriorDoor[] = [
  {
    id: "crossing-hall",
    nameKey: "interior.crossing-hall.name",
    x: 910,
    y: 490,
    copyKey: "interior.crossing-hall.copy",
  },
  {
    id: "lantern-house",
    nameKey: "interior.lantern-house.name",
    x: 1235,
    y: 500,
    copyKey: "interior.lantern-house.copy",
  },
  {
    id: "wayfarer-rest",
    nameKey: "interior.wayfarer-rest.name",
    x: 510,
    y: 1055,
    copyKey: "interior.wayfarer-rest.copy",
  },
  {
    id: "bramblewick-farm",
    nameKey: "interior.bramblewick-farm.name",
    x: 1960,
    y: 2070,
    copyKey: "interior.bramblewick-farm.copy",
  },
] as const;

let lastStatus: () => string = () => "";

function setStatus(compute: () => string): void {
  lastStatus = compute;
  statusBar.textContent = compute();
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

let lastState: SelfState | null = null;
let lastPlayer: PlayerSnapshot | undefined;

function renderState(state: SelfState): void {
  lastState = state;
  xpBar.max = state.xpToNext;
  xpBar.value = state.xp;
  xpText.textContent = `${state.xp}/${state.xpToNext}`;
  const { potions, gold, crystals, weapon } = state.inventory;
  inventoryText.replaceChildren(
    itemChip("potion", t("item.potion"), String(potions), "Q"),
    itemChip("gold", t("item.gold"), String(gold)),
    itemChip("crystal", t("item.crystal"), String(crystals)),
    itemChip("sword", t("item.sword"), weapon === "rusty_sword" ? t("item.sword_on") : "?"),
  );
  if (state.quest.status === "available") {
    questText.textContent = t("quest.available");
    questProgress.hidden = true;
  } else if (state.quest.status === "active") {
    questText.textContent = t("quest.active", {
      progress: state.quest.progress,
      target: state.quest.target,
    });
    questProgress.hidden = false;
    questProgress.max = state.quest.target;
    questProgress.value = state.quest.progress;
  } else if (state.quest.status === "ready") {
    questText.textContent = t("quest.ready");
    questProgress.hidden = false;
    questProgress.max = state.quest.target;
    questProgress.value = state.quest.target;
  } else {
    questText.textContent = t("quest.completed");
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
  interiorTitle.textContent = t(door.nameKey);
  interiorCopy.textContent = t(door.copyKey);
  interior.dataset.room = door.id;
  interior.hidden = false;
  interior.classList.add("open");
}

function closeInterior(): void {
  interior.classList.remove("open");
  interior.hidden = true;
}

function renderPlayer(player: PlayerSnapshot | undefined): void {
  lastPlayer = player;
  if (!player) return;
  playerName.textContent = player.nick;
  playerLevel.textContent = t("hud.level", { level: player.level });
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
    prompt.textContent = t("prompt.close_interior");
    prompt.hidden = false;
    return;
  }
  if (!self || self.dead) {
    prompt.hidden = true;
    return;
  }
  const nearNpc = pointDistance(self, QUEST_NPC) <= INTERACTION_RANGE;
  if (interiorDoor && !nearNpc) {
    prompt.textContent = t("prompt.look_inside", { name: t(interiorDoor.nameKey) });
    prompt.hidden = false;
    return;
  }
  if (
    nearNpc &&
    (questStatus === "available" || questStatus === "ready" || questStatus === "completed")
  ) {
    prompt.textContent =
      questStatus === "available"
        ? t("prompt.swear")
        : questStatus === "ready"
          ? t("prompt.claim")
          : t("prompt.speak");
    prompt.hidden = false;
    return;
  }
  if (questStatus === "active") {
    const inHub =
      self.x >= SAFE_ZONE.x &&
      self.x <= SAFE_ZONE.x + SAFE_ZONE.width &&
      self.y >= SAFE_ZONE.y &&
      self.y <= SAFE_ZONE.y + SAFE_ZONE.height;
    prompt.textContent = t("prompt.hunt");
    prompt.hidden = nearNpc || !inHub;
    return;
  }
  if (questStatus === "available") {
    prompt.textContent = t("prompt.approach");
    prompt.hidden = pointDistance(self, QUEST_NPC) > 420;
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
  setStatus(() => t("status.connecting", { name: me.nick }));
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
      setStatus(() => t("status.connected"));
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
      setStatus(() => t("status.disconnected", { reason }));
      addEvent(t("status.connection_lost"), "bad");
    },
  });

  stopActions = trackActions({
    attack: () => {
      if (!interior.hidden) return;
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
      if (!interior.hidden) return;
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
    client.update(interior.hidden ? input.current() : NO_INPUT, dt);
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
      renderStats: () => renderer.diagnostics(),
    };
  }
}

onLocaleChange(() => {
  statusBar.textContent = lastStatus();
  if (lastState) renderState(lastState);
  renderPlayer(lastPlayer);
});

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

initLocale();

const existing = await fetchMe();
if (existing) await play(existing);
else {
  loginPanel.hidden = false;
  nicknameField.focus();
}
