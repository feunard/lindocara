import { setLocale } from "@lindocara/client/i18n.js";
import {
  questObjectiveProgressText,
  questTrackerNotifications,
} from "@lindocara/client/quest-presentation.js";
import type { AuthoredQuestTracker } from "@lindocara/engine/adventure-state.js";
import { beforeEach, describe, expect, it } from "vitest";

function tracker(
  progress: number,
  status: AuthoredQuestTracker["status"] = "active",
): AuthoredQuestTracker {
  return {
    id: "0001",
    title: "Goblin watch",
    description: "Protect the road.",
    journalSummary: "Clear the road.",
    recommendedLevel: 2,
    scope: "party",
    repeatable: false,
    abandonable: true,
    completion: "turn-in",
    objectiveMode: "simultaneous",
    status,
    objectives: [
      {
        id: "0001",
        label: "",
        progress,
        target: 10,
        rule: {
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
      },
    ],
    rewards: { experience: 100, gold: 20, items: [], choices: [] },
  };
}

describe("authored quest presentation", () => {
  beforeEach(() => setLocale("en"));

  it("generates a readable localized label from the structured rule", () => {
    const objective = tracker(4).objectives[0];
    if (!objective) throw new Error("missing tracked objective");
    expect(questObjectiveProgressText(objective)).toBe("Kill Spear Goblin: 4 / 10");
  });

  it("emits notices only for authoritative changes, including readiness", () => {
    expect(questTrackerNotifications([tracker(4)], [tracker(5)])).toEqual([
      { text: "Kill Spear Goblin: 5 / 10", tone: "good" },
    ]);
    expect(questTrackerNotifications([tracker(9)], [tracker(10, "ready")])).toEqual([
      { text: "Objective complete: Kill Spear Goblin", tone: "good" },
      { text: "Quest ready to turn in: Goblin watch", tone: "good" },
    ]);
    expect(questTrackerNotifications([tracker(10, "ready")], [tracker(10, "ready")])).toEqual([]);
  });

  it("does not replay persisted quest notices on the first snapshot", () => {
    expect(questTrackerNotifications(undefined, [tracker(4)])).toEqual([]);
  });
});
