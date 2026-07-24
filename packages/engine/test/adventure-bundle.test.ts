import { describe, expect, it } from "vitest";
import {
  ADVENTURE_BUNDLE_FORMAT,
  ADVENTURE_BUNDLE_VERSION,
  type AdventureBundle,
  mintEventIdMapping,
  parseAdventureBundle,
  rewriteBundleIds,
} from "../src/adventure-bundle.js";
import { defaultEventPage, functionalEvent, type MapEvent } from "../src/map-events.js";
import { createAuthoredQuestDefinition, emptyQuestRewards } from "../src/quests.js";
import { emptyLayer, encodeTileLayer } from "../src/tile-layer-codec.js";

const MAP_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const MAP_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const NPC = "11111111-0000-4000-8000-000000000001";
const EXIT_A = "22222222-0000-4000-8000-000000000002";
const ENTRY_B = "33333333-0000-4000-8000-000000000003";
const BOSS = "44444444-0000-4000-8000-000000000004";

function layers(): string[] {
  const layer = encodeTileLayer(emptyLayer(20, 15));
  return [layer, layer, layer];
}

function npcEvent(): MapEvent {
  return {
    id: NPC,
    col: 3,
    row: 3,
    name: "PNJ",
    ordinal: 1,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [
      {
        ...defaultEventPage(),
        commands: [
          {
            t: "choices",
            prompt: "Partir ?",
            options: [
              { label: "Oui", body: [{ t: "teleport", mapId: MAP_B, col: 2, row: 2 }] },
              { label: "Non", body: [{ t: "say", name: null, text: "Bien." }] },
            ],
          },
        ],
      },
    ],
  };
}

function fixture(): AdventureBundle {
  const quest = {
    ...createAuthoredQuestDefinition("0001", "Chasse"),
    giver: { mapId: MAP_A, eventId: NPC },
    turnInTarget: { mapId: MAP_A, eventId: NPC },
    objectives: [
      {
        id: "0001",
        type: "kill" as const,
        label: "",
        target: 3,
        optional: false,
        hidden: false,
        stage: 0,
        species: "spear_goblin" as const,
        mapScope: { kind: "maps" as const, mapIds: [MAP_B] },
        credit: "nearby-party" as const,
      },
      {
        id: "0002",
        type: "defeat-target" as const,
        label: "",
        target: 1,
        optional: false,
        hidden: false,
        stage: 0,
        targetRef: { mapId: MAP_B, eventId: BOSS },
        credit: "killer" as const,
      },
      {
        id: "0003",
        type: "reach" as const,
        label: "",
        target: 1,
        optional: false,
        hidden: false,
        stage: 0,
        destination: { kind: "area" as const, mapId: MAP_B, areaId: "camp" },
      },
    ],
    rewards: {
      ...emptyQuestRewards(),
      customCommands: [{ t: "teleport" as const, mapId: MAP_A, col: 1, row: 1 }],
    },
  };
  const parsed = parseAdventureBundle({
    format: ADVENTURE_BUNDLE_FORMAT,
    version: ADVENTURE_BUNDLE_VERSION,
    adventure: {
      title: "Test",
      maxPlayers: 4,
      registry: { switches: [], variables: [], quests: [quest] },
    },
    maps: [
      {
        id: MAP_A,
        name: "A",
        tilesetId: "tiny-swords",
        cols: 20,
        rows: 15,
        layers: layers(),
        elements: [],
        spawn: { col: 1, row: 1 },
        events: [
          npcEvent(),
          functionalEvent({ id: EXIT_A, col: 5, row: 5, ordinal: 2, kind: "exit" }),
        ],
      },
      {
        id: MAP_B,
        name: "B",
        tilesetId: "tiny-swords",
        cols: 20,
        rows: 15,
        layers: layers(),
        elements: [],
        spawn: { col: 1, row: 1 },
        events: [
          functionalEvent({ id: ENTRY_B, col: 2, row: 2, ordinal: 1, kind: "entry" }),
          functionalEvent({
            id: BOSS,
            col: 9,
            row: 9,
            ordinal: 2,
            kind: "monster",
            species: "minotaur_brute",
            patrolRadius: 96,
          }),
        ],
      },
    ],
    graph: {
      start: { mapId: MAP_A, entryId: ENTRY_B },
      links: [{ mapId: MAP_A, exitId: EXIT_A, dest: { mapId: MAP_B, entryId: ENTRY_B } }],
    },
  });
  if (!parsed) throw new Error("fixture bundle must parse");
  return parsed;
}

describe("adventure bundle", () => {
  it("round-trips through JSON and the total parser", () => {
    const bundle = fixture();
    const again = parseAdventureBundle(JSON.parse(JSON.stringify(bundle)));
    expect(again).not.toBeNull();
    expect(again?.maps.map((m) => m.id)).toEqual([MAP_A, MAP_B]);
    expect(again?.adventure.registry.quests?.length).toBe(1);
  });

  it("rejects a wrong format, a duplicate map id, and a malformed map", () => {
    const bundle = JSON.parse(JSON.stringify(fixture())) as Record<string, unknown>;
    expect(parseAdventureBundle({ ...bundle, format: "other" })).toBeNull();
    const maps = bundle.maps as { id: string }[];
    expect(
      parseAdventureBundle({ ...bundle, maps: [maps[0], { ...maps[1], id: maps[0]?.id }] }),
    ).toBeNull();
    expect(parseAdventureBundle({ ...bundle, maps: [{ ...maps[0], layers: ["bad"] }] })).toBeNull();
  });

  it("rewrites every internal reference through the id mapping", () => {
    const bundle = fixture();
    const eventIds = mintEventIdMapping(
      bundle,
      (() => {
        let n = 0;
        return () => {
          n += 1;
          return `99999999-0000-4000-8000-00000000000${n}`;
        };
      })(),
    );
    const mapIds = new Map([
      [MAP_A, "aaaa0000-0000-4000-8000-000000000001"],
      [MAP_B, "bbbb0000-0000-4000-8000-000000000002"],
    ]);
    const rewritten = rewriteBundleIds(bundle, { mapIds, eventIds });

    // Maps and events carry the new ids; no old id survives anywhere in the document.
    const text = JSON.stringify(rewritten);
    for (const old of [MAP_A, MAP_B, NPC, EXIT_A, ENTRY_B, BOSS]) {
      expect(text).not.toContain(old);
    }

    // The nested teleport inside the choices branch follows the map mapping.
    const npc = rewritten.maps[0]?.events[0];
    const choices = npc?.pages[0]?.commands[0];
    if (choices?.t !== "choices") throw new Error("expected choices");
    const tp = choices.options[0]?.body[0];
    if (tp?.t !== "teleport") throw new Error("expected teleport");
    expect(tp.mapId).toBe("bbbb0000-0000-4000-8000-000000000002");

    // Quest bindings follow both mappings.
    const quest = rewritten.adventure.registry.quests?.[0];
    expect(quest?.giver?.mapId).toBe("aaaa0000-0000-4000-8000-000000000001");
    expect(quest?.giver?.eventId).toBe(eventIds.get(NPC));
    const defeat = quest?.objectives[1];
    if (defeat?.type !== "defeat-target") throw new Error("expected defeat-target");
    expect(defeat.targetRef.eventId).toBe(eventIds.get(BOSS));
    const rewardTp = quest?.rewards.customCommands[0];
    if (rewardTp?.t !== "teleport") throw new Error("expected reward teleport");
    expect(rewardTp.mapId).toBe("aaaa0000-0000-4000-8000-000000000001");

    // The graph follows too.
    expect(rewritten.graph.links[0]?.exitId).toBe(eventIds.get(EXIT_A));
    expect(rewritten.graph.links[0]?.dest).toEqual({
      mapId: "bbbb0000-0000-4000-8000-000000000002",
      entryId: eventIds.get(ENTRY_B),
    });
  });
});
