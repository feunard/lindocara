import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/ui/pixelact-ui/button/index.js";

describe("pixelact button", () => {
  it("renders with the Tiny Swords frame and four authored states", () => {
    render(<Button>Press Start</Button>);
    const button = screen.getByRole("button", { name: "Press Start" });
    expect(button).toHaveClass("tiny-button");
    expect(button).toHaveAttribute("data-tiny-normal");
    expect(button).toHaveAttribute("data-tiny-hover");
    expect(button).toHaveAttribute("data-tiny-pressed");
    expect(button).toHaveAttribute("data-tiny-disabled");
  });
});
