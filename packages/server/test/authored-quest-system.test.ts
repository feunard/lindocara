import {
  type AdventureRegistry,
  type AuthoredQuestProgress,
  EMPTY_ADVENTURE_STATE,
  type PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import {
  buildQuestObjectiveIndex,
  createAuthoredQuestProgress,
  type QuestActor,
  type QuestBusinessEvent,
} from "@lindocara/engine/quest-runtime.js";
import {
  type AuthoredQuestDefinition,
  createAuthoredQuestDefinition,
} from "@lindocara/engine/quests.js";
import { describe, expect, it, vi } from "vitest";
import { processAuthoredQuestEvent } from "../src/authored-quest-system.js";

const MAP_ID = "11111111-1111-4111-8111-111111111111";
const alice: QuestActor = { heroId: "alice", sessionEpoch: 3, level: 8 };
const bob: QuestActor = { heroId: "bob", sessionEpoch: 5, level: 6 };
const clara: QuestActor = { heroId: "clara", sessionEpoch: 7, level: 4 };

function quest(
  scope: "party" | "personal",
  overrides: Partial<AuthoredQuestDefinition> = {},
): AuthoredQuestDefinition {
  return {
    ...createAuthoredQuestDefinition("0001", "Dix gobelins à lance"),
    scope,
    acceptance: "automatic",
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
        mapScope: { kind: "any" },
        credit: "contributors",
      },
    ],
    ...overrides,
  };
}

function killEvent(id = "kill-1"): QuestBusinessEvent {
  return {
    id,
    type: "monsterKilled",
    mapId: MAP_ID,
    monsterId: "monster-1",
    species: "spear_goblin",
    killer: alice,
    contributors: [alice, bob],
    nearbyParty: [alice, bob, clara],
  };
}

function registry(definition: AuthoredQuestDefinition): AdventureRegistry {
  return { switches: [], variables: [], quests: [definition] };
}

async function process(input: {
  definition: AuthoredQuestDefinition;
  partyState?: PartyAdventureState;
  personal?: Record<string, Record<string, AuthoredQuestProgress>>;
  event?: QuestBusinessEvent;
  save?: (actor: QuestActor, questId: string, progress: AuthoredQuestProgress) => Promise<boolean>;
}) {
  const authoredRegistry = registry(input.definition);
  const personal = input.personal ?? {};
  const partyState = input.partyState ?? EMPTY_ADVENTURE_STATE;
  const pinnedIndex = (progress: Readonly<Record<string, AuthoredQuestProgress>> | undefined) =>
    buildQuestObjectiveIndex(
      Object.values(progress ?? {}).flatMap((item) =>
        item.definitionSnapshot ? [item.definitionSnapshot] : [],
      ),
    );
  return processAuthoredQuestEvent({
    registry: authoredRegistry,
    partyState,
    currentIndex: buildQuestObjectiveIndex(authoredRegistry.quests ?? []),
    partyPinnedIndex: pinnedIndex(partyState.quests),
    event: input.event ?? killEvent(),
    indexForDefinition: (definition) => buildQuestObjectiveIndex([definition]),
    loadPersonal: async (actor) => personal[actor.heroId] ?? {},
    personalPinnedIndex: (actor) => pinnedIndex(personal[actor.heroId]),
    savePersonal:
      input.save ??
      (async (actor, questId, progress) => {
        personal[actor.heroId] = { ...(personal[actor.heroId] ?? {}), [questId]: progress };
        return true;
      }),
  });
}

describe("authoritative authored quest orchestration", () => {
  it("credits a shared party quest once even when several members qualify", async () => {
    const result = await process({ definition: quest("party") });
    expect(result.partyChanged).toBe(true);
    expect(result.partyState.quests?.["0001"]?.objectives).toEqual({ "0001": 1 });
    expect(result.changes).toEqual([
      {
        scope: "party",
        questId: "0001",
        objectiveIds: ["0001"],
        status: "active",
      },
    ]);
    expect(result.personalUpdates).toEqual([]);
  });

  it("credits only meaningful contributors for personal quests", async () => {
    const stored: Record<string, Record<string, AuthoredQuestProgress>> = {};
    const result = await process({ definition: quest("personal"), personal: stored });
    expect(result.partyChanged).toBe(false);
    expect(result.personalUpdates.map((update) => update.actor.heroId)).toEqual(["alice", "bob"]);
    expect(stored.alice?.["0001"]?.objectives).toEqual({ "0001": 1 });
    expect(stored.bob?.["0001"]?.objectives).toEqual({ "0001": 1 });
    expect(stored.clara).toBeUndefined();
  });

  it("does not start a manually accepted quest from a matching gameplay event", async () => {
    const result = await process({
      definition: quest("party", { acceptance: "manual" }),
    });
    expect(result.partyChanged).toBe(false);
    expect(result.changes).toEqual([]);
  });

  it("keeps an accepted definition pinned when the current target is edited", async () => {
    const accepted = quest("party");
    const acceptedObjective = accepted.objectives[0];
    if (acceptedObjective?.type !== "kill") throw new Error("missing kill objective fixture");
    const edited = quest("party", {
      version: 2,
      objectives: [
        {
          ...acceptedObjective,
          species: "torch_goblin",
        },
      ],
    });
    const progress = createAuthoredQuestProgress(accepted);
    const result = await process({
      definition: edited,
      partyState: { ...EMPTY_ADVENTURE_STATE, quests: { "0001": progress } },
    });
    expect(result.partyState.quests?.["0001"]?.definitionVersion).toBe(1);
    expect(result.partyState.quests?.["0001"]?.objectives).toEqual({ "0001": 1 });
  });

  it("does not publish personal progress when the epoch-fenced save refuses it", async () => {
    const save = vi.fn(async () => false);
    const result = await process({ definition: quest("personal"), save });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.personalUpdates).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it("deduplicates a replay after reconnect from the persisted progress", async () => {
    const definition = quest("personal");
    const stored: Record<string, Record<string, AuthoredQuestProgress>> = {};
    await process({ definition, personal: stored, event: killEvent("stable-kill") });
    const replay = await process({ definition, personal: stored, event: killEvent("stable-kill") });
    expect(stored.alice?.["0001"]?.objectives).toEqual({ "0001": 1 });
    expect(stored.bob?.["0001"]?.objectives).toEqual({ "0001": 1 });
    expect(replay.changes).toEqual([]);
  });
});
