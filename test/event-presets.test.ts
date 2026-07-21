import { describe, expect, it } from "vitest";
import { EVENT_PRESETS, presetEvent, presetPageContent } from "../src/shared/event-presets.js";
import { isUuid } from "../src/shared/identifiers.js";
import { parseMapEvents } from "../src/shared/map-events.js";

const MAP_ID = "11111111-1111-4111-8111-111111111111";

describe("presetPageContent", () => {
  it("raw is the blank scripted event (the historical default)", () => {
    expect(presetPageContent("raw", MAP_ID)).toEqual({ trigger: "action", commands: [] });
  });

  it("teleporter carries a player-touch trigger and a same-map teleport command", () => {
    const { trigger, commands } = presetPageContent("teleporter", MAP_ID);
    expect(trigger).toBe("player-touch");
    expect(commands).toEqual([{ t: "teleport", mapId: MAP_ID, col: 0, row: 0 }]);
  });

  it("sign carries an interact-triggered say; chest a changeGold", () => {
    expect(presetPageContent("sign", MAP_ID)).toEqual({
      trigger: "action",
      commands: [{ t: "say", text: "", name: null }],
    });
    expect(presetPageContent("chest", MAP_ID).commands).toEqual([{ t: "changeGold", amount: 10 }]);
  });
});

describe("presetEvent", () => {
  it("builds a normal, single-page, uuid-identified event out of the preset", () => {
    const event = presetEvent({
      id: crypto.randomUUID(),
      col: 2,
      row: 3,
      ordinal: 1,
      preset: "teleporter",
      selfMapId: MAP_ID,
    });
    expect(event.kind).toBe("normal");
    expect(isUuid(event.id)).toBe(true);
    expect(event.pages).toHaveLength(1);
    expect(event.pages[0]?.commands).toEqual([{ t: "teleport", mapId: MAP_ID, col: 0, row: 0 }]);
  });

  it("every preset produces an event the wire parser accepts (a real scripted event)", () => {
    for (const preset of EVENT_PRESETS) {
      const event = presetEvent({
        id: crypto.randomUUID(),
        col: 1,
        row: 1,
        ordinal: 1,
        preset,
        selfMapId: MAP_ID,
      });
      // The server re-parses events off the wire; a preset must never mint one it would reject.
      expect(parseMapEvents([event], 20, 15)).not.toBeNull();
    }
  });
});
