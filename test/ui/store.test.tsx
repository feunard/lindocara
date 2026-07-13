import { describe, expect, it } from "vitest";
import { useUiStore } from "../../src/client/store.js";

describe("ui store", () => {
  it("caps the event log at 6 and the chat at 8", () => {
    const store = useUiStore.getState();
    for (let i = 0; i < 9; i++) store.addEvent(`event ${i}`, "info");
    for (let i = 0; i < 10; i++) store.addChat("nick", `line ${i}`);
    const state = useUiStore.getState();
    expect(state.events).toHaveLength(6);
    expect(state.events[0]?.text).toBe("event 3");
    expect(state.chat).toHaveLength(8);
    expect(state.chat[7]?.text).toBe("line 9");
  });

  it("resetToCharacterSelect clears the game handle, reconnect banner, and every overlay flag", () => {
    useUiStore.setState({
      game: {
        attack: () => {},
        interact: () => {},
        usePotion: () => {},
        heal: () => {},
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
      equipment: { mainHand: "weathered_sword" as const, offHand: "oak_shield" as const },
    };
    useUiStore.getState().setSelf(self);
    const first = useUiStore.getState().self;
    useUiStore.getState().setSelf({ ...self });
    expect(useUiStore.getState().self).toBe(first);
  });
});
