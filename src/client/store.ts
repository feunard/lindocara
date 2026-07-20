import { create } from "zustand";
import type { CharacterAppearance, Equipment, PrimaryColor } from "../shared/character.js";
import type { ConsumableId } from "../shared/consumables.js";
import type { LifeState } from "../shared/death.js";
import type { PlayerClass } from "../shared/game.js";
import type { MessageKey } from "../shared/i18n/index.js";
import type { PartyState, QuestStatus, SelfState } from "../shared/protocol.js";
import type { Input } from "../shared/simulation.js";
import type { SkillSlot } from "../shared/skills.js";
import type { AdventureDraft } from "./adventure-draft.js";
import type { PartyListing } from "./api.js";

export interface AdventureEditorSession {
  adventureId: string | null;
  draftId: string;
  draft: AdventureDraft;
  invalidatedLinks: string[];
  savedDraft: string | null;
  /** UX wave #14: set true when the picker creates an adventure with the default title and drops the
   *  author straight into the editor. The editor seeds a local flag from it so the first explicit save
   *  prompts for the real name; every reloaded session (map/graph refreshes) omits it, defaulting to
   *  "already named". */
  titleUntouched?: boolean;
}

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
  channel?: "local" | "party" | "system";
  tone?: EventLine["tone"];
  at: number;
}

/**
 * The dialogue panel's current beat (spec Decision 4), or null when no panel is open. A per-player
 * WoW-style panel: the server pushes `event.say`/`event.choices` to the triggerer and `event.close`
 * ends it. `runId` names the run the intents (`eventAdvance`/`eventChoose`) route back to. The prose
 * (`text`/`name`/`prompt`/`options`) is the AUTHOR's data rendered verbatim — the sanctioned
 * codes-not-sentences exception; every chrome string around it stays i18n-governed.
 */
export type EventDialogue =
  | { kind: "say"; runId: string; text: string; name?: string }
  | { kind: "choices"; runId: string; prompt: string; options: string[] };

export interface PartyInviteNotice {
  inviteId: string;
  fromId: string;
  from: string;
  expiresAt: number;
}

export interface PortraitArt {
  source: string;
  frames: number;
}

/** What the HUD needs from the self snapshot — excludes x/y so it does not churn 60x/s. */
export interface SelfHud {
  id?: string;
  nick: string;
  level: number;
  hp: number;
  maxHp: number;
  life: LifeState;
  /** How far your ghost still has to walk. Null unless you are one. */
  corpseDistance: number | null;
  class: PlayerClass;
  appearance: CharacterAppearance;
  equipment: Equipment;
  /** Server-authoritative persistent Iron Guard posture. */
  guarding?: boolean;
}

export interface GameHandle {
  attack(): void;
  interact(): void;
  usePotion(): void;
  useItem?(item: ConsumableId): void;
  buyItem?(item: ConsumableId): void;
  release(): void;
  castSkill(slot: SkillSlot): void;
  releaseSkill?(slot: SkillSlot): void;
  unlockTalent?(nodeId: string): void;
  resetTalents?(): void;
  /** Virtual controls feed the same intent stream as the keyboard; never an authoritative position. */
  setMovement?(input: Input): void;
  sendChat(text: string, channel?: "local" | "party"): void;
  partyCreate?(): void;
  partyInvite?(playerId: string): void;
  partyAccept?(inviteId: string): void;
  partyRefuse?(inviteId: string): void;
  partyLeave?(): void;
  partyKick?(playerId: string): void;
  partyDissolve?(): void;
  /** The two dialogue intents (spec Decision 4). The panel calls these; the server re-validates. */
  eventAdvance?(runId: string): void;
  eventChoose?(runId: string, index: number): void;
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

export type HeroLoadingPhase = "preparing" | "connecting" | "world" | "ready";

export interface HeroLoadingState {
  name: string;
  class: PlayerClass;
  color: PrimaryColor;
  phase: HeroLoadingPhase;
  progress: number;
}

interface UiState {
  screen: "boot" | "auth" | "characters" | "game" | "adventure-editor" | "parties" | "party";
  accountId: string | null;
  activeParty: PartyListing | null;
  adventureEditorSession: AdventureEditorSession | null;
  self: SelfHud | null;
  selfState: SelfState | null;
  questStatus: QuestStatus;
  prompt: LocalizedText | null;
  status: LocalizedText | null;
  events: EventLine[];
  chat: ChatLine[];
  party: PartyState | null;
  partyInvite: PartyInviteNotice | null;
  chatFocusRequest: number;
  attackCooldownUntil: number;
  healCooldownUntil: number;
  skillCooldowns: Record<SkillSlot, number>;
  interiorDoorId: string | null;
  settingsOpen: boolean;
  mapOpen: boolean;
  talentsOpen: boolean;
  inventoryOpen: boolean;
  merchantOpen: boolean;
  quickItems: readonly [ConsumableId | null, ConsumableId | null, ConsumableId | null];
  /** The current zone's i18n key, carried by the welcome message. Null until the first
   *  welcome arrives; refreshed on every zone transition so the world map titles itself
   *  correctly after walking through a portal. */
  zoneNameKey: MessageKey | null;
  /** The current zone's terrain size, carried by the welcome message. Set once per zone
   *  transition (not per frame, so it does not run afoul of the no-world-position rule below):
   *  it lets the world map apply the true aspect ratio instead of assuming every zone is
   *  Verdant Reach's 16:9. */
  worldSize: { width: number; height: number } | null;
  reconnect: ReconnectState | null;
  heroLoading: HeroLoadingState | null;
  adventureVictory: boolean;
  /** The open dialogue panel, or null. Owned entirely by session.ts's event handlers. */
  eventDialogue: EventDialogue | null;
  game: GameHandle | null;

  setScreen(screen: UiState["screen"]): void;
  setAccountId(accountId: string | null): void;
  setActiveParty(activeParty: PartyListing | null): void;
  setAdventureEditorSession(session: AdventureEditorSession | null): void;
  setSelf(self: SelfHud | null): void;
  setSelfState(state: SelfState): void;
  setQuestStatus(status: QuestStatus): void;
  setPrompt(prompt: LocalizedText | null): void;
  setStatus(status: LocalizedText): void;
  addEvent(text: string, tone: EventLine["tone"]): void;
  removeEvent(id: number): void;
  addChat(from: string, text: string, channel?: "local" | "party"): void;
  setParty(party: PartyState | null): void;
  setPartyInvite(invite: PartyInviteNotice | null): void;
  requestChatFocus(): void;
  setAttackCooldownUntil(until: number): void;
  setHealCooldownUntil(until: number): void;
  setSkillCooldown(slot: SkillSlot, until: number): void;
  setInteriorDoorId(id: string | null): void;
  setSettingsOpen(open: boolean): void;
  setMapOpen(open: boolean): void;
  setTalentsOpen(open: boolean): void;
  setInventoryOpen(open: boolean): void;
  setMerchantOpen(open: boolean): void;
  setQuickItem(index: 0 | 1 | 2, item: ConsumableId | null): void;
  setZoneNameKey(key: MessageKey): void;
  setWorldSize(size: { width: number; height: number } | null): void;
  setReconnect(reconnect: ReconnectState | null): void;
  setHeroLoading(heroLoading: HeroLoadingState | null): void;
  setAdventureVictory(visible: boolean): void;
  setEventDialogue(dialogue: EventDialogue | null): void;
  setGame(game: GameHandle | null): void;
  /** Everything a terminal disconnect must clear before character select is usable again: the
   *  handle, the reconnect banner, and every full-screen overlay flag. Miss one and it survives
   *  into the next character's session, already open over a world that has not welcomed it. */
  resetToCharacterSelect(): void;
  resetToParty(): void;
}

let eventIdCounter = 0;
let chatIdCounter = 0;

function selfHudEqual(a: SelfHud | null, b: SelfHud | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.id === b.id &&
    a.nick === b.nick &&
    a.level === b.level &&
    a.hp === b.hp &&
    a.maxHp === b.maxHp &&
    a.life === b.life &&
    // Rounded to the metre by the writer, so a walking ghost re-renders the HUD ~1x/step.
    a.corpseDistance === b.corpseDistance &&
    a.class === b.class &&
    a.guarding === b.guarding &&
    a.appearance.body === b.appearance.body &&
    a.appearance.primaryColor === b.appearance.primaryColor &&
    a.equipment.mainHand === b.equipment.mainHand &&
    a.equipment.offHand === b.equipment.offHand
  );
}

/**
 * The server rebroadcasts party state on every snapshot tick, and `partyState()` builds a fresh
 * array each time — so the reference always changes even when nothing did. Without this guard,
 * `set({ party })` re-renders Hud and Chat ~10-20x/s for as long as you are in a party, standing
 * still. Same reason `selfHudEqual` exists.
 */
function partyEqual(a: PartyState | null, b: PartyState | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.id !== b.id || a.leaderId !== b.leaderId || a.members.length !== b.members.length) {
    return false;
  }
  return a.members.every((member, index) => {
    const other = b.members[index];
    return (
      other !== undefined &&
      member.id === other.id &&
      member.nick === other.nick &&
      member.hp === other.hp &&
      member.maxHp === other.maxHp &&
      member.life === other.life
    );
  });
}

function localizedTextEqual(a: LocalizedText | null, b: LocalizedText | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.key === b.key && JSON.stringify(a.params) === JSON.stringify(b.params);
}

const EMPTY_SKILL_COOLDOWNS: Record<SkillSlot, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

function clearedGameSession() {
  return {
    self: null,
    selfState: null,
    questStatus: "available" as const,
    prompt: null,
    status: null,
    events: [],
    chat: [],
    party: null,
    partyInvite: null,
    attackCooldownUntil: 0,
    healCooldownUntil: 0,
    skillCooldowns: { ...EMPTY_SKILL_COOLDOWNS },
    interiorDoorId: null,
    settingsOpen: false,
    mapOpen: false,
    talentsOpen: false,
    inventoryOpen: false,
    merchantOpen: false,
    zoneNameKey: null,
    worldSize: null,
    reconnect: null,
    heroLoading: null,
    adventureVictory: false,
    eventDialogue: null,
    game: null,
  };
}

export const useUiStore = create<UiState>((set) => ({
  // "boot" is a brief, invisible holding state while fetchMe() is in flight, so a logged-in
  // user does not see a flash of the title screen before landing on their saved parties.
  screen: "boot",
  accountId: null,
  activeParty: null,
  adventureEditorSession: null,
  self: null,
  selfState: null,
  questStatus: "available",
  prompt: null,
  status: null,
  events: [],
  chat: [],
  party: null,
  partyInvite: null,
  chatFocusRequest: 0,
  attackCooldownUntil: 0,
  healCooldownUntil: 0,
  skillCooldowns: { ...EMPTY_SKILL_COOLDOWNS },
  interiorDoorId: null,
  settingsOpen: false,
  mapOpen: false,
  talentsOpen: false,
  inventoryOpen: false,
  merchantOpen: false,
  quickItems: ["health_potion", "mana_potion", "invisibility_potion"],
  zoneNameKey: null,
  worldSize: null,
  reconnect: null,
  heroLoading: null,
  adventureVictory: false,
  eventDialogue: null,
  game: null,

  setScreen: (screen) => set({ screen }),
  setAccountId: (accountId) => set({ accountId }),
  setActiveParty: (activeParty) => set({ activeParty }),
  setAdventureEditorSession: (adventureEditorSession) => set({ adventureEditorSession }),
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
      const chatLine: ChatLine = {
        id: chatIdCounter++,
        from: "",
        text,
        channel: "system",
        tone,
        at: Date.now(),
      };
      return {
        events: [...state.events, line].slice(-6),
        chat: [...state.chat, chatLine].slice(-50),
      };
    }),
  removeEvent: (id) =>
    set((state) => ({
      events: state.events.filter((e) => e.id !== id),
    })),
  addChat: (from, text, channel = "local") =>
    set((state) => {
      const line: ChatLine = {
        id: chatIdCounter++,
        from,
        text,
        channel,
        at: Date.now(),
      };
      return {
        chat: [...state.chat, line].slice(-50),
      };
    }),
  setParty: (party) =>
    set((state) => {
      if (partyEqual(state.party, party)) return {};
      return { party };
    }),
  setPartyInvite: (partyInvite) => set({ partyInvite }),
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
  setTalentsOpen: (open) => set({ talentsOpen: open }),
  setInventoryOpen: (open) => set({ inventoryOpen: open }),
  setMerchantOpen: (open) => set({ merchantOpen: open }),
  setQuickItem: (index, item) =>
    set((state) => {
      const quickItems = [...state.quickItems] as [
        ConsumableId | null,
        ConsumableId | null,
        ConsumableId | null,
      ];
      quickItems[index] = item;
      return { quickItems };
    }),
  setZoneNameKey: (zoneNameKey) => set({ zoneNameKey }),
  setWorldSize: (worldSize) => set({ worldSize }),
  setReconnect: (reconnect) => set({ reconnect }),
  setHeroLoading: (heroLoading) => set({ heroLoading }),
  setAdventureVictory: (adventureVictory) => set({ adventureVictory }),
  setEventDialogue: (eventDialogue) => set({ eventDialogue }),
  setGame: (game) => set({ game }),
  resetToCharacterSelect: () =>
    set({
      ...clearedGameSession(),
      screen: "characters",
      activeParty: null,
    }),
  resetToParty: () =>
    set({
      ...clearedGameSession(),
      screen: "party",
    }),
}));
