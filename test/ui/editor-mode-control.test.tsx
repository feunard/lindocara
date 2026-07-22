import { EditorModeControl } from "@lindocara/editor/ui/editor/EditorModeControl.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// This repo's generated `toggle-group` wraps Base UI, not Radix: it renders each segment as a
// plain <button> with `aria-pressed`, never `role="radio"` — confirmed by reading
// `src/client/ui/components/toggle-group.tsx` / `toggle.tsx` (Task 10 brief step 5).
describe("EditorModeControl", () => {
  it("marks the active mode pressed", () => {
    render(<EditorModeControl mode="element" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /scenery|décors/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /field|terrain/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reports a selection", () => {
    const onSelect = vi.fn();
    render(<EditorModeControl mode="field" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /event|événement/i }));
    expect(onSelect).toHaveBeenCalledWith("event");
  });

  it("never reports a deselection", () => {
    // A segmented control has no empty state: clicking the active segment is a no-op. Base UI's
    // single-select ToggleGroup fires onValueChange([]) here (no built-in guard like Radix), so
    // the control itself must swallow it.
    const onSelect = vi.fn();
    render(<EditorModeControl mode="field" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /field|terrain/i }));
    expect(onSelect).not.toHaveBeenCalledWith(undefined);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
