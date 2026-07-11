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

  it("setSelf is referentially stable for equal values", () => {
    const self = {
      nick: "Hero",
      level: 2,
      hp: 90,
      maxHp: 112,
      dead: false,
      class: "warrior" as const,
    };
    useUiStore.getState().setSelf(self);
    const first = useUiStore.getState().self;
    useUiStore.getState().setSelf({ ...self });
    expect(useUiStore.getState().self).toBe(first);
  });
});
