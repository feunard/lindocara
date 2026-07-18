import { describe, expect, it } from "vitest";
import {
  type AdventureInput,
  type AdventureLink,
  MAX_ADVENTURE_LINKS,
  MAX_ADVENTURE_MAPS,
  type MapMarkerIds,
  parseAdventureGraph,
  parseAdventureInput,
  validateAdventure,
} from "../src/shared/adventure.js";

const MARKERS = new Map<string, MapMarkerIds>([
  ["map-a", { entryIds: ["start"], exitIds: ["east"] }],
  ["map-b", { entryIds: ["west-door"], exitIds: ["boss-gate"] }],
]);

function goodInput(): AdventureInput {
  return {
    title: "Donjon",
    maxPlayers: 4,
    mapIds: ["map-a", "map-b"],
    graph: {
      start: { mapId: "map-a", entryId: "start" },
      links: [
        { mapId: "map-a", exitId: "east", dest: { mapId: "map-b", entryId: "west-door" } },
        { mapId: "map-b", exitId: "boss-gate", dest: "end" },
      ],
    },
  };
}

function distinctMapIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `map-${index}`);
}

function repeatedLinks(count: number): AdventureLink[] {
  return Array.from({ length: count }, () => ({ mapId: "map-a", exitId: "east", dest: "end" }));
}

describe("parseAdventureInput", () => {
  it("round-trips a well-formed body", () => {
    expect(parseAdventureInput(goodInput())).toEqual(goodInput());
  });

  it("rejects malformed bodies instead of throwing", () => {
    const good = goodInput();
    const bad: unknown[] = [
      null,
      { ...good, title: 7 },
      { ...good, maxPlayers: "four" },
      { ...good, mapIds: "map-a" },
      { ...good, graph: { start: null, links: [] } },
      {
        ...good,
        graph: { ...good.graph, links: [{ mapId: "map-a", exitId: "east", dest: "nowhere" }] },
      },
    ];
    for (const value of bad) expect(parseAdventureInput(value)).toBeNull();
  });

  it("accepts exactly MAX_ADVENTURE_MAPS mapIds and rejects one more", () => {
    const atLimit = { ...goodInput(), mapIds: distinctMapIds(MAX_ADVENTURE_MAPS) };
    expect(parseAdventureInput(atLimit)).not.toBeNull();

    const overLimit = { ...goodInput(), mapIds: distinctMapIds(MAX_ADVENTURE_MAPS + 1) };
    expect(parseAdventureInput(overLimit)).toBeNull();
  });
});

describe("parseAdventureGraph", () => {
  it("returns the parsed graph for a well-formed value", () => {
    const { graph } = goodInput();
    expect(parseAdventureGraph(graph)).toEqual(graph);
  });

  it("accepts exactly MAX_ADVENTURE_LINKS links and rejects one more, without deduping repeats", () => {
    const start = goodInput().graph.start;

    const atLimit = parseAdventureGraph({ start, links: repeatedLinks(MAX_ADVENTURE_LINKS) });
    expect(atLimit).not.toBeNull();
    expect(atLimit?.links).toHaveLength(MAX_ADVENTURE_LINKS);

    const overLimit = parseAdventureGraph({
      start,
      links: repeatedLinks(MAX_ADVENTURE_LINKS + 1),
    });
    expect(overLimit).toBeNull();
  });

  it("rejects corrupt shapes", () => {
    const { start } = goodInput().graph;
    expect(parseAdventureGraph(null)).toBeNull();
    expect(parseAdventureGraph({ start, links: "x" })).toBeNull();
    expect(
      parseAdventureGraph({ start, links: [{ mapId: "map-a", exitId: "east", dest: 7 }] }),
    ).toBeNull();
  });
});

describe("validateAdventure", () => {
  it("accepts a complete graph", () => {
    expect(() => validateAdventure(goodInput(), MARKERS)).not.toThrow();
  });

  it("enforces title, player count and map membership", () => {
    expect(() => validateAdventure({ ...goodInput(), title: " " }, MARKERS)).toThrow(/^title:/);
    expect(() => validateAdventure({ ...goodInput(), maxPlayers: 5 }, MARKERS)).toThrow(
      /^players:/,
    );
    expect(() =>
      validateAdventure({ ...goodInput(), mapIds: ["map-a", "ghost"] }, MARKERS),
    ).toThrow(/^maps:/);
    expect(() => validateAdventure({ ...goodInput(), mapIds: [] }, MARKERS)).toThrow(/^maps:/);
    expect(() =>
      validateAdventure({ ...goodInput(), mapIds: ["map-a", "map-a"] }, MARKERS),
    ).toThrow(/^maps:/);
  });

  it("requires the start to name a member map and a real entry", () => {
    const input = goodInput();
    input.graph = { ...input.graph, start: { mapId: "map-b", entryId: "start" } };
    expect(() => validateAdventure(input, MARKERS)).toThrow(/^graph:/);
  });

  it("requires every exit bound exactly once, to a real entry", () => {
    const unbound = goodInput();
    unbound.graph = { ...unbound.graph, links: [unbound.graph.links[0] as never] };
    expect(() => validateAdventure(unbound, MARKERS)).toThrow(/^graph:/);

    const duplicate = goodInput();
    duplicate.graph = {
      ...duplicate.graph,
      links: [...duplicate.graph.links, duplicate.graph.links[0] as never],
    };
    expect(() => validateAdventure(duplicate, MARKERS)).toThrow(/^graph:/);

    const badEntry = goodInput();
    badEntry.graph = {
      ...badEntry.graph,
      links: [
        { mapId: "map-a", exitId: "east", dest: { mapId: "map-b", entryId: "no-such-door" } },
        { mapId: "map-b", exitId: "boss-gate", dest: "end" },
      ],
    };
    expect(() => validateAdventure(badEntry, MARKERS)).toThrow(/^graph:/);
  });

  it("requires at least one end", () => {
    const endless = goodInput();
    endless.graph = {
      ...endless.graph,
      links: [
        { mapId: "map-a", exitId: "east", dest: { mapId: "map-b", entryId: "west-door" } },
        { mapId: "map-b", exitId: "boss-gate", dest: { mapId: "map-a", entryId: "start" } },
      ],
    };
    expect(() => validateAdventure(endless, MARKERS)).toThrow(/^graph:/);
  });

  it("refuses an ending that cannot be reached from the start", () => {
    const markers = new Map<string, MapMarkerIds>([
      ["map-a", { entryIds: ["start"], exitIds: ["east"] }],
      ["map-b", { entryIds: ["west-door"], exitIds: ["return"] }],
      ["map-c", { entryIds: ["island"], exitIds: ["finish"] }],
    ]);
    const input: AdventureInput = {
      title: "Endless loop",
      maxPlayers: 4,
      mapIds: ["map-a", "map-b", "map-c"],
      graph: {
        start: { mapId: "map-a", entryId: "start" },
        links: [
          { mapId: "map-a", exitId: "east", dest: { mapId: "map-b", entryId: "west-door" } },
          { mapId: "map-b", exitId: "return", dest: { mapId: "map-a", entryId: "start" } },
          { mapId: "map-c", exitId: "finish", dest: "end" },
        ],
      },
    };
    expect(() => validateAdventure(input, markers)).toThrow(/ending is reachable/);
  });

  it("reports a member-map island even when another reachable map ends the adventure", () => {
    const markers = new Map<string, MapMarkerIds>([
      ["map-a", { entryIds: ["start"], exitIds: ["finish"] }],
      ["map-c", { entryIds: ["island"], exitIds: ["island-end"] }],
    ]);
    const input: AdventureInput = {
      title: "Island",
      maxPlayers: 4,
      mapIds: ["map-a", "map-c"],
      graph: {
        start: { mapId: "map-a", entryId: "start" },
        links: [
          { mapId: "map-a", exitId: "finish", dest: "end" },
          { mapId: "map-c", exitId: "island-end", dest: "end" },
        ],
      },
    };
    expect(() => validateAdventure(input, markers)).toThrow(/map map-c is unreachable/);
  });
});
