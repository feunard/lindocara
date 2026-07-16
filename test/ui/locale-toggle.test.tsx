import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { currentLocale, setLocale, t } from "../../src/client/i18n.js";
import { LocaleToggle } from "../../src/client/ui/LocaleToggle.js";
import type { MessageKey } from "../../src/shared/i18n/index.js";

describe("t", () => {
  it("prints an unknown key verbatim, so a D1 map's raw name renders as itself", () => {
    setLocale("en");
    // A map name the server sends as `zoneNameKey` — not an i18n key. It must render as the name, not
    // "undefined".
    expect(t("Frostfen Hollow" as MessageKey)).toBe("Frostfen Hollow");
  });
});

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
