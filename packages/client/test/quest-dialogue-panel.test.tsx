import { setLocale } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { QuestDialoguePanel } from "@lindocara/client/ui/hud/QuestDialoguePanel.js";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
            speakerName: "Warden Mira",
            title: "Mira's request",
            text: "Will you help?",
            category: "side",
            region: "Old road",
            landmark: "Eastern gate",
            giverName: "Warden Mira",
            phase: "offer",
            canAccept: true,
            canTurnIn: false,
            rewardChoices: [],
          },
        ],
      },
    });
    render(<QuestDialoguePanel />);
    expect(screen.getByText("Warden Mira")).toBeInTheDocument();
    expect(screen.getByText("Mira's request")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-text-surface", "dialogue");
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
            speakerName: "Village Captain",
            title: "Road secured",
            text: "Choose your reward.",
            category: "side",
            region: "Old road",
            landmark: "Eastern gate",
            giverName: "Village Captain",
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

  it("ignores the held opening A press, then navigates with the D-pad and confirms with A", () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const buttons = Array.from({ length: 16 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    const gamepad = {
      axes: [0, 0],
      buttons,
      connected: true,
      id: "Test Xbox controller",
    } as unknown as Gamepad;
    const originalGetGamepads = navigator.getGamepads;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad],
    });
    const setButton = (index: number, pressed: boolean) => {
      const button = buttons[index];
      if (!button) throw new Error(`Missing test gamepad button ${index}`);
      button.pressed = pressed;
      button.touched = pressed;
      button.value = Number(pressed);
    };
    const poll = () => {
      const callback = frames.shift();
      if (!callback) throw new Error("Missing gamepad polling frame");
      act(() => callback(0));
    };

    setButton(0, true);
    useUiStore.setState({
      questDialogue: {
        kind: "open",
        conversationId: "conversation-pad",
        entries: [
          {
            questId: "pad-quest",
            speakerName: "Warden Mira",
            title: "Controller quest",
            text: "Will you help?",
            category: "side",
            region: "Old road",
            landmark: "Eastern gate",
            giverName: "Warden Mira",
            phase: "offer",
            canAccept: true,
            canTurnIn: false,
            rewardChoices: [],
          },
        ],
      },
    });
    const { unmount } = render(<QuestDialoguePanel />);

    try {
      expect(screen.getByRole("button", { name: "Decline" }).parentElement).toHaveFocus();
      poll();
      expect(questAction).not.toHaveBeenCalled();

      setButton(0, false);
      poll();
      setButton(13, true);
      poll();
      expect(screen.getByRole("button", { name: "Accept" }).parentElement).toHaveFocus();
      setButton(13, false);
      poll();
      setButton(0, true);
      poll();

      expect(questAction).toHaveBeenCalledWith(
        "conversation-pad",
        "accept",
        "pad-quest",
        undefined,
      );
    } finally {
      unmount();
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: originalGetGamepads,
      });
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    }
  });
});
