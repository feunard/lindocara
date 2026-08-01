import type { GameNavigation } from "@lindocara/client/state/navigation.js";
import { getGameNavigation, setGameNavigation } from "@lindocara/client/state/navigation.js";
import { useUiStore } from "@lindocara/client/store.js";
import { defaultMapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import { afterEach, describe, expect, it, vi } from "vitest";

/** A plain, non-Alepha fake — `setGameNavigation` never requires a real Alepha instance (see the
 *  module's docblock), which is what lets a store-level test install one by direct reassignment. */
function fakeNavigation(overrides: Partial<GameNavigation> = {}): GameNavigation {
  return {
    toGame: vi.fn(),
    toMenu: vi.fn(),
    toAuth: vi.fn(),
    toEditor: vi.fn(),
    setActiveParty: vi.fn(),
    getActiveParty: () => null,
    setAdventureTestSession: vi.fn(),
    getAdventureTestSession: () => null,
    getQuickItems: () => [null, null, null],
    logout: vi.fn(),
    ...overrides,
  };
}

describe("ui store", () => {
  afterEach(() => setGameNavigation(null));

  it("no longer carries a screen field, screen-machine API or editor-session field — the router owns navigation and the atoms own editor state", () => {
    const state = useUiStore.getState();
    expect("screen" in state).toBe(false);
    expect("setScreen" in state).toBe(false);
    expect("resetToTitle" in state).toBe(false);
    expect("resetToSaves" in state).toBe(false);
    expect("activeParty" in state).toBe(false);
    expect("quickItems" in state).toBe(false);
    expect("questTracking" in state).toBe(false);
    expect("adventureTestSession" in state).toBe(false);
    expect("setAdventureTestSession" in state).toBe(false);
    expect("adventureEditorSession" in state).toBe(false);
    expect("setAdventureEditorSession" in state).toBe(false);
    expect("setActiveParty" in state).toBe(false);
  });

  it("does not retain a combat target or a target mutation API", () => {
    const state = useUiStore.getState();
    expect("combatTarget" in state).toBe(false);
    expect("setCombatTarget" in state).toBe(false);
  });

  it("caps the event log at 6 and the chat at 50", () => {
    const store = useUiStore.getState();
    for (let i = 0; i < 9; i++) store.addEvent(`event ${i}`, "info");
    for (let i = 0; i < 10; i++) store.addChat("nick", `line ${i}`);
    const state = useUiStore.getState();
    expect(state.events).toHaveLength(6);
    expect(state.events[0]?.text).toBe("event 3");
    expect(state.chat).toHaveLength(19);
    expect(state.chat.at(-1)?.text).toBe("line 9");
    expect(state.chat.at(-1)?.channel).toBe("local");
    expect(state.chat.find((line) => line.channel === "system")?.text).toBe("event 0");
  });

  it("clearedGameSession clears the game handle, reconnect banner, and every overlay flag, but does not navigate", () => {
    const nav = fakeNavigation();
    setGameNavigation(nav);
    useUiStore.setState({
      game: {
        attack: () => {},
        interact: () => {},
        usePotion: () => {},
        release: () => {},
        castSkill: () => {},
        sendChat: () => {},
        switchCharacter: () => {},
        logout: () => {},
        returnToTitle: () => {},
        attachMinimap: () => {},
        attachWorldMap: () => {},
      },
      reconnect: { kind: "network", attempt: 2, cancelReconnect: () => {} },
      heroLoading: {
        name: "Mira",
        class: "priest",
        color: "azure",
        phase: "connecting",
        progress: 48,
      },
      mapOpen: true,
      talentsOpen: true,
      inventoryOpen: true,
      merchantOpen: true,
      settingsOpen: true,
      interiorDoorId: "warden-hut",
      self: {
        nick: "Mira",
        level: 3,
        hp: 12,
        maxHp: 100,
        life: "ghost",
        corpseDistance: 42,
        class: "priest",
        appearance: { body: "wayfarer", primaryColor: "azure" },
        equipment: { mainHand: "heartwood_staff", offHand: null },
      },
      selfState: {
        xp: 20,
        xpToNext: 100,
        inventory: { potions: 2, gold: 3, crystals: 4 },
        quest: { status: "active", progress: 1, target: 3 },
        life: "ghost",
        corpse: { x: 10, y: 20 },
      },
      questStatus: "active",
      prompt: { key: "prompt.hunt" },
      status: { key: "status.connecting", params: { name: "Mira" } },
      events: [{ id: 1, text: "old", tone: "info" }],
      chat: [{ id: 1, from: "old", text: "old", at: 1 }],
      party: { id: "party", leaderId: "hero", members: [] },
      partyInvite: { inviteId: "invite", fromId: "hero", from: "Mira", expiresAt: 1 },
      attackCooldownUntil: 10,
      healCooldownUntil: 20,
      skillCooldowns: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 },
      zoneNameKey: "zone.verdant_reach.name",
      worldSize: { width: 100, height: 200 },
      mapHeroSettings: defaultMapHeroSettings(),
    });

    useUiStore.getState().clearedGameSession();

    const state = useUiStore.getState();
    expect(state.game).toBeNull();
    expect(state.reconnect).toBeNull();
    expect(state.heroLoading).toBeNull();
    expect(state.mapOpen).toBe(false);
    expect(state.talentsOpen).toBe(false);
    expect(state.inventoryOpen).toBe(false);
    expect(state.merchantOpen).toBe(false);
    expect(state.settingsOpen).toBe(false);
    expect(state.interiorDoorId).toBeNull();
    expect(state.self).toBeNull();
    expect(state.selfState).toBeNull();
    expect(state.questStatus).toBe("available");
    expect(state.prompt).toBeNull();
    expect(state.status).toBeNull();
    expect(state.events).toEqual([]);
    expect(state.chat).toEqual([]);
    expect(state.party).toBeNull();
    expect(state.partyInvite).toBeNull();
    expect(state.attackCooldownUntil).toBe(0);
    expect(state.healCooldownUntil).toBe(0);
    expect(state.skillCooldowns).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(state.zoneNameKey).toBeNull();
    expect(state.worldSize).toBeNull();
    expect(state.mapHeroSettings).toBeNull();
    // The store itself never navigates anymore — no call reached the seam.
    expect(nav.toMenu).not.toHaveBeenCalled();
    expect(nav.toGame).not.toHaveBeenCalled();
    expect(nav.toEditor).not.toHaveBeenCalled();
  });

  it("setSelf is referentially stable for equal values", () => {
    const self = {
      nick: "Hero",
      level: 2,
      hp: 90,
      maxHp: 112,
      life: "alive" as const,
      corpseDistance: null,
      class: "warrior" as const,
      appearance: { body: "wayfarer" as const, primaryColor: "azure" as const },
      equipment: { mainHand: "weathered_sword" as const, offHand: "oak_shield" as const },
    };
    useUiStore.getState().setSelf(self);
    const first = useUiStore.getState().self;
    useUiStore.getState().setSelf({ ...self });
    expect(useUiStore.getState().self).toBe(first);
    useUiStore.getState().setSelf({ ...self, guarding: true });
    expect(useUiStore.getState().self).not.toBe(first);
    expect(useUiStore.getState().self?.guarding).toBe(true);
  });

  it("ignores an unchanged party, so a 10Hz rebroadcast does not re-render the HUD", () => {
    const party = {
      id: "p1",
      leaderId: "a",
      members: [{ id: "a", nick: "Aelwyn", hp: 80, maxHp: 100, life: "alive" as const }],
    };
    useUiStore.getState().setParty(party);
    const first = useUiStore.getState().party;

    // The server rebuilds this array every snapshot tick, so the reference always differs.
    useUiStore.getState().setParty(structuredClone(party));
    expect(useUiStore.getState().party).toBe(first);

    // A real change must still land.
    useUiStore.getState().setParty({ ...structuredClone(party), leaderId: "b" });
    expect(useUiStore.getState().party).not.toBe(first);
    expect(useUiStore.getState().party?.leaderId).toBe("b");

    // ...including a member's HP dropping, which is the whole point of the panel.
    const wounded = structuredClone(party);
    const member = wounded.members[0];
    if (member) member.hp = 12;
    useUiStore.getState().setParty(wounded);
    expect(useUiStore.getState().party?.members[0]?.hp).toBe(12);
  });
});

describe("getGameNavigation / setGameNavigation", () => {
  afterEach(() => setGameNavigation(null));

  it("is null until installed, then returns exactly the installed object", () => {
    expect(getGameNavigation()).toBeNull();
    const nav = fakeNavigation();
    setGameNavigation(nav);
    expect(getGameNavigation()).toBe(nav);
    setGameNavigation(null);
    expect(getGameNavigation()).toBeNull();
  });
});
