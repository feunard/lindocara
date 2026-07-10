import {
  ATTACK_COOLDOWN_MS,
  ATTACK_RANGE,
  INTERACTION_RANGE,
  pointDistance,
  QUEST_NPC,
  SAFE_ZONE,
} from "../shared/game.js";
import type { MessageKey } from "../shared/i18n/index.js";
import type {
  Appearance,
  EventCode,
  EventParams,
  PlayerSnapshot,
  QuestStatus,
  SelfState,
} from "../shared/protocol.js";
import { NO_INPUT } from "../shared/simulation.js";
import { initLocale, onLocaleChange, t } from "./i18n.js";
import { trackActions, trackInput } from "./input.js";
import { WorldClient } from "./net.js";
import { type RenderContext, Renderer } from "./renderer.js";
import { GameSound } from "./sound.js";
import "./style.css";

interface Me {
  id: string;
  username: string;
}

interface CharacterSummary {
  id: string;
  name: string;
  appearance: Appearance;
  level: number;
}

/** The client can only create as many characters as the server's per-account cap allows.
 *  Kept in sync with `MAX_CHARACTERS_PER_ACCOUNT` in `src/server/characters.ts` — not
 *  imported, since client code must not import server code. */
const MAX_CHARACTERS = 3;

/** Cache of the last-fetched character list, used to re-render on locale changes
 *  without re-fetching or closing the character creation form. */
let lastCharacters: CharacterSummary[] | null = null;

/** API errors carry stable machine codes the UI maps to i18n keys. */
class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : "generic";
    throw new ApiError(code);
  }
  return body as T;
}

const fetchMe = () => api<Me>("/api/me").catch(() => null);
const fetchCharacters = () => api<CharacterSummary[]>("/api/characters");

/** Stable machine codes (from ApiError, or synthesized client-side) mapped to i18n keys. */
const ERROR_KEYS: Record<string, MessageKey> = {
  username_taken: "auth.error.username_taken",
  invalid_credentials: "auth.error.invalid_credentials",
  invalid_username: "auth.error.invalid_username",
  invalid_password: "auth.error.invalid_password",
  password_mismatch: "auth.error.password_mismatch",
  limit_reached: "chars.error.limit_reached",
  invalid_name: "chars.error.invalid_name",
};

function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : "generic";
}

function authErrorText(code: string): string {
  return t(ERROR_KEYS[code] ?? "auth.error.generic");
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`index.html is missing ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>("#stage");
const authPanel = required<HTMLDivElement>("#auth");
const tabLogin = required<HTMLButtonElement>("#tab-login");
const tabRegister = required<HTMLButtonElement>("#tab-register");
const loginForm = required<HTMLFormElement>("#login-form");
const registerForm = required<HTMLFormElement>("#register-form");
const loginError = required<HTMLParagraphElement>("#login-error");
const registerError = required<HTMLParagraphElement>("#register-error");
const charactersPanel = required<HTMLElement>("#characters");
const characterList = required<HTMLDivElement>("#character-list");
const characterCreate = required<HTMLFormElement>("#character-create");
const characterError = required<HTMLParagraphElement>("#character-error");
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

type FormErrorField = "login" | "register" | "character";

const errorElements: Record<FormErrorField, HTMLParagraphElement> = {
  login: loginError,
  register: registerError,
  character: characterError,
};

/** The last error code shown per form, so a locale toggle can re-render it in the new language. */
const errorCodes: Partial<Record<FormErrorField, string>> = {};

function showFormError(field: FormErrorField, code: string): void {
  errorCodes[field] = code;
  errorElements[field].textContent = authErrorText(code);
}

function clearFormError(field: FormErrorField): void {
  delete errorCodes[field];
  errorElements[field].textContent = "";
}

function showAuth(): void {
  authPanel.hidden = false;
  charactersPanel.hidden = true;
  required<HTMLInputElement>("#login-username").focus();
}

function setTab(register: boolean): void {
  tabLogin.classList.toggle("active", !register);
  tabRegister.classList.toggle("active", register);
  loginForm.hidden = register;
  registerForm.hidden = !register;
  clearFormError("login");
  clearFormError("register");
}
tabLogin.addEventListener("click", () => setTab(false));
tabRegister.addEventListener("click", () => setTab(true));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  sound.unlock();
  clearFormError("login");
  const data = new FormData(loginForm);
  try {
    await api<Me>("/api/session", {
      method: "POST",
      body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
    });
    await showCharacters();
  } catch (error) {
    showFormError("login", errorCode(error));
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  sound.unlock();
  clearFormError("register");
  const data = new FormData(registerForm);
  if (data.get("password") !== data.get("confirm")) {
    showFormError("register", "password_mismatch");
    return;
  }
  try {
    await api<Me>("/api/register", {
      method: "POST",
      body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
    });
    await showCharacters();
  } catch (error) {
    showFormError("register", errorCode(error));
  }
});

async function showCharacters(): Promise<void> {
  authPanel.hidden = true;
  let characters: CharacterSummary[];
  try {
    characters = await fetchCharacters();
  } catch {
    showAuth();
    return;
  }
  lastCharacters = characters;
  renderCharacterList(characters);
  characterCreate.hidden = characters.length > 0;
  charactersPanel.hidden = false;
}

function renderCharacterList(characters: CharacterSummary[]): void {
  characterList.replaceChildren(
    ...characters.map((character) => {
      const card = document.createElement("article");
      card.className = "character-card";
      const swatch = document.createElement("span");
      swatch.className = `swatch swatch--${character.appearance}`;
      swatch.setAttribute("aria-hidden", "true");
      const name = document.createElement("strong");
      name.textContent = character.name;
      const level = document.createElement("span");
      level.textContent = t("hud.level", { level: character.level });
      const playButton = document.createElement("button");
      playButton.type = "button";
      playButton.textContent = t("chars.play");
      playButton.addEventListener("click", () => {
        charactersPanel.hidden = true;
        void play(character);
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = t("chars.delete");
      remove.addEventListener("click", async () => {
        if (remove.dataset.confirming !== "true") {
          remove.dataset.confirming = "true";
          remove.textContent = t("chars.delete_confirm");
          return;
        }
        await api(`/api/characters/${character.id}`, { method: "DELETE" }).catch(() => undefined);
        await showCharacters();
      });
      card.append(swatch, name, level, playButton, remove);
      return card;
    }),
    newCharacterCard(characters.length),
  );
}

function newCharacterCard(count: number): HTMLElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "character-card character-card--new";
  card.textContent = t("chars.new");
  card.disabled = count >= MAX_CHARACTERS;
  card.addEventListener("click", () => {
    characterCreate.hidden = false;
    required<HTMLInputElement>("#character-name").focus();
  });
  return card;
}

characterCreate.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearFormError("character");
  const data = new FormData(characterCreate);
  try {
    await api<CharacterSummary>("/api/characters", {
      method: "POST",
      body: JSON.stringify({ name: data.get("name"), appearance: data.get("appearance") }),
    });
    characterCreate.reset();
    await showCharacters();
  } catch (error) {
    showFormError("character", errorCode(error));
  }
});
required<HTMLButtonElement>("#character-create-cancel").addEventListener("click", () => {
  characterCreate.hidden = true;
});

required<HTMLButtonElement>("#logout").addEventListener("click", async () => {
  await fetch("/api/session", { method: "DELETE" });
  window.location.reload();
});

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

/** The door currently shown in the interior panel, so a locale toggle can re-translate it. */
let openDoor: InteriorDoor | undefined;

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
  openDoor = door;
  interiorTitle.textContent = t(door.nameKey);
  interiorCopy.textContent = t(door.copyKey);
  interior.dataset.room = door.id;
  interior.hidden = false;
  interior.classList.add("open");
}

function closeInterior(): void {
  openDoor = undefined;
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

async function play(character: CharacterSummary): Promise<void> {
  setStatus(() => t("status.connecting", { name: character.name }));
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
        setStatus(() => t("status.disconnected", { reason: t(key) }));
        addEvent(t("status.connection_lost"), "bad");
      },
    },
    character.id,
  );

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
      // biome-ignore lint/correctness/useHookAtTopLevel: usePotion is a game action handler, not a React hook.
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

  required<HTMLButtonElement>("#switch-character").addEventListener("click", () => {
    connection.close();
    window.location.reload();
  });
  required<HTMLButtonElement>("#logout-game").addEventListener("click", async () => {
    connection.close();
    await fetch("/api/session", { method: "DELETE" });
    window.location.reload();
  });

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
  if (!charactersPanel.hidden) renderCharacterList(lastCharacters ?? []);
  if (openDoor) {
    interiorTitle.textContent = t(openDoor.nameKey);
    interiorCopy.textContent = t(openDoor.copyKey);
  }
  for (const field of Object.keys(errorElements) as FormErrorField[]) {
    const code = errorCodes[field];
    if (code) errorElements[field].textContent = authErrorText(code);
  }
});

initLocale();
const existing = await fetchMe();
if (existing) await showCharacters();
else showAuth();
