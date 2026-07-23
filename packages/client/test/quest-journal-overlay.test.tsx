import { setLocale } from "@lindocara/client/i18n.js";
import { type GameHandle, useUiStore } from "@lindocara/client/store.js";
import { QuestJournalOverlay } from "@lindocara/client/ui/QuestJournalOverlay.js";
import type { AuthoredQuestTracker } from "@lindocara/engine/adventure-state.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

function activeQuest(): AuthoredQuestTracker {
  return {
    id: "0001",
    title: "Goblin watch",
    description: "Keep the eastern road open for travellers.",
    journalSummary: "Defeat the spear goblins.",
    recommendedLevel: 2,
    scope: "party",
    repeatable: false,
    abandonable: true,
    completion: "turn-in",
    objectiveMode: "simultaneous",
    status: "active",
    objectives: [
      {
        id: "0001",
        label: "",
        progress: 4,
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
          credit: "nearby-party",
        },
      },
    ],
    rewards: {
      experience: 100,
      gold: 25,
      items: [{ itemId: "health_potion", quantity: 2 }],
      choices: [],
    },
  };
}

function game(abandonQuest: (questId: string) => void): GameHandle {
  return {
    attack: vi.fn(),
    interact: vi.fn(),
    usePotion: vi.fn(),
    release: vi.fn(),
    castSkill: vi.fn(),
    sendChat: vi.fn(),
    abandonQuest,
    switchCharacter: vi.fn(),
    logout: vi.fn(),
    attachMinimap: vi.fn(),
    attachWorldMap: vi.fn(),
  };
}

describe("QuestJournalOverlay", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({
      questJournalOpen: true,
      questTracking: {},
      selfState: {
        xp: 0,
        xpToNext: 100,
        inventory: { potions: 0, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
        life: "alive",
        corpse: null,
        authoredQuests: [activeQuest()],
      },
    });
  });

  it("keeps the pre-welcome empty snapshot stable", () => {
    useUiStore.setState({ selfState: null });
    render(<QuestJournalOverlay />);

    expect(screen.getByRole("dialog", { name: "Quest journal" })).toBeInTheDocument();
    expect(screen.getAllByText("No quests in this section.").length).toBeGreaterThan(0);
  });

  it("shows readable objectives and reward previews without technical ids", () => {
    render(<QuestJournalOverlay />);

    expect(screen.getByRole("dialog", { name: "Quest journal" })).toBeInTheDocument();
    expect(screen.getAllByText("Goblin watch").length).toBeGreaterThan(0);
    expect(screen.getByText("Kill Spear Goblin: 4 / 10")).toBeInTheDocument();
    expect(screen.getByText("+100 XP")).toBeInTheDocument();
    expect(screen.getByText("2 × Heartroot tonic")).toBeInTheDocument();
    expect(screen.queryByText("0001")).not.toBeInTheDocument();
  });

  it("lets the player untrack and explicitly confirm abandonment", () => {
    const abandonQuest = vi.fn();
    useUiStore.setState({ game: game(abandonQuest) });
    render(<QuestJournalOverlay />);

    fireEvent.click(screen.getByRole("button", { name: "Stop tracking" }));
    expect(useUiStore.getState().questTracking["0001"]).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Abandon quest" }));
    expect(
      screen.getByText("This shared quest will be abandoned for the whole party."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Confirm abandonment" }));
    expect(abandonQuest).toHaveBeenCalledWith("0001");
  });
});
