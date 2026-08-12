import { TinyButton } from "@lindocara/client/ui/tiny-swords/TinyButton.js";
import { TinyPanel } from "@lindocara/client/ui/tiny-swords/TinyPanel.js";
import { TinyRange } from "@lindocara/client/ui/tiny-swords/TinyRange.js";
import { applyTinySwordsTheme } from "@lindocara/renderer/tiny-swords-assets.js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("Tiny Swords UI foundation", () => {
  it("keeps authored button states, keyboard activation, focus and disabled behavior", async () => {
    const action = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <TinyButton onClick={action}>Continue</TinyButton>
        <TinyButton disabled onClick={action}>
          Locked
        </TinyButton>
      </>,
    );
    const enabled = screen.getByRole("button", { name: "Continue" });
    expect(enabled).toHaveAttribute("data-tiny-normal");
    expect(enabled).toHaveAttribute("data-tiny-hover");
    expect(enabled).toHaveAttribute("data-tiny-pressed");
    expect(enabled).toHaveAttribute("data-tiny-disabled");
    await user.tab();
    expect(enabled).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(action).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Locked" }));
    expect(action).toHaveBeenCalledOnce();
  });

  it("publishes cursor fallbacks and gives panels the readable information surface", () => {
    const root = document.createElement("div");
    applyTinySwordsTheme(root);
    expect(root.style.getPropertyValue("--tiny-cursor-default")).toBe(
      'image-set(url("/assets/lindocara/tiny-swords/ui/cursor.png") 2x) 22 17, default',
    );
    expect(root.style.getPropertyValue("--tiny-cursor-link")).toBe(
      'image-set(url("/assets/lindocara/tiny-swords/ui/cursor-hand.png") 2x) 23 17, pointer',
    );
    expect(root.style.getPropertyValue("--tiny-cursor-interact")).toMatch(/, pointer$/);
    expect(root.style.getPropertyValue("--tiny-cursor-move")).toMatch(/, grab$/);
    expect(root.style.getPropertyValue("--tiny-cursor-unavailable")).toMatch(/, not-allowed$/);
    render(<TinyPanel data-testid="panel" />);
    expect(screen.getByTestId("panel")).toHaveAttribute("data-text-surface", "information");
    expect(root.style.getPropertyValue("--tiny-panel-carved")).toBe("");
  });

  it("assembles range tracks from the authored left, middle and right bar cells", () => {
    render(<TinyRange aria-label="Volume" />);
    const slider = screen.getByRole("slider", { name: "Volume" });
    expect(slider).toHaveClass("tiny-range");
    expect(slider.parentElement?.querySelector("[data-tiny-bar-track]")?.children).toHaveLength(3);
  });
});
