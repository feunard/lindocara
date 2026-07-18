import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Bar } from "../../src/client/ui/hud/Bar.js";

describe("Bar", () => {
  it("exposes progressbar semantics and proportional fill", () => {
    render(<Bar value={30} max={120} variant="hp" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    expect(bar).toHaveAttribute("aria-valuemax", "120");
    expect(bar.querySelector("[data-tiny-bar-track]")?.children).toHaveLength(3);
    const fill = bar.querySelector("[data-fill]");
    expect(fill).toHaveStyle({ width: "25%" });
  });

  it("clamps overflow", () => {
    render(<Bar value={500} max={100} variant="xp" />);
    const fill = screen.getByRole("progressbar").querySelector("[data-fill]");
    expect(fill).toHaveStyle({ width: "100%" });
  });
});
