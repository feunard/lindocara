import { EditorModeControl } from "@lindocara/editor/ui/editor/EditorModeControl.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `Segmented` (@alepha/ui) reports itself as a `radiogroup` of `radio`s with `aria-checked` — the
// correct semantic for a one-of-N control. The hand-styled `ToggleGroup` it replaced rendered
// plain buttons carrying `aria-pressed`, which is why the old assertions read that way.
describe("EditorModeControl", () => {
  it("marks the active mode checked", () => {
    render(<EditorModeControl mode="element" onSelect={() => {}} />);
    expect(screen.getByRole("radio", { name: /scenery|décors/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /field|terrain/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("reports a selection", () => {
    const onSelect = vi.fn();
    render(<EditorModeControl mode="field" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("radio", { name: /event|événement/i }));
    expect(onSelect).toHaveBeenCalledWith("event");
  });

  it("has no empty state: re-clicking the active mode re-reports it, never nothing", () => {
    // The old control could be told to deselect — Base UI's single-select ToggleGroup fired
    // `onValueChange([])` on the active segment, and it had to swallow that itself. `Segmented`
    // always reports a concrete value, so the failure mode is gone rather than guarded. Clicking
    // the active segment is a harmless restatement of the current mode.
    const onSelect = vi.fn();
    render(<EditorModeControl mode="field" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("radio", { name: /field|terrain/i }));
    for (const [reported] of onSelect.mock.calls) expect(reported).toBe("field");
  });
});
