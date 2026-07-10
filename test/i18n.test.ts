import { describe, expect, it } from "vitest";
import { dictionaries, format } from "../src/shared/i18n/index.js";

describe("i18n", () => {
  it("interpolates {tokens} and leaves unknown tokens visible", () => {
    expect(format("You hit {name} for {damage}.", { name: "Gloamcap", damage: 12 })).toBe(
      "You hit Gloamcap for 12.",
    );
    expect(format("Missing {token} stays", {})).toBe("Missing {token} stays");
    expect(format("No params")).toBe("No params");
  });

  it("keeps en and fr key parity", () => {
    // Compile-time enforced too (fr is Record<MessageKey, string>); this guards the build output.
    expect(Object.keys(dictionaries.fr).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });

  it("has no empty translations", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const [key, value] of Object.entries(dictionaries[locale])) {
        expect(value, `${locale}:${key}`).not.toBe("");
      }
    }
  });
});
