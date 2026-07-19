import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { ConnectionOverlay } from "../../src/client/ui/ConnectionOverlay.js";

describe("ConnectionOverlay", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ reconnect: null, heroLoading: null });
  });

  it("turns the initial hero connection into a phased Tiny Swords loading scene", () => {
    useUiStore.setState({
      heroLoading: {
        name: "Mira",
        class: "priest",
        color: "violet",
        phase: "world",
        progress: 68,
      },
    });

    const view = render(<ConnectionOverlay />);

    expect(screen.getByRole("status")).toHaveTextContent("Mira joins the adventure");
    expect(screen.getByRole("status")).toHaveTextContent("Deploying the world");
    expect(screen.getByRole("progressbar", { name: "Loading progress" })).toHaveAttribute(
      "aria-valuenow",
      "68",
    );
    expect(view.container.querySelector(".menu-scene--courtyard")).not.toBeNull();
    expect(view.container.querySelectorAll(".hero-loading__actor")).toHaveLength(5);
  });

  it("distinguishes network reconnection from a zone transition", async () => {
    const cancelReconnect = vi.fn();
    useUiStore.setState({ reconnect: { kind: "network", attempt: 2, cancelReconnect } });
    const view = render(<ConnectionOverlay />);
    expect(screen.getByText("Reconnecting")).toBeInTheDocument();
    expect(screen.getByText(/2\/4/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Return to characters" }));
    expect(cancelReconnect).toHaveBeenCalledOnce();

    useUiStore.setState({ reconnect: { kind: "transition", attempt: 0, cancelReconnect } });
    view.rerender(<ConnectionOverlay />);
    expect(screen.getByText("Crossing the threshold")).toBeInTheDocument();
  });
});
