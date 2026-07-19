import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../../src/client/store.js";

describe("launch navigation state", () => {
  beforeEach(() => {
    useUiStore.setState({ screen: "boot", accountId: null, activeParty: null });
  });

  it("navigates to the parties and party screens", () => {
    useUiStore.getState().setScreen("parties");
    expect(useUiStore.getState().screen).toBe("parties");
    useUiStore.getState().setScreen("party");
    expect(useUiStore.getState().screen).toBe("party");
  });

  it("tracks the account id and the active party", () => {
    useUiStore.getState().setAccountId("acct-1");
    expect(useUiStore.getState().accountId).toBe("acct-1");
    const party = {
      id: "p1",
      name: null,
      adventureId: "a1",
      adventureTitle: "Donjon",
      maxPlayers: 4,
      status: "open" as const,
      hostAccountId: "acct-1",
      colors: ["blue" as const],
      mine: true,
      myColor: "blue" as const,
    };
    useUiStore.getState().setActiveParty(party);
    expect(useUiStore.getState().activeParty?.id).toBe("p1");
    useUiStore.getState().setActiveParty(null);
    expect(useUiStore.getState().activeParty).toBeNull();
  });
});

describe("ui store", () => {
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

  it("resetToCharacterSelect clears the game handle, reconnect banner, and every overlay flag", () => {
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
        attachMinimap: () => {},
        attachWorldMap: () => {},
      },
      reconnect: { kind: "network", attempt: 2, cancelReconnect: () => {} },
      screen: "game",
      mapOpen: true,
      settingsOpen: true,
      interiorDoorId: "warden-hut",
    });

    useUiStore.getState().resetToCharacterSelect();

    const state = useUiStore.getState();
    expect(state.game).toBeNull();
    expect(state.reconnect).toBeNull();
    expect(state.screen).toBe("characters");
    expect(state.mapOpen).toBe(false);
    expect(state.settingsOpen).toBe(false);
    expect(state.interiorDoorId).toBeNull();
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
