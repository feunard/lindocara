import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/ui/pixelact-ui/button/index.js";

describe("pixelact button", () => {
  it("renders with the garrison frame class", () => {
    render(<Button>Press Start</Button>);
    const button = screen.getByRole("button", { name: "Press Start" });
    expect(button.className).toContain("btn-frame");
  });
});
