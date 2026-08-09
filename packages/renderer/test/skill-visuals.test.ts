import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import { SKILL_VISUALS, skillVisual } from "@lindocara/renderer/skill-visuals.js";
import { describe, expect, it } from "vitest";

describe("playable skill visual vocabulary", () => {
  it("pins one explicit HD-2D profile to every catalogued skill and no retired id", () => {
    const catalogued = Object.values(CLASS_SKILLS)
      .flatMap((skills) => skills.map((skill) => skill.id))
      .sort();
    const presented = Object.keys(SKILL_VISUALS).sort();

    expect(presented).toEqual(catalogued);
    for (const skillId of catalogued) expect(skillVisual(skillId)).not.toBeNull();
    expect(skillVisual("retired_pixel_attack")).toBeNull();
  });

  it("keeps mobility, healing, projectiles, area skills and trades visually discriminable", () => {
    expect(skillVisual("shield_bash")?.cast).toBe("charge");
    expect(skillVisual("blink")?.cast).toBe("blink");
    expect(skillVisual("mend")?.cast).toBe("heal");
    expect(skillVisual("volley")?.cast).toBe("fan");
    expect(skillVisual("whirlwind")?.cast).toBe("spin");
    expect(skillVisual("vanish")?.cast).toBe("stealth");
    expect(skillVisual("woodcutters_swing")?.cast).toBe("harvest");
    expect(skillVisual("makeshift_camp")?.cast).toBe("construct");
    expect(skillVisual("homemade_bomb")?.cast).toBe("bomb");
  });
});
