/**
 * The dialogue panel (tranche 5, Task 4) — a Tiny-tree GAME UI surface driven entirely by the store.
 * It renders the authored say text / choice labels VERBATIM (the sanctioned prose exception) and
 * emits `eventAdvance`/`eventChoose` through the game handle; `event.close` (store → null) hides it.
 * The keyboard affordances (Space advances a say, 1-4 pick a choice) are covered here, including the
 * guard that a stray number key never emits a choose when no choices offer is pending (mutation proof).
 */

import { setLocale } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { EventDialoguePanel } from "@lindocara/client/ui/hud/EventDialoguePanel.js";
import {
  resetInputBindings,
  setGamepadBinding,
  setInputMode,
} from "@lindocara/renderer/input-settings.js";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const eventAdvance = vi.fn();
const eventChoose = vi.fn();

function stubGame() {
  // Only the two dialogue methods matter here; the rest of the handle is unused by the panel.
  useUiStore.setState({
    game: { eventAdvance, eventChoose } as unknown as ReturnType<
      typeof useUiStore.getState
    >["game"],
  });
}

beforeEach(() => {
  setLocale("en");
  resetInputBindings();
  setInputMode("keyboard");
  eventAdvance.mockClear();
  eventChoose.mockClear();
  stubGame();
});

afterEach(() => {
  useUiStore.setState({ eventDialogue: null });
  resetInputBindings();
  setInputMode("keyboard");
});

describe("EventDialoguePanel", () => {
  it("renders nothing when there is no open dialogue", () => {
    useUiStore.setState({ eventDialogue: null });
    const { container } = render(<EventDialoguePanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a say beat's authored prose and advances on click and Space", () => {
    useUiStore.setState({
      eventDialogue: { kind: "say", runId: "run-1", text: "Hail, traveller.", name: "Keeper" },
    });
    render(<EventDialoguePanel />);
    expect(screen.getByText("Hail, traveller.")).toBeInTheDocument();
    expect(screen.getByText("Keeper")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-text-surface", "dialogue");

    fireEvent.click(screen.getByRole("button"));
    expect(eventAdvance).toHaveBeenCalledWith("run-1");

    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(eventAdvance).toHaveBeenCalledTimes(2);
  });

  it("renders choices and emits choose on click and on the number keys", () => {
    useUiStore.setState({
      eventDialogue: {
        kind: "choices",
        runId: "run-2",
        prompt: "Open the door?",
        options: ["Open", "Leave"],
      },
    });
    render(<EventDialoguePanel />);
    expect(screen.getByText("Open the door?")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Leave"));
    expect(eventChoose).toHaveBeenCalledWith("run-2", 1);

    fireEvent.keyDown(window, { code: "Digit1" });
    expect(eventChoose).toHaveBeenCalledWith("run-2", 0);
    // A number key beyond the offered options is ignored.
    fireEvent.keyDown(window, { code: "Digit3" });
    expect(eventChoose).toHaveBeenCalledTimes(2);
  });

  it("uses the direction keys to navigate choices before confirming", () => {
    useUiStore.setState({
      eventDialogue: {
        kind: "choices",
        runId: "run-arrows",
        prompt: "Enter the maze?",
        options: ["Yes", "No"],
      },
    });
    render(<EventDialoguePanel />);

    expect(screen.getByRole("button", { name: /1 Yes/ }).parentElement).toHaveFocus();
    fireEvent.keyDown(window, { key: "ArrowDown", code: "ArrowDown" });
    expect(screen.getByRole("button", { name: /2 No/ }).parentElement).toHaveFocus();
    fireEvent.keyDown(window, { key: "Enter", code: "Enter" });

    expect(eventChoose).toHaveBeenCalledWith("run-arrows", 1);
  });

  it("uses the D-pad or left stick and the remapped gamepad confirm button", () => {
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
    const axes = [0, 0];
    const gamepad = {
      axes,
      buttons,
      connected: true,
      id: "Test Xbox controller",
    } as unknown as Gamepad;
    const originalGetGamepads = navigator.getGamepads;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [gamepad],
    });
    setGamepadBinding("interact", { kind: "button", index: 2 });
    useUiStore.setState({
      eventDialogue: {
        kind: "choices",
        runId: "run-gamepad",
        prompt: "Choose a path.",
        options: ["Forest", "Cave"],
      },
    });
    const { unmount } = render(<EventDialoguePanel />);
    const poll = () => {
      const callback = frames.shift();
      if (!callback) throw new Error("Missing gamepad polling frame");
      act(() => callback(0));
    };
    const setButton = (index: number, pressed: boolean) => {
      const button = buttons[index];
      if (!button) throw new Error(`Missing test gamepad button ${index}`);
      button.pressed = pressed;
      button.touched = pressed;
      button.value = Number(pressed);
    };

    try {
      expect(screen.getByRole("button", { name: /1 Forest/ }).parentElement).toHaveFocus();

      // The first neutral sample arms the newly mounted menu.
      poll();
      axes[1] = 1;
      poll();
      expect(screen.getByRole("button", { name: /2 Cave/ }).parentElement).toHaveFocus();
      expect(screen.getByText("X", { selector: "kbd" })).toBeInTheDocument();

      axes[1] = 0;
      poll();
      setButton(12, true);
      poll();
      expect(screen.getByRole("button", { name: /1 Forest/ }).parentElement).toHaveFocus();

      setButton(12, false);
      poll();
      setButton(13, true);
      poll();
      expect(screen.getByRole("button", { name: /2 Cave/ }).parentElement).toHaveFocus();

      setButton(13, false);
      poll();
      setButton(2, true);
      poll();
      expect(eventChoose).toHaveBeenCalledWith("run-gamepad", 1);
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

  it("waits for the opening A press to be released before advancing dialogue", () => {
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
    const setA = (pressed: boolean) => {
      const button = buttons[0];
      if (!button) throw new Error("Missing Xbox A button");
      button.pressed = pressed;
      button.touched = pressed;
      button.value = Number(pressed);
    };
    const poll = () => {
      const callback = frames.shift();
      if (!callback) throw new Error("Missing gamepad polling frame");
      act(() => callback(0));
    };

    setA(true);
    useUiStore.setState({
      eventDialogue: { kind: "say", runId: "run-held-a", text: "Still here." },
    });
    const { unmount } = render(<EventDialoguePanel />);

    try {
      poll();
      expect(eventAdvance).not.toHaveBeenCalled();
      setA(false);
      poll();
      setA(true);
      poll();
      expect(eventAdvance).toHaveBeenCalledWith("run-held-a");
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

  // MUTATION PROOF (c): the panel must never emit a choose with no pending choices offer. On a SAY
  // page, a number key reaches `chooseOption`, whose `kind !== "choices"` guard drops it. Remove that
  // guard and this fires `eventChoose` on a say page — this assertion then fails.
  it("does not emit choose on a number key while showing a say page", () => {
    useUiStore.setState({
      eventDialogue: { kind: "say", runId: "run-3", text: "Just talking." },
    });
    render(<EventDialoguePanel />);
    fireEvent.keyDown(window, { code: "Digit1" });
    fireEvent.keyDown(window, { code: "Digit2" });
    expect(eventChoose).not.toHaveBeenCalled();
  });

  it("hides once the store dialogue is cleared (the server's event.close)", () => {
    useUiStore.setState({
      eventDialogue: { kind: "say", runId: "run-4", text: "Bye." },
    });
    const { container } = render(<EventDialoguePanel />);
    expect(screen.getByText("Bye.")).toBeInTheDocument();
    // The server's event.close clears the store; wrap in act so React flushes the unmount.
    act(() => useUiStore.setState({ eventDialogue: null }));
    expect(container).toBeEmptyDOMElement();
  });
});
