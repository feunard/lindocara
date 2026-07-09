import type { PlayerSnapshot, SelfState } from "../shared/protocol.js";
import { trackActions, trackInput } from "./input.js";
import { WorldClient } from "./net.js";
import { Renderer } from "./renderer.js";
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
const eventLog = required<HTMLElement>("#event-log");
const chat = required<HTMLElement>("#chat");
const chatMessages = required<HTMLElement>("#chat-messages");
const chatForm = required<HTMLFormElement>("#chat-form");
const chatInput = required<HTMLInputElement>("#chat-input");
const help = required<HTMLElement>("#help");
const sound = new GameSound();

function setStatus(text: string): void {
  statusBar.textContent = text;
}

function itemChip(icon: string, label: string, value: string, hotkey?: string): HTMLElement {
  const chip = document.createElement("div");
  chip.className = "item-chip";
  const symbol = document.createElement("span");
  symbol.className = "item-icon";
  symbol.textContent = icon;
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
    itemChip("◒", "Heartroot tonic", String(potions), "Q"),
    itemChip("●", "Sunmarks", String(gold)),
    itemChip("◆", "Gloam shards", String(crystals)),
    itemChip("†", "Weathered blade", weapon === "rusty_sword" ? "Equipped" : "Unknown"),
  );
  if (state.quest.status === "available") questText.textContent = "Speak with Keeper Elowen [E]";
  else if (state.quest.status === "active") {
    questText.textContent = `The Gloamcap Oath: ${state.quest.progress}/${state.quest.target}`;
  } else if (state.quest.status === "ready") {
    questText.textContent = "Oath fulfilled — return to Elowen [E]";
  } else {
    questText.textContent = "The Gloamcap Oath fulfilled";
  }
  pulse(inventoryText.closest(".panel"));
  pulse(questText.closest(".panel"));
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

function addEvent(text: string, tone: "info" | "good" | "bad"): void {
  const line = document.createElement("div");
  line.className = `event ${tone}`;
  const icon = tone === "good" ? "✦" : tone === "bad" ? "◆" : "◇";
  line.textContent = `${icon}  ${text}`;
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
  while (chatMessages.children.length > 30) chatMessages.firstElementChild?.remove();
}

async function play(me: Me): Promise<void> {
  loginPanel.hidden = true;
  setStatus(`connecting as ${me.nick}…`);
  const renderer = await Renderer.create(canvas);
  const client = new WorldClient();
  const input = trackInput();
  let stopActions: (() => void) | null = null;

  const connection = client.connect({
    onWelcome: (selfId, _world, state) => {
      renderer.setSelfId(selfId);
      renderState(state);
      hud.hidden = false;
      chat.hidden = false;
      help.hidden = false;
      setStatus("connected");
    },
    onState: renderState,
    onChat: (from, text) => {
      addChat(from, text);
      sound.chat();
    },
    onEvent: (text, tone, x, y) => {
      addEvent(text, tone);
      renderer.showWorldEvent(text, tone, x, y);
      if (/level up|oath is fulfilled/i.test(text)) sound.levelUp();
      else if (/picked up|oath sworn|heartroot tonic/i.test(text)) sound.loot();
      else if (/knocked out/i.test(text)) sound.death();
      else if (/hits|hit you/i.test(text)) sound.hit();
    },
    onClose: (reason) => {
      input.stop();
      stopActions?.();
      setStatus(`disconnected: ${reason}`);
      addEvent("Connection lost. Reload to rejoin.", "bad");
    },
  });

  stopActions = trackActions({
    attack: () => {
      sound.unlock();
      sound.attack();
      if (client.selfId) renderer.playAttack(client.selfId);
      connection.attack();
    },
    interact: () => {
      sound.unlock();
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
      chatInput.focus();
    },
  });

  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (text) connection.sendChat(text);
    chatInput.value = "";
    chatInput.blur();
  });

  renderer.onFrame((now, dt) => {
    // Predict before drawing, so the local player reacts within the frame.
    client.update(input.current(), dt);
    const sample = client.sample(now);
    renderer.render(sample, now);
    renderPlayer(sample.players.find((player) => player.id === client.selfId));
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
