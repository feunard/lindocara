import { setLocale } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { QuestDialoguePanel } from "@lindocara/client/ui/hud/QuestDialoguePanel.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const questAction = vi.fn();

beforeEach(() => {
  setLocale("en");
  questAction.mockClear();
  useUiStore.setState({
    questDialogue: null,
    game: { questAction } as unknown as ReturnType<typeof useUiStore.getState>["game"],
  });
});

afterEach(() => useUiStore.setState({ questDialogue: null, game: null }));

describe("QuestDialoguePanel", () => {
  it("renders friendly quest names and emits accept without exposing ids", () => {
    useUiStore.setState({
      questDialogue: {
        kind: "open",
        conversationId: "conversation-1",
        entries: [
          {
            questId: "0001",
            title: "Mira's request",
            text: "Will you help?",
            phase: "offer",
            canAccept: true,
            canTurnIn: false,
            rewardChoices: [],
          },
        ],
      },
    });
    render(<QuestDialoguePanel />);
    expect(screen.getByText("Mira's request")).toBeInTheDocument();
    expect(screen.queryByText("0001")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(questAction).toHaveBeenCalledWith("conversation-1", "accept", "0001", undefined);
  });

  it("requires a named reward choice before turn-in", () => {
    useUiStore.setState({
      questDialogue: {
        kind: "open",
        conversationId: "conversation-2",
        entries: [
          {
            questId: "0002",
            title: "Road secured",
            text: "Choose your reward.",
            phase: "ready",
            canAccept: false,
            canTurnIn: true,
            rewardChoices: [{ id: "0007", label: "Healing potion" }],
          },
        ],
      },
    });
    render(<QuestDialoguePanel />);
    const turnIn = screen.getByRole("button", { name: "Turn in quest" });
    expect(turnIn).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Healing potion" }));
    expect(turnIn).toBeEnabled();
    fireEvent.click(turnIn);
    expect(questAction).toHaveBeenCalledWith("conversation-2", "turn-in", "0002", "0007");
  });
});
