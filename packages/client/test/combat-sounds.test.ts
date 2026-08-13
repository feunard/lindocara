import {
  COMBAT_SAMPLES,
  castSampleForSkill,
  consumeSample,
  monsterImpactSample,
  uniqueSampleSources,
} from "@lindocara/client/game/combat-sounds.js";
import { CONSUMABLE_IDS } from "@lindocara/engine/consumables.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
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

describe("dedicated gameplay audio", () => {
  it("maps all 25 hero skills to distinct generated WAV cues", () => {
    const mappings = Object.values(CLASS_SKILLS)
      .flat()
      .map((skill) => castSampleForSkill(skill.id));
    expect(mappings).toHaveLength(25);
    expect(mappings.every(Boolean)).toBe(true);
    expect(new Set(mappings)).toHaveLength(25);
    for (const key of mappings) {
      if (!key) throw new Error("missing skill sound");
      expect(COMBAT_SAMPLES[key].src).toMatch(/^\/assets\/lindocara\/audio\/sfx\/.+\.wav$/);
    }
  });

  it("selects the exact resource hit and gives every quick item its own cue", () => {
    for (const resource of ["wood", "stone", "gold", "meat"] as const) {
      expect(castSampleForSkill("woodcutters_swing", resource)).toBe(`harvest.${resource}`);
    }
    const itemKeys = CONSUMABLE_IDS.map(consumeSample);
    expect(new Set(itemKeys)).toHaveLength(CONSUMABLE_IDS.length);
    for (const key of itemKeys) expect(COMBAT_SAMPLES[key].src).toMatch(/\.wav$/);
  });
});
