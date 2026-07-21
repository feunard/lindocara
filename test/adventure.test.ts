import { describe, expect, it } from "vitest";
import {
  type AdventureGraph,
  type AdventureLink,
  EMPTY_GRAPH,
  MAX_ADVENTURE_LINKS,
  type MapMarkerIds,
  parseAdventureGraph,
  parseAdventureInput,
  validateAdventure,
} from "../src/shared/adventure.js";

// `validateAdventure` still takes a REQUIRED graph (it is the compat/seed validator). `AdventureInput`
// made the graph optional (the editor no longer authors one), so these graph-shape fixtures use a
// local graph-required type rather than `AdventureInput`.
type ValidateInput = { title: string; maxPlayers: number; graph: AdventureGraph };

// UX wave #12: `parseAdventureGraph` binds entry/exit EVENT uuids, so the round-trip fixtures use
// real uuids. (`validateAdventure` itself never checks id shape — only membership — but its member
// set must still agree with the graph, so `MARKERS` reuses these same uuids.)
const START = "aaaaaaaa-0000-4000-8000-000000000001";
const EAST = "aaaaaaaa-0000-4000-8000-000000000002";
const WEST_DOOR = "bbbbbbbb-0000-4000-8000-000000000001";
const BOSS_GATE = "bbbbbbbb-0000-4000-8000-000000000002";

const MARKERS = new Map<string, MapMarkerIds>([
  ["map-a", { entryIds: [START], exitIds: [EAST] }],
  ["map-b", { entryIds: [WEST_DOOR], exitIds: [BOSS_GATE] }],
]);

function goodInput(): ValidateInput {
  return {
    title: "Donjon",
    maxPlayers: 4,
    graph: {
      start: { mapId: "map-a", entryId: START },
      links: [
        { mapId: "map-a", exitId: EAST, dest: { mapId: "map-b", entryId: WEST_DOOR } },
        { mapId: "map-b", exitId: BOSS_GATE, dest: "end" },
      ],
    },
  };
}

function repeatedLinks(count: number): AdventureLink[] {
  return Array.from({ length: count }, () => ({ mapId: "map-a", exitId: EAST, dest: "end" }));
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
      // A present-but-malformed graph is still rejected (a legacy/test writer must not persist an
      // unparseable graph).
      {
        ...good,
        graph: { ...good.graph, links: [{ mapId: "map-a", exitId: "east", dest: "nowhere" }] },
      },
    ];
    for (const value of bad) expect(parseAdventureInput(value)).toBeNull();
  });

  it("treats an omitted graph as valid — the editor never authors one now", () => {
    // The stored graph is preserved by the server when a PUT omits it, so a graph-free body must
    // parse. Round-trips to just the shell (no `graph` key).
    const shell = { title: "Donjon", maxPlayers: 4 };
    expect(parseAdventureInput(shell)).toEqual(shell);
    expect(parseAdventureInput({ ...shell, graph: undefined })).toEqual(shell);
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

  it("accepts a draft (null start) that carries referentially-sound links", () => {
    // Completeness is not enforced: a null start with a real, end-bound link is a valid save.
    expect(() =>
      validateAdventure(
        {
          title: "Draft",
          maxPlayers: 4,
          graph: { start: null, links: [{ mapId: "map-a", exitId: EAST, dest: "end" }] },
        },
        MARKERS,
      ),
    ).not.toThrow();
  });

  it("still rejects a link from a non-member map, even in a draft", () => {
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

  it("rejects a start that names a non-member map (referential integrity)", () => {
    // A start pointing at a map the adventure does not own is a dangling reference, not a draft.
    expect(() => validateAdventure(goodInput(), new Map())).toThrow(/^graph:/);
  });

  it("requires the start, IF set, to name a member map and a real entry", () => {
    const input = goodInput();
    input.graph = { ...input.graph, start: { mapId: "map-b", entryId: "start" } };
    expect(() => validateAdventure(input, MARKERS)).toThrow(/^graph:/);
  });

  it("allows an unbound exit (partial wiring is a valid save)", () => {
    // map-b's exit is left unbound: no ending is reachable, but that no longer blocks the save.
    const unbound = goodInput();
    unbound.graph = { ...unbound.graph, links: [unbound.graph.links[0] as never] };
    expect(() => validateAdventure(unbound, MARKERS)).not.toThrow();
  });

  it("still rejects a double-bound exit or a link to a missing entry", () => {
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
        { mapId: "map-a", exitId: EAST, dest: { mapId: "map-b", entryId: "no-such-door" } },
        { mapId: "map-b", exitId: BOSS_GATE, dest: "end" },
      ],
    };
    expect(() => validateAdventure(badEntry, MARKERS)).toThrow(/^graph:/);
  });

  it("accepts a graph with no ending (completeness is not enforced)", () => {
    const endless = goodInput();
    endless.graph = {
      ...endless.graph,
      links: [
        { mapId: "map-a", exitId: EAST, dest: { mapId: "map-b", entryId: WEST_DOOR } },
        { mapId: "map-b", exitId: BOSS_GATE, dest: { mapId: "map-a", entryId: START } },
      ],
    };
    expect(() => validateAdventure(endless, MARKERS)).not.toThrow();
  });

  it("accepts an ending that cannot be reached from the start", () => {
    const markers = new Map<string, MapMarkerIds>([
      ["map-a", { entryIds: ["start"], exitIds: ["east"] }],
      ["map-b", { entryIds: ["west-door"], exitIds: ["return"] }],
      ["map-c", { entryIds: ["island"], exitIds: ["finish"] }],
    ]);
    const input: ValidateInput = {
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
    expect(() => validateAdventure(input, markers)).not.toThrow();
  });

  it("allows an owned map that is not yet wired into the graph (work in progress)", () => {
    // map-c is owned but unlinked — under implicit membership that is a draft-in-progress, not an
    // error, and completeness is not checked either way.
    const markers = new Map<string, MapMarkerIds>([
      ["map-a", { entryIds: ["start"], exitIds: ["finish"] }],
      ["map-c", { entryIds: ["island"], exitIds: [] }],
    ]);
    const input: ValidateInput = {
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
