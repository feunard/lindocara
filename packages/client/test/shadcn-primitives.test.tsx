import { Button } from "@lindocara/ui/components/button.js";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("stock shadcn primitives", () => {
  it("renders a Base UI button that carries no Tiny Swords skin", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button).not.toHaveClass("tiny-button");
    expect(button).not.toHaveAttribute("data-tiny-normal");
  });
});
