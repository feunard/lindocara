import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { ColorPicker } from "../../src/client/ui/ColorPicker.js";

describe("ColorPicker", () => {
  it("picks a free colour and disables a taken one", async () => {
    setLocale("en");
    const onPick = vi.fn();
    render(<ColorPicker value={null} taken={["blue"]} onPick={onPick} />);

    expect(screen.getByRole("button", { name: "Blue" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Red" }));
    expect(onPick).toHaveBeenCalledWith("red");
  });

  it("marks the current selection pressed", () => {
    setLocale("en");
    render(<ColorPicker value="yellow" taken={[]} onPick={() => undefined} />);
    expect(screen.getByRole("button", { name: "Yellow" })).toHaveAttribute("aria-pressed", "true");
  });
});
