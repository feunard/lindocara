/**
 * `parseAdventureRegistry`, `parsePartyAdventureState` and `activePageIndex`: totality (every
 * malformed field lands on null, never a throw), the duplicate-id-per-list rule, and XP's
 * highest-holding-page precedence rule, including the two mutation-proof branches called out in
 * the plan (highest-vs-lowest precedence, unknown-switch-as-true).
 */

import {
  type AdventureRegistry,
  activePageIndex,
  authoredQuestTrackers,
  createAuthoredQuestDefinition,
  createManualQuestObjective,
  EMPTY_ADVENTURE_STATE,
  EMPTY_REGISTRY,
  MAX_REGISTRY_SWITCHES,
  MAX_REGISTRY_VARIABLES,
  MAX_SELF_SWITCH_ENTRIES,
  mintRegistryId,
  type PartyAdventureState,
  parseAdventureRegistry,
  parsePartyAdventureState,
  REGISTRY_ENTRY_NAME_MAX,
  type RegistryEntry,
} from "@lindocara/engine/adventure-state.js";
import type { MapEvent, MapEventPage } from "@lindocara/engine/map-events.js";
import { describe, expect, it } from "vitest";

const EVENT_A = "11111111-1111-4111-8111-111111111111";
const EVENT_B = "22222222-2222-4222-8222-222222222222";

function entry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return { id: "0001", name: "Porte ouverte", ...overrides };
}

function page(overrides: Partial<MapEventPage> = {}): MapEventPage {
  return {
    condSwitchId: null,
    condVariableId: null,
    condVariableMin: null,
    condSelfSwitch: null,
    graphicAssetId: null,
    moveType: "fixed",
    moveSpeed: 0,
    moveFreq: 0,
    optMoveAnim: false,
    optStopAnim: false,
    optDirFix: false,
    optThrough: false,
    optOnTop: false,
    trigger: "action",
    commands: [],
    ...overrides,
  };
}

function event(overrides: Partial<MapEvent> = {}): MapEvent {
  return {
    id: EVENT_A,
    col: 1,
    row: 1,
    name: "Portier",
    ordinal: 0,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [page()],
    ...overrides,
  };
}

function state(overrides: Partial<PartyAdventureState> = {}): PartyAdventureState {
  return { switches: {}, variables: {}, selfSwitches: {}, ...overrides };
}

describe("parseAdventureRegistry: good payloads round-trip unchanged", () => {
  it("round-trips an empty registry", () => {
    expect(parseAdventureRegistry({ switches: [], variables: [] })).toEqual(EMPTY_REGISTRY);
  });

  it("round-trips a registry with both switches and variables", () => {
    const registry: AdventureRegistry = {
      switches: [entry({ id: "0001", name: "Porte" }), entry({ id: "0002", name: "Lumière" })],
      variables: [entry({ id: "0001", name: "Or" })],
    };
    expect(parseAdventureRegistry(registry)).toEqual(registry);
  });

  it("migrates legacy authored quests and derives a ready player tracker", () => {
    const legacy = {
      switches: [],
      variables: [],
      quests: [
        {
          id: "0001",
          title: "Chasse aux gobelins",
          description: "Protéger le village.",
          objectives: [{ id: "0001", label: "Gobelins vaincus", target: 2 }],
        },
      ],
    };
    const quest = {
      ...createAuthoredQuestDefinition("0001", "Chasse aux gobelins"),
      description: "Protéger le village.",
      journalSummary: "Protéger le village.",
      abandonable: false,
      objectives: [createManualQuestObjective("0001", "Gobelins vaincus", 2)],
    };
    const registry: AdventureRegistry = { switches: [], variables: [], quests: [quest] };
    expect(parseAdventureRegistry(legacy)).toEqual(registry);
    expect(
      authoredQuestTrackers(
        registry,
        state({
          quests: {
            "0001": {
              status: "active",
              objectives: { "0001": 2 },
              definitionSnapshot: null,
              definitionVersion: 1,
              rewardClaimed: false,
              completionCount: 0,
              processedEventKeys: [],
            },
          },
        }),
      ),
    ).toEqual([
      {
        id: "0001",
        title: "Chasse aux gobelins",
        description: "Protéger le village.",
        journalSummary: "Protéger le village.",
        recommendedLevel: null,
        scope: "party",
        repeatable: false,
        abandonable: false,
        completion: "turn-in",
        objectiveMode: "simultaneous",
        status: "ready",
        objectives: [
          {
            id: "0001",
            label: "Gobelins vaincus",
            progress: 2,
            target: 2,
            rule: createManualQuestObjective("0001", "Gobelins vaincus", 2),
          },
        ],
        rewards: { experience: 0, gold: 0, items: [], choices: [] },
      },
    ]);
  });

  it("accepts exactly the name length maximum", () => {
    const name = "x".repeat(REGISTRY_ENTRY_NAME_MAX);
    expect(parseAdventureRegistry({ switches: [entry({ name })], variables: [] })).toEqual({
      switches: [entry({ name })],
      variables: [],
    });
  });

  it("trims a name and accepts an empty one — the id is the real label", () => {
    expect(
      parseAdventureRegistry({ switches: [entry({ name: "  Porte  " })], variables: [] }),
    ).toEqual({ switches: [entry({ name: "Porte" })], variables: [] });
    expect(parseAdventureRegistry({ switches: [entry({ name: "" })], variables: [] })).toEqual({
      switches: [entry({ name: "" })],
      variables: [],
    });
  });

  it("accepts up to MAX_REGISTRY_SWITCHES / MAX_REGISTRY_VARIABLES entries", () => {
    const switches = Array.from({ length: MAX_REGISTRY_SWITCHES }, (_, i) =>
      entry({ id: String(i).padStart(4, "0") }),
    );
    const variables = Array.from({ length: MAX_REGISTRY_VARIABLES }, (_, i) =>
      entry({ id: String(i).padStart(4, "0") }),
    );
    expect(parseAdventureRegistry({ switches, variables })).toEqual({ switches, variables });
  });
});

describe("parseAdventureRegistry: totality — every malformed field lands on null, never a throw", () => {
  const cases: Record<string, unknown> = {
    "non-object root": "nope",
    "null root": null,
    "array root": [],
    "missing switches": { variables: [] },
    "missing variables": { switches: [] },
    "non-array switches": { switches: "nope", variables: [] },
    "non-array variables": { switches: [], variables: "nope" },
    "non-object entry": { switches: [42], variables: [] },
    "null entry": { switches: [null], variables: [] },
    "malformed id shape": { switches: [entry({ id: "1" })], variables: [] },
    "id with letters": { switches: [entry({ id: "00a1" })], variables: [] },
    "non-string name": { switches: [entry({ name: 42 as unknown as string })], variables: [] },
    "over-long name": {
      switches: [entry({ name: "x".repeat(REGISTRY_ENTRY_NAME_MAX + 1) })],
      variables: [],
    },
    "duplicate id within switches": {
      switches: [entry({ id: "0001" }), entry({ id: "0001", name: "Autre" })],
      variables: [],
    },
    "duplicate id within variables": {
      switches: [],
      variables: [entry({ id: "0001" }), entry({ id: "0001", name: "Autre" })],
    },
    "too many switches": {
      switches: Array.from({ length: MAX_REGISTRY_SWITCHES + 1 }, (_, i) =>
        entry({ id: String(i).padStart(4, "0") }),
      ),
      variables: [],
    },
    "too many variables": {
      switches: [],
      variables: Array.from({ length: MAX_REGISTRY_VARIABLES + 1 }, (_, i) =>
        entry({ id: String(i).padStart(4, "0") }),
      ),
    },
  };

  for (const [name, value] of Object.entries(cases)) {
    it(`rejects: ${name}`, () => {
      expect(parseAdventureRegistry(value)).toBeNull();
    });
  }
});

describe("parseAdventureRegistry: mutation proof — duplicate rejection is per list", () => {
  it("the same id in both switches and variables is NOT a collision", () => {
    const registry: AdventureRegistry = {
      switches: [entry({ id: "0001", name: "Interrupteur" })],
      variables: [entry({ id: "0001", name: "Compteur" })],
    };
    expect(parseAdventureRegistry(registry)).toEqual(registry);
  });
});

describe("parsePartyAdventureState: good payloads round-trip unchanged", () => {
  it("round-trips the empty state", () => {
    expect(parsePartyAdventureState({ switches: {}, variables: {}, selfSwitches: {} })).toEqual(
      EMPTY_ADVENTURE_STATE,
    );
  });

  it("round-trips a populated state", () => {
    const value: PartyAdventureState = {
      switches: { "0001": true, "0002": false },
      variables: { "0001": 5, "0002": -3 },
      selfSwitches: { [`${EVENT_A}:A`]: true, [`${EVENT_B}:A`]: false },
    };
    expect(parsePartyAdventureState(value)).toEqual(value);
  });

  it("accepts safe-integer variable extremes, including negative", () => {
    const value: PartyAdventureState = {
      switches: {},
      variables: { "0001": Number.MAX_SAFE_INTEGER, "0002": -Number.MAX_SAFE_INTEGER },
      selfSwitches: {},
    };
    expect(parsePartyAdventureState(value)).toEqual(value);
  });

  it("accepts exactly MAX_SELF_SWITCH_ENTRIES self-switch entries", () => {
    const selfSwitches: Record<string, boolean> = {};
    for (let i = 0; i < MAX_SELF_SWITCH_ENTRIES; i++) {
      const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      selfSwitches[`${uuid}:A`] = true;
    }
    const value: PartyAdventureState = { switches: {}, variables: {}, selfSwitches };
    expect(parsePartyAdventureState(value)).toEqual(value);
  });
});

describe("parsePartyAdventureState: totality — every malformed field lands on null, never a throw", () => {
  const cases: Record<string, unknown> = {
    "non-object root": "nope",
    "null root": null,
    "array root": [],
    "missing switches": { variables: {}, selfSwitches: {} },
    "missing variables": { switches: {}, selfSwitches: {} },
    "missing selfSwitches": { switches: {}, variables: {} },
    "switches not an object": { switches: [], variables: {}, selfSwitches: {} },
    "switches key not 4 digits": { switches: { "1": true }, variables: {}, selfSwitches: {} },
    "switches value not boolean": { switches: { "0001": "yes" }, variables: {}, selfSwitches: {} },
    "variables not an object": { switches: {}, variables: [], selfSwitches: {} },
    "variables key not 4 digits": { switches: {}, variables: { abcd: 1 }, selfSwitches: {} },
    "variables value not a safe integer": {
      switches: {},
      variables: { "0001": 2 ** 53 },
      selfSwitches: {},
    },
    "variables value not a number": { switches: {}, variables: { "0001": "5" }, selfSwitches: {} },
    "selfSwitches not an object": { switches: {}, variables: {}, selfSwitches: [] },
    "selfSwitches key without a colon": {
      switches: {},
      variables: {},
      selfSwitches: { [EVENT_A]: true },
    },
    "selfSwitches key with a bad letter": {
      switches: {},
      variables: {},
      selfSwitches: { [`${EVENT_A}:E`]: true },
    },
    "selfSwitches key with a malformed event id": {
      switches: {},
      variables: {},
      selfSwitches: { "not-a-uuid:A": true },
    },
    "selfSwitches value not boolean": {
      switches: {},
      variables: {},
      selfSwitches: { [`${EVENT_A}:A`]: "on" },
    },
  };

  for (const [name, value] of Object.entries(cases)) {
    it(`rejects: ${name}`, () => {
      expect(parsePartyAdventureState(value)).toBeNull();
    });
  }

  it("rejects more than MAX_SELF_SWITCH_ENTRIES self-switch entries", () => {
    const selfSwitches: Record<string, boolean> = {};
    for (let i = 0; i < MAX_SELF_SWITCH_ENTRIES + 1; i++) {
      const uuid = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      selfSwitches[`${uuid}:A`] = true;
    }
    expect(parsePartyAdventureState({ switches: {}, variables: {}, selfSwitches })).toBeNull();
  });
});

describe("activePageIndex", () => {
  it("a page with no conditions is always active", () => {
    const ev = event({ pages: [page()] });
    expect(activePageIndex(ev, state())).toBe(0);
  });

  it("page 3 beats page 1 when both hold — the highest-position holding page wins", () => {
    const ev = event({
      pages: [
        page({ condSwitchId: "0001" }), // page 1: holds
        page({ condSwitchId: "0002" }), // page 2: does not hold
        page({ condSwitchId: "0001" }), // page 3: also holds
      ],
    });
    expect(activePageIndex(ev, state({ switches: { "0001": true } }))).toBe(2);
  });

  it("an unknown switch id reads false", () => {
    const ev = event({ pages: [page({ condSwitchId: "0009" })] });
    expect(activePageIndex(ev, state())).toBeNull();
  });

  it("an unknown variable id reads 0 — so a `min 0` condition HOLDS against it", () => {
    const ev = event({ pages: [page({ condVariableId: "0009", condVariableMin: 0 })] });
    expect(activePageIndex(ev, state())).toBe(0);
  });

  it("a variable condition above the unknown default of 0 does not hold", () => {
    const ev = event({ pages: [page({ condVariableId: "0009", condVariableMin: 1 })] });
    expect(activePageIndex(ev, state())).toBeNull();
  });

  it("self-switches are keyed per event: two events sharing letter A stay independent", () => {
    const eventA = event({ id: EVENT_A, pages: [page({ condSelfSwitch: "A" })] });
    const eventB = event({ id: EVENT_B, pages: [page({ condSelfSwitch: "A" })] });
    const partyState = state({ selfSwitches: { [`${EVENT_A}:A`]: true } });
    expect(activePageIndex(eventA, partyState)).toBe(0);
    expect(activePageIndex(eventB, partyState)).toBeNull();
  });

  it("all pages failing their conditions leaves the event dormant (null)", () => {
    const ev = event({
      pages: [
        page({ condSwitchId: "0001" }),
        page({ condVariableId: "0002", condVariableMin: 10 }),
      ],
    });
    expect(activePageIndex(ev, state())).toBeNull();
  });

  it("all conditions on one page must hold together (AND, not OR)", () => {
    const ev = event({
      pages: [page({ condSwitchId: "0001", condVariableId: "0002", condVariableMin: 5 })],
    });
    // Switch holds but the variable does not: the page as a whole must not hold.
    expect(activePageIndex(ev, state({ switches: { "0001": true } }))).toBeNull();
    // Both hold: the page holds.
    expect(
      activePageIndex(ev, state({ switches: { "0001": true }, variables: { "0002": 5 } })),
    ).toBe(0);
  });

  it("a bare page 1 loses to a conditioned page 2 once the condition holds, and wins once it doesn't", () => {
    // The archetype XP authors actually use: an unconditional "default" page 1, overridden by a
    // more specific page 2. A scanner that stops at the first BARE page walking top-down would
    // return page 1 unconditionally and never even look at page 2 — this pins that it does not.
    const ev = event({
      pages: [
        page(), // page 1: bare, no conditions — the fallback
        page({ condSwitchId: "0001" }), // page 2: conditioned — the override
      ],
    });
    expect(activePageIndex(ev, state({ switches: { "0001": true } }))).toBe(1);
    expect(activePageIndex(ev, state())).toBe(0);
  });
});

describe("mintRegistryId", () => {
  const entry = (id: string): RegistryEntry => ({ id, name: "" });

  it("mints 0001 for an empty list", () => {
    expect(mintRegistryId([])).toBe("0001");
  });

  it("is monotone: it skips existing ids and never reuses a gap", () => {
    // Delete the middle of {0001,0002,0003} and mint again: the next id is 0004, one past the
    // HIGHEST ordinal — never 0002 refilling the gap. A registry id is identity (an event page
    // references it by string), so reusing a freed id would silently redirect an orphaned
    // condition onto a brand-new entry. This is the mutation-proof target: a gap-filling mint
    // returns "0002" here and fails.
    expect(mintRegistryId([entry("0001"), entry("0003")])).toBe("0004");
    expect(mintRegistryId([entry("0001"), entry("0002"), entry("0003")])).toBe("0004");
    expect(mintRegistryId([entry("0005")])).toBe("0006");
  });

  it("returns null once the id space is exhausted at 9999", () => {
    expect(mintRegistryId([entry("9999")])).toBeNull();
  });
});
