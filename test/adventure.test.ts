import { describe, expect, it } from "vitest";
import {
  type AdventureInput,
  type AdventureLink,
  EMPTY_GRAPH,
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
    graph: {
      start: { mapId: "map-a", entryId: "start" },
      links: [
        { mapId: "map-a", exitId: "east", dest: { mapId: "map-b", entryId: "west-door" } },
        { mapId: "map-b", exitId: "boss-gate", dest: "end" },
      ],
    },
  };
}

function markersFor(count: number): Map<string, MapMarkerIds> {
  return new Map(
    Array.from({ length: count }, (_, index) => [
      `map-${index}`,
      { entryIds: ["start"], exitIds: [] } as MapMarkerIds,
    ]),
  );
}

function repeatedLinks(count: number): AdventureLink[] {
  return Array.from({ length: count }, () => ({ mapId: "map-a", exitId: "east", dest: "end" }));
}

describe("parseAdventureInput", () => {
  it("round-trips a well-formed body (no mapIds — membership is implicit now)", () => {
    expect(parseAdventureInput(goodInput())).toEqual(goodInput());
  });

  it("rejects malformed bodies instead of throwing", () => {
    const good = goodInput();
    const bad: unknown[] = [
      null,
      { ...good, title: 7 },
      { ...good, maxPlayers: "four" },
      { ...good, graph: undefined },
      {
        ...good,
        graph: { ...good.graph, links: [{ mapId: "map-a", exitId: "east", dest: "nowhere" }] },
      },
    ];
    for (const value of bad) expect(parseAdventureInput(value)).toBeNull();
  });
});

describe("parseAdventureGraph", () => {
  it("returns the parsed graph for a well-formed value", () => {
    const { graph } = goodInput();
    expect(parseAdventureGraph(graph)).toEqual(graph);
  });

  it("accepts a draft graph with a null start", () => {
    expect(parseAdventureGraph({ start: null, links: [] })).toEqual(EMPTY_GRAPH);
    // An absent start is the same draft state.
    expect(parseAdventureGraph({ links: [] })).toEqual(EMPTY_GRAPH);
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

  it("accepts a draft (null start, no links) with no member maps", () => {
    expect(() =>
      validateAdventure({ title: "Draft", maxPlayers: 4, graph: EMPTY_GRAPH }, new Map()),
    ).not.toThrow();
  });

  it("rejects a draft that carries links", () => {
    expect(() =>
      validateAdventure(
        { title: "Draft", maxPlayers: 4, graph: { start: null, links: repeatedLinks(1) } },
        new Map(),
      ),
    ).toThrow(/^graph:/);
  });

  it("enforces title and player count", () => {
    expect(() => validateAdventure({ ...goodInput(), title: " " }, MARKERS)).toThrow(/^title:/);
    expect(() => validateAdventure({ ...goodInput(), maxPlayers: 5 }, MARKERS)).toThrow(
      /^players:/,
    );
  });

  it("rejects a graph that references a map the adventure does not own (foreign map id)", () => {
    // "map-c" is nowhere in MARKERS: the adventure owns only map-a and map-b.
    const foreignStart = goodInput();
    foreignStart.graph = { ...foreignStart.graph, start: { mapId: "map-c", entryId: "start" } };
    expect(() => validateAdventure(foreignStart, MARKERS)).toThrow(/^graph:/);

    const foreignLink = goodInput();
    foreignLink.graph = {
      ...foreignLink.graph,
      links: [{ mapId: "map-c", exitId: "east", dest: "end" }, ...foreignLink.graph.links],
    };
    expect(() => validateAdventure(foreignLink, MARKERS)).toThrow(/^graph:/);
  });

  it("rejects a non-draft graph with no member maps, or more than MAX_ADVENTURE_MAPS", () => {
    expect(() => validateAdventure(goodInput(), new Map())).toThrow(/^maps:/);
    const startAnchor = { mapId: "map-0", entryId: "start" };
    expect(() =>
      validateAdventure(
        { title: "Too many", maxPlayers: 4, graph: { start: startAnchor, links: [] } },
        markersFor(MAX_ADVENTURE_MAPS + 1),
      ),
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

  it("allows an owned map that is not yet wired into the graph (work in progress)", () => {
    // map-c is owned but unlinked — under implicit membership that is a draft-in-progress, not an
    // error, as long as an ending is still reachable from the start (map-a here).
    const markers = new Map<string, MapMarkerIds>([
      ["map-a", { entryIds: ["start"], exitIds: ["finish"] }],
      ["map-c", { entryIds: ["island"], exitIds: [] }],
    ]);
    const input: AdventureInput = {
      title: "In progress",
      maxPlayers: 4,
      graph: {
        start: { mapId: "map-a", entryId: "start" },
        links: [{ mapId: "map-a", exitId: "finish", dest: "end" }],
      },
    };
    expect(() => validateAdventure(input, markers)).not.toThrow();
  });
});
