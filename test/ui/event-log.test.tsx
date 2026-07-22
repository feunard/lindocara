import { useUiStore } from "@lindocara/client/store.js";
import { EventLog } from "@lindocara/client/ui/EventLog.js";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("EventLog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUiStore.setState({ events: [] });
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
    act(() => vi.advanceTimersByTime(6_100));
    expect(screen.queryByText(/first/)).not.toBeInTheDocument();
  });
});
