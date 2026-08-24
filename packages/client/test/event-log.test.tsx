import { setLocale } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { EventLog } from "@lindocara/client/ui/EventLog.js";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("EventLog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setLocale("en");
    useUiStore.setState({ events: [], selfState: null });
  });

  it("renders newest first with tone markers and expires lines after 6s", () => {
    render(<EventLog />);
    act(() => {
      useUiStore.getState().addEvent("first", "good");
      useUiStore.getState().addEvent("second", "bad");
    });
    const lines = screen.getAllByText(/first|second/);
    expect(lines[0]).toHaveTextContent("! second");
    expect(lines[1]).toHaveTextContent("+ first");
    expect(lines[0]).toHaveAttribute("data-text-surface", "information");
    expect(lines[0]).toHaveAttribute("data-text-tone", "bad");
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(screen.queryByText(/first/)).not.toBeInTheDocument();
  });

  it("keeps authoritative bonuses and penalties visible with a live countdown", () => {
    useUiStore.setState({
      selfState: {
        xp: 0,
        xpToNext: 100,
        inventory: { potions: 0, gold: 0, crystals: 0 },
        quest: { status: "available", progress: 0, target: 3 },
        life: "alive",
        corpse: null,
        serverNow: 1_000,
        displacement: { seq: 0, x: 0, y: 0, z: 0 },
        movementEffects: [
          { kind: "speed_boost", power: 1.35, until: 4_500 },
          { kind: "inverted_controls", power: 1, until: 3_000 },
        ],
      },
    });

    render(<EventLog />);

    expect(screen.getByText("Bonus active: Speed boost — 3.5s")).toBeInTheDocument();
    expect(screen.getByText("Penalty active: Inverted controls — 2.0s")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(screen.getByText("Bonus active: Speed boost — 2.4s")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(screen.queryByText(/Bonus active/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Penalty active/)).not.toBeInTheDocument();
  });
});
