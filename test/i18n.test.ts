import { describe, expect, it } from "vitest";
import { MONSTER_SPAWNS } from "../src/shared/game.js";
import { dictionaries, format } from "../src/shared/i18n/index.js";
import { EVENT_CODES } from "../src/shared/protocol.js";

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

  it("has a template for every event code in both languages", () => {
    for (const code of EVENT_CODES) {
      for (const locale of ["en", "fr"] as const) {
        const table = dictionaries[locale] as Record<string, string>;
        expect(table[`event.${code}`], `${locale}:event.${code}`).toBeTypeOf("string");
      }
    }
  });

  it("has a monster name for every spawn and a label for every loot kind", () => {
    // Closes the hole where a new species/kind compiles green but renders "undefined" —
    // MONSTER_SPAWNS and the loot kinds are the source of truth, not the dictionaries.
    for (const spawn of MONSTER_SPAWNS) {
      for (const locale of ["en", "fr"] as const) {
        const table = dictionaries[locale] as Record<string, string>;
        expect(table[`monster.${spawn.species}`], `${locale}:monster.${spawn.species}`).toBeTypeOf(
          "string",
        );
      }
    }
    for (const kind of ["potion", "gold", "crystal"] as const) {
      for (const locale of ["en", "fr"] as const) {
        const table = dictionaries[locale] as Record<string, string>;
        expect(table[`item.${kind}`], `${locale}:item.${kind}`).toBeTypeOf("string");
      }
    }
  });
});
