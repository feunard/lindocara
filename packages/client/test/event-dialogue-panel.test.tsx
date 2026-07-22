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
  eventAdvance.mockClear();
  eventChoose.mockClear();
  stubGame();
});

afterEach(() => {
  useUiStore.setState({ eventDialogue: null });
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

    fireEvent.click(screen.getByRole("button"));
    expect(eventAdvance).toHaveBeenCalledWith("run-1");

    fireEvent.keyDown(window, { code: "Space" });
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
