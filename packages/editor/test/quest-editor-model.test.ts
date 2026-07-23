import {
  bindQuestTarget,
  createStructuredQuestObjective,
  creatorSlug,
  duplicateAuthoredQuest,
  eventReferenceFromValue,
  eventReferenceValue,
  questValidationContext,
  STRUCTURED_OBJECTIVE_TYPES,
} from "@lindocara/editor/ui/editor/quest-editor-model.js";
import {
  createAuthoredQuestDefinition,
  validateAuthoredQuests,
} from "@lindocara/engine/adventure-state.js";
import { defaultEventPage, functionalEvent, type MapEvent } from "@lindocara/engine/map-events.js";
import { describe, expect, it } from "vitest";

const MAP_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const MONSTER_ID = "33333333-3333-4333-8333-333333333333";

function event(commands = defaultEventPage().commands): MapEvent {
  return {
    id: EVENT_ID,
    col: 2,
    row: 3,
    name: "Mira",
    ordinal: 1,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [{ ...defaultEventPage(), commands }],
  };
}

const MAPS = [
  {
    mapId: MAP_ID,
    name: "Village",
    cols: 40,
    rows: 30,
    events: [
      event(),
      functionalEvent({
        id: MONSTER_ID,
        col: 8,
        row: 8,
        ordinal: 2,
        kind: "monster",
        species: "spear_goblin",
        patrolRadius: 96,
        name: "Goblin captain",
      }),
    ],
  },
] as const;

describe("quest editor model", () => {
  it("creates a parser-valid structured default for every automatic objective type", () => {
    const quest = createAuthoredQuestDefinition("0001", "A complete quest");
    const objectives = STRUCTURED_OBJECTIVE_TYPES.map((type, index) => {
      const objective = createStructuredQuestObjective(
        String(index + 1).padStart(4, "0"),
        type,
        MAPS,
      );
      expect(objective, type).not.toBeNull();
      return objective;
    }).filter((objective) => objective !== null);

    const diagnostics = validateAuthoredQuests(
      [
        {
          ...quest,
          acceptance: "automatic",
          completion: "automatic",
          objectives,
        },
      ],
      questValidationContext({ switches: [], variables: [] }, MAPS),
    );

    expect(objectives.map((objective) => objective.type)).toEqual(STRUCTURED_OBJECTIVE_TYPES);
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("refuses defaults that need a missing map or event instead of creating a fake control", () => {
    expect(createStructuredQuestObjective("0001", "defeat-target", [])).toBeNull();
    expect(createStructuredQuestObjective("0001", "interact", [])).toBeNull();
    expect(createStructuredQuestObjective("0001", "reach", [])).toBeNull();
    expect(createStructuredQuestObjective("0001", "kill", [])).not.toBeNull();
  });

  it("finds offer and turn-in bindings recursively without exposing technical ids", () => {
    const nested = event([
      {
        t: "if",
        cond: { type: "switch", switchId: "0001" },
        then: [{ t: "startQuest", questId: "0007" }],
        else: [
          {
            t: "choices",
            prompt: "Ready?",
            options: [{ label: "Yes", body: [{ t: "completeQuest", questId: "0007" }] }],
          },
        ],
      },
    ]);
    const context = questValidationContext(
      { switches: [{ id: "0001", name: "Gate" }], variables: [] },
      [{ ...MAPS[0], events: [nested] }],
    );

    expect(context.offeredQuestIds?.has("0007")).toBe(true);
    expect(context.turnInQuestIds?.has("0007")).toBe(true);
  });

  it("round-trips event references, creates readable slugs and deeply duplicates rewards", () => {
    const reference = { mapId: MAP_ID, eventId: EVENT_ID };
    expect(eventReferenceFromValue(eventReferenceValue(reference))).toEqual(reference);
    expect(creatorSlug("Défense de l’Arène !")).toBe("defense_de_l_arene");

    const original = {
      ...createAuthoredQuestDefinition("0001", "Original"),
      rewards: {
        ...createAuthoredQuestDefinition("0001").rewards,
        items: [{ itemId: "small_potion", quantity: 2 }],
        customCommands: [{ t: "say", text: "Done", name: null }] as const,
      },
    };
    const duplicate = duplicateAuthoredQuest(original, "0002", "Copy");

    expect(duplicate).toMatchObject({ id: "0002", title: "Copy", version: 1 });
    expect(duplicate.rewards).not.toBe(original.rewards);
    expect(duplicate.rewards.items).not.toBe(original.rewards.items);
    expect(duplicate.rewards.customCommands).not.toBe(original.rewards.customCommands);
  });

  it("binds giver, turn-in and interaction targets by stable event reference", () => {
    const quest = {
      ...createAuthoredQuestDefinition("0001", "Audience"),
      objectives: [
        {
          id: "0001",
          type: "interact" as const,
          label: "",
          target: 1,
          optional: false,
          hidden: false,
          stage: 0,
          interaction: "talk" as const,
          targetRef: { mapId: MAP_ID, eventId: MONSTER_ID },
        },
      ],
    };
    const base = { switches: [], variables: [], quests: [quest] };
    const reference = { mapId: MAP_ID, eventId: EVENT_ID };
    const withGiver = bindQuestTarget(base, { kind: "giver", questId: "0001" }, reference);
    const withTurnIn = bindQuestTarget(
      withGiver ?? base,
      { kind: "turn-in", questId: "0001" },
      reference,
    );
    const bound = bindQuestTarget(
      withTurnIn ?? base,
      { kind: "objective", questId: "0001", objectiveId: "0001", interaction: "interact" },
      reference,
    );

    expect(bound?.quests?.[0]).toMatchObject({
      acceptance: "manual",
      completion: "turn-in",
      giver: reference,
      turnInTarget: reference,
      version: 4,
      objectives: [{ type: "interact", interaction: "interact", targetRef: reference }],
    });
  });
});
