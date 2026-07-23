import {
  type AdventureRegistry,
  authoredQuestTrackers,
  createAuthoredQuestDefinition,
  createManualQuestObjective,
  normalizeAuthoredQuestProgress,
  parseAdventureRegistry,
  parsePartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import {
  type AuthoredQuestDefinition,
  type AuthoredQuestObjective,
  parseAuthoredQuestDefinition,
  QUEST_SCHEMA_VERSION,
  requiredQuestObjectivesComplete,
  validateAuthoredQuests,
} from "@lindocara/engine/quests.js";
import { describe, expect, it } from "vitest";

const MAP_A = "11111111-1111-4111-8111-111111111111";
const MAP_B = "22222222-2222-4222-8222-222222222222";
const EVENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function objectives(): AuthoredQuestObjective[] {
  const base = { label: "", target: 3, optional: false, hidden: false, stage: 0 } as const;
  return [
    {
      ...base,
      id: "0001",
      type: "kill",
      species: "spear_goblin",
      mapScope: { kind: "maps", mapIds: [MAP_A, MAP_B] },
      credit: "contributors",
    },
    {
      ...base,
      id: "0002",
      type: "defeat-target",
      target: 1,
      targetRef: { mapId: MAP_A, eventId: EVENT_A },
      credit: "killer",
    },
    {
      ...base,
      id: "0003",
      type: "collect",
      itemId: "health_potion",
      counting: "inventory",
    },
    {
      ...base,
      id: "0004",
      type: "deliver",
      itemId: "mana_potion",
      consume: true,
    },
    {
      ...base,
      id: "0005",
      type: "interact",
      interaction: "talk",
      target: 1,
      targetRef: { mapId: MAP_A, eventId: EVENT_B },
    },
    {
      ...base,
      id: "0006",
      type: "reach",
      target: 1,
      destination: { kind: "map", mapId: MAP_B },
    },
    {
      ...base,
      id: "0007",
      type: "use-item",
      itemId: "health_potion",
      context: { kind: "event", mapId: MAP_A, eventId: EVENT_B },
    },
    {
      ...base,
      id: "0008",
      type: "activity",
      activityId: "village_defence",
    },
  ];
}

function objectiveOfType<T extends AuthoredQuestObjective["type"]>(
  type: T,
): Extract<AuthoredQuestObjective, { type: T }> {
  const objective = objectives().find((candidate) => candidate.type === type);
  if (!objective) throw new Error(`missing test objective ${type}`);
  return objective as Extract<AuthoredQuestObjective, { type: T }>;
}

function quest(overrides: Partial<AuthoredQuestDefinition> = {}): AuthoredQuestDefinition {
  return {
    ...createAuthoredQuestDefinition("0001", "La route des gobelins"),
    description: "Sécurisez la route avant la tombée de la nuit.",
    journalSummary: "Sécuriser la route.",
    recommendedLevel: 3,
    acceptance: "automatic",
    completion: "automatic",
    objectives: objectives(),
    rewards: {
      experience: 120,
      gold: 25,
      items: [{ itemId: "health_potion", quantity: 2 }],
      choices: [
        {
          id: "0001",
          label: "Potions de mana",
          experience: 0,
          gold: 0,
          items: [{ itemId: "mana_potion", quantity: 2 }],
        },
      ],
      nextQuestId: null,
      stateChanges: [{ type: "switch", switchId: "0001", value: true }],
      customCommands: [{ t: "setVariable", variableId: "0001", op: "add", value: 1 }],
    },
    dialogues: {
      offer: "La route n'est plus sûre.",
      accepted: "Revenez en vie.",
      refused: "Je trouverai quelqu'un d'autre.",
      reminder: "Les gobelins rôdent encore.",
      ready: "La route est sûre.",
      turnIn: "Excellent travail.",
      completed: "Le village se souvient de vous.",
      unavailable: "Vous n'êtes pas encore prêt.",
    },
    ...overrides,
  };
}

describe("structured authored quest parser", () => {
  it("round-trips every objective family, prerequisites, dialogues and rewards", () => {
    const value = quest({
      giver: { mapId: MAP_A, eventId: EVENT_A },
      turnInTarget: { mapId: MAP_A, eventId: EVENT_B },
      prerequisites: {
        minLevel: 2,
        previousQuestId: null,
        mode: "all",
        conditions: [
          { type: "switch", switchId: "0001", value: true },
          { type: "variable", variableId: "0001", min: 4 },
        ],
      },
    });
    expect(parseAuthoredQuestDefinition(value)).toEqual(value);
  });

  it("explicitly converts the old free-label format to a versioned manual objective", () => {
    const parsed = parseAuthoredQuestDefinition({
      id: "0001",
      title: "Ancienne quête",
      description: "Une sauvegarde historique.",
      objectives: [{ id: "0001", label: "Compteur libre", target: 5 }],
    });
    expect(parsed).toMatchObject({
      schemaVersion: QUEST_SCHEMA_VERSION,
      version: 1,
      id: "0001",
      journalSummary: "Une sauvegarde historique.",
      scope: "party",
      abandonable: false,
      acceptance: "manual",
      completion: "turn-in",
      objectives: [
        {
          id: "0001",
          type: "manual",
          label: "Compteur libre",
          target: 5,
          optional: false,
          hidden: false,
          stage: 0,
        },
      ],
    });
  });

  it.each([
    ["unknown schema", { ...quest(), schemaVersion: 99 }],
    ["unknown monster", { ...quest(), objectives: [{ ...objectives()[0], species: "dragon" }] }],
    [
      "precise target count other than one",
      { ...quest(), objectives: [{ ...objectives()[1], target: 2 }] },
    ],
    ["malformed map reference", { ...quest(), giver: { mapId: "map", eventId: EVENT_A } }],
    ["unknown objective type", { ...quest(), objectives: [{ ...objectives()[0], type: "dance" }] }],
  ])("rejects %s without throwing", (_name, value) => {
    expect(() => parseAuthoredQuestDefinition(value)).not.toThrow();
    expect(parseAuthoredQuestDefinition(value)).toBeNull();
  });
});

describe("shared quest validation", () => {
  const context = {
    mapIds: new Set([MAP_A, MAP_B]),
    eventIdsByMap: new Map([
      [MAP_A, new Set([EVENT_A, EVENT_B])],
      [MAP_B, new Set<string>()],
    ]),
    areaIdsByMap: new Map([
      [MAP_A, new Set(["village_square"])],
      [MAP_B, new Set<string>()],
    ]),
    itemIds: new Set(["health_potion", "mana_potion"]),
    activityIds: new Set(["village_defence"]),
    switchIds: new Set(["0001"]),
    variableIds: new Set(["0001"]),
  };

  it("accepts a fully-resolved automatic quest", () => {
    const automatic = quest({
      rewards: { ...quest().rewards, choices: [], customCommands: [] },
    });
    expect(validateAuthoredQuests([automatic], context)).toEqual([]);
  });

  it("requires a turn-in interaction for reward choices and advanced commands", () => {
    const automatic = quest({
      completion: "automatic",
      rewards: {
        ...quest().rewards,
        choices: [{ id: "0001", label: "Potion", experience: 0, gold: 0, items: [] }],
        customCommands: [{ t: "say", text: "Bravo", name: null }],
      },
    });
    expect(validateAuthoredQuests([automatic], context).map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "quest.reward.choices_require_turn_in",
        "quest.reward.commands_require_turn_in",
      ]),
    );
  });

  it("rejects an area that no authored event can enter", () => {
    const areaQuest = quest({
      objectives: [
        {
          ...objectiveOfType("reach"),
          destination: { kind: "area", mapId: MAP_A, areaId: "missing_area" },
        },
      ],
      rewards: { ...quest().rewards, choices: [], customCommands: [] },
    });
    expect(validateAuthoredQuests([areaQuest], context).map(({ code }) => code)).toContain(
      "quest.objective.area_missing",
    );
  });

  it("reports broken references and missing manual acceptance/turn-in routes", () => {
    const brokenMap = "33333333-3333-4333-8333-333333333333";
    const broken = quest({
      acceptance: "manual",
      completion: "turn-in",
      giver: null,
      turnInTarget: null,
      objectives: [
        {
          ...objectiveOfType("collect"),
          itemId: "lost_item",
        },
        {
          ...objectiveOfType("reach"),
          destination: { kind: "map", mapId: brokenMap },
        },
        {
          ...objectiveOfType("interact"),
          targetRef: { mapId: MAP_B, eventId: EVENT_A },
        },
      ],
      rewards: {
        ...quest().rewards,
        items: [{ itemId: "lost_item", quantity: 1 }],
        nextQuestId: "0002",
      },
    });
    const codes = validateAuthoredQuests([broken], context).map((diagnostic) => diagnostic.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "quest.acceptance.unbound",
        "quest.turn_in.unbound",
        "quest.objective.item_missing",
        "quest.objective.map_missing",
        "quest.objective.event_missing",
        "quest.reward.item_missing",
        "quest.next.missing",
      ]),
    );
  });

  it("blocks prerequisite loops and sequential stage gaps", () => {
    const first = quest({
      id: "0001",
      prerequisites: {
        minLevel: null,
        previousQuestId: "0002",
        mode: "all",
        conditions: [],
      },
      objectiveMode: "sequential",
      objectives: [
        createManualQuestObjective("0001", "Étape 1"),
        { ...createManualQuestObjective("0002", "Étape 3"), stage: 2 },
      ],
    });
    const second = quest({
      id: "0002",
      prerequisites: {
        minLevel: null,
        previousQuestId: "0001",
        mode: "all",
        conditions: [],
      },
    });
    const codes = validateAuthoredQuests([first, second]).map((diagnostic) => diagnostic.code);
    expect(codes).toContain("quest.prerequisite.cycle");
    expect(codes).toContain("quest.objectives.stage_gap");
  });
});

describe("definition pinning for saves already in progress", () => {
  it("pins a legacy active row, then ignores current edits and deletion", () => {
    const accepted = quest({
      version: 1,
      title: "Version acceptée",
      objectives: [
        {
          ...objectiveOfType("kill"),
          target: 10,
        },
      ],
    });
    const registry: AdventureRegistry = { switches: [], variables: [], quests: [accepted] };
    const legacyState = parsePartyAdventureState({
      switches: {},
      variables: {},
      selfSwitches: {},
      quests: { "0001": { status: "active", objectives: { "0001": 4 } } },
    });
    expect(legacyState).not.toBeNull();
    if (!legacyState) throw new Error("legacy state did not parse");
    const pinned = normalizeAuthoredQuestProgress(registry, legacyState);
    expect(pinned.quests?.["0001"]?.definitionSnapshot).toEqual(accepted);

    const edited = quest({
      version: 2,
      title: "Version publiée plus tard",
      objectives: [{ ...objectiveOfType("kill"), target: 1 }],
    });
    const afterEdit = normalizeAuthoredQuestProgress(
      { switches: [], variables: [], quests: [edited] },
      pinned,
    );
    const afterDeletion = normalizeAuthoredQuestProgress(
      { switches: [], variables: [] },
      afterEdit,
    );
    expect(afterDeletion.quests?.["0001"]).toMatchObject({
      definitionVersion: 1,
      objectives: { "0001": 4 },
    });
    expect(authoredQuestTrackers({ switches: [], variables: [] }, afterDeletion)).toMatchObject([
      {
        title: "Version acceptée",
        status: "active",
        objectives: [{ progress: 4, target: 10 }],
      },
    ]);
  });

  it("marks old completed rows as already rewarded during conversion", () => {
    const parsed = parsePartyAdventureState({
      switches: {},
      variables: {},
      selfSwitches: {},
      quests: { "0001": { status: "completed", objectives: { "0001": 1 } } },
    });
    expect(parsed?.quests?.["0001"]).toMatchObject({
      definitionSnapshot: null,
      definitionVersion: 1,
      rewardClaimed: true,
      completionCount: 1,
    });
  });

  it("keeps hidden rules off the player payload until progress reveals them", () => {
    const hidden = {
      ...createManualQuestObjective("0001", "Passage secret", 2),
      hidden: true,
    };
    const definition = quest({ objectives: [hidden] });
    const progress = (amount: number) => ({
      switches: {},
      variables: {},
      selfSwitches: {},
      quests: {
        "0001": {
          status: "active" as const,
          objectives: { "0001": amount },
          definitionSnapshot: definition,
          definitionVersion: 1,
          rewardClaimed: false,
          completionCount: 0,
          processedEventKeys: [],
        },
      },
    });

    expect(
      authoredQuestTrackers({ switches: [], variables: [], quests: [definition] }, progress(0))[0]
        ?.objectives,
    ).toEqual([]);
    expect(
      authoredQuestTrackers({ switches: [], variables: [], quests: [definition] }, progress(1))[0]
        ?.objectives,
    ).toMatchObject([{ label: "Passage secret", progress: 1, rule: { hidden: true } }]);
  });

  it("requires every non-optional objective but not optional bonus goals", () => {
    const definition = quest({
      objectives: [
        createManualQuestObjective("0001", "Obligatoire", 2),
        { ...createManualQuestObjective("0002", "Bonus", 5), optional: true },
      ],
    });
    expect(requiredQuestObjectivesComplete(definition, { "0001": 2, "0002": 0 })).toBe(true);
    expect(requiredQuestObjectivesComplete(definition, { "0001": 1, "0002": 5 })).toBe(false);
  });
});

describe("registry boundary", () => {
  it("normalizes v2 definitions through the existing adventure registry parser", () => {
    const registry = { switches: [], variables: [], quests: [quest()] };
    expect(parseAdventureRegistry(registry)).toEqual(registry);
  });
});
