import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { currentLocale, setLocale } from "../../src/client/i18n.js";
import { LocaleToggle } from "../../src/client/ui/LocaleToggle.js";

describe("LocaleToggle", () => {
  it("marks the current locale active and switches on click", async () => {
    setLocale("en");
    render(<LocaleToggle />);
    expect(screen.getByRole("button", { name: "EN" })).toHaveClass("locale-chip--active");

    await userEvent.click(screen.getByRole("button", { name: "FR" }));
    expect(currentLocale()).toBe("fr");
    expect(screen.getByRole("button", { name: "FR" })).toHaveClass("locale-chip--active");
    expect(document.documentElement.lang).toBe("fr");
  });
});
