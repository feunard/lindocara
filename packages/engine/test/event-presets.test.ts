import { EVENT_PRESETS, presetEvent, presetPageContent } from "@lindocara/engine/event-presets.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import { parseMapEvents } from "@lindocara/engine/map-events.js";
import {
  LINDOCARA_CHEST_CLOSED_ASSET_ID,
  LINDOCARA_CHEST_OPEN_ASSET_ID,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

const MAP_ID = "11111111-1111-4111-8111-111111111111";

describe("presetPageContent", () => {
  it("raw is the blank scripted event (the historical default)", () => {
    expect(presetPageContent("raw", MAP_ID)).toEqual({ trigger: "action", commands: [] });
  });

  it("teleporter carries a player-touch trigger and a same-map teleport command", () => {
    const { trigger, commands } = presetPageContent("teleporter", MAP_ID);
    expect(trigger).toBe("player-touch");
    expect(commands).toEqual([
      { t: "teleport", mapId: MAP_ID, col: 0, row: 0, category: "geographic" },
    ]);
  });

  it("aims a fresh teleporter at the map's own spawn, not at the (0,0) corner", () => {
    // (0, 0) is a corner, and the runtime silently refuses a teleport onto unwalkable ground — on any
    // map with a decorated border that placeholder does nothing and only warns into the server log.
    // A map's spawn is the one cell the editor guarantees stays clear.
    const { commands } = presetPageContent("teleporter", MAP_ID, { col: 7, row: 4 });
    expect(commands).toEqual([
      { t: "teleport", mapId: MAP_ID, col: 7, row: 4, category: "geographic" },
    ]);
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
    expect(event.pages[0]?.commands).toEqual([
      { t: "teleport", mapId: MAP_ID, col: 0, row: 0, category: "geographic" },
    ]);
  });

  it("carries the placement's name so the event list can tell the presets apart", () => {
    // Without this every preset lists as the generic kind fallback ("Custom event"), and an author
    // cannot see which of five identical rows is the teleporter. The name is authored data in the
    // author's own language, so the editor supplies it already localized.
    const named = presetEvent({
      id: crypto.randomUUID(),
      col: 2,
      row: 3,
      ordinal: 1,
      preset: "chest",
      selfMapId: MAP_ID,
      name: "Téléporteur",
    });
    expect(named.name).toBe("Téléporteur");
    expect(named.pages).toMatchObject([
      {
        graphicAssetId: LINDOCARA_CHEST_CLOSED_ASSET_ID,
        commands: [
          { t: "changeGold", amount: 10 },
          { t: "setSelfSwitch", selfSwitch: "A", value: true },
        ],
      },
      {
        graphicAssetId: LINDOCARA_CHEST_OPEN_ASSET_ID,
        condSelfSwitch: "A",
      },
    ]);
    expect(parseMapEvents([named], 20, 15)).not.toBeNull();
    // Omitted stays the historical unnamed event, so `raw` placements are unaffected.
    const anonymous = presetEvent({
      id: crypto.randomUUID(),
      col: 2,
      row: 3,
      ordinal: 1,
      preset: "raw",
      selfMapId: MAP_ID,
    });
    expect(anonymous.name).toBe("");
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
