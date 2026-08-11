import { MOVEMENT_GAINS } from "@lindocara/audio/movement.js";
import { movementSkidIntensity, movementSoundCue } from "@lindocara/client/game/movement-sounds.js";
import type { HeroEvent } from "@lindocara/engine/hd2d/hero-state.js";
import { describe, expect, it } from "vitest";

describe("movement sound routing", () => {
  it("owns every audible HeroEvent and gives each material its own footstep", () => {
    const audible: HeroEvent[] = [
      { t: "pas", matiere: "herbe" },
      { t: "pas", matiere: "glace" },
      { t: "brasse" },
      { t: "saut" },
      { t: "reception", force: 1 },
      { t: "entree-eau", x: 0, y: 0, z: 0, rupture: false },
      { t: "sortie-eau", x: 0, y: 0, z: 0 },
      { t: "glace-craque", cle: "0:0", x: 0, z: 0 },
      { t: "glace-rompt", cle: "0:0", x: 0, z: 0 },
      { t: "glider-open" },
    ];
    for (const event of audible) expect(movementSoundCue(event)).not.toBeNull();
    expect(movementSoundCue({ t: "pas", matiere: "herbe" })?.key).toBe("step.grass");
    expect(movementSoundCue({ t: "pas", matiere: "glace" })?.key).toBe("step.ice");
    expect(movementSoundCue({ t: "pas", matiere: "sable" })?.key).toBe("step.sand");
    expect(movementSoundCue({ t: "pas", matiere: "neige" })?.key).toBe("step.snow");
    // Every key it can name must be one the shared bank actually defines, or the sound is simply
    // never heard — with nothing failing anywhere, which is exactly how it would go unnoticed.
    const keys = new Set(Object.keys(movementSampleKeyNames));
    for (const event of audible) {
      const cue = movementSoundCue(event);
      if (cue) expect(keys.has(cue.key)).toBe(true);
    }
  });

  it("scales the landing with the fall, off the same force the camera shake reads", () => {
    const soft = movementSoundCue({ t: "reception", force: 0.35 });
    const hard = movementSoundCue({ t: "reception", force: 1.4 });
    expect(soft?.gain).toBeCloseTo(MOVEMENT_GAINS.land * 0.35, 8);
    expect(hard?.gain).toBeCloseTo(MOVEMENT_GAINS.land * 1.4, 8);
    expect(hard?.gain).toBeGreaterThan(soft?.gain ?? 0);
  });

  it("plays the ice's own plunge when the fall came through a broken sheet", () => {
    expect(movementSoundCue({ t: "entree-eau", x: 0, y: 0, z: 0, rupture: true })?.key).toBe(
      "ice.plunge",
    );
    expect(movementSoundCue({ t: "entree-eau", x: 0, y: 0, z: 0, rupture: false })?.key).toBe(
      "water.enter",
    );
  });

  it("keeps thin ice on the ice footstep, as it already shares its friction", () => {
    expect(movementSoundCue({ t: "pas", matiere: "glace-fine" })?.key).toBe(
      movementSoundCue({ t: "pas", matiere: "glace" })?.key,
    );
  });

  it("keeps visual events silent and reduces held skids to one bounded intensity", () => {
    for (const event of [
      { t: "trace", x: 0, z: 0, cote: 1 },
      { t: "haleine" },
      { t: "glider-close" },
    ] satisfies HeroEvent[]) {
      expect(movementSoundCue(event)).toBeNull();
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

/**
 * The bank's key names, transcribed rather than imported.
 *
 * `@lindocara/audio/assets.js` resolves real files through `import.meta.glob`, which does not exist
 * under this runner — importing it here would fail for a reason that has nothing to do with the
 * routing. Transcribing the names keeps the check honest in the only way that matters: if the
 * package renames a key and this list is not updated, the assertion above fails.
 */
const movementSampleKeyNames = {
  "step.grass": true,
  "step.sand": true,
  "step.snow": true,
  "step.ice": true,
  swim: true,
  jump: true,
  land: true,
  "water.enter": true,
  "water.leave": true,
  "glider.open": true,
  "ice.crack": true,
  "ice.break": true,
  "ice.plunge": true,
};
