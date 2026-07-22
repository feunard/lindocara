import { EMPTY_ADVENTURE_STATE } from "@lindocara/engine/adventure-state.js";
import {
  applyQuestBusinessEvent,
  buildQuestObjectiveIndex,
  completedQuestIds,
  createAuthoredQuestProgress,
  type QuestActor,
  type QuestBusinessEvent,
  questEventActors,
  questObjectiveCandidates,
  questPrerequisitesHold,
} from "@lindocara/engine/quest-runtime.js";
import {
  type AuthoredQuestDefinition,
  createAuthoredQuestDefinition,
  createManualQuestObjective,
  type KillQuestObjective,
} from "@lindocara/engine/quests.js";
import { describe, expect, it } from "vitest";

const MAP_A = "11111111-1111-4111-8111-111111111111";
const MAP_B = "22222222-2222-4222-8222-222222222222";
const MONSTER_EVENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const alice: QuestActor = { heroId: "alice", sessionEpoch: 3, level: 8 };
const bob: QuestActor = { heroId: "bob", sessionEpoch: 7, level: 6 };
const clara: QuestActor = { heroId: "clara", sessionEpoch: 2, level: 2 };

function killQuest(overrides: Partial<AuthoredQuestDefinition> = {}): AuthoredQuestDefinition {
  return {
    ...createAuthoredQuestDefinition("0001", "Dix gobelins à lance"),
    acceptance: "automatic",
    completion: "turn-in",
    objectives: [
      {
        id: "0001",
        type: "kill",
        label: "",
        target: 10,
        optional: false,
        hidden: false,
        stage: 0,
        species: "spear_goblin",
        mapScope: { kind: "maps", mapIds: [MAP_A] },
        credit: "contributors",
      },
    ],
    ...overrides,
  };
}

function killObjective(): KillQuestObjective {
  const objective = killQuest().objectives[0];
  if (objective?.type !== "kill") throw new Error("missing kill objective fixture");
  return objective;
}

function killEvent(
  overrides: Partial<Extract<QuestBusinessEvent, { type: "monsterKilled" }>> = {},
) {
  return {
    id: "kill-1",
    type: "monsterKilled" as const,
    mapId: MAP_A,
    monsterId: MONSTER_EVENT,
    species: "spear_goblin",
    killer: alice,
    contributors: [alice, bob],
    nearbyParty: [alice, bob, clara],
    ...overrides,
  };
}

function apply(definition: AuthoredQuestDefinition, event: QuestBusinessEvent) {
  const index = buildQuestObjectiveIndex([definition]);
  const ids = questObjectiveCandidates(index, event).map((candidate) => candidate.objectiveId);
  return applyQuestBusinessEvent(definition, createAuthoredQuestProgress(definition), event, ids);
}

describe("quest objective index", () => {
  it("returns only objectives indexed under the event target", () => {
    const definition = killQuest({
      objectives: [
        ...killQuest().objectives,
        {
          id: "0002",
          type: "collect",
          label: "",
          target: 3,
          optional: false,
          hidden: false,
          stage: 0,
          itemId: "health_potion",
          counting: "acquired",
        },
      ],
    });
    const index = buildQuestObjectiveIndex([definition]);
    expect(questObjectiveCandidates(index, killEvent())).toEqual([
      { questId: "0001", objectiveId: "0001" },
    ]);
    expect(
      questObjectiveCandidates(index, {
        id: "loot-1",
        type: "itemAcquired",
        mapId: MAP_A,
        actor: alice,
        itemId: "health_potion",
        amount: 1,
        inventoryQuantity: 2,
      }),
    ).toEqual([{ questId: "0001", objectiveId: "0002" }]);
  });

  it("indexes several objectives aimed at the same target", () => {
    const definition = killQuest({
      objectives: [...killQuest().objectives, { ...killObjective(), id: "0002", target: 2 }],
    });
    const result = apply(definition, killEvent());
    expect(result.changedObjectiveIds).toEqual(["0001", "0002"]);
    expect(result.progress.objectives).toEqual({ "0001": 1, "0002": 1 });
  });
});

describe("automatic progress", () => {
  it("increments a matching spear goblin kill, clamps at ten and becomes ready", () => {
    const definition = killQuest();
    const index = buildQuestObjectiveIndex([definition]);
    let progress = createAuthoredQuestProgress(definition);
    for (let count = 1; count <= 12; count++) {
      const event = killEvent({ id: `kill-${count}` });
      const ids = questObjectiveCandidates(index, event).map((item) => item.objectiveId);
      progress = applyQuestBusinessEvent(definition, progress, event, ids).progress;
    }
    expect(progress.objectives["0001"]).toBe(10);
    expect(progress.status).toBe("ready");
  });

  it("does not double-credit an event id and survives the serialized progress round-trip shape", () => {
    const definition = killQuest();
    const event = killEvent();
    const first = apply(definition, event).progress;
    const second = applyQuestBusinessEvent(definition, first, event, ["0001"]);
    expect(second.changedObjectiveIds).toEqual([]);
    expect(second.progress.objectives["0001"]).toBe(1);
    expect(second.progress.processedEventKeys).toEqual(["kill-1"]);
  });

  it("rejects the right species on a disallowed map and any event on a completed quest", () => {
    const definition = killQuest();
    expect(apply(definition, killEvent({ mapId: MAP_B })).changedObjectiveIds).toEqual([]);
    const completed = {
      ...createAuthoredQuestProgress(definition),
      status: "completed" as const,
      objectives: { "0001": 10 },
      completionCount: 1,
    };
    expect(applyQuestBusinessEvent(definition, completed, killEvent(), ["0001"]).progress).toBe(
      completed,
    );
  });

  it("automatically completes when configured and never exceeds the objective target", () => {
    const definition = killQuest({
      completion: "automatic",
      objectives: [{ ...killObjective(), target: 1 }],
    });
    const result = apply(definition, killEvent());
    expect(result.becameCompleted).toBe(true);
    expect(result.progress).toMatchObject({
      status: "completed",
      completionCount: 1,
      rewardClaimed: false,
      objectives: { "0001": 1 },
    });
  });

  it("uses inventory totals for collect/deliver and can move ready back to active before turn-in", () => {
    const definition = killQuest({
      objectives: [
        {
          id: "0001",
          type: "deliver",
          label: "",
          target: 3,
          optional: false,
          hidden: false,
          stage: 0,
          itemId: "health_potion",
          consume: true,
        },
      ],
    });
    const acquired: QuestBusinessEvent = {
      id: "loot-1",
      type: "itemAcquired",
      mapId: MAP_A,
      actor: alice,
      itemId: "health_potion",
      amount: 3,
      inventoryQuantity: 3,
    };
    const ready = apply(definition, acquired).progress;
    expect(ready.status).toBe("ready");
    const removed: QuestBusinessEvent = {
      ...acquired,
      id: "use-1",
      type: "itemRemoved",
      amount: 1,
      inventoryQuantity: 2,
    };
    const result = applyQuestBusinessEvent(definition, ready, removed, ["0001"]);
    expect(result.progress).toMatchObject({ status: "active", objectives: { "0001": 2 } });
  });

  it("unlocks only the current stage of a sequential quest", () => {
    const definition = killQuest({
      objectiveMode: "sequential",
      objectives: [
        { ...killObjective(), target: 1 },
        { ...killObjective(), id: "0002", target: 1, stage: 1 },
      ],
    });
    const first = apply(definition, killEvent({ id: "kill-1" })).progress;
    expect(first.objectives).toEqual({ "0001": 1 });
    const replay = applyQuestBusinessEvent(definition, first, killEvent({ id: "kill-1" }), [
      "0001",
      "0002",
    ]).progress;
    expect(replay).toBe(first);
    expect(replay.objectives).toEqual({ "0001": 1 });
    const second = applyQuestBusinessEvent(definition, first, killEvent({ id: "kill-2" }), [
      "0001",
      "0002",
    ]).progress;
    expect(second.objectives).toEqual({ "0001": 1, "0002": 1 });
    expect(second.status).toBe("ready");
  });

  it("matches one exact authored monster and rejects the same id on another map", () => {
    const definition = killQuest({
      objectives: [
        {
          id: "0001",
          type: "defeat-target",
          label: "",
          target: 1,
          optional: false,
          hidden: false,
          stage: 0,
          targetRef: { mapId: MAP_A, eventId: MONSTER_EVENT },
          credit: "killer",
        },
      ],
    });
    expect(apply(definition, killEvent()).progress.objectives).toEqual({ "0001": 1 });
    expect(apply(definition, killEvent({ mapId: MAP_B })).changedObjectiveIds).toEqual([]);
  });

  it("tracks acquisitions, interactions, map/area arrival, item use and activities by target", () => {
    const cases: Array<{
      objective: AuthoredQuestDefinition["objectives"][number];
      event: QuestBusinessEvent;
      expected: number;
    }> = [
      {
        objective: {
          id: "0001",
          type: "collect",
          label: "",
          target: 3,
          optional: false,
          hidden: false,
          stage: 0,
          itemId: "health_potion",
          counting: "acquired",
        },
        event: {
          id: "loot-1",
          type: "itemAcquired",
          mapId: MAP_A,
          actor: alice,
          itemId: "health_potion",
          amount: 2,
          inventoryQuantity: 5,
        },
        expected: 2,
      },
      {
        objective: {
          id: "0001",
          type: "interact",
          label: "",
          target: 1,
          optional: false,
          hidden: false,
          stage: 0,
          targetRef: { mapId: MAP_A, eventId: MONSTER_EVENT },
          interaction: "interact",
        },
        event: {
          id: "interaction-1",
          type: "objectInteracted",
          mapId: MAP_A,
          actor: alice,
          targetEventId: MONSTER_EVENT,
        },
        expected: 1,
      },
      {
        objective: {
          id: "0001",
          type: "interact",
          label: "",
          target: 1,
          optional: false,
          hidden: false,
          stage: 0,
          targetRef: { mapId: MAP_A, eventId: MONSTER_EVENT },
          interaction: "talk",
        },
        event: {
          id: "talk-1",
          type: "npcTalked",
          mapId: MAP_A,
          actor: alice,
          targetEventId: MONSTER_EVENT,
        },
        expected: 1,
      },
      {
        objective: {
          id: "0001",
          type: "reach",
          label: "",
          target: 1,
          optional: false,
          hidden: false,
          stage: 0,
          destination: { kind: "map", mapId: MAP_A },
        },
        event: { id: "arrival-1", type: "mapEntered", mapId: MAP_A, actor: alice },
        expected: 1,
      },
      {
        objective: {
          id: "0001",
          type: "reach",
          label: "",
          target: 1,
          optional: false,
          hidden: false,
          stage: 0,
          destination: { kind: "area", mapId: MAP_A, areaId: "ruins" },
        },
        event: {
          id: "area-1",
          type: "areaEntered",
          mapId: MAP_A,
          actor: alice,
          areaId: "ruins",
        },
        expected: 1,
      },
      {
        objective: {
          id: "0001",
          type: "use-item",
          label: "",
          target: 2,
          optional: false,
          hidden: false,
          stage: 0,
          itemId: "health_potion",
          context: { kind: "map", mapId: MAP_A },
        },
        event: {
          id: "use-1",
          type: "itemUsed",
          mapId: MAP_A,
          actor: alice,
          itemId: "health_potion",
          amount: 1,
        },
        expected: 1,
      },
      {
        objective: {
          id: "0001",
          type: "activity",
          label: "",
          target: 3,
          optional: false,
          hidden: false,
          stage: 0,
          activityId: "arena-round",
        },
        event: {
          id: "activity-1",
          type: "activityCompleted",
          mapId: MAP_A,
          actor: alice,
          activityId: "arena-round",
          amount: 2,
        },
        expected: 2,
      },
    ];
    for (const { objective, event, expected } of cases) {
      const result = apply(killQuest({ objectives: [objective] }), event);
      expect(result.progress.objectives["0001"], objective.type).toBe(expected);
    }
  });
});

describe("credit and prerequisites", () => {
  it("selects killer, meaningful contributors or nearby party without duplicates", () => {
    const base = killObjective();
    const event = killEvent({
      contributors: [alice, bob, alice],
      nearbyParty: [alice, bob, clara],
    });
    expect(
      questEventActors({ ...base, credit: "killer" }, event).map((actor) => actor.heroId),
    ).toEqual(["alice"]);
    expect(
      questEventActors({ ...base, credit: "contributors" }, event).map((actor) => actor.heroId),
    ).toEqual(["alice", "bob"]);
    expect(
      questEventActors({ ...base, credit: "nearby-party" }, event).map((actor) => actor.heroId),
    ).toEqual(["alice", "bob", "clara"]);
  });

  it("evaluates level, previous quest, switches, variables and all/any mode", () => {
    const prior = killQuest({ id: "0002" });
    const progress = {
      "0002": { ...createAuthoredQuestProgress(prior), status: "completed" as const },
    };
    const definition = killQuest({
      prerequisites: {
        minLevel: 5,
        previousQuestId: "0002",
        mode: "all",
        conditions: [
          { type: "switch", switchId: "0001", value: true },
          { type: "variable", variableId: "0001", min: 3 },
        ],
      },
    });
    expect(
      questPrerequisitesHold(definition, {
        level: 8,
        completedQuestIds: completedQuestIds(progress),
        adventureState: {
          ...EMPTY_ADVENTURE_STATE,
          switches: { "0001": true },
          variables: { "0001": 3 },
        },
      }),
    ).toBe(true);
    expect(
      questPrerequisitesHold(definition, {
        level: 4,
        completedQuestIds: completedQuestIds(progress),
        adventureState: EMPTY_ADVENTURE_STATE,
      }),
    ).toBe(false);
  });

  it("keeps manual objectives outside automatic indexes", () => {
    const definition = killQuest({ objectives: [createManualQuestObjective("0001", "Script")] });
    expect(questObjectiveCandidates(buildQuestObjectiveIndex([definition]), killEvent())).toEqual(
      [],
    );
  });
});
