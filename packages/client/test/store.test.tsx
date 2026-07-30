import type { GameNavigation } from "@lindocara/client/state/navigation.js";
import { getGameNavigation, setGameNavigation } from "@lindocara/client/state/navigation.js";
import { useUiStore } from "@lindocara/client/store.js";
import { afterEach, describe, expect, it, vi } from "vitest";

/** A plain, non-Alepha fake — `setGameNavigation` never requires a real Alepha instance (see the
 *  module's docblock), which is what lets a store-level test install one by direct reassignment. */
function fakeNavigation(overrides: Partial<GameNavigation> = {}): GameNavigation {
  return {
    toGame: vi.fn(),
    toMenu: vi.fn(),
    toAuth: vi.fn(),
    setActiveParty: vi.fn(),
    getActiveParty: () => null,
    setAdventureTestSession: vi.fn(),
    getAdventureTestSession: () => null,
    getQuickItems: () => [null, null, null],
    logout: vi.fn(),
    setAdventureEditorSession: vi.fn(),
    push: vi.fn(),
    ...overrides,
  };
}

describe("ui store", () => {
  afterEach(() => setGameNavigation(null));

  it("no longer carries a screen field or a resetToTitle/resetToSaves API — the router owns navigation", () => {
    const state = useUiStore.getState();
    expect("screen" in state).toBe(false);
    expect("resetToTitle" in state).toBe(false);
    expect("resetToSaves" in state).toBe(false);
    expect("activeParty" in state).toBe(false);
    expect("quickItems" in state).toBe(false);
    expect("questTracking" in state).toBe(false);
    expect("adventureTestSession" in state).toBe(false);
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

  describe("setScreen (deprecated shim)", () => {
    it("is a no-op before a navigation seam installs", () => {
      expect(() => useUiStore.getState().setScreen("menu")).not.toThrow();
    });

    it("routes every legacy screen name to the matching $page push, through the installed seam", () => {
      const nav = fakeNavigation();
      setGameNavigation(nav);
      useUiStore.getState().setScreen("title");
      useUiStore.getState().setScreen("menu");
      useUiStore.getState().setScreen("auth");
      useUiStore.getState().setScreen("new");
      useUiStore.getState().setScreen("continue");
      useUiStore.getState().setScreen("join");
      useUiStore.getState().setScreen("credits");
      useUiStore.getState().setScreen("game");
      useUiStore.getState().setScreen("adventure-editor");
      expect(nav.push).toHaveBeenCalledWith("title");
      expect(nav.push).toHaveBeenCalledWith("menu");
      expect(nav.push).toHaveBeenCalledWith("auth");
      expect(nav.push).toHaveBeenCalledWith("playNew");
      expect(nav.push).toHaveBeenCalledWith("playContinue");
      expect(nav.push).toHaveBeenCalledWith("playJoin");
      expect(nav.push).toHaveBeenCalledWith("credits");
      expect(nav.push).toHaveBeenCalledWith("game");
      expect(nav.push).toHaveBeenCalledWith("editor");
    });

    it("pushes nothing for the blank initial 'boot' state", () => {
      const nav = fakeNavigation();
      setGameNavigation(nav);
      useUiStore.getState().setScreen("boot");
      expect(nav.push).not.toHaveBeenCalled();
    });
  });

  describe("setAdventureEditorSession (deprecated editor shim)", () => {
    it("dual-writes the seam (the atom) and the store's own field, so the editor stays reactive", () => {
      const nav = fakeNavigation();
      setGameNavigation(nav);
      const session = {
        adventureId: "adv-1",
        draftId: "draft-1",
        draft: {} as never,
        invalidatedLinks: [],
        savedDraft: null,
      };
      useUiStore.getState().setAdventureEditorSession(session);
      expect(nav.setAdventureEditorSession).toHaveBeenCalledWith(session);
      expect(useUiStore.getState().adventureEditorSession).toBe(session);
    });

    it("still updates the local field when no seam is installed (editor tests render bare)", () => {
      const session = {
        adventureId: "adv-1",
        draftId: "draft-1",
        draft: {} as never,
        invalidatedLinks: [],
        savedDraft: null,
      };
      expect(() => useUiStore.getState().setAdventureEditorSession(session)).not.toThrow();
      expect(useUiStore.getState().adventureEditorSession).toBe(session);
    });
  });

  describe("setAdventureTestSession (deprecated editor shim)", () => {
    it("writes only through the seam — the store keeps no readable field for it", () => {
      const nav = fakeNavigation();
      setGameNavigation(nav);
      const session = { id: "test-1" } as never;
      useUiStore.getState().setAdventureTestSession(session);
      expect(nav.setAdventureTestSession).toHaveBeenCalledWith(session);
      expect("adventureTestSession" in useUiStore.getState()).toBe(false);
    });

    it("is a no-op before a navigation seam installs", () => {
      expect(() => useUiStore.getState().setAdventureTestSession(null)).not.toThrow();
    });
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
    // The store itself never navigates anymore — no call reached the seam.
    expect(nav.toMenu).not.toHaveBeenCalled();
    expect(nav.toGame).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
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
