import { movementSkidIntensity, movementSoundCue } from "@lindocara/client/game/movement-sounds.js";
import type { HeroEvent } from "@lindocara/engine/hd2d/hero-state.js";
import { describe, expect, it } from "vitest";

describe("movement sound routing", () => {
  it("owns every audible HeroEvent and varies material footsteps", () => {
    const audible: HeroEvent[] = [
      { t: "pas", matiere: "herbe" },
      { t: "pas", matiere: "glace" },
      { t: "brasse" },
      { t: "saut" },
      { t: "reception", force: 8 },
      { t: "entree-eau", x: 0, y: 0, z: 0, rupture: false },
      { t: "sortie-eau", x: 0, y: 0, z: 0 },
      { t: "glace-craque", cle: "0:0", x: 0, z: 0 },
      { t: "glace-rompt", cle: "0:0", x: 0, z: 0 },
      { t: "glider-open" },
    ];
    for (const event of audible) expect(movementSoundCue(event, 0)).not.toBeNull();
    expect(movementSoundCue(audible[0] as HeroEvent, 0)).not.toEqual(
      movementSoundCue(audible[1] as HeroEvent, 0),
    );
  });

  it("keeps visual events silent and reduces held skids to one bounded intensity", () => {
    for (const event of [
      { t: "trace", x: 0, z: 0, cote: 1 },
      { t: "haleine" },
      { t: "glider-close" },
    ] satisfies HeroEvent[]) {
      expect(movementSoundCue(event, 0)).toBeNull();
    }
    expect(
      movementSkidIntensity([
        { t: "glisse", intensite: 0.3 },
        { t: "glisse", intensite: 1.4 },
      ]),
    ).toBe(1);
    expect(movementSkidIntensity([])).toBe(0);
  });
});
