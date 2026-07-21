import { MONSTER_SPAWNS } from "@lindocara/engine/game.js";
import { dictionaries, format } from "@lindocara/engine/i18n/index.js";
import { EVENT_CODES } from "@lindocara/engine/protocol.js";
import { describe, expect, it } from "vitest";

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

  it("keeps visual healer colour out of localized combat prose", () => {
    for (const locale of ["en", "fr"] as const) {
      expect(dictionaries[locale]["event.heal.cast"]).not.toContain("{color}");
      expect(dictionaries[locale]["event.heal.received"]).not.toContain("{color}");
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

  it("has class names and blurbs in both languages", () => {
    for (const key of [
      "class.warrior",
      "class.ranger",
      "class.priest",
      "class.warrior.blurb",
      "class.ranger.blurb",
      "class.priest.blurb",
      "chars.create.class",
      "hud.heal",
    ]) {
      for (const locale of ["en", "fr"] as const) {
        expect(
          (dictionaries[locale] as Record<string, string>)[key],
          `${locale}:${key}`,
        ).toBeTypeOf("string");
      }
    }
  });
});
