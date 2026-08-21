/**
 * The authored cue catalogue, and the one thing that can rot about it: a src pointing at a file
 * nobody ships. The ids are a contract with stored maps, so this suite guards both ends - an id
 * cannot silently disappear, and a src cannot silently become a 404.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEventCommands } from "@lindocara/engine/event-commands.js";
import {
  isSoundEffectId,
  SOUND_EFFECT_FAMILIES,
  SOUND_EFFECT_IDS,
  SOUND_EFFECTS,
  soundEffect,
} from "@lindocara/engine/sfx-catalog.js";
import { describe, expect, it } from "vitest";

/** Where the client actually serves `/assets/...` from. */
const PUBLIC_ROOT = fileURLToPath(new URL("../../client/public", import.meta.url));

describe("the authored sound catalogue", () => {
  it("ships every file it names", () => {
    const missing = SOUND_EFFECTS.filter(
      (effect) => !existsSync(`${PUBLIC_ROOT}${effect.src}`),
    ).map((effect) => `${effect.id} -> ${effect.src}`);
    expect(missing).toEqual([]);
  });

  it("has unique ids, a known family and a sane level for each", () => {
    expect(new Set(SOUND_EFFECT_IDS).size).toBe(SOUND_EFFECTS.length);
    for (const effect of SOUND_EFFECTS) {
      expect(SOUND_EFFECT_FAMILIES).toContain(effect.family);
      expect(effect.volume).toBeGreaterThan(0);
      expect(effect.volume).toBeLessThanOrEqual(1);
      expect(soundEffect(effect.id)).toBe(effect);
    }
  });

  it("covers the cues the request named by hand", () => {
    // Feedback #25 asked for "'hurting', 'houra', classic rpg stuff" in as many words.
    expect(isSoundEffectId("hurt")).toBe(true);
    expect(isSoundEffectId("cheer")).toBe(true);
    expect(isSoundEffectId("coins")).toBe(true);
    expect(isSoundEffectId("chest")).toBe(true);
    expect(isSoundEffectId("door")).toBe(true);
  });

  it("refuses an id it does not ship, at the parse boundary", () => {
    // The gate is the whole reason ids are a contract: a page naming a cue that does not exist
    // would be a silent nothing at run time, with no way to see why.
    expect(parseEventCommands([{ t: "playSound", soundId: "chest" }])).toEqual([
      { t: "playSound", soundId: "chest" },
    ]);
    expect(parseEventCommands([{ t: "playSound", soundId: "kazoo" }])).toBeNull();
    expect(parseEventCommands([{ t: "playSound" }])).toBeNull();
    expect(parseEventCommands([{ t: "playSound", soundId: 7 }])).toBeNull();
  });
});
