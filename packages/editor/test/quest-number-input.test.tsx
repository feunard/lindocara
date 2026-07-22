import { QuestNumberInput } from "@lindocara/editor/ui/editor/QuestNumberInput.js";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

describe("QuestNumberInput", () => {
  it("supports the common clear-then-type gesture without prefixing the old minimum", async () => {
    function Harness() {
      const [value, setValue] = useState(1);
      return (
        <QuestNumberInput
          aria-label="Target"
          min={1}
          max={9999}
          value={value}
          onValueChange={(next) => setValue(next ?? 1)}
        />
      );
    }

    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("spinbutton", { name: "Target" });
    await user.clear(input);
    await user.type(input, "10");
    expect(input).toHaveValue(10);
  });
});
