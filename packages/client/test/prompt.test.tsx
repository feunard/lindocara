import { setLocale } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { Prompt } from "@lindocara/client/ui/Prompt.js";
import { resetInputBindings, setInputMode } from "@lindocara/renderer/input-settings.js";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

describe("Prompt", () => {
  beforeEach(() => {
    setLocale("en");
    resetInputBindings();
    setInputMode("keyboard");
    useUiStore.setState({
      prompt: null,
      interiorDoorId: null,
    });
  });

  it("renders prompt text when prompt is set and interior is closed", () => {
    useUiStore.setState({
      prompt: { key: "prompt.hunt" },
    });
    render(<Prompt />);
    expect(screen.getByText(/quest trail/)).toBeInTheDocument();
  });

  it("shows the active controller interaction button", () => {
    setInputMode("gamepad");
    useUiStore.setState({ prompt: { key: "prompt.merchant" } });

    render(<Prompt />);

    expect(screen.getByText("[A] Trade with Bramble")).toBeInTheDocument();
  });

  it("renders nothing when prompt is null", () => {
    useUiStore.setState({
      prompt: null,
    });
    const { container } = render(<Prompt />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when interior door is open, even if prompt is set", () => {
    useUiStore.setState({
      prompt: { key: "prompt.hunt" },
      interiorDoorId: "crossing-hall",
    });
    const { container } = render(<Prompt />);
    expect(container.firstChild).toBeNull();
  });
});
