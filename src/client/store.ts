import { create } from "zustand";
import type { Equipment } from "../shared/character.js";
import type { LifeState } from "../shared/death.js";
import type { PlayerClass } from "../shared/game.js";
import type { MessageKey } from "../shared/i18n/index.js";
import type { QuestStatus, SelfState } from "../shared/protocol.js";
import type { SkillSlot } from "../shared/skills.js";
import type { CharacterSummary } from "./api.js";

export interface LocalizedText {
  key: MessageKey;
  params?: Record<string, string | number>;
}

export interface EventLine {
  id: number;
  text: string; // rendered at arrival, deliberately (spec)
  tone: "info" | "good" | "bad";
}

export interface ChatLine {
  id: number;
  from: string;
  text: string;
}

/** What the HUD needs from the self snapshot — excludes x/y so it does not churn 60x/s. */
export interface SelfHud {
  nick: string;
  level: number;
  hp: number;
  maxHp: number;
  life: LifeState;
  /** How far your ghost still has to walk. Null unless you are one. */
  corpseDistance: number | null;
  class: PlayerClass;
  equipment: Equipment;
}

export interface GameHandle {
  attack(): void;
  interact(): void;
  usePotion(): void;
  release(): void;
  heal(): void;
  castSkill(slot: SkillSlot): void;
  sendChat(text: string): void;
  switchCharacter(): void;
  logout(): void;
  /** React owns the canvas; the game loop draws into it. The store stays free of world x/y. */
  attachMinimap(canvas: HTMLCanvasElement | null): void;
  attachWorldMap(canvas: HTMLCanvasElement | null): void;
}

export interface ReconnectState {
  kind: "transition" | "network";
  attempt: number;
  cancelReconnect(): void;
}

interface UiState {
  screen: "boot" | "auth" | "characters" | "game";
  characters: CharacterSummary[] | null;
  self: SelfHud | null;
  selfState: SelfState | null;
  questStatus: QuestStatus;
  prompt: LocalizedText | null;
  status: LocalizedText | null;
  events: EventLine[];
  chat: ChatLine[];
  chatFocusRequest: number;
  attackCooldownUntil: number;
  healCooldownUntil: number;
  skillCooldowns: Record<SkillSlot, number>;
  interiorDoorId: string | null;
  settingsOpen: boolean;
  mapOpen: boolean;
  reconnect: ReconnectState | null;
  game: GameHandle | null;

  setScreen(screen: UiState["screen"]): void;
  setCharacters(characters: CharacterSummary[] | null): void;
  setSelf(self: SelfHud | null): void;
  setSelfState(state: SelfState): void;
  setQuestStatus(status: QuestStatus): void;
  setPrompt(prompt: LocalizedText | null): void;
  setStatus(status: LocalizedText): void;
  addEvent(text: string, tone: EventLine["tone"]): void;
  removeEvent(id: number): void;
  addChat(from: string, text: string): void;
  requestChatFocus(): void;
  setAttackCooldownUntil(until: number): void;
  setHealCooldownUntil(until: number): void;
  setSkillCooldown(slot: SkillSlot, until: number): void;
  setInteriorDoorId(id: string | null): void;
  setSettingsOpen(open: boolean): void;
  setMapOpen(open: boolean): void;
  setReconnect(reconnect: ReconnectState | null): void;
  setGame(game: GameHandle | null): void;
}

let eventIdCounter = 0;
let chatIdCounter = 0;

function selfHudEqual(a: SelfHud | null, b: SelfHud | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.nick === b.nick &&
    a.level === b.level &&
    a.hp === b.hp &&
    a.maxHp === b.maxHp &&
    a.life === b.life &&
    // Rounded to the metre by the writer, so a walking ghost re-renders the HUD ~1x/step.
    a.corpseDistance === b.corpseDistance &&
    a.class === b.class &&
    a.equipment.mainHand === b.equipment.mainHand &&
    a.equipment.offHand === b.equipment.offHand
  );
}

function localizedTextEqual(a: LocalizedText | null, b: LocalizedText | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.key === b.key && JSON.stringify(a.params) === JSON.stringify(b.params);
}

export const useUiStore = create<UiState>((set) => ({
  // "boot" is a brief, invisible holding state while fetchMe() is in flight, so a logged-in
  // user does not see a flash of the auth screen before landing on characters.
  screen: "boot",
  characters: null,
  self: null,
  selfState: null,
  questStatus: "available",
  prompt: null,
  status: null,
  events: [],
  chat: [],
  chatFocusRequest: 0,
  attackCooldownUntil: 0,
  healCooldownUntil: 0,
  skillCooldowns: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  interiorDoorId: null,
  settingsOpen: false,
  mapOpen: false,
  reconnect: null,
  game: null,

  setScreen: (screen) => set({ screen }),
  setCharacters: (characters) => set({ characters }),
  setSelf: (self) =>
    set((state) => {
      if (selfHudEqual(state.self, self)) return {};
      return { self };
    }),
  setSelfState: (selfState) => set({ selfState }),
  setQuestStatus: (questStatus) => set({ questStatus }),
  setPrompt: (prompt) =>
    set((state) => {
      if (localizedTextEqual(state.prompt, prompt)) return {};
      return { prompt };
    }),
  setStatus: (status) =>
    set((state) => {
      if (localizedTextEqual(state.status, status)) return {};
      return { status };
    }),
  addEvent: (text, tone) =>
    set((state) => {
      const line: EventLine = {
        id: eventIdCounter++,
        text,
        tone,
      };
      return {
        events: [...state.events, line].slice(-6),
      };
    }),
  removeEvent: (id) =>
    set((state) => ({
      events: state.events.filter((e) => e.id !== id),
    })),
  addChat: (from, text) =>
    set((state) => {
      const line: ChatLine = {
        id: chatIdCounter++,
        from,
        text,
      };
      return {
        chat: [...state.chat, line].slice(-8),
      };
    }),
  requestChatFocus: () =>
    set((state) => ({
      chatFocusRequest: state.chatFocusRequest + 1,
    })),
  setAttackCooldownUntil: (until) => set({ attackCooldownUntil: until }),
  setHealCooldownUntil: (until) => set({ healCooldownUntil: until }),
  setSkillCooldown: (slot, until) =>
    set((state) => ({ skillCooldowns: { ...state.skillCooldowns, [slot]: until } })),
  setInteriorDoorId: (id) => set({ interiorDoorId: id }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setMapOpen: (open) => set({ mapOpen: open }),
  setReconnect: (reconnect) => set({ reconnect }),
  setGame: (game) => set({ game }),
}));
