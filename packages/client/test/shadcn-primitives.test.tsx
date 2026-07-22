import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/ui/components/button";

describe("stock shadcn primitives", () => {
  it("renders a Base UI button that carries no Tiny Swords skin", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button).not.toHaveClass("tiny-button");
    expect(button).not.toHaveAttribute("data-tiny-normal");
  });
});
