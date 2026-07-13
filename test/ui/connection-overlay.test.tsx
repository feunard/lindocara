import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { ConnectionOverlay } from "../../src/client/ui/ConnectionOverlay.js";

describe("ConnectionOverlay", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ reconnect: null });
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
