import {
  COMBAT_SAMPLES,
  monsterImpactSample,
  uniqueSampleSources,
} from "@lindocara/client/game/combat-sounds.js";
import { describe, expect, it } from "vitest";

describe("monster special impact audio", () => {
  it("maps every typed impact family to an existing bundled combat sample", () => {
    expect(monsterImpactSample("weapon")).toBe("monster.impact_weapon");
    expect(monsterImpactSample("magic")).toBe("monster.impact_magic");
    expect(monsterImpactSample("fire")).toBe("monster.impact_fire");
    expect(monsterImpactSample("heavy")).toBe("monster.impact_heavy");
    for (const kind of ["weapon", "magic", "fire", "heavy"] as const) {
      const sample = COMBAT_SAMPLES[monsterImpactSample(kind)];
      expect(sample.src).toMatch(/^\/assets\/lindocara\/audio\/sfx\/.+\.ogg$/);
      expect(uniqueSampleSources()).toContain(sample.src);
    }
  });
});
